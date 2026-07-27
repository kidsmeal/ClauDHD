"use strict";
/* Tests for thread.js - the mode/from/intent/design state writers wired by
 * /claudhd:start and /claudhd:design (phase 7). */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const thread = require("../plugins/claudhd/scripts/thread.js");
const nowrender = require("../plugins/claudhd/scripts/nowrender.js");
const HOLD_LOCK = path.join(__dirname, "..", "tools", "hold-lock.js");

function mk() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "claudhd-thread-"));
  fs.writeFileSync(path.join(dir, "NOW.md"), nowrender.render({}));
  return dir;
}
function readState(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, ".now", "state.json"), "utf8"));
}
function readNow(dir) {
  return fs.readFileSync(path.join(dir, "NOW.md"), "utf8");
}

test("enterDesign: sets mode=design, from, and intent, and re-renders NOW.md", () => {
  const dir = mk();
  try {
    thread.enterDesign(dir, { from: "r-0725-1", thread: "the new feature", next: "read the code" });
    const s = readState(dir);
    assert.equal(s.mode, "design");
    assert.equal(s.from, "r-0725-1");
    assert.deepEqual(s.intent, { thread: "the new feature", next: "read the code" });
    const now = readNow(dir);
    assert.match(now, /Mode: design/);
    assert.match(now, /from: r-0725-1/);
    assert.match(now, /the new feature/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("enterDesign: from '-' (via CLI convention) is passed through as null unplanned", () => {
  const dir = mk();
  try {
    thread.enterDesign(dir, { from: null });
    const s = readState(dir);
    assert.equal(s.mode, "design");
    assert.equal(s.from, null);
    assert.match(readNow(dir), /\(unplanned work\)/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("enterDesign: a completed prior design's resolved/open lists and doc never leak into a fresh session (sol round-one finding 2)", () => {
  const dir = mk();
  try {
    // A fully completed prior design: doc set, forks resolved, nothing open.
    thread.enterDesign(dir, { from: "r-0710-1", thread: "old feature", next: "old next" });
    thread.setDesignDoc(dir, "design/old-feature.md");
    thread.addDecision(dir, "resolved", "old decision A");
    thread.addDecision(dir, "resolved", "old decision B");
    let s = readState(dir);
    assert.equal(s.design.doc, "design/old-feature.md");
    assert.deepEqual(s.design.resolved, ["old decision A", "old decision B"]);

    // Now activate a NEW, unrelated roadmap item into design mode.
    thread.enterDesign(dir, { from: "r-0725-5", thread: "new feature", next: "read the code" });
    s = readState(dir);
    assert.equal(s.from, "r-0725-5", "from must point at the new item");
    assert.deepEqual(s.design, { doc: null, resolved: [], open: [] },
      "the new design session must start with a completely fresh board");

    const now = readNow(dir);
    assert.doesNotMatch(now, /old decision A/, "the old resolved decision must not leak into the rendered board");
    assert.doesNotMatch(now, /old-feature\.md/, "the old doc path must not leak into the rendered board");
    assert.match(now, /\(no doc yet\)/, "the new session has no doc until set-design-doc runs again");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("setIntent: updates intent without touching mode or from", () => {
  const dir = mk();
  try {
    thread.enterDesign(dir, { from: "r-0725-2" });
    thread.setIntent(dir, "renamed thread", "next tiny step");
    const s = readState(dir);
    assert.equal(s.mode, "design", "mode must survive a later setIntent call");
    assert.equal(s.from, "r-0725-2", "from must survive a later setIntent call");
    assert.deepEqual(s.intent, { thread: "renamed thread", next: "next tiny step" });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("setDesignDoc: sets design.doc and preserves prior resolved/open lists", () => {
  const dir = mk();
  try {
    thread.enterDesign(dir, {});
    thread.addDecision(dir, "resolved", "use option A");
    thread.setDesignDoc(dir, "design/feature.md");
    const s = readState(dir);
    assert.equal(s.design.doc, "design/feature.md");
    assert.deepEqual(s.design.resolved, ["use option A"]);
    assert.match(readNow(dir), /designing design\/feature\.md/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("setDesignDoc: does NOT wipe an in-progress board the way enterDesign would (audit-continuation safety)", () => {
  const dir = mk();
  try {
    thread.enterDesign(dir, { from: "r-0725-7", thread: "t", next: "n" });
    thread.addDecision(dir, "open", "still deciding this one");
    thread.addDecision(dir, "resolved", "already settled this one");
    // A later /claudhd:design <path> call on an existing draft only calls
    // setDesignDoc, never enterDesign - this must leave from/mode/the
    // accumulated board fully intact.
    thread.setDesignDoc(dir, "design/existing-draft.md");
    const s = readState(dir);
    assert.equal(s.mode, "design");
    assert.equal(s.from, "r-0725-7");
    assert.equal(s.design.doc, "design/existing-draft.md");
    assert.deepEqual(s.design.open, ["still deciding this one"]);
    assert.deepEqual(s.design.resolved, ["already settled this one"]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// --- the /claudhd:design existing-doc audit path lifecycle (sol round-five) ---
//
// Models the exact sequence design.md's Audit section now follows: the
// board is initialized to point at the draft (setDesignDoc, never
// enterDesign, so it never wipes anything); each design-reviewer
// [NEEDS USER DECISION: ...] marker is recorded as OPEN first; then each is
// resolved into its REAL resolution text, never the marker's own wording.
test("audit-path board lifecycle: setDesignDoc initializes the board, each marker is opened then resolved into its real resolution", () => {
  const dir = mk();
  try {
    // Auditing a pre-existing draft with no prior grill session in this repo.
    thread.setDesignDoc(dir, "design/hand-written-draft.md");
    let s = readState(dir);
    assert.equal(s.design.doc, "design/hand-written-draft.md");
    assert.deepEqual(s.design.open, []);
    assert.deepEqual(s.design.resolved, []);

    // The design-reviewer's two NEEDS USER DECISION markers get recorded open.
    const markerA = "[NEEDS USER DECISION: should retries be capped at 3 or 5?]";
    const markerB = "[NEEDS USER DECISION: does this need a migration?]";
    thread.addDecision(dir, "open", markerA);
    thread.addDecision(dir, "open", markerB);
    s = readState(dir);
    assert.deepEqual(s.design.open, [markerA, markerB]);

    // Each resolves into its own real resolution text, not the marker itself.
    thread.resolveDecision(dir, markerA, "cap at 5, matching the FAIL-round valve elsewhere");
    thread.resolveDecision(dir, markerB, "no migration needed, this is additive");
    s = readState(dir);
    assert.deepEqual(s.design.open, [], "both markers must be cleared from open");
    assert.deepEqual(s.design.resolved, [
      "cap at 5, matching the FAIL-round valve elsewhere",
      "no migration needed, this is additive",
    ], "resolved must carry the real resolutions, never the marker text verbatim");
    assert.ok(!s.design.resolved.some((r) => r.includes("NEEDS USER DECISION")),
      "no leftover marker text may survive into resolved");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// --- auditDesign: the existing-doc /claudhd:design entry point (sol round-seven) ---
//
// Consolidates enterDesign-equivalent fresh-entry semantics with setDesignDoc's
// continuation-preserving semantics into one function, choosing between them
// by comparing the requested doc path to whatever design.doc is CURRENTLY
// active.

test("auditDesign: fresh entry (idle) sets mode=design, a fresh board, from cleared to null, and clears an active override", () => {
  const dir = mk();
  try {
    thread.auditDesign(dir, "design/hand-written-draft.md");
    const s = readState(dir);
    assert.equal(s.mode, "design");
    assert.equal(s.from, null);
    assert.deepEqual(s.design, { doc: "design/hand-written-draft.md", resolved: [], open: [] });
    assert.equal(s.override, undefined, "no prior override existed; none should appear");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("auditDesign: fresh entry on a DIFFERENT doc than a prior unrelated thread's does not leak that thread's from/board (sol round-seven finding 1)", () => {
  const dir = mk();
  try {
    // A prior, unrelated build-mode thread with its own roadmap parent.
    thread.enterDesign(dir, { from: "r-0710-1", thread: "old feature", next: "old next" });
    thread.setDesignDoc(dir, "design/old-feature.md");
    thread.addDecision(dir, "resolved", "old decision A");
    thread.addDecision(dir, "open", "old open question");
    thread.enterBuild(dir); // simulate the old thread moving on into build mode

    // Now auditing an unrelated, brand-new doc must not inherit any of it.
    thread.auditDesign(dir, "design/brand-new-draft.md");
    const s = readState(dir);
    assert.equal(s.mode, "design");
    assert.equal(s.from, null, "an existing-doc audit never carries a roadmap parent from an unrelated thread");
    assert.deepEqual(s.design, { doc: "design/brand-new-draft.md", resolved: [], open: [] },
      "the old thread's resolved/open lists must not leak into this fresh audit");

    const now = readNow(dir);
    assert.doesNotMatch(now, /old decision A/, "the old resolved decision must not leak into the rendered board");
    assert.doesNotMatch(now, /old open question/, "the old open decision must not leak into the rendered board");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("auditDesign: clears an active override on a fresh entry (properly-scoped transition, sol round-one finding 1 widened)", () => {
  const dir = mk();
  try {
    const override = require("../plugins/claudhd/scripts/override.js");
    override.recordOverride(dir, "s1");
    let s = readState(dir);
    assert.ok(s.override, "override must be recorded before the transition");

    thread.auditDesign(dir, "design/new-draft.md");
    s = readState(dir);
    assert.equal(s.override, undefined, "a properly-scoped audit-design entry must clear a stale override");
    assert.doesNotMatch(readNow(dir), /unguarded session/, "the rendered override line must be stripped too");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("auditDesign: re-auditing the CURRENTLY-ACTIVE doc is a continuation - the board, from, and intent survive byte-for-byte (sol round-seven finding 1)", () => {
  const dir = mk();
  try {
    thread.enterDesign(dir, { from: "r-0725-7", thread: "the thread", next: "the next step" });
    thread.setDesignDoc(dir, "design/existing-draft.md");
    thread.addDecision(dir, "open", "still deciding this one");
    thread.addDecision(dir, "resolved", "already settled this one");
    const before = readState(dir);

    thread.auditDesign(dir, "design/existing-draft.md");
    const s = readState(dir);
    assert.equal(s.mode, "design");
    assert.equal(s.from, before.from, "from must be preserved on a same-doc continuation");
    assert.deepEqual(s.intent, before.intent, "intent must be preserved on a same-doc continuation");
    assert.deepEqual(s.design, before.design, "the board must be preserved byte-for-byte on a same-doc continuation");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("auditDesign: re-auditing the currently-active doc still clears an active override (continuation is still a properly-scoped transition)", () => {
  const dir = mk();
  try {
    thread.enterDesign(dir, { from: "r-0725-8" });
    thread.setDesignDoc(dir, "design/active.md");
    const override = require("../plugins/claudhd/scripts/override.js");
    override.recordOverride(dir, "s2");
    let s = readState(dir);
    assert.ok(s.override, "override must be recorded before the re-audit");

    thread.auditDesign(dir, "design/active.md");
    s = readState(dir);
    assert.equal(s.override, undefined, "the continuation branch must still clear the override");
    assert.equal(s.design.doc, "design/active.md");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("CLI: audit-design writes through the script entry point", () => {
  const dir = mk();
  try {
    const r = spawnSync(process.execPath, [THREAD_SCRIPT, "audit-design", "design/cli-draft.md"], {
      encoding: "utf8",
      env: { ...process.env, GANTRY_PROJECT_DIR: dir },
    });
    assert.equal(r.status, 0, "CLI should exit 0\nstdout: " + r.stdout + "\nstderr: " + r.stderr);
    const s = readState(dir);
    assert.equal(s.mode, "design");
    assert.equal(s.design.doc, "design/cli-draft.md");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// Async (non-blocking) thread.js CLI spawn, needed for the concurrency test
// below: two spawnSync calls in the same process can never actually overlap
// (each blocks the event loop until it returns), so racing two real
// invocations requires spawn() + Promise - the same pattern
// test/vocab.test.js's concurrent-move regressions use.
const THREAD_SCRIPT = path.join(__dirname, "..", "plugins", "claudhd", "scripts", "thread.js");
function runThreadAsync(dir, args) {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, [THREAD_SCRIPT, ...args], {
      env: { ...process.env, GANTRY_PROJECT_DIR: dir },
    });
    let stdout = "", stderr = "";
    c.stdout.on("data", (d) => (stdout += d));
    c.stderr.on("data", (d) => (stderr += d));
    c.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}
function holdLockAsync(lockDir, id, holdMs, logFile) {
  return new Promise((resolve, reject) => {
    const c = spawn(process.execPath, [HOLD_LOCK, lockDir, id, String(holdMs), logFile]);
    let stderr = "";
    c.stderr.on("data", (d) => (stderr += d));
    c.on("close", (code) => (code === 0 ? resolve() : reject(new Error("hold-lock failed: " + stderr))));
  });
}

test("addDecision: two concurrent decisions racing on the design board are both recorded under the shared design lock (sol round-one finding 5)", async () => {
  const dir = mk();
  try {
    thread.enterDesign(dir, {});

    const nowDir = path.join(dir, ".now");
    const lockDir = thread.designLockPath(nowDir);
    const logFile = path.join(dir, "lock-events.log");
    fs.writeFileSync(logFile, "");

    // Hold the design lock artificially first, so both racing addDecision
    // calls queue up behind it rather than one finishing before the other
    // even starts (which would prove nothing about the lock).
    const holdMs = 300;
    const holdPromise = holdLockAsync(lockDir, "HOLDER", holdMs, logFile);
    await new Promise((r) => setTimeout(r, 50));

    const jobA = runThreadAsync(dir, ["decision", "open", "decision from job A"]);
    const jobB = runThreadAsync(dir, ["decision", "open", "decision from job B"]);

    const [, resultA, resultB] = await Promise.all([holdPromise, jobA, jobB]);
    assert.equal(resultA.status, 0, "job A should exit 0\n" + resultA.stderr);
    assert.equal(resultB.status, 0, "job B should exit 0\n" + resultB.stderr);

    const s = readState(dir);
    assert.ok(s.design.open.includes("decision from job A"), "job A's decision must survive");
    assert.ok(s.design.open.includes("decision from job B"), "job B's decision must survive");
    assert.equal(s.design.open.length, 2, "neither concurrent write may clobber the other's addition");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("addDecision: appends to design.open and design.resolved independently", () => {
  const dir = mk();
  try {
    thread.addDecision(dir, "open", "how should X behave?");
    thread.addDecision(dir, "open", "what data shape?");
    thread.addDecision(dir, "resolved", "use JSON");
    const s = readState(dir);
    assert.deepEqual(s.design.open, ["how should X behave?", "what data shape?"]);
    assert.deepEqual(s.design.resolved, ["use JSON"]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("addDecision: rejects an unknown kind and writes nothing", () => {
  const dir = mk();
  try {
    assert.throws(() => thread.addDecision(dir, "bogus", "text"), /kind must be resolved or open/);
    const p = path.join(dir, ".now", "state.json");
    assert.ok(!fs.existsSync(p), "no state.json should be written on a rejected call");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("resolveDecision: moves an exact-match open item to resolved", () => {
  const dir = mk();
  try {
    thread.addDecision(dir, "open", "decide the id scheme");
    thread.resolveDecision(dir, "decide the id scheme");
    const s = readState(dir);
    assert.deepEqual(s.design.open, []);
    assert.deepEqual(s.design.resolved, ["decide the id scheme"]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("resolveDecision: throws and writes nothing when the text is not an open decision", () => {
  const dir = mk();
  try {
    thread.addDecision(dir, "open", "real decision");
    assert.throws(() => thread.resolveDecision(dir, "not present"), /no open decision matches/);
    const s = readState(dir);
    assert.deepEqual(s.design.open, ["real decision"], "the open list must be untouched");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("resolveDecision: a separate resolution text records the ACTUAL resolution, not the open marker's own wording (sol round-five, the audit path)", () => {
  const dir = mk();
  try {
    const marker = "[NEEDS USER DECISION: should the retry cap be 3 or 5?]";
    thread.addDecision(dir, "open", marker);
    thread.resolveDecision(dir, marker, "retry cap is 5, matching the existing FAIL-round valve");
    const s = readState(dir);
    assert.deepEqual(s.design.open, [], "the marker must be removed from open");
    assert.deepEqual(s.design.resolved, ["retry cap is 5, matching the existing FAIL-round valve"],
      "resolved must carry the real resolution text, not the marker verbatim");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("resolveDecision: throws and writes nothing when the marker to resolve was never recorded as open (never a silent no-op)", () => {
  const dir = mk();
  try {
    thread.addDecision(dir, "open", "a genuinely open decision");
    assert.throws(
      () => thread.resolveDecision(dir, "[NEEDS USER DECISION: never recorded]", "some resolution"),
      /no open decision matches/
    );
    const s = readState(dir);
    assert.deepEqual(s.design.open, ["a genuinely open decision"], "the unrelated open entry must be untouched");
    assert.deepEqual(s.design.resolved, [], "nothing may be resolved from an entry that was never open");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("CLI: resolve-decision <open text> -- <resolution text> records the resolution, not the marker", () => {
  const dir = mk();
  try {
    thread.addDecision(dir, "open", "marker text");
    const r = spawnSync(process.execPath, [THREAD_SCRIPT, "resolve-decision", "marker", "text", "--", "the", "real", "resolution"], {
      encoding: "utf8",
      env: { ...process.env, GANTRY_PROJECT_DIR: dir },
    });
    assert.equal(r.status, 0, "CLI should exit 0\nstdout: " + r.stdout + "\nstderr: " + r.stderr);
    const s = readState(dir);
    assert.deepEqual(s.design.open, []);
    assert.deepEqual(s.design.resolved, ["the real resolution"]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("enterBuild: sets mode=build for display, independent of the sentinel", () => {
  const dir = mk();
  try {
    thread.enterBuild(dir);
    const s = readState(dir);
    assert.equal(s.mode, "build");
    assert.match(readNow(dir), /Mode: build/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("clearMode: sets mode back to null without touching from/intent/design", () => {
  const dir = mk();
  try {
    thread.enterDesign(dir, { from: "r-0725-3", thread: "t", next: "n" });
    thread.setDesignDoc(dir, "design/x.md");
    thread.clearMode(dir);
    const s = readState(dir);
    assert.equal(s.mode, null);
    assert.equal(s.from, "r-0725-3", "from must survive clearMode");
    assert.equal(s.design.doc, "design/x.md", "design must survive clearMode");
    assert.match(readNow(dir), /Position: idle/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("CLI: enter-design writes mode/from through the script entry point", () => {
  const dir = mk();
  try {
    const r = spawnSync(process.execPath, [THREAD_SCRIPT, "enter-design", "r-0725-9", "cli thread", "cli next"], {
      encoding: "utf8",
      env: { ...process.env, GANTRY_PROJECT_DIR: dir },
    });
    assert.equal(r.status, 0, "CLI should exit 0\nstdout: " + r.stdout + "\nstderr: " + r.stderr);
    const s = readState(dir);
    assert.equal(s.mode, "design");
    assert.equal(s.from, "r-0725-9");
    assert.deepEqual(s.intent, { thread: "cli thread", next: "cli next" });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
