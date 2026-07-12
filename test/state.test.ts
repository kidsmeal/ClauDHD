import { describe, expect, it } from "vitest";
import { parseStateJson } from "../src/core/parse/state.js";

const full = JSON.stringify({
  schemaVersion: 1,
  generatedAt: "2026-07-12T10:00:00.000Z",
  branch: "main",
  cursor: {
    activeThread: "the Loom",
    activeThreadLineCount: 170,
    nextAction: "test loom v1",
    lastTouched: "2026-07-08",
    queueCount: 2,
    quickFixCount: 0,
  },
  ideas: { total: 5, untriaged: 3, oldestUntriagedDate: "2026-06-15" },
  shipped: { total: 40, lastEntryDate: "2026-07-08" },
  roadmap: { count: 4, topItem: "evolution stage B" },
  git: { uncommitted: 0, unpushed: 0, lastCommitAt: "2026-07-08T20:00:00-07:00", lastCommitMsg: "prose guide" },
});

describe("parseStateJson", () => {
  it("reads the full contract", () => {
    const s = parseStateJson(full)!;
    expect(s.meta.generatedAt).toBe("2026-07-12T10:00:00.000Z");
    expect(s.cursor?.activeThreadLineCount).toBe(170);
    expect(s.ideas?.oldestUntriagedDate).toBe("2026-06-15");
    expect(s.roadmap?.topItem).toBe("evolution stage B");
  });

  it("tolerates null sections (checkpoint.js writes null for absent files)", () => {
    const s = parseStateJson(
      JSON.stringify({ schemaVersion: 1, generatedAt: null, branch: null, cursor: null, ideas: null, shipped: null, roadmap: null, git: null })
    )!;
    expect(s).not.toBeNull();
    expect(s.cursor).toBeNull();
    expect(s.ideas).toBeNull();
  });

  it("ignores unknown fields (additive schema)", () => {
    const withExtra = JSON.parse(full);
    withExtra.futureField = { anything: true };
    withExtra.cursor.futureCursorField = 9;
    const s = parseStateJson(JSON.stringify(withExtra))!;
    expect(s.cursor?.activeThread).toBe("the Loom");
  });

  it("rejects a breaking schema bump (caller falls back to the NOW.md parse)", () => {
    const bumped = JSON.parse(full);
    bumped.schemaVersion = 2;
    expect(parseStateJson(JSON.stringify(bumped))).toBeNull();
  });

  it("rejects garbage without throwing", () => {
    expect(parseStateJson("{not json")).toBeNull();
    expect(parseStateJson("[]")).toBeNull();
    expect(parseStateJson(null)).toBeNull();
  });

  it("never carries state.json-absent facts: cap, loose ends, grown sections stay empty", () => {
    const s = parseStateJson(full)!;
    expect(s.cursor?.quickFixCap).toBeNull();
    expect(s.cursor?.looseEndsCount).toBeNull();
    expect(s.cursor?.grownSections).toEqual([]);
  });
});
