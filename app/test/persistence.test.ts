import { describe, expect, it } from "vitest";
import type { FleetSnapshot } from "../src/core/model.js";
import {
  appendHistoryLine,
  loadSnapshot,
  readHistoryLines,
  saveSnapshot,
  SNAPSHOT_FILE,
} from "../src/core/persistence.js";
import { failingStore, memStore } from "./helpers.js";

const snap: FleetSnapshot = {
  scannedAtMs: 1000,
  roots: ["/r"],
  cards: [],
  untracked: [],
  fleetFlags: [],
};

describe("snapshot persistence", () => {
  it("round-trips through the store", async () => {
    const store = memStore();
    expect(await saveSnapshot(store, snap, 5000)).toBe(true);
    const loaded = await loadSnapshot(store);
    expect(loaded?.savedAtMs).toBe(5000);
    expect(loaded?.snapshot.roots).toEqual(["/r"]);
  });

  it("missing, torn, or foreign content loads as null, never a throw", async () => {
    expect(await loadSnapshot(memStore())).toBeNull();
    expect(await loadSnapshot(memStore({ [SNAPSHOT_FILE]: "{torn" }))).toBeNull();
    expect(await loadSnapshot(memStore({ [SNAPSHOT_FILE]: JSON.stringify({ other: true }) }))).toBeNull();
  });

  it("a failing store reports false, never a throw", async () => {
    expect(await saveSnapshot(failingStore(), snap, 1)).toBe(false);
  });
});

describe("history jsonl", () => {
  it("appends lines and reads them back", async () => {
    const store = memStore();
    await appendHistoryLine(store, { a: 1 });
    await appendHistoryLine(store, { b: 2 });
    expect(await readHistoryLines(store)).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("a torn line (crash mid-append) is skipped, the rest survive", async () => {
    const store = memStore();
    await appendHistoryLine(store, { ok: 1 });
    store.files.set("history.jsonl", store.files.get("history.jsonl") + '{"torn": tr');
    await store.append("history.jsonl", "");
    await appendHistoryLine(store, { ok: 2 });
    const lines = await readHistoryLines(store);
    expect(lines).toContainEqual({ ok: 1 });
    expect(lines).toContainEqual({ ok: 2 });
    expect(lines.length).toBe(2);
  });
});
