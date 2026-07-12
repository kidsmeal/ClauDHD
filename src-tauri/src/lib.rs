// The courier. Filesystem reads, one git shell-out, the app's own data-folder
// store, a notify forwarder, and tray residency. All logic lives in
// TypeScript (docs/CONVENTIONS.md, the seam rule); this side never decides.

use notify::{RecursiveMode, Watcher};
use serde::Serialize;
use std::path::PathBuf;
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

// --- the app's own data folder (%APPDATA%\object-permanence) ---------------
// The ONLY writable surface the frontend gets. Names are bare filenames;
// anything path-shaped is refused, so project files stay unreachable.

fn data_dir() -> Option<PathBuf> {
    let base = std::env::var_os("APPDATA")?;
    let dir = PathBuf::from(base).join("object-permanence");
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

fn safe_name(name: &str) -> bool {
    !name.is_empty() && !name.contains('/') && !name.contains('\\') && !name.contains("..")
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
        .manage(WatcherState(Mutex::new(None)))
        .setup(|app| {
            use tauri::menu::{MenuBuilder, MenuItemBuilder};
            use tauri::tray::TrayIconBuilder;
            let show = MenuItemBuilder::with_id("show", "show").build(app)?;
            let quit = MenuItemBuilder::with_id("quit", "quit").build(app)?;
            let menu = MenuBuilder::new(app).items(&[&show, &quit]).build()?;
            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("object permanence: still there")
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
            // blur, so nothing is lost by the hide.
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
            watch_start
        ])
        .run(tauri::generate_context!())
        .expect("error while running object permanence");
}
