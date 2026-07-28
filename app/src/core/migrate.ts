// Where the app's own folder lives, and the one-shot move of the folder it
// used to live in. The app persisted to %APPDATA%\object-permanence before it
// was folded into claudhd as its desktop window; %APPDATA%\claudhd is the
// target now.
//
// The decision rule is here, pure and tested. The courier
// (src-tauri/src/lib.rs) mirrors it, the same way idea_append mirrors
// claudhd's idea.js contract: data_dir() is the chokepoint every store command
// goes through, including the hidden capture window's, so a frontend-driven
// migration would race the first store touch.

export const DATA_DIR_NAME = "claudhd";
export const LEGACY_DATA_DIR_NAME = "object-permanence";

// Everything the old folder held. config.json is the user's tuning, snapshot
// is the since-last-open baseline, history is the fire-rate log.
export const MIGRATED_FILES = ["config.json", "history.jsonl", "snapshot.json"] as const;

export type MigrationReason =
  | "no legacy folder"
  | "already migrated"
  | "legacy folder adopted";

export interface DataDirMigration {
  migrate: boolean;
  files: readonly string[];
  reason: MigrationReason;
}

// One shot, and only ever forward. A claudhd folder that already exists is
// never touched, so a second run cannot overwrite live state with the stale
// copy the old folder still holds. The legacy folder is left in place either
// way; nothing here deletes.
export function planDataDirMigration(legacyExists: boolean, currentExists: boolean): DataDirMigration {
  if (currentExists) return { migrate: false, files: [], reason: "already migrated" };
  if (!legacyExists) return { migrate: false, files: [], reason: "no legacy folder" };
  return { migrate: true, files: MIGRATED_FILES, reason: "legacy folder adopted" };
}
