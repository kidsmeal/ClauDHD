"use strict";
/*
 * Tests for nowrender.js - the pure state-in/NOW.md-text-out renderer.
 *
 * Load-bearing per the plan's Phase 3 Verification:
 *   1. regenerate NOW.md twice from the same state and get identical output
 *   2. regenerate after an intent-line edit and the intent line survives
 *   3. the opt-in marker survives
 * Plus: facts (mode, plan, phase, from-link, counts) render from state; a
 * thread with no parent renders as unplanned work (B3/design section 4).
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { render } = require("../plugins/claudhd/scripts/nowrender.js");
const { modeLine, fromLine } = require("../plugins/claudhd/scripts/nowfile.js");

const REAL_TEMPLATE = fs.readFileSync(
  path.join(__dirname, "..", "plugins", "claudhd", "templates", "NOW.md"), "utf8"
);

test("render keeps the claudhd opt-in marker in the output", () => {
  const out = render({});
  assert.match(out, /<!-- claudhd/);
});

test("render is pure: the same state renders byte-identical output twice", () => {
  const state = {
    mode: "build",
    from: "r-0725-1",
    build: { plan: "docs/x-plan.md", phase: 2 },
    intent: { thread: "wire the thing", next: "write the test" },
    cursor: { queueCount: 2, quickFixCount: 1 },
    ideas: { untriaged: 3 },
  };
  const a = render(state);
  const b = render(state);
  assert.equal(a, b, "rendering twice from identical state must be idempotent");
});

test("facts render from state: mode, plan, phase, from-link and counts", () => {
  const state = {
    mode: "build",
    from: "r-0725-1",
    build: { plan: "docs/x-plan.md", phase: 2 },
    intent: null,
    cursor: { queueCount: 2, quickFixCount: 1 },
    ideas: { untriaged: 3 },
  };
  const out = render(state);
  assert.match(out, /Mode:\s*build/);
  assert.match(out, /docs\/x-plan\.md/);
  assert.match(out, /phase 2/i);
  assert.match(out, /from:\s*r-0725-1/);
  assert.match(out, /queue 2/i);
  assert.match(out, /quick fixes 1/i);
  assert.match(out, /ideas untriaged 3/i);
});

test("a thread with no parent renders as unplanned work", () => {
  const out = render({ mode: "build", from: null });
  assert.match(out, /from:\s*\(unplanned work\)/i);
});

test("idle mode with no build/design section renders a pick-a-mode prompt, not a crash", () => {
  const out = render({ mode: null });
  assert.match(out, /Mode:\s*\(none/i);
});

test("intent lines render into the Active thread section", () => {
  const out = render({ intent: { thread: "wire the parser", next: "write the failing test" } });
  assert.match(out, /\*\*wire the parser\*\*/);
  assert.match(out, /- \[ \] write the failing test/);
});

test("intent lines survive a regeneration (state is the only source, never re-parsed from NOW.md)", () => {
  const state = { intent: { thread: "wire the parser", next: "write the failing test" } };
  const out1 = render(state);
  const out2 = render(state);
  assert.equal(out1, out2, "same intent, regenerated, must render identically");
  assert.match(out2, /\*\*wire the parser\*\*/);
});

test("intent lines change across a regeneration when state.intent changes", () => {
  const out1 = render({ intent: { thread: "a", next: "b" } });
  const out2 = render({ intent: { thread: "c", next: "d" } });
  assert.notEqual(out1, out2);
  assert.match(out2, /\*\*c\*\*/);
  assert.doesNotMatch(out2, /\*\*a\*\*/);
});

test("B3: state.intent is the ONLY source for the Active thread lines - an old NOW.md's hand-written thread/next action is never recovered", () => {
  const previous = [
    "# NOW",
    "<!-- claudhd: opt-in marker -->",
    "",
    "## Active thread (only one)",
    "",
    "**hand-written thread**",
    "",
    "Next physical action:",
    "",
    "- [ ] hand-written step",
    "",
  ].join("\n");
  const out = render({ now: previous }); // no state.intent
  assert.doesNotMatch(out, /hand-written thread/, "old NOW.md prose must never be recovered into intent");
  assert.doesNotMatch(out, /hand-written step/);
  assert.match(out, /\*\*\(name your current focus here\)\*\*/, "absent intent renders the placeholder, not the old document");
  assert.match(out, /- \[ \] \(one tiny step you can start in under a minute\)/);
});

test("Queue / Quick fixes / Loose ends carry forward verbatim from the previous NOW.md", () => {
  const previous = [
    "# NOW",
    "<!-- claudhd: opt-in marker -->",
    "",
    "## Queue",
    "",
    "1. carried queue item",
    "",
    "## Quick fixes (clear in one pass)",
    "",
    "- [ ] carried quick fix",
    "",
    "## Loose ends",
    "",
    "- a carried loose end",
    "",
  ].join("\n");
  const out = render({ now: previous });
  assert.match(out, /carried queue item/);
  assert.match(out, /carried quick fix/);
  assert.match(out, /a carried loose end/);
});

test("Queue / Quick fixes / Loose ends fall back to placeholder content on a fresh render with no previous NOW.md", () => {
  const out = render({});
  assert.match(out, /## Queue/);
  assert.match(out, /## Quick fixes/);
  assert.match(out, /## Loose ends/);
  assert.match(out, /nothing queued yet/);
});

test("mode/from fact-lines parse back out of the generated shape via nowfile.js", () => {
  const out = render({ mode: "design", from: "r-0801-2" });
  assert.equal(modeLine(out), "design");
  assert.equal(fromLine(out), "r-0801-2");
});

test("fromLine reads back as null when the thread has no parent", () => {
  const out = render({ mode: "build", from: null });
  assert.equal(fromLine(out), null);
});

test("modeLine reads back as null when mode is idle (the renderer's placeholder, not a real mode)", () => {
  const out = render({ mode: null });
  assert.equal(modeLine(out), null);
});

// --- Real-input: the actual shipped templates/NOW.md, not a synthetic fixture ---

test("the real shipped templates/NOW.md carries the opt-in marker nowrender.js also emits", () => {
  assert.match(REAL_TEMPLATE, /<!-- claudhd/);
});

test("re-rendering the real shipped templates/NOW.md through render() as `now` is idempotent and renders the placeholder cursor (no state.intent set)", () => {
  const out1 = render({ now: REAL_TEMPLATE });
  const out2 = render({ now: REAL_TEMPLATE });
  assert.equal(out1, out2, "rendering the real template twice must be idempotent");
  assert.match(out1, /\*\*\(name your current focus here\)\*\*/);
  assert.match(out1, /- \[ \] \(one tiny step you can start in under a minute\)/);
});

test("LOCK: the shipped templates/NOW.md equals render() of the canonical default state, byte-exact", () => {
  assert.equal(REAL_TEMPLATE, render({}), "template and renderer must never drift - regenerate templates/NOW.md from render({}) if this fails");
});

test("re-rendering the real shipped templates/NOW.md carries its real Queue/Quick fixes/Loose ends sections forward", () => {
  const out = render({ now: REAL_TEMPLATE });
  assert.match(out, /## Queue/);
  assert.match(out, /## Quick fixes/);
  assert.match(out, /## Loose ends/);
  assert.match(out, /nothing queued yet/);
});
