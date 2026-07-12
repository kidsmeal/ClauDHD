// In-memory FileSystem and canned GitRunner for the suites. The fake FS is a
// flat map of forward-slash paths; directories are implied by their children.

import type { DirEntry, FileSystem, GitRunner } from "../src/core/ports.js";

export interface MemFile {
  text: string;
  mtimeMs?: number;
}

export function memFs(files: Record<string, MemFile | string>): FileSystem {
  const map = new Map<string, MemFile>();
  for (const [k, v] of Object.entries(files)) {
    map.set(normalize(k), typeof v === "string" ? { text: v } : v);
  }
  function normalize(p: string): string {
    return p.replace(/\\/g, "/").replace(/\/+$/, "");
  }
  function childrenOf(dir: string): DirEntry[] | null {
    const prefix = normalize(dir) + "/";
    const names = new Map<string, boolean>(); // name -> isDir
    let anyPrefix = false;
    for (const key of map.keys()) {
      if (!key.startsWith(prefix)) continue;
      anyPrefix = true;
      const rest = key.slice(prefix.length);
      const slash = rest.indexOf("/");
      if (slash === -1) names.set(rest, false);
      else {
        const dirName = rest.slice(0, slash);
        if (!names.get(dirName)) names.set(dirName, true);
      }
    }
    if (!anyPrefix) return null;
    return [...names.entries()].map(([name, isDir]) => ({ name, isDir }));
  }
  return {
    async readText(path: string): Promise<string | null> {
      return map.get(normalize(path))?.text ?? null;
    },
    async listDir(path: string): Promise<DirEntry[] | null> {
      return childrenOf(path);
    },
    async exists(path: string): Promise<boolean> {
      const p = normalize(path);
      if (map.has(p)) return true;
      return childrenOf(p) != null;
    },
    async mtimeMs(path: string): Promise<number | null> {
      const f = map.get(normalize(path));
      if (f == null) return null;
      return f.mtimeMs ?? 1_000_000;
    },
  };
}

// Canned git: match on the joined args prefix, per repo path suffix when given.
export function cannedGit(answers: Record<string, string | null>): GitRunner {
  return {
    async run(_repoPath: string, args: string[]): Promise<string | null> {
      const key = args.join(" ");
      for (const [prefix, out] of Object.entries(answers)) {
        if (key.startsWith(prefix)) return out;
      }
      return null;
    },
  };
}

export const deadGit: GitRunner = {
  async run(): Promise<string | null> {
    return null;
  },
};
