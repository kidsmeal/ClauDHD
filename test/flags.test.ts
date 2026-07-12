import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/core/config.js";
import { computeFleetFlags, computeProjectFlags, type CardFacts } from "../src/core/flags.js";
import type { UntrackedRepo } from "../src/core/model.js";

// A fixed "now": 2026-07-12 12:00 local.
const NOW = Date.parse("2026-07-12T12:00:00");
const DAY = 86_400_000;

function facts(over: Partial<CardFacts>): CardFacts {
  return {
    name: "proj",
    path: "/root/proj",
    title: null,
    hasMarker: true,
    source: "now.md",
    parse: { status: "ok" },
    cursor: {
      activeThread: "a real thread",
      activeThreadLineCount: 20,
      nextAction: "do the thing",
      lastTouched: "2026-07-12",
      queueCount: 1,
      quickFixCount: 0,
      quickFixCap: null,
      looseEndsCount: 0,
      grownSections: [],
    },
    ideas: { total: 3, untriaged: 2, oldestUntriagedDate: "2026-07-01" },
    shipped: { total: 10, lastEntryDate: "2026-07-11" },
    shippedRecent: [],
    roadmap: { count: 2, topItem: "x" },
    git: {
      branch: "main",
      uncommitted: 0,
      unpushed: 0,
      lastCommitAt: "2026-07-12T09:00:00",
      lastCommitMsg: "x",
      windowCommits: [],
    },
    checkpoint: { stoppedAt: "2026-07-12 09:30", mtimeMs: NOW - 2 * 3_600_000, branch: "main" },
    stateJson: null,
    plans: [],
    sentinel: null,
    auditMtimeMs: null,
    lastActivityMs: NOW - 3_600_000,
    ...over,
  };
}

function get(flags: ReturnType<typeof computeProjectFlags>, id: string) {
  return flags.find((f) => f.id === id);
}

describe("cursor bloat", () => {
  it("silent under budget, warn over 40, crit over 80", () => {
    expect(get(computeProjectFlags(facts({}), DEFAULT_CONFIG, NOW), "cursor-bloat")).toBeUndefined();
    const c = facts({});
    c.cursor!.activeThreadLineCount = 55;
    expect(get(computeProjectFlags(c, DEFAULT_CONFIG, NOW), "cursor-bloat")?.severity).toBe("warn");
    c.cursor!.activeThreadLineCount = 170;
    c.cursor!.grownSections = ["Parked: story", "NPC text generator"];
    const f = get(computeProjectFlags(c, DEFAULT_CONFIG, NOW), "cursor-bloat");
    expect(f?.severity).toBe("crit");
    expect(f?.evidence.join(" ")).toContain("170");
    expect(f?.evidence.join(" ")).toContain("Parked: story");
    expect(f?.remedy).toBe("/claudhd:wrap");
  });
});

describe("cursor stale", () => {
  it("2+ days of newer activity warns, 5+ crits", () => {
    const c = facts({
      cursor: { ...facts({}).cursor!, lastTouched: "2026-07-08" },
      checkpoint: { stoppedAt: "2026-07-10 22:14", mtimeMs: NOW - 2 * DAY, branch: "main" },
      git: { ...facts({}).git!, lastCommitAt: "2026-07-10T20:00:00" },
    });
    const f = get(computeProjectFlags(c, DEFAULT_CONFIG, NOW), "cursor-stale");
    expect(f?.severity).toBe("warn");
    expect(f?.evidence.join(" ")).toContain("2026-07-08");

    c.checkpoint = { stoppedAt: "2026-07-13 09:00", mtimeMs: NOW, branch: "main" };
    // 5 calendar days past the cursor date
    const f2 = get(computeProjectFlags(c, DEFAULT_CONFIG, NOW), "cursor-stale");
    expect(f2?.severity).toBe("crit");
  });

  it("a session that ended hours ago past the cursor date is the info tier (unwrapped)", () => {
    const c = facts({
      cursor: { ...facts({}).cursor!, lastTouched: "2026-07-11" },
      checkpoint: { stoppedAt: "2026-07-12 01:00", mtimeMs: NOW - 11 * 3_600_000, branch: "main" },
      git: { ...facts({}).git!, lastCommitAt: "2026-07-11T09:00:00" },
    });
    const f = get(computeProjectFlags(c, DEFAULT_CONFIG, NOW), "cursor-stale");
    expect(f?.severity).toBe("info");
    expect(f?.summary).toContain("unwrapped");
  });

  it("cursor touched today with a fresh session raises nothing", () => {
    expect(get(computeProjectFlags(facts({}), DEFAULT_CONFIG, NOW), "cursor-stale")).toBeUndefined();
  });
});

