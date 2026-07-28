// Tauri adapter: fills the core's ports over the Rust courier's commands.

import { invoke } from "@tauri-apps/api/core";
import type { AppStore, Clock, DirEntry, FileSystem, GitRunner } from "../core/ports.js";

export const tauriFs: FileSystem = {
  async readText(path: string): Promise<string | null> {
    return await invoke<string | null>("fs_read_text", { path });
  },
  async listDir(path: string): Promise<DirEntry[] | null> {
    return await invoke<DirEntry[] | null>("fs_list_dir", { path });
  },
  async exists(path: string): Promise<boolean> {
    return await invoke<boolean>("fs_exists", { path });
  },
  async mtimeMs(path: string): Promise<number | null> {
    return await invoke<number | null>("fs_mtime_ms", { path });
  },
};

export const tauriGit: GitRunner = {
  async run(repoPath: string, args: string[]): Promise<string | null> {
    return await invoke<string | null>("git_run", { repo: repoPath, args });
  },
};

export const tauriClock: Clock = {
  nowMs: () => Date.now(),
};

export const tauriStore: AppStore = {
  async read(name: string): Promise<string | null> {
    return await invoke<string | null>("store_read", { name });
  },
  async write(name: string, text: string): Promise<boolean> {
    return await invoke<boolean>("store_write", { name, text });
  },
  async append(name: string, line: string): Promise<boolean> {
    return await invoke<boolean>("store_append", { name, line });
  },
};

export async function startWatch(paths: string[]): Promise<boolean> {
  return await invoke<boolean>("watch_start", { paths });
}

// The single project-file write (design section 9): one line into IDEAS.md.
export async function ideaAppend(projectPath: string, entryLine: string): Promise<boolean> {
  return await invoke<boolean>("idea_append", { project: projectPath, entry: entryLine });
}

export async function launchDetached(exe: string, args: string[]): Promise<boolean> {
  return await invoke<boolean>("launch_detached", { exe, args });
}

export function isTauri(): boolean {
  return "__TAURI_INTERNALS__" in window;
}
