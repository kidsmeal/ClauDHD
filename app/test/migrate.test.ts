import { describe, expect, it } from "vitest";
import {
  DATA_DIR_NAME,
  LEGACY_DATA_DIR_NAME,
  MIGRATED_FILES,
  planDataDirMigration,
} from "../src/core/migrate.js";

describe("data dir migration decision", () => {
  it("adopts the legacy folder only when there is nothing to adopt into", () => {
    const plan = planDataDirMigration(true, false);
    expect(plan.migrate).toBe(true);
    expect(plan.reason).toBe("legacy folder adopted");
    expect(plan.files).toEqual(["config.json", "history.jsonl", "snapshot.json"]);
  });

  it("does nothing on a fresh install with no legacy folder", () => {
    const plan = planDataDirMigration(false, false);
    expect(plan.migrate).toBe(false);
    expect(plan.reason).toBe("no legacy folder");
    expect(plan.files).toEqual([]);
  });

  it("does nothing once the claudhd folder exists, so a live config is never clobbered by the stale copy", () => {
    expect(planDataDirMigration(true, true).migrate).toBe(false);
    expect(planDataDirMigration(true, true).reason).toBe("already migrated");
  });

  it("is a no-op when neither folder is there and when only the new one is", () => {
    expect(planDataDirMigration(false, true).migrate).toBe(false);
    expect(planDataDirMigration(false, true).reason).toBe("already migrated");
  });

  it("is idempotent: the second run after a migration decides against it", () => {
    const first = planDataDirMigration(true, false);
    expect(first.migrate).toBe(true);
    // the migration created the target, so the legacy folder is still there
    // and the new one now is too
    expect(planDataDirMigration(true, true).migrate).toBe(false);
  });

  it("names the folders the courier uses", () => {
    expect(DATA_DIR_NAME).toBe("claudhd");
    expect(LEGACY_DATA_DIR_NAME).toBe("object-permanence");
    expect(MIGRATED_FILES).toHaveLength(3);
  });
});
