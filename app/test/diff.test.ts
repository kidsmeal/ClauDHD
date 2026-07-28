import { describe, expect, it } from "vitest";
import { gapLabel, sinceLastOpen } from "../src/core/diff.js";
import type { FleetSnapshot, ProjectCard } from "../src/core/model.js";

function card(name: string, over: Partial<ProjectCard> = {}): ProjectCard {
  return {
    name,
    path: "/r/" + name,
    title: null,
    hasMarker: true,
    source: "now.md",
    parse: { status: "ok" },
    cursor: {
      activeThread: "thread",
      activeThreadLineCount: 10,
      nextAction: null,
      lastTouched: "2026-07-10",
      queueCount: 0,
      quickFixCount: 0,
      quickFixCap: null,
      looseEndsCount: 0,
      grownSections: [],
    },
    ideas: { total: 2, untriaged: 1, oldestUntriagedDate: null },
    shipped: { total: 5, lastEntryDate: "2026-07-01" },
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
    ...over,
  };
}

function snap(cards: ProjectCard[]): FleetSnapshot {
  return { scannedAtMs: 0, roots: [], cards, untracked: [], fleetFlags: [] };
}

describe("sinceLastOpen", () => {
  it("empty when nothing changed", () => {
    expect(sinceLastOpen(snap([card("a")]), snap([card("a")]))).toEqual([]);
  });

  it("reports a moved cursor", () => {
    const next = card("a");
    next.cursor!.activeThread = "a new thread";
    const lines = sinceLastOpen(snap([card("a")]), snap([next]));
    expect(lines).toEqual([{ kind: "~", project: "a", text: "cursor moved: a new thread" }]);
  });

  it("reports shipped and ideas deltas", () => {
    const next = card("a", {
      shipped: { total: 7, lastEntryDate: "2026-07-12" },
      ideas: { total: 6, untriaged: 4, oldestUntriagedDate: null },
    });
    const lines = sinceLastOpen(snap([card("a")]), snap([next]));
    expect(lines).toContainEqual({ kind: "+", project: "a", text: "shipped 2 entries (last 2026-07-12)" });
    expect(lines).toContainEqual({ kind: "~", project: "a", text: "+3 ideas (now 4 untriaged)" });
  });

  it("reports flags raised, cleared, and severity moves", () => {
    const f = (sev: "warn" | "crit") => ({
      id: "cursor-bloat" as const,
      severity: sev,
      summary: "x",
      evidence: ["e"],
      remedy: null,
    });
    const raised = sinceLastOpen(snap([card("a")]), snap([card("a", { flags: [f("warn")] })]));
    expect(raised).toContainEqual({ kind: "~", project: "a", text: "cursor-bloat raised (warn)" });

    const escalated = sinceLastOpen(snap([card("a", { flags: [f("warn")] })]), snap([card("a", { flags: [f("crit")] })]));
    expect(escalated).toContainEqual({ kind: "~", project: "a", text: "cursor-bloat warn -> crit" });

    const cleared = sinceLastOpen(snap([card("a", { flags: [f("warn")] })]), snap([card("a")]));
    expect(cleared).toContainEqual({ kind: "+", project: "a", text: "cursor-bloat cleared" });
  });

  it("reports appeared and vanished projects", () => {
    expect(sinceLastOpen(snap([]), snap([card("new")]))).toContainEqual({
      kind: "+",
      project: "new",
      text: "new project appeared",
    });
    expect(sinceLastOpen(snap([card("old")]), snap([]))).toContainEqual({
      kind: "~",
      project: "old",
      text: "project no longer found under the roots",
    });
  });
});

describe("gapLabel", () => {
  const H = 3_600_000;
  it("states the gap in hours then days", () => {
    expect(gapLabel(0, 30 * 60_000)).toBe("under an hour");
    expect(gapLabel(0, 5 * H)).toBe("5h");
    expect(gapLabel(0, 72 * H)).toBe("3 days");
  });
});
