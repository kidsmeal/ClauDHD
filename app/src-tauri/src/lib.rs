// The courier. Filesystem reads, one git shell-out, the app's own data-folder
// store, a notify forwarder, and tray residency. All logic lives in
// TypeScript (docs/CONVENTIONS.md, the seam rule); this side never decides.

use notify::{RecursiveMode, Watcher};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use tauri::{Emitter, Manager};

struct WatcherState(Mutex<Option<notify::RecommendedWatcher>>);

#[derive(Serialize)]
struct DirEntry {
    name: String,
    #[serde(rename = "isDir")]
    is_dir: bool,
}

#[tauri::command]
fn fs_read_text(path: String) -> Option<String> {
    std::fs::read_to_string(path).ok()
}

#[tauri::command]
fn fs_list_dir(path: String) -> Option<Vec<DirEntry>> {
    let entries = std::fs::read_dir(path).ok()?;
    let mut out = Vec::new();
    for e in entries.flatten() {
        let is_dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
        out.push(DirEntry {
            name: e.file_name().to_string_lossy().into_owned(),
            is_dir,
        });
    }
    Some(out)
}

#[tauri::command]
fn fs_exists(path: String) -> bool {
    std::path::Path::new(&path).exists()
}

#[tauri::command]
fn fs_mtime_ms(path: String) -> Option<f64> {
    let meta = std::fs::metadata(path).ok()?;
    let mtime = meta.modified().ok()?;
    let dur = mtime.duration_since(std::time::UNIX_EPOCH).ok()?;
    Some(dur.as_millis() as f64)
}

