// Node adapter: fills the core's ports for vitest and the acceptance script.
// The only file besides src-tauri allowed to import node builtins.

import { execFile } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import { DATA_DIR_NAME } from "../core/migrate.js";
import type { Clock, DataDir, DirEntry, FileSystem, GitRunner } from "../core/ports.js";

export const nodeFs: FileSystem = {
  async readText(path: string): Promise<string | null> {
    try {
      return await readFile(path, "utf8");
    } catch {
      return null;
    }
  },
  async listDir(path: string): Promise<DirEntry[] | null> {
    try {
      const entries = await readdir(path, { withFileTypes: true });
      return entries.map((e) => ({ name: e.name, isDir: e.isDirectory() }));
    } catch {
      return null;
    }
  },
  async exists(path: string): Promise<boolean> {
    try {
      await stat(path);
      return true;
    } catch {
      return false;
    }
  },
  async mtimeMs(path: string): Promise<number | null> {
    try {
      return (await stat(path)).mtimeMs;
    } catch {
      return null;
    }
  },
};

export const nodeGit: GitRunner = {
  run(repoPath: string, args: string[]): Promise<string | null> {
    return new Promise((resolve) => {
      execFile(
        "git",
        ["-C", repoPath, ...args],
        { encoding: "utf8", timeout: 15_000, windowsHide: true },
        (err, stdout) => {
          if (err) resolve(null);
          else resolve(stdout.trim());
        }
      );
    });
  },
};

export const nodeClock: Clock = {
  nowMs: () => Date.now(),
};

export function nodeDataDir(): DataDir {
  const base = process.env["APPDATA"] ?? ".";
  return { path: () => base + "\\" + DATA_DIR_NAME };
}
