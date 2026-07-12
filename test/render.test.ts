// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import type { FleetSnapshot, ProjectCard } from "../src/core/model.js";
import { initRender, paint } from "../src/ui/render.js";
import { onPaint, store } from "../src/ui/store.js";

function card(name: string, over: Partial<ProjectCard> = {}): ProjectCard {
  return {
    name,
    path: "/r/" + name,
    title: null,
    hasMarker: true,
    source: "now.md",
    parse: { status: "ok" },
    cursor: {
      activeThread: "thread of " + name,
      activeThreadLineCount: 12,
      nextAction: "next for " + name,
      lastTouched: "2026-07-12",
      queueCount: 0,
      quickFixCount: 0,
      quickFixCap: null,
      looseEndsCount: 0,
      grownSections: [],
    },
    ideas: { total: 0, untriaged: 0, oldestUntriagedDate: null },
    shipped: { total: 1, lastEntryDate: "2026-07-11" },
    shippedRecent: [],
    roadmap: null,
    git: {
      branch: "main",
      uncommitted: 0,
      unpushed: 0,
      lastCommitAt: "2026-07-12T09:00:00",
      lastCommitMsg: "x",
      windowCommits: [],
    },
    checkpoint: null,
    stateJson: null,
    plans: [],
    sentinel: null,
    auditMtimeMs: null,
    flags: [
      {
        id: "cursor-bloat",
        severity: "warn",
        summary: "cursor bloat: active thread 55 lines",
        evidence: ["active thread section: 55 lines, budget 40"],
        remedy: "/claudhd:wrap",
      },
    ],
    lastActivityMs: Date.parse("2026-07-12T09:00:00"),
    ...over,
  };
}

function snapshot(cards: ProjectCard[]): FleetSnapshot {
  return {
    scannedAtMs: Date.parse("2026-07-12T12:00:00"),
    roots: ["/r"],
    cards,
    untracked: [],
    fleetFlags: [],
  };
}

beforeEach(() => {
  document.body.innerHTML = `<div id="app"></div>`;
  store.route = { view: "fleet" };
  store.snapshot = null;
  store.scanning = false;
  store.scanError = null;
  store.expanded = new Set();
  store.dataMode = "test";
  onPaint(paint);
  initRender(document.getElementById("app")!, { now: () => Date.parse("2026-07-12T12:00:00") });
});

describe("paint reconciles cards by key", () => {
  it("rebuilds only the card whose data changed", () => {
    const a = card("alpha");
    const b = card("beta");
    store.snapshot = snapshot([a, b]);
    paint();
    const alphaBefore = document.querySelector('[data-card="alpha"]');
    const betaBefore = document.querySelector('[data-card="beta"]');
    expect(alphaBefore).not.toBeNull();

    // mutate beta only (replace with a changed clone, as a rescan would)
    const b2 = card("beta");
    b2.cursor!.activeThread = "a new thread";
    store.snapshot = snapshot([a, b2]);
    paint();

    const alphaAfter = document.querySelector('[data-card="alpha"]');
    const betaAfter = document.querySelector('[data-card="beta"]');
    expect(alphaAfter).toBe(alphaBefore); // same DOM node, untouched
    expect(betaAfter).not.toBe(betaBefore); // rebuilt
    expect(betaAfter?.textContent).toContain("a new thread");
  });

  it("toggling evidence rebuilds that card and shows the evidence", () => {
    store.snapshot = snapshot([card("alpha")]);
    paint();
    expect(document.querySelector(".evidence")?.hasAttribute("hidden")).toBe(true);
    (document.querySelector("[data-toggle-flag]") as HTMLElement).click();
    expect(document.querySelector(".evidence")?.hasAttribute("hidden")).toBe(false);
    expect(document.querySelector(".evidence")?.textContent).toContain("budget 40");
  });
});

describe("raw-fallback card state", () => {
  it("shows the reason and the raw file, drops nothing silently", () => {
    const broken = card("broken", {
      parse: { status: "raw-fallback", reason: "no '## Active thread' section found", raw: "the raw braindump text" },
    });
    store.snapshot = snapshot([broken]);
    paint();
    const el = document.querySelector('[data-card="broken"]')!;
    expect(el.textContent).toContain("could not parse NOW.md");
    expect(el.textContent).toContain("showing raw");
    expect(el.textContent).toContain("the raw braindump text");
  });
});

describe("escaping", () => {
  it("file-derived strings render inert", () => {
    const evil = card("evil");
    evil.cursor!.activeThread = '<img src=x onerror="window.pwned=1">';
    store.snapshot = snapshot([evil]);
    paint();
    expect(document.querySelector("img")).toBeNull();
    expect((window as unknown as Record<string, unknown>)["pwned"]).toBeUndefined();
    expect(document.querySelector('[data-card="evil"]')?.textContent).toContain("<img");
  });
});

describe("detail view", () => {
  it("renders the card's sections and the phase-5 stubs stay inert", () => {
    const a = card("alpha", {
      shippedRecent: [
        { date: "2026-07-08", text: "prose style guide shipped" },
        { date: null, text: "an undated entry" },
      ],
    });
    store.snapshot = snapshot([a]);
    store.route = { view: "detail", name: "alpha" };
    paint();
    const page = document.getElementById("app")!;
    expect(page.textContent).toContain("cursor (NOW.md)");
    expect(page.textContent).toContain("recent shipped");
    expect(page.textContent).toContain("prose style guide shipped");
    expect(page.textContent).toContain("??"); // the honest null-date marker
    const resume = Array.from(page.querySelectorAll("button")).find((b) => b.textContent?.includes("resume"));
    expect(resume?.disabled).toBe(true);
  });
});
