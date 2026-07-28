import { describe, expect, it } from "vitest";
import type { FleetSnapshot, ProjectCard } from "../src/core/model.js";
import { revalidate, revalidationLabel } from "../src/core/revalidate.js";

function card(name: string, thread: string): ProjectCard {
  return {
    name,
    path: "/r/" + name,
    title: null,
    hasMarker: true,
    source: "now.md",
    parse: { status: "ok" },
    cursor: {
      activeThread: thread,
      activeThreadLineCount: 10,
      nextAction: null,
      lastTouched: "2026-07-10",
      queueCount: 0,
      quickFixCount: 0,
      quickFixCap: null,
      looseEndsCount: 0,
      grownSections: [],
    },
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
    flags: [],
    lastActivityMs: 0,
  };
}

function snap(cards: ProjectCard[]): FleetSnapshot {
  return { scannedAtMs: 0, roots: [], cards, untracked: [], fleetFlags: [] };
}

describe("revalidate", () => {
  it("clean when the fresh scan matches (no dropped events)", () => {
    const r = revalidate(snap([card("a", "t")]), snap([card("a", "t")]), 999);
    expect(r.clean).toBe(true);
    expect(revalidationLabel(r)).toContain("revalidated clean");
  });

  it("a change the watcher missed is reconciled and reported, never hidden", () => {
    const r = revalidate(snap([card("a", "old thread")]), snap([card("a", "edited while unfocused")]), 999);
    expect(r.clean).toBe(false);
    expect(r.changes.length).toBe(1);
    expect(revalidationLabel(r)).toContain("reconciled 1 change");
  });

  it("no revalidation yet is stated, not implied clean", () => {
    expect(revalidationLabel(null)).toBe("not yet revalidated");
  });
});
