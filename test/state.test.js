"use strict";
/*
 * Tests for state.js - the .now/state.json contract. The parsers are pure
 * (string in, object out), so most cases run without a repo; writeStateAtomic
 * gets its own temp-dir test for the atomic write and temp-file cleanup.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  SCHEMA_VERSION,
  buildState,
  writeStateAtomic,
  cursorFacts,
  ideasFacts,
  shippedFacts,
  roadmapFacts,
} = require("../plugins/claudhd/scripts/state.js");
const { STATE_TEXT_CAP } = require("../plugins/claudhd/scripts/constants.js");

const NOW = [
  "# NOW",
  "<!-- claudhd: opt-in marker -->",
  "",
  "Last touched: 2026-07-08 (some prose after the date)",
  "",
  "## Active thread (only one)",
  "",
  "**build the thing**",
  "",
  "Next physical action:",
  "",
  "- [ ] wire the parser",
  "- [x] already done",
  "",
  "Rule: coaching line",
  "",
  "## Queue",
  "",
  "intro prose here, not a list item",
  "1. first queued",
  "2. second queued",
  "",
  "## Quick fixes",
  "",
  "- [ ] q one",
  "- [ ] q two",
  "- [x] done fix",
  "",
  "## Loose ends",
  "",
  "(none)",
  "",
].join("\n");

test("cursorFacts extracts the thread, its line count, next action, and counts", () => {
  const c = cursorFacts(NOW);
  assert.equal(c.activeThread, "build the thing");
  assert.equal(c.activeThreadLineCount, 10, "heading through the Rule line, trailing blanks trimmed");
  assert.equal(c.nextAction, "wire the parser", "first unchecked step in the section only");
  assert.equal(c.lastTouched, "2026-07-08", "the parsed date, not the freeform remainder");
  assert.equal(c.queueCount, 2, "numbered items, not the intro prose");
  assert.equal(c.quickFixCount, 2, "open items only, the [x] is excluded");
});

test("cursorFacts: a section with no unchecked step yields nextAction null", () => {
  const now = "## Active thread\n\n**done thread**\n\n- [x] finished\n";
  assert.equal(cursorFacts(now).nextAction, null);
});

test("cursorFacts is null when NOW.md content is null (missing file)", () => {
  assert.equal(cursorFacts(null), null);
});

test("ideasFacts counts total/untriaged and finds the oldest untriaged date", () => {
  const ideas = [
    "# IDEAS",
    "## Inbox",
    "",
    "- [ ] 2026-06-30 12:00 (while: x) idea a",
    "- [ ] 2026-07-05 09:00 (while: y) idea b",
    "- [ ] no date on this one",
    "- [~] 2026-07-01 (while: z) promoted",
    "- [x] 2026-06-20 dropped",
  ].join("\n");
  const i = ideasFacts(ideas);
  assert.equal(i.total, 5, "all of [ ] [~] [x]");
  assert.equal(i.untriaged, 3, "only [ ]");
  assert.equal(i.oldestUntriagedDate, "2026-06-30", "min date, ignoring the undated untriaged line");
});

test("ideasFacts: null input and an empty inbox", () => {
  assert.equal(ideasFacts(null), null);
  const empty = ideasFacts("# IDEAS\n## Inbox\n\n(empty)\n");
  assert.deepEqual(empty, { total: 0, untriaged: 0, oldestUntriagedDate: null });
});

test("shippedFacts counts entries and reads the newest date header", () => {
  const shipped = [
    "# SHIPPED",
    "",
    "<!-- last-sha: abc -->",
    "",
    "### 2026-07-08",
    "- chore: release v0.8.0 (`7063122`)",
    "- feat: something (`abc1234`)",
    "",
    "### 2026-07-01",
    "- older thing (`def5678`)",
  ].join("\n");
  const s = shippedFacts(shipped);
  assert.equal(s.total, 3);
  assert.equal(s.lastEntryDate, "2026-07-08", "newest-first, so the first header");
});

test("shippedFacts: null input and a first-run file with only the marker", () => {
  assert.equal(shippedFacts(null), null);
  const fresh = shippedFacts("# SHIPPED\n\nprose.\n\n<!-- last-sha: -->\n");
  assert.deepEqual(fresh, { total: 0, lastEntryDate: null });
});

test("roadmapFacts counts open Next+Later intents and reads the top Next item", () => {
  const roadmap = [
    "# ROADMAP",
    "## Now",
    "- (nothing in flight)",
    "## Next",
    "- [ ] first intent - done: x",
    "- [ ] second intent - done: y",
    "## Later",
    "- [ ] later intent - done: z",
    "## Shipped",
    "- shipped thing",
  ].join("\n");
  const r = roadmapFacts(roadmap);
  assert.equal(r.count, 3, "Next(2) + Later(1); Now and Shipped bullets are not [ ]");
  assert.equal(r.topItem, "first intent - done: x");
});

test("roadmapFacts is null when ROADMAP.md is absent", () => {
  assert.equal(roadmapFacts(null), null);
});

test("buildState assembles the full snapshot with schemaVersion and echoed facts", () => {
  const state = buildState({
    generatedAt: "2026-07-11T14:32:05.000Z",
    branch: "main",
    now: NOW,
    ideas: "# IDEAS\n## Inbox\n\n- [ ] 2026-07-01 (while: t) x\n",
    shipped: "# SHIPPED\n\n### 2026-07-08\n- a (`1234567`)\n",
    roadmap: "# ROADMAP\n## Next\n- [ ] do it - done: y\n",
    git: { uncommitted: 4, unpushed: 6, lastCommitAt: "2026-07-08T12:00:00-07:00", lastCommitMsg: "chore: release" },
  });
  assert.equal(state.schemaVersion, SCHEMA_VERSION);
  assert.equal(state.generatedAt, "2026-07-11T14:32:05.000Z");
  assert.equal(state.branch, "main");
  assert.equal(state.cursor.activeThread, "build the thing");
  assert.equal(state.ideas.untriaged, 1);
  assert.equal(state.shipped.total, 1);
  assert.equal(state.roadmap.topItem, "do it - done: y");
  assert.equal(state.git.uncommitted, 4);
  assert.equal(state.git.unpushed, 6);
  assert.equal(state.git.lastCommitMsg, "chore: release");
});

test("buildState: missing files become null sections, not errors", () => {
  const state = buildState({
    generatedAt: "2026-07-11T00:00:00.000Z",
    branch: null,
    now: NOW,
    ideas: null,
    shipped: null,
    roadmap: null,
    git: { uncommitted: 0, unpushed: null, lastCommitAt: null, lastCommitMsg: null },
  });
  assert.equal(state.branch, null);
  assert.equal(state.ideas, null);
  assert.equal(state.shipped, null);
  assert.equal(state.roadmap, null);
  assert.ok(state.cursor, "cursor still present from NOW.md");
  assert.equal(state.git.unpushed, null, "no upstream stays null, distinct from 0");
  assert.equal(state.git.uncommitted, 0);
});

test("buildState caps free-text fields so a huge source can't bloat the snapshot", () => {
  const huge = "x".repeat(STATE_TEXT_CAP * 4);
  const now = "## Active thread\n\n**" + huge + "**\n\n- [ ] step\n";
  const state = buildState({
    generatedAt: "2026-07-11T00:00:00.000Z",
    branch: "main",
    now,
    ideas: null, shipped: null, roadmap: null,
    git: { uncommitted: 0, unpushed: null, lastCommitAt: null, lastCommitMsg: "z".repeat(STATE_TEXT_CAP * 4) },
  });
  assert.ok(state.cursor.activeThread.length <= STATE_TEXT_CAP, "active thread capped");
  assert.ok(state.git.lastCommitMsg.length <= STATE_TEXT_CAP, "commit subject capped");
});

test("writeStateAtomic writes valid JSON and leaves no temp file behind", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "claudhd-state-"));
  try {
    const nowDir = path.join(dir, ".now");
    const obj = buildState({
      generatedAt: "2026-07-11T00:00:00.000Z",
      branch: "main",
      now: NOW,
      ideas: null, shipped: null, roadmap: null,
      git: { uncommitted: 1, unpushed: 0, lastCommitAt: null, lastCommitMsg: null },
    });
    writeStateAtomic(nowDir, obj);
    const dest = path.join(nowDir, "state.json");
    assert.ok(fs.existsSync(dest), "state.json should exist");
    const parsed = JSON.parse(fs.readFileSync(dest, "utf8"));
    assert.equal(parsed.schemaVersion, SCHEMA_VERSION);
    assert.equal(parsed.cursor.activeThread, "build the thing");
    const leftovers = fs.readdirSync(nowDir).filter((f) => f.includes(".tmp"));
    assert.equal(leftovers.length, 0, "no .tmp file should remain after an atomic write");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
