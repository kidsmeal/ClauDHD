import { describe, expect, it } from "vitest";
import {
  appendTransitions,
  computeTransitions,
  fireRates,
  readTransitions,
  type Transition,
} from "../src/core/history.js";
import type { Flag, FleetSnapshot, ProjectCard } from "../src/core/model.js";
import { memStore } from "./helpers.js";

function flag(id: Flag["id"], severity: Flag["severity"]): Flag {
  return { id, severity, summary: `${id} summary`, evidence: [`${id} evidence line`], remedy: null };
}

function card(name: string, flags: Flag[]): ProjectCard {
  return {
    name,
    path: "/r/" + name,
    title: null,
    hasMarker: true,
    source: "now.md",
    parse: { status: "ok" },
    cursor: null,
    ideas: null,
    shipped: null,
    shippedRecent: [],
    roadmap: null,
    git: null,
    checkpoint: null,
    stateJson: null,
    plans: [],
    sentinel: null,
    auditMtimeMs: null,
    flags,
    lastActivityMs: 0,
  };
}

function snap(cards: ProjectCard[], fleetFlags: Flag[] = []): FleetSnapshot {
  return { scannedAtMs: 0, roots: [], cards, untracked: [], fleetFlags };
}

describe("computeTransitions", () => {
  it("no change records nothing (standing state never inflates the counts)", () => {
    const a = snap([card("p", [flag("debt", "warn")])]);
    expect(computeTransitions(a, snap([card("p", [flag("debt", "warn")])]), 1)).toEqual([]);
  });

  it("records raised, severity move, and cleared with evidence attached", () => {
    const before = snap([card("p", [flag("debt", "warn"), flag("idle", "info")])]);
    const after = snap([card("p", [flag("debt", "crit"), flag("cursor-bloat", "warn")])]);
    const t = computeTransitions(before, after, 99);

    expect(t).toContainEqual(
      expect.objectContaining({ project: "p", flagId: "debt", kind: "severity", from: "warn", to: "crit", atMs: 99 })
    );
    expect(t).toContainEqual(
      expect.objectContaining({ project: "p", flagId: "cursor-bloat", kind: "raised", from: null, to: "warn" })
    );
    expect(t).toContainEqual(
      expect.objectContaining({ project: "p", flagId: "idle", kind: "cleared", from: "info", to: null })
    );
    for (const tr of t) expect(tr.evidence.length).toBeGreaterThan(0);
  });

  it("fleet flags transition under the project name fleet", () => {
    const t = computeTransitions(snap([]), snap([], [flag("wip-spread", "warn")]), 1);
    expect(t).toEqual([
      expect.objectContaining({ project: "fleet", flagId: "wip-spread", kind: "raised" }),
    ]);
  });

  it("a vanished project is unobserved, never a burst of cleared flags", () => {
    const before = snap([card("gone", [flag("debt", "warn"), flag("idle", "info")])]);
    expect(computeTransitions(before, snap([]), 1)).toEqual([]);
  });
});

describe("history persistence round trip", () => {
  it("appended transitions survive restart (read back from the store)", async () => {
    const store = memStore();
    const t = computeTransitions(snap([card("p", [])]), snap([card("p", [flag("debt", "warn")])]), 7);
    await appendTransitions(store, t);
    const back = await readTransitions(store);
    expect(back.length).toBe(1);
    expect(back[0]).toMatchObject({ project: "p", flagId: "debt", kind: "raised", atMs: 7 });
  });

  it("foreign lines in the file are skipped, not fatal", async () => {
    const store = memStore({ "history.jsonl": '{"not":"a transition"}\n' });
    await appendTransitions(store, [
      { atMs: 1, project: "p", flagId: "x", kind: "raised", from: null, to: "warn", summary: "s", evidence: ["e"] },
    ]);
    const back = await readTransitions(store);
    expect(back.length).toBe(1);
  });
});

describe("fireRates", () => {
  it("counts raises, clears, and severity moves per project/flag", () => {
    const t: Transition[] = [
      { atMs: 1, project: "p", flagId: "debt", kind: "raised", from: null, to: "warn", summary: "", evidence: [] },
      { atMs: 2, project: "p", flagId: "debt", kind: "cleared", from: "warn", to: null, summary: "", evidence: [] },
      { atMs: 3, project: "p", flagId: "debt", kind: "raised", from: null, to: "warn", summary: "", evidence: [] },
      { atMs: 4, project: "p", flagId: "debt", kind: "severity", from: "warn", to: "crit", summary: "", evidence: [] },
      { atMs: 5, project: "q", flagId: "idle", kind: "raised", from: null, to: "info", summary: "", evidence: [] },
    ];
    const rates = fireRates(t);
    expect(rates[0]).toMatchObject({ project: "p", flagId: "debt", raised: 2, cleared: 1, severityMoves: 1, lastAtMs: 4 });
    expect(rates[1]).toMatchObject({ project: "q", flagId: "idle", raised: 1 });
  });
});