describe("dead cursor", () => {
  it("placeholder thread with activity warns", () => {
    const c = facts({});
    c.cursor!.activeThread = "(name your current focus here)";
    const f = get(computeProjectFlags(c, DEFAULT_CONFIG, NOW), "dead-cursor");
    expect(f?.severity).toBe("warn");
    expect(f?.remedy).toBe("/claudhd:now");
  });

  it("no flag on a raw-fallback parse (parse failure is already loud)", () => {
    const c = facts({ parse: { status: "raw-fallback", reason: "x", raw: "" } });
    c.cursor!.activeThread = null;
    expect(get(computeProjectFlags(c, DEFAULT_CONFIG, NOW), "dead-cursor")).toBeUndefined();
  });
});

describe("section budgets", () => {
  it("the file's own quick-fix cap beats the config default", () => {
    const c = facts({});
    c.cursor!.quickFixCount = 4;
    c.cursor!.quickFixCap = 5;
    expect(get(computeProjectFlags(c, DEFAULT_CONFIG, NOW), "section-budgets")).toBeUndefined();
    c.cursor!.quickFixCap = null; // config default 3
    const f = get(computeProjectFlags(c, DEFAULT_CONFIG, NOW), "section-budgets");
    expect(f?.severity).toBe("warn");
  });

  it("queue and loose ends have budgets", () => {
    const c = facts({});
    c.cursor!.queueCount = 6;
    c.cursor!.looseEndsCount = 9;
    const f = get(computeProjectFlags(c, DEFAULT_CONFIG, NOW), "section-budgets");
    expect(f?.evidence.length).toBe(2);
  });
});

describe("ideas pressure", () => {
  it("warn over 20 untriaged, crit over 40", () => {
    const c = facts({ ideas: { total: 30, untriaged: 25, oldestUntriagedDate: "2026-05-01" } });
    expect(get(computeProjectFlags(c, DEFAULT_CONFIG, NOW), "ideas-pressure")?.severity).toBe("warn");
    const c2 = facts({ ideas: { total: 50, untriaged: 44, oldestUntriagedDate: "2026-05-01" } });
    const f = get(computeProjectFlags(c2, DEFAULT_CONFIG, NOW), "ideas-pressure");
    expect(f?.severity).toBe("crit");
    expect(f?.evidence.join(" ")).toContain("2026-05-01");
  });
});

describe("shipped drought", () => {
  const commits = (paths: string[][]) =>
    paths.map((p, i) => ({
      hash: `h${i}`,
      dateIso: "2026-07-10T10:00:00",
      subject: `commit ${i}`,
      paths: p,
    }));

  it("needs both the commit window and the shipped gap", () => {
    const quiet = facts({});
    expect(get(computeProjectFlags(quiet, DEFAULT_CONFIG, NOW), "shipped-drought")).toBeUndefined();

    const c = facts({
      shipped: { total: 10, lastEntryDate: "2026-06-20" },
      git: {
        ...facts({}).git!,
        windowCommits: commits([["src/a.ts"], ["src/b.ts"], ["design/x.md"], ["src/c.ts"], ["src/d.ts"]]),
      },
    });
    expect(get(computeProjectFlags(c, DEFAULT_CONFIG, NOW), "shipped-drought")?.severity).toBe("warn");
  });

  it("docs-only commit windows escalate to crit (design sessions, no build)", () => {
    const c = facts({
      shipped: { total: 10, lastEntryDate: "2026-06-20" },
      git: {
        ...facts({}).git!,
        windowCommits: commits([["design/x.md"], ["docs/y.md"], ["design/z.md"], ["NOTES.md"], ["design/w.md"]]),
      },
    });
    const f = get(computeProjectFlags(c, DEFAULT_CONFIG, NOW), "shipped-drought");
    expect(f?.severity).toBe("crit");
    expect(f?.remedy).toBe("/claudhd:shipped");
  });

  it("a parked repo (no commits) is idle, never a drought", () => {
    const c = facts({ shipped: { total: 10, lastEntryDate: "2026-05-01" } });
    expect(get(computeProjectFlags(c, DEFAULT_CONFIG, NOW), "shipped-drought")).toBeUndefined();
  });
});

