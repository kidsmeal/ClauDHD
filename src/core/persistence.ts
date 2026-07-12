// The app's memory: snapshot.json is the BASELINE, the fleet state the user
// last looked at. It is written on focus loss (plus a one-time boot seed when
// absent) and never by polls or fs events, so unseen drift can never be
// folded into it; since-last-open diffs against it on the next open.
// history.jsonl records flag transitions (appended in phase 4). Everything
// goes through the AppStore port; deleting the folder deletes the memory and
// nothing else changes.

import type { FleetSnapshot } from "./model.js";
import type { AppStore } from "./ports.js";

export const SNAPSHOT_FILE = "snapshot.json";
export const HISTORY_FILE = "history.jsonl";
export const CONFIG_FILE = "config.json";

export interface SavedSnapshot {
  savedAtMs: number;
  snapshot: FleetSnapshot;
}

export async function saveSnapshot(store: AppStore, snapshot: FleetSnapshot, savedAtMs: number): Promise<boolean> {
  const payload: SavedSnapshot = { savedAtMs, snapshot };
  return store.write(SNAPSHOT_FILE, JSON.stringify(payload));
}

export async function loadSnapshot(store: AppStore): Promise<SavedSnapshot | null> {
  const text = await store.read(SNAPSHOT_FILE);
  if (text == null) return null;
  try {
    const parsed = JSON.parse(text) as SavedSnapshot;
    if (typeof parsed.savedAtMs !== "number" || !Array.isArray(parsed.snapshot?.cards)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function appendHistoryLine(store: AppStore, entry: unknown): Promise<boolean> {
  return store.append(HISTORY_FILE, JSON.stringify(entry));
}

export async function readHistoryLines(store: AppStore): Promise<unknown[]> {
  const text = await store.read(HISTORY_FILE);
  if (text == null || text === "") return [];
  const out: unknown[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // a torn line (crash mid-append) is skipped, never fatal
    }
  }
  return out;
}
