import { describe, expect, it } from "vitest";
import { mergeConfig } from "../src/core/config.js";
import { scanFleet } from "../src/core/scan.js";
import { cannedGit, memFs } from "./helpers.js";

const MARKED_NOW = `# NOW (read me first)

<!-- claudhd: opt-in marker (do not remove) -->

Last touched: 2026-07-10

## Active thread (only one)

**a real thread**

Next physical action:

- [ ] the next step

## Queue (in order, not now)

(nothing queued yet)
`;

const cfg = mergeConfig({
  roots: ["/root"],
  thresholds: { wipSpreadRepos: 99 },
});

const git = cannedGit({
  "rev-parse --abbrev-ref HEAD": "main",
  "status --porcelain": "",
  "rev-list --count @{u}..HEAD": "0",
  "log -1": "2026-07-10T10:00:00\tlast",
  "log --since": "",
  "rev-list --count --since": "0",
});

const clock = { nowMs: () => Date.parse("2026-07-12T12:00:00") };

describe("scanFleet discovery", () => {
  it("classifies marked, git-only, unmarked-no-git, and plain folders", async () => {
    const fs = memFs({
      "/root/marked/NOW.md": MARKED_NOW,
      "/root/marked/.git/HEAD": "ref",
      "/root/gitonly/.git/HEAD": "ref",
      "/root/gitonly/readme.md": "x",
      "/root/unmarked/NOW.md": "# NOW\nno marker here\n## Active thread\n**x**",
      "/root/noise/file.txt": "x",
    });
    const snap = await scanFleet({ fs, git, clock }, cfg);
    expect(snap.cards.map((c) => c.name)).toEqual(["marked"]);
    expect(snap.untracked.map((u) => u.name)).toEqual(["gitonly"]);
    // unmarked NOW.md without .git: discovered, shown nowhere
    expect(snap.cards.length + snap.untracked.length).toBe(2);
  });

  it("honors scanDepth: nested projects appear at depth 2, never at depth 1", async () => {
    const fs = memFs({
      "/root/group/nested/NOW.md": MARKED_NOW,
      "/root/top/NOW.md": MARKED_NOW,
    });
    const depth1 = await scanFleet({ fs, git, clock }, mergeConfig({ roots: ["/root"], thresholds: { wipSpreadRepos: 99 } }));
    expect(depth1.cards.map((c) => c.name)).toEqual(["top"]);

    const depth2 = await scanFleet(
      { fs, git, clock },
      mergeConfig({ roots: ["/root"], scanDepth: 2, thresholds: { wipSpreadRepos: 99 } })
    );
    expect(depth2.cards.map((c) => c.name).sort()).toEqual(["group/nested", "top"]);
  });

  it("a qualifying dir is never descended into (no repos inside repos)", async () => {
    const fs = memFs({
      "/root/outer/.git/HEAD": "ref",
      "/root/outer/inner/NOW.md": MARKED_NOW,
    });
    const snap = await scanFleet(
      { fs, git, clock },
      mergeConfig({ roots: ["/root"], scanDepth: 3, thresholds: { wipSpreadRepos: 99 } })
    );
    expect(snap.untracked.map((u) => u.name)).toEqual(["outer"]);
    expect(snap.cards).toEqual([]);
  });

  it("respects the ignore list", async () => {
    const fs = memFs({
      "/root/keepme/NOW.md": MARKED_NOW,
      "/root/dropme/NOW.md": MARKED_NOW,
    });
    const snap = await scanFleet({ fs, git, clock }, mergeConfig({ roots: ["/root"], ignore: ["dropme"] }));
    expect(snap.cards.map((c) => c.name)).toEqual(["keepme"]);
  });

  it("a marked project with a mangled NOW.md gets a raw-fallback card, not dropped", async () => {
    const fs = memFs({
      "/root/mangled/NOW.md": "<!-- claudhd -->\nfreeform, no headings",
    });
    const snap = await scanFleet({ fs, git, clock }, cfg);
    expect(snap.cards.length).toBe(1);
    expect(snap.cards[0]?.parse.status).toBe("raw-fallback");
  });

  it("reads the human title from CLAUDE.md's first h1", async () => {
    const fs = memFs({
      "/root/proj/NOW.md": MARKED_NOW,
      "/root/proj/CLAUDE.md": "# The Unwoven: A Bastard's Reckoning\n\nbody",
    });
    const snap = await scanFleet({ fs, git, clock }, cfg);
    expect(snap.cards[0]?.title).toBe("The Unwoven: A Bastard's Reckoning");
  });

  it("prefers fresh state.json and labels the source", async () => {
    const state = JSON.stringify({
      schemaVersion: 1,
      generatedAt: "2026-07-12T11:00:00",
      branch: "main",
      cursor: {
        activeThread: "from state",
        activeThreadLineCount: 12,
        nextAction: "next from state",
        lastTouched: "2026-07-12",
        queueCount: 0,
        quickFixCount: 0,
      },
      ideas: { total: 1, untriaged: 1, oldestUntriagedDate: null },
      shipped: { total: 2, lastEntryDate: "2026-07-11" },
      roadmap: { count: 0, topItem: null },
      git: { uncommitted: 0, unpushed: 0, lastCommitAt: null, lastCommitMsg: null },
    });
    const fs = memFs({
      "/root/proj/NOW.md": { text: MARKED_NOW, mtimeMs: Date.parse("2026-07-11T00:00:00") },
      "/root/proj/.now/state.json": { text: state, mtimeMs: Date.parse("2026-07-12T11:00:00") },
    });
    const snap = await scanFleet({ fs, git, clock }, cfg);
    const card = snap.cards[0]!;
    expect(card.source).toBe("state.json");
    expect(card.cursor?.activeThread).toBe("from state");
    // the NOW.md-only facts still ride along
    expect(card.cursor?.grownSections).toEqual([]);
  });

  it("falls back to the NOW.md parse when state.json is stale", async () => {
    const state = JSON.stringify({
      schemaVersion: 1,
      generatedAt: "2026-07-01T00:00:00",
      branch: "main",
      cursor: {
        activeThread: "ancient state",
        activeThreadLineCount: 5,
        nextAction: null,
        lastTouched: "2026-07-01",
        queueCount: 0,
        quickFixCount: 0,
      },
      ideas: null,
      shipped: null,
      roadmap: null,
      git: null,
    });
    const fs = memFs({
      "/root/proj/NOW.md": { text: MARKED_NOW, mtimeMs: Date.parse("2026-07-10T00:00:00") },
      "/root/proj/.now/state.json": { text: state, mtimeMs: Date.parse("2026-07-01T00:00:00") },
    });
    const snap = await scanFleet({ fs, git, clock }, cfg);
    const card = snap.cards[0]!;
    expect(card.source).toBe("now.md");
    expect(card.cursor?.activeThread).toBe("a real thread");
  });
});