describe("debt", () => {
  it("uncommitted is warn-only; unpushed carries crit", () => {
    const c = facts({ git: { ...facts({}).git!, uncommitted: 9 } });
    expect(get(computeProjectFlags(c, DEFAULT_CONFIG, NOW), "debt")?.severity).toBe("warn");

    const c2 = facts({ git: { ...facts({}).git!, uncommitted: 40, unpushed: 4 } });
    expect(get(computeProjectFlags(c2, DEFAULT_CONFIG, NOW), "debt")?.severity).toBe("warn");

    const c3 = facts({ git: { ...facts({}).git!, unpushed: 11 } });
    expect(get(computeProjectFlags(c3, DEFAULT_CONFIG, NOW), "debt")?.severity).toBe("crit");
  });

  it("no upstream is not debt", () => {
    const c = facts({ git: { ...facts({}).git!, unpushed: null } });
    expect(get(computeProjectFlags(c, DEFAULT_CONFIG, NOW), "debt")).toBeUndefined();
  });
});

describe("idle", () => {
  it("info after 7 quiet days, never above info", () => {
    const c = facts({ lastActivityMs: NOW - 9 * DAY });
    const f = get(computeProjectFlags(c, DEFAULT_CONFIG, NOW), "idle");
    expect(f?.severity).toBe("info");
    expect(f?.summary).toContain("9d");
  });
});

describe("stalled plan", () => {
  it("an old sentinel is itself the signal", () => {
    const c = facts({
      sentinel: { plan: "design/x-plan.md", phase: "3", started: "2026-07-01", mtimeMs: NOW - 11 * DAY },
    });
    const f = get(computeProjectFlags(c, DEFAULT_CONFIG, NOW), "stalled-plan");
    expect(f?.severity).toBe("warn");
    expect(f?.evidence.join(" ")).toContain("active-phase.json");
  });

  it("an incomplete plan the repo moved past fires; a completed plan never does", () => {
    const base = {
      file: "design/x-plan.md",
      basis: "status" as const,
      mtimeMs: NOW - 2 * DAY,
      phases: [],
    };
    const c = facts({
      plans: [{ ...base, phasesTotal: 5, phasesDone: 2, commitsSinceMtime: 14 }],
    });
    expect(get(computeProjectFlags(c, DEFAULT_CONFIG, NOW), "stalled-plan")?.severity).toBe("warn");

    const done = facts({
      plans: [{ ...base, phasesTotal: 5, phasesDone: 5, commitsSinceMtime: 50 }],
    });
    expect(get(computeProjectFlags(done, DEFAULT_CONFIG, NOW), "stalled-plan")).toBeUndefined();
  });
});

describe("audit stale", () => {
  it("info on an active repo with an old audit; silent on an idle repo", () => {
    const c = facts({ auditMtimeMs: NOW - 40 * DAY });
    expect(get(computeProjectFlags(c, DEFAULT_CONFIG, NOW), "audit-stale")?.severity).toBe("info");

    const idle = facts({ auditMtimeMs: NOW - 40 * DAY, lastActivityMs: NOW - 30 * DAY });
    expect(get(computeProjectFlags(idle, DEFAULT_CONFIG, NOW), "audit-stale")).toBeUndefined();
  });
});

describe("hooks not firing", () => {
  it("recent commits with a long-dead checkpoint warns and marks the card suspect", () => {
    const c = facts({
      checkpoint: null,
      git: { ...facts({}).git!, lastCommitAt: "2026-07-11T10:00:00" },
    });
    const f = get(computeProjectFlags(c, DEFAULT_CONFIG, NOW), "hooks-not-firing");
    expect(f?.severity).toBe("warn");
    expect(f?.evidence.join(" ")).toContain("suspect");
  });

  it("a fresh checkpoint keeps it silent", () => {
    expect(get(computeProjectFlags(facts({}), DEFAULT_CONFIG, NOW), "hooks-not-firing")).toBeUndefined();
  });
});

describe("fleet wip spread", () => {
  it("three dirty repos across cards and shelf raise the banner naming them", () => {
    const dirtyCard = facts({ name: "assassinrpg", git: { ...facts({}).git!, uncommitted: 2 } });
    const cleanCard = facts({ name: "bakingapp" });
    const shelf: UntrackedRepo[] = [
      { name: "humanizer", path: "/r/h", uncommitted: 2, unpushed: 0 },
      { name: "Github", path: "/r/g", uncommitted: 1, unpushed: null },
      { name: "terminus", path: "/r/t", uncommitted: 0, unpushed: 0 },
    ];
    const flags = computeFleetFlags([dirtyCard, cleanCard], shelf, DEFAULT_CONFIG);
    expect(flags.length).toBe(1);
    expect(flags[0]?.summary).toContain("3 repos dirty");
    expect(flags[0]?.evidence.join(" ")).toContain("humanizer");

    const fewer = computeFleetFlags([cleanCard], shelf.slice(0, 2), DEFAULT_CONFIG);
    expect(fewer.length).toBe(0);
  });
});