// stdout (trimmed) on success, null on any failure; never a window flash.
#[tauri::command]
fn git_run(repo: String, args: Vec<String>) -> Option<String> {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(repo).args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let out = cmd.output().ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

// --- the app's own data folder (%APPDATA%\claudhd) --------------------------
// The ONLY writable surface the frontend gets. Names are bare filenames;
// anything path-shaped is refused, so project files stay unreachable.
//
// The folder was %APPDATA%\object-permanence before the app was folded into
// claudhd as its desktop window. src/core/migrate.ts holds the decision rule
// and its tests; this mirrors it, the same way idea_append below mirrors
// claudhd's idea.js contract. It has to run here rather than in the frontend
// because data_dir() is the chokepoint every store command goes through,
// including the hidden capture window's, so a frontend-driven migration would
// race the first store touch.

const DATA_DIR_NAME: &str = "claudhd";
const LEGACY_DATA_DIR_NAME: &str = "object-permanence";
const MIGRATED_FILES: [&str; 3] = ["config.json", "history.jsonl", "snapshot.json"];

// One shot, and only ever forward. A claudhd folder that already exists is
// never touched, so a second run cannot overwrite live state with the stale
// copy the legacy folder still holds.
fn should_migrate(legacy_exists: bool, current_exists: bool) -> bool {
    legacy_exists && !current_exists
}

// Copy, never move: the legacy folder is left exactly where it was. A file
// that fails to copy is skipped rather than aborting the rest, so a partial
// legacy folder still brings over what it has.
fn migrate_legacy_data_dir(legacy: &Path, current: &Path) {
    if !should_migrate(legacy.is_dir(), current.exists()) {
        return;
    }
    if std::fs::create_dir_all(current).is_err() {
        return;
    }
    for name in MIGRATED_FILES {
        let from = legacy.join(name);
        if from.is_file() {
            let _ = std::fs::copy(&from, current.join(name));
        }
    }
}

fn data_dir() -> Option<PathBuf> {
    let base = std::env::var_os("APPDATA")?;
    let dir = PathBuf::from(&base).join(DATA_DIR_NAME);
    // Once per process, and before the create_dir_all below can make the
    // "current folder is absent" test answer false forever.
    static MIGRATION: std::sync::Once = std::sync::Once::new();
    MIGRATION.call_once(|| {
        migrate_legacy_data_dir(&PathBuf::from(&base).join(LEGACY_DATA_DIR_NAME), &dir);
    });
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

fn safe_name(name: &str) -> bool {
    !name.is_empty() && !name.contains('/') && !name.contains('\\') && !name.contains("..")
}

#[tauri::command]
fn data_dir_path() -> Option<String> {
    Some(data_dir()?.to_string_lossy().into_owned())
}

#[tauri::command]
fn store_read(name: String) -> Option<String> {
    if !safe_name(&name) {
        return None;
    }
    std::fs::read_to_string(data_dir()?.join(name)).ok()
}

#[tauri::command]
fn store_write(name: String, text: String) -> bool {
    if !safe_name(&name) {
        return false;
    }
    let Some(dir) = data_dir() else { return false };
    let dest = dir.join(&name);
    let tmp = dir.join(format!("{}.{}.tmp", name, std::process::id()));
    if std::fs::write(&tmp, text).is_err() {
        return false;
    }
    // Atomic swap; a watcher holding the destination open can make the rename
    // fail transiently on windows, so retry briefly (same as ClauDHD 0.9).
    for _ in 0..40 {
        match std::fs::rename(&tmp, &dest) {
            Ok(_) => return true,
            Err(_) => {
                let _ = std::fs::remove_file(&dest);
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
        }
    }
    let _ = std::fs::remove_file(&tmp);
    false
}

#[tauri::command]
fn store_append(name: String, line: String) -> bool {
    if !safe_name(&name) {
        return false;
    }
    let Some(dir) = data_dir() else { return false };
    use std::io::Write;
    let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(dir.join(name)) else {
        return false;
    };
    writeln!(f, "{}", line).is_ok()
}

// --- the notify forwarder ---------------------------------------------------
// Watches the given roots recursively and forwards every event path to the
// frontend as an "fs-change" event. The frontend filters and debounces;
// this side never decides what matters.

#[tauri::command]
fn watch_start(app: tauri::AppHandle, state: tauri::State<WatcherState>, paths: Vec<String>) -> bool {
    let handle = app.clone();
    let watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(event) = res {
            for p in event.paths {
                let _ = handle.emit("fs-change", p.to_string_lossy().to_string());
            }
        }
    });
    let Ok(mut watcher) = watcher else { return false };
    let mut any = false;
    for p in &paths {
        if watcher.watch(std::path::Path::new(p), RecursiveMode::Recursive).is_ok() {
            any = true;
        }
    }
    if any {
        *state.0.lock().unwrap() = Some(watcher);
    }
    any
}

// --- the single project-file write (design section 9) ------------------------
// Capture appends one line to a project's IDEAS.md, mirroring ClauDHD's
// idea.js exactly: newest-first under "## Inbox", the "(empty)" placeholder
// removed, the file created from the same header when missing, and the same
// .now/ideas.lock held so a popover capture and a live session capture can
// never clobber each other. Atomic temp+rename. This command and store_*
// are the only writes the courier can perform.

const IDEAS_HEADER: &str = "# IDEAS (capture, do not chase)\n\nWhen an idea comes up mid-task, it is recorded here in one line. Do NOT open a new chat for it; the current thread survives. Triage regularly: each idea is promoted to the NOW.md Queue, kept parked, or dropped.\n\nCapture: `/claudhd:idea <your idea>` in any chat.\nHarvest: `/claudhd:harvest` to backfill ideas from past sessions you never recorded.\nTriage: `/claudhd:triage` to review this list.\n\nLegend: `[ ]` new, `[~]` promoted to NOW.md Queue, `[x]` done or dropped.\n\n## Inbox\n\n(empty)\n";

#[tauri::command]
fn idea_append(project: String, entry: String) -> bool {
    if entry.contains('\n') || entry.trim().is_empty() {
        return false; // one line, always
    }
    let root = PathBuf::from(&project);
    if !root.join("NOW.md").exists() {
        return false; // only claudhd projects are capture targets
    }
    let ideas = root.join("IDEAS.md");
    let lock_dir = root.join(".now");
    let _ = std::fs::create_dir_all(&lock_dir);
    let lock = lock_dir.join("ideas.lock");

    // Directory lock, the exact primitive claudhd's lock.js takes (mkdir /
    // rmdir), so stale-lock recovery stays symmetric between the two tools
    // after a crash: either one can see and clear the other's leftover.
    let mut held = false;
    for _ in 0..40 {
        match std::fs::create_dir(&lock) {
            Ok(_) => {
                held = true;
                break;
            }
            Err(_) => std::thread::sleep(std::time::Duration::from_millis(50)),
        }
    }
    if !held {
        return false; // a stuck lock reports failure, never a silent drop
    }

    let ok = (|| -> Option<()> {
        let mut body = std::fs::read_to_string(&ideas).unwrap_or_else(|_| IDEAS_HEADER.to_string());
        body = body.replace("\n(empty)\n", "\n");
        let inbox = "## Inbox\n";
        if let Some(idx) = body.find(inbox) {
            let split = idx + inbox.len();
            let head = &body[..split];
            let tail = body[split..].trim_start_matches('\n');
            body = format!("{}\n{}\n{}", head, entry, tail);
        } else {
            body = format!("{}\n\n## Inbox\n\n{}\n", body.trim_end(), entry);
        }
        let tmp = root.join(format!("IDEAS.md.{}.tmp", std::process::id()));
        std::fs::write(&tmp, &body).ok()?;
        std::fs::rename(&tmp, &ideas).ok()
    })()
    .is_some();

    let _ = std::fs::remove_dir(&lock);
    ok
}

// Launch a configured template (resume, terminal, open folder) as a detached
// process. False when the spawn fails (missing executable, bad path), so the
// UI reports instead of silently doing nothing.
#[tauri::command]
fn launch_detached(exe: String, args: Vec<String>) -> bool {
    let mut cmd = Command::new(&exe);
    cmd.args(&args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        cmd.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
    }
    cmd.spawn().is_ok()
}

// --- tray + residency --------------------------------------------------------

fn show_main(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // a second launch focuses the existing window
            show_main(app);
        }))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(WatcherState(Mutex::new(None)))
        .setup(|app| {
            use tauri::menu::{MenuBuilder, MenuItemBuilder};
            use tauri::tray::TrayIconBuilder;
            let show = MenuItemBuilder::with_id("show", "show").build(app)?;
            let quit = MenuItemBuilder::with_id("quit", "quit").build(app)?;
            let menu = MenuBuilder::new(app).items(&[&show, &quit]).build()?;
            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("claudhd: still there")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => show_main(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click { .. } = event {
                        show_main(tray.app_handle());
                    }
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // close-to-tray: X hides, quit is explicit from the tray menu.
            // Hiding fires a blur, and the frontend saves its snapshot on
            // blur, so nothing is lost by the hide. The capture popover hides
            // the same way (esc/enter also hide it from the frontend).
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            fs_read_text,
            fs_list_dir,
            fs_exists,
            fs_mtime_ms,
            git_run,
            store_read,
            store_write,
            store_append,
            watch_start,
            idea_append,
            launch_detached,
            data_dir_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running claudhd");
}
