// The courier. Four filesystem reads and one git shell-out, nothing else:
// all logic lives in TypeScript (docs/CONVENTIONS.md, the seam rule).

use serde::Serialize;
use std::process::Command;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            fs_read_text,
            fs_list_dir,
            fs_exists,
            fs_mtime_ms,
            git_run
        ])
        .run(tauri::generate_context!())
        .expect("error while running object permanence");
}
