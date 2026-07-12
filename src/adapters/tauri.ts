// Tauri adapter: fills the core's ports over the Rust courier's commands.

import { invoke } from "@tauri-apps/api/core";
import type { Clock, DirEntry, FileSystem, GitRunner } from "../core/ports.js";

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

export function isTauri(): boolean {
  return "__TAURI_INTERNALS__" in window;
}
