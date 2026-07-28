// The seam. src/core imports nothing from node or tauri; the environment
// arrives through these four interfaces. src/adapters/node.ts fills them for
// vitest and the acceptance script, src/adapters/tauri.ts for the app.

export interface DirEntry {
  name: string;
  isDir: boolean;
}

export interface FileSystem {
  // null when the file does not exist or cannot be read.
  readText(path: string): Promise<string | null>;
  // null when the directory does not exist.
  listDir(path: string): Promise<DirEntry[] | null>;
  exists(path: string): Promise<boolean>;
  // null when the path does not exist.
  mtimeMs(path: string): Promise<number | null>;
}

export interface GitRunner {
  // stdout (trimmed) on success, null on any failure. Never throws.
  run(repoPath: string, args: string[]): Promise<string | null>;
}

export interface Clock {
  nowMs(): number;
}

export interface DataDir {
  // %APPDATA%\claudhd in the real app, a temp dir in tests.
  path(): string;
}

// The app's own folder is the ONLY place it writes (plus the single capture
// append in phase 5). Project files stay unreachable through this port: names
// are bare filenames inside the data dir, never paths.
export interface AppStore {
  read(name: string): Promise<string | null>;
  // Atomic: temp file then rename. False on failure, never a throw.
  write(name: string, text: string): Promise<boolean>;
  append(name: string, line: string): Promise<boolean>;
}

// Forward slashes work on windows everywhere we shell out or read; core code
// never touches node:path.
export function joinPath(...parts: string[]): string {
  return parts
    .map((p, i) => (i === 0 ? p.replace(/[\\/]+$/, "") : p.replace(/^[\\/]+|[\\/]+$/g, "")))
    .filter((p) => p.length > 0)
    .join("/");
}
