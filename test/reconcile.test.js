"use strict";
/*
 * Tests for reconcile.js - the commit boundary reconcile (design section 5,
 * phase 4). Driven through commit-guard.js's own PreToolUse stdin contract,
 * exactly as the real hook is invoked, per the plan's phase 4 Verification.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { makeRepo, cleanup, write, read, exists } = require("../tools/helpers.js");

const GUARD = path.join(__dirname, "..", "plugins", "claudhd", "scripts", "hooks", "commit-guard.js");
const SENTINEL_JS = path.join(__dirname, "..", "plugins", "claudhd", "scripts", "sentinel.js");
const MARKER = "<!-- claudhd: opt-in marker -->";

// Run a real `node <args>` call rooted at `dir`, exactly as the orchestrator's
// own sentinel.js clear call would be invoked for real (as opposed to
// runGuard(), which only feeds a command STRING to the hook for its
// permission-check-and-reconcile side effect, without actually executing it).
function runNode(dir, args) {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: dir };
  delete env.CLAUDHD_PROJECT_DIR;
  delete env.GANTRY_PROJECT_DIR;
  return spawnSync(process.execPath, args, { cwd: dir, encoding: "utf8", env });
}

function nowFile(thread) {
  return `# NOW\n${MARKER}\n\n## Active thread\n\n**${thread}**\n\n- [ ] step\n`;
}

// A marker-only, pre-1.0 project: a real NOW.md carrying the claudhd opt-in
// comment, but no `.now/enabled` - the ONLY B1 signal that activates
// reconcile (the legacy `.gantry/enabled` activates the guards' enforcement
// gating only, never reconcile - see reconcile.js's header comment). This is
// NOT adopted for reconcile's purposes (sol's fix: NOW-marker-only activation
// would have regenerated every unmigrated project's hand-written cursor
// fleet-wide).
function optInMarkerOnly(dir, git, thread) {
  write(dir, ".gitignore", ".now/\n");
  write(dir, "NOW.md", nowFile(thread || "main thread"));
  git(["add", ".gitignore", "NOW.md"]);
  git(["commit", "-q", "-m", "init claudhd"]);
}

// Opt a throwaway repo into 1.0 for reconcile's purposes (writes `.now/enabled`,
// reconcile's own B1 signal) WITHOUT the guard's own `.gantry/enabled`
// enforcement marker, so the guard itself stays inactive (gate always null)
// while reconcile is adopted and fires - the phase 4 tests below care about
// the reconcile, not the deny matrix (that is test/commit-guard.test.js's job).
function optInNoEnforcement(dir, git, thread) {
  optInMarkerOnly(dir, git, thread);
  fs.mkdirSync(path.join(dir, ".now"), { recursive: true });
  write(dir, path.join(".now", "enabled"), "");
}

function writeState(dir, state) {
  fs.mkdirSync(path.join(dir, ".now"), { recursive: true });
  write(dir, path.join(".now", "state.json"), JSON.stringify(state));
}

function readState(dir) {
  return JSON.parse(read(dir, path.join(".now", "state.json")));
}

function runGuard(dir, command, sessionId) {
  const payload = {
    session_id: sessionId || "session-1",
    cwd: dir,
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command },
  };
  const env = { ...process.env, CLAUDE_PROJECT_DIR: dir };
  delete env.CLAUDHD_PROJECT_DIR;
  delete env.GANTRY_PROJECT_DIR;
  return spawnSync(process.execPath, [GUARD], {
    encoding: "utf8",
    input: JSON.stringify(payload),
    env,
  });
}

// Phase 5 (B1's computeGate change - see commit-guard.js's isAdopted()) made
// enforcement and reconcile share `.now/enabled` as an activation signal,
// where before this file's own `optInNoEnforcement()` fixture relied on
// enforcement staying off while reconcile ran. The real pipeline's own
// command shape - a leading `node <sentinel.js path> clear` - already
// bypasses the gate regardless of enforcement (isSentinelCall() matches on
// the command's first two tokens only; commit-guard.js's header comment
// documents this deliberately), and is already exercised end-to-end by the
// "compound command" test further down. Tests below that need reconcile to
// see a live (pre-clear) sentinel while still passing the gate under full
// enforcement use this same real shape instead of a bare `git commit`.
function compoundClearAndCommit(message) {
  return `node ${JSON.stringify(SENTINEL_JS)} clear && git add -A && git commit -m ${JSON.stringify(message)}`;
}

// Phase 2's status is "built" - the REAL normal path: by the time a real
// commit reaches the guard, the relay has already moved a reviewed phase
// past "pending" (this repo's own plan uses "built"; see PRECOMMIT_STATUS_RE).
const PLAN = [
  "# Test Plan",
  "",
  "## Phase 1: First",
  "**Status:** committed (already shipped)",
  "**Files:** `a.js`",
  "",
  "## Phase 2: Second",
  "**Status:** built",
  "**Files:** `b.js`",
  "",
].join("\n");

// Same shape, but phase 2 carries the pipeline template's own pre-commit
// phrasing instead of this repo's "built".
const PLAN_READY_TO_COMMIT = [
  "# Test Plan",
  "",
  "## Phase 1: First",
  "**Status:** committed (already shipped)",
  "**Files:** `a.js`",
  "",
  "## Phase 2: Second",
  "**Status:** ready to commit",
  "**Files:** `b.js`",
  "",
].join("\n");

const ROADMAP = [
  "# ROADMAP",
  "",
  "## Now",
  "",
  "- (nothing in flight)",
  "",
  "## Next",
  "",
  "- [ ] Ship the widget - done: it ships `r-0101-1`",
  "",
  "## Later",
  "",
  "## Shipped",
  "",
  "- (nothing yet)",
  "",
].join("\n");

// The real legacy shape (roadmapids.test.js's own fixture pattern): prose
// under ## Now, plain id-less bullets under Next/Later - no `r-MMDD-N` ids
// anywhere yet, exactly what a pre-1.0 ROADMAP.md looks like.
const LEGACY_ROADMAP = [
  "# ROADMAP",
  "",
  "## Now",
  "",
  "- Nothing in flight.",
  "",
  "## Next",
  "",
  "- Ship the widget - done: it ships",
  "- Another intent - done: y",
  "",
  "## Later",
  "",
  "- Someday thing",
  "",
  "## Shipped",
  "",
  "- (nothing yet)",
  "",
].join("\n");

function todayMMDD() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return p(d.getMonth() + 1) + p(d.getDate());
}

test("reconcile (via the commit-guard interception point): a final-phase commit updates NOW.md, SHIPPED.md, the plan's Status line, and moves the roadmap item to Shipped - all staged", () => {
  const { dir, git } = makeRepo();
  try {
    optInNoEnforcement(dir, git);
    write(dir, "PLAN.md", PLAN);
    write(dir, "ROADMAP.md", ROADMAP);
    write(dir, "b.js", "done\n");
    git(["add", "PLAN.md", "ROADMAP.md", "b.js"]);
    writeState(dir, {
      schemaVersion: 2,
      mode: "build",
      from: "r-0101-1",
      build: {
        plan: "PLAN.md",
        phase: 2,
        files: ["b.js"],
        allow: ["PLAN.md"],
        started: new Date().toISOString(),
        session: "session-1",
      },
    });

    const r = runGuard(dir, compoundClearAndCommit("phase 2 done"));
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), "", "the sentinel-call bypass allows the compound through, enforcement notwithstanding");

    const plan = read(dir, "PLAN.md");
    assert.match(plan, /## Phase 2: Second\s*\n\*\*Status:\*\* committed \(\d{4}-\d{2}-\d{2}\)/);
    assert.match(plan, /## Phase 1: First\s*\n\*\*Status:\*\* committed \(already shipped\)/, "phase 1's existing status is untouched");

    const roadmap = read(dir, "ROADMAP.md");
    const nextBody = roadmap.slice(roadmap.indexOf("## Next"), roadmap.indexOf("## Later"));
    assert.doesNotMatch(nextBody, /Ship the widget/, "the completed item leaves Next");
    const shippedBody = roadmap.slice(roadmap.indexOf("## Shipped"));
    assert.match(shippedBody, /-\s*Ship the widget - done: it ships `r-0101-1`/, "the item lands in Shipped, checkbox stripped, id untouched");

    const shipped = read(dir, "SHIPPED.md");
    assert.match(shipped, /phase 2 done/);
    assert.doesNotMatch(shipped, /`[0-9a-f]{7,40}`/, "no hash - the commit has not happened yet at this interception point");

    const now = read(dir, "NOW.md");
    assert.match(now, /<!-- claudhd/);
    assert.match(now, /from:\s*r-0101-1/);

    const state = readState(dir);
    assert.ok(state.generatedAt, "state.json was regenerated");

    const staged = git(["diff", "--cached", "--name-only"]).split(/\r?\n/).filter(Boolean);
    assert.ok(staged.includes("NOW.md"), "NOW.md staged");
    assert.ok(staged.includes("SHIPPED.md"), "SHIPPED.md staged");
    assert.ok(staged.includes("ROADMAP.md"), "ROADMAP.md staged");
    assert.ok(staged.includes("PLAN.md"), "PLAN.md staged");
    assert.ok(!staged.includes(".now/state.json") && !staged.includes(path.join(".now", "state.json")),
      ".now/state.json must never be staged (gitignored)");
  } finally { cleanup(dir); }
});

test("markPhaseCommitted also fires from the pipeline template's own pre-commit phrasing, 'ready to commit'", () => {
  const { dir, git } = makeRepo();
  try {
    optInNoEnforcement(dir, git);
    write(dir, "PLAN.md", PLAN_READY_TO_COMMIT);
    write(dir, "b.js", "done\n");
    git(["add", "PLAN.md", "b.js"]);
    writeState(dir, {
      schemaVersion: 2,
      build: {
        plan: "PLAN.md",
        phase: 2,
        files: ["b.js"],
        allow: ["PLAN.md"],
        started: new Date().toISOString(),
        session: "session-1",
      },
    });

    const r = runGuard(dir, compoundClearAndCommit("phase 2 done, ready-to-commit phrasing"));
    assert.equal(r.status, 0, r.stderr);

    const plan = read(dir, "PLAN.md");
    assert.match(plan, /## Phase 2: Second\s*\n\*\*Status:\*\* committed \(\d{4}-\d{2}-\d{2}\)/,
      "'ready to commit' transitions to committed just like 'built'");
  } finally { cleanup(dir); }
});

test("a STALE build sentinel is never used to mark a plan phase committed or move a roadmap item - an abandoned phase must not be misattributed to an unrelated later commit", () => {
  const { dir, git } = makeRepo();
  try {
    optInNoEnforcement(dir, git);
    write(dir, "PLAN.md", PLAN);
    write(dir, "ROADMAP.md", ROADMAP);
    const old = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();
    writeState(dir, {
      schemaVersion: 2,
      from: "r-0101-1",
      build: {
        plan: "PLAN.md",
        phase: 2,
        files: ["b.js"],
        allow: ["PLAN.md"],
        started: old,
        session: "abandoned-session",
      },
    });

    const r = runGuard(dir, 'git commit -m "unrelated later work"', "a-new-session");
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), "");

    const plan = read(dir, "PLAN.md");
    assert.match(plan, /## Phase 2: Second\s*\n\*\*Status:\*\* built/, "the abandoned phase's Status line is untouched");

    const roadmap = read(dir, "ROADMAP.md");
    const nextBody = roadmap.slice(roadmap.indexOf("## Next"), roadmap.indexOf("## Later"));
    assert.match(nextBody, /Ship the widget/, "the roadmap item stays in Next - not falsely marked shipped");

    const shipped = read(dir, "SHIPPED.md");
    assert.match(shipped, /unrelated later work/, "SHIPPED.md still logs the real commit");
  } finally { cleanup(dir); }
});

test("a commit with no active plan still writes the SHIPPED entry (build/from both absent)", () => {
  const { dir, git } = makeRepo();
  try {
    optInNoEnforcement(dir, git);
    writeState(dir, { schemaVersion: 2 });

    const r = runGuard(dir, 'git commit -m "ad hoc fix, no phase"');
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), "");

    const shipped = read(dir, "SHIPPED.md");
    assert.match(shipped, /ad hoc fix, no phase/);
    assert.ok(!exists(dir, "PLAN.md"), "no plan file existed and none was created");

    const now = read(dir, "NOW.md");
    assert.match(now, /<!-- claudhd/);
  } finally { cleanup(dir); }
});

// 1.0.1 fix round (sol finding 1): the commit-boundary reconcile computed its
// committed cursor facts (both the local `cursor` object it renders NOW.md's
// Last-touched/Counts lines from, and the buildState() snapshot it persists
// to state.json) by re-parsing NOW.md text, without threading state.intent
// through - the same stale-derivation bug bug-5 fixed in checkpoint.js,
// unfixed here. `intent` (thread.js's setIntent) is the single source of
// truth for activeThread/nextAction; NOW.md text can legitimately lag it
// between a set-intent call and the next regeneration.
test("commit-boundary reconcile derives committed cursor.activeThread/nextAction from state.intent, not by re-parsing (possibly stale) NOW.md text", () => {
  const { dir, git } = makeRepo();
  try {
    // NOW.md's own text still shows the OLD thread - intent already moved on.
    optInNoEnforcement(dir, git, "old thread text in NOW.md");
    writeState(dir, {
      schemaVersion: 2,
      intent: { thread: "new thread from intent", next: "new next from intent" },
    });

    const r = runGuard(dir, 'git commit -m "commit while NOW.md text still lags intent"');
    assert.equal(r.status, 0, r.stderr);

    const state = readState(dir);
    assert.equal(state.cursor.activeThread, "new thread from intent",
      "the committed cursor.activeThread must come from state.intent, not the stale NOW.md text");
    assert.equal(state.cursor.nextAction, "new next from intent",
      "the committed cursor.nextAction must come from state.intent, not the stale NOW.md text");
  } finally { cleanup(dir); }
});

test(".now/state.json is regenerated on every reconcile but is never staged, because .now/ is gitignored", () => {
  const { dir, git } = makeRepo();
  try {
    optInNoEnforcement(dir, git);
    writeState(dir, { schemaVersion: 2 });
    const before = readState(dir);

    runGuard(dir, 'git commit -m "touch state"');

    const after = readState(dir);
    assert.notEqual(after.generatedAt, before.generatedAt, "state.json was rewritten");
    const staged = git(["diff", "--cached", "--name-only"]).split(/\r?\n/).filter(Boolean);
    assert.ok(!staged.some((p) => p.includes("state.json")), "state.json is never staged");
  } finally { cleanup(dir); }
});

test("a reconcile throw is swallowed and leaves the commit permitted (guard still exits 0, still allows)", () => {
  const { dir, git } = makeRepo();
  try {
    optInNoEnforcement(dir, git);
    writeState(dir, { schemaVersion: 2 });
    // SHIPPED.md is a directory, not a file: appendEntry's write throws EISDIR.
    fs.mkdirSync(path.join(dir, "SHIPPED.md"));

    const r = runGuard(dir, 'git commit -m "this should still be allowed"');
    assert.equal(r.status, 0, "guard must still exit 0 even though reconcile threw");
    assert.equal(r.stdout.trim(), "", "no deny JSON - the commit is still permitted");

    const log = read(dir, path.join(".now", "reconcile.log"));
    assert.match(log, /reconcile failed/, "the failure is visible in reconcile's own log, never in the commit's fate");
  } finally { cleanup(dir); }
});

test("known limit: a commit made outside a Claude Code session (never through the guard) leaves the docs untouched", () => {
  const { dir, git } = makeRepo();
  try {
    optInNoEnforcement(dir, git);
    const nowBefore = read(dir, "NOW.md");

    write(dir, "feature.txt", "shipped by hand\n");
    git(["add", "feature.txt"]);
    git(["commit", "-q", "-m", "a commit made directly, bypassing the hook entirely"]);

    assert.equal(read(dir, "NOW.md"), nowBefore, "NOW.md is untouched - nothing reconciled it");
    assert.ok(!exists(dir, "SHIPPED.md"), "SHIPPED.md was never written - the known limit is real, not assumed");
  } finally { cleanup(dir); }
});

// --- fix round: the adoption gate requires a B1 signal, not the NOW marker alone ---

test("a pre-1.0 marker-only project (real NOW.md shape, no enabled marker) is NOT adopted - a commit through the guard leaves it byte-untouched", () => {
  const { dir, git } = makeRepo();
  try {
    optInMarkerOnly(dir, git);
    const nowBefore = read(dir, "NOW.md");
    assert.ok(!exists(dir, path.join(".now", "enabled")) && !exists(dir, path.join(".gantry", "enabled")),
      "sanity: neither B1 activation marker exists in this fixture");

    write(dir, "feature.txt", "some code\n");
    git(["add", "feature.txt"]);
    const r = runGuard(dir, 'git commit -m "should not reconcile"');
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), "", "guard is inactive (no .gantry/enabled) - must allow");

    assert.equal(read(dir, "NOW.md"), nowBefore, "NOW.md must be byte-identical - a marker-only project is not adopted");
    assert.ok(!exists(dir, "SHIPPED.md"), "SHIPPED.md must never be created for an unadopted project");
    assert.ok(!exists(dir, path.join(".now", "state.json")),
      "no state regeneration side effect beyond what the Stop hook already owns - nothing wrote .now/state.json here");
  } finally { cleanup(dir); }
});

test("the legacy .gantry/enabled marker ALONE (no .now/enabled) may still let an enforcing guard deny commits, but does NOT activate the reconcile - it is left byte-untouched", () => {
  const { dir, git } = makeRepo();
  try {
    optInMarkerOnly(dir, git);
    fs.mkdirSync(path.join(dir, ".gantry"), { recursive: true });
    write(dir, path.join(".gantry", "enabled"), "");
    const nowBefore = read(dir, "NOW.md");

    const r = runGuard(dir, 'git commit -m "gantry-era project, no reconcile"');
    assert.equal(r.status, 0, r.stderr);
    // No sentinel is present in this fixture, so the (still-untouched)
    // enforcement gate fails open and allows the commit - only reconcile's
    // adoption is under test here.
    assert.equal(r.stdout.trim(), "");

    assert.equal(read(dir, "NOW.md"), nowBefore, "NOW.md must be byte-identical - .gantry/enabled alone does not adopt for reconcile");
    assert.ok(!exists(dir, "SHIPPED.md"), "SHIPPED.md must never be created from .gantry/enabled alone");
    assert.ok(!exists(dir, path.join(".now", "state.json")),
      "no state regeneration side effect - reconcile never ran");
  } finally { cleanup(dir); }
});

// --- fix round: legacy id-less ROADMAP.md must be backfilled before the `from` lookup ---

test("a legacy id-less ROADMAP.md is backfilled before the roadmap-item lookup, so `from` resolves, the item moves on the final phase, wording is preserved, and ROADMAP.md is staged", () => {
  const { dir, git } = makeRepo();
  try {
    optInNoEnforcement(dir, git);
    write(dir, "PLAN.md", PLAN);
    write(dir, "ROADMAP.md", LEGACY_ROADMAP);
    write(dir, "b.js", "done\n");
    git(["add", "PLAN.md", "ROADMAP.md", "b.js"]);

    const expectedId = `r-${todayMMDD()}-1`;
    writeState(dir, {
      schemaVersion: 2,
      mode: "build",
      from: expectedId,
      build: {
        plan: "PLAN.md",
        phase: 2,
        files: ["b.js"],
        allow: ["PLAN.md"],
        started: new Date().toISOString(),
        session: "session-1",
      },
    });

    const r = runGuard(dir, compoundClearAndCommit("phase 2 done, legacy roadmap"));
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), "");

    const roadmap = read(dir, "ROADMAP.md");
    assert.match(roadmap, /Another intent - done: y\s*`r-\d{4}-2`/, "a sibling id-less item also gets backfilled");
    assert.match(roadmap, /Someday thing\s*`r-\d{4}-3`/, "the Later item gets backfilled too");
    assert.doesNotMatch(roadmap, /Nothing in flight\.\s*`r-/, "## Now's pointer bullet never gets an id");

    const nextBody = roadmap.slice(roadmap.indexOf("## Next"), roadmap.indexOf("## Later"));
    assert.doesNotMatch(nextBody, /Ship the widget/, "the completed item leaves Next now that `from` could resolve it");
    const shippedBody = roadmap.slice(roadmap.indexOf("## Shipped"));
    assert.match(shippedBody, new RegExp("-\\s*Ship the widget - done: it ships\\s*`" + expectedId + "`"),
      "the item lands in Shipped with its wording byte-preserved and its newly-issued id");

    const state = readState(dir);
    assert.ok(Array.isArray(state.roadmapIds) && state.roadmapIds.includes(expectedId),
      "the issued id is recorded in the durable ledger");

    const staged = git(["diff", "--cached", "--name-only"]).split(/\r?\n/).filter(Boolean);
    assert.ok(staged.includes("ROADMAP.md"), "ROADMAP.md (backfilled + moved) is staged");
  } finally { cleanup(dir); }
});

test("a legacy id-less ROADMAP.md is backfilled on a commit with NO active plan at all, and staged", () => {
  const { dir, git } = makeRepo();
  try {
    optInNoEnforcement(dir, git);
    write(dir, "ROADMAP.md", LEGACY_ROADMAP);
    git(["add", "ROADMAP.md"]);
    writeState(dir, { schemaVersion: 2 }); // no build, no from

    const r = runGuard(dir, 'git commit -m "ad hoc fix, legacy roadmap still trues up"');
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), "");

    const roadmap = read(dir, "ROADMAP.md");
    assert.match(roadmap, /Ship the widget - done: it ships\s*`r-\d{4}-1`/, "backfilled even with no active plan");
    assert.match(roadmap, /Another intent - done: y\s*`r-\d{4}-2`/);
    assert.match(roadmap, /Someday thing\s*`r-\d{4}-3`/);
    assert.doesNotMatch(roadmap, /Nothing in flight\.\s*`r-/, "## Now's pointer bullet still never gets an id");
    // No final phase to complete, so the item stays put - only its id changed.
    const nextBody = roadmap.slice(roadmap.indexOf("## Next"), roadmap.indexOf("## Later"));
    assert.match(nextBody, /Ship the widget/, "no active plan means no move - the item is not falsely marked shipped");

    const staged = git(["diff", "--cached", "--name-only"]).split(/\r?\n/).filter(Boolean);
    assert.ok(staged.includes("ROADMAP.md"), "the backfill alone is enough to stage ROADMAP.md");
  } finally { cleanup(dir); }
});

test("a legacy id-less ROADMAP.md is backfilled on a NON-final-phase commit (phase 1 of 2), and staged, without moving the roadmap item", () => {
  const { dir, git } = makeRepo();
  try {
    optInNoEnforcement(dir, git);
    write(dir, "PLAN.md", PLAN);
    write(dir, "ROADMAP.md", LEGACY_ROADMAP);
    write(dir, "a.js", "wip\n");
    git(["add", "PLAN.md", "ROADMAP.md", "a.js"]);

    const expectedId = `r-${todayMMDD()}-1`;
    writeState(dir, {
      schemaVersion: 2,
      from: expectedId,
      build: {
        plan: "PLAN.md",
        phase: 1, // NOT the plan's final phase (phase 2 is)
        files: ["a.js"],
        allow: ["PLAN.md"],
        started: new Date().toISOString(),
        session: "session-1",
      },
    });

    const r = runGuard(dir, compoundClearAndCommit("phase 1 midway, legacy roadmap"));
    assert.equal(r.status, 0, r.stderr);

    const roadmap = read(dir, "ROADMAP.md");
    assert.match(roadmap, new RegExp("Ship the widget - done: it ships\\s*`" + expectedId + "`"),
      "backfilled even though this commit is not the final phase");
    const nextBody = roadmap.slice(roadmap.indexOf("## Next"), roadmap.indexOf("## Later"));
    assert.match(nextBody, /Ship the widget/, "not the final phase - the item is not moved to Shipped yet");

    const staged = git(["diff", "--cached", "--name-only"]).split(/\r?\n/).filter(Boolean);
    assert.ok(staged.includes("ROADMAP.md"), "the backfill alone is enough to stage ROADMAP.md");
  } finally { cleanup(dir); }
});

// --- fix round: commit message parsing must cover the real forms git accepts ---

test("extractCommitMessage: the actual subject reaches SHIPPED.md for every parseable -m/--message form (guard-driven)", () => {
  const cases = [
    { label: "quoted -m", command: 'git commit -m "quoted subject"', expect: "quoted subject" },
    { label: "unquoted -m (next argv token)", command: "git commit -m unquoted-subject", expect: "unquoted-subject" },
    { label: "single-quoted -m", command: "git commit -m 'single quoted subject'", expect: "single quoted subject" },
    { label: "attached -m\"msg\"", command: 'git commit -m"attached subject"', expect: "attached subject" },
    { label: "-m=msg", command: "git commit -m=equals-subject", expect: "equals-subject" },
    { label: "--message=msg", command: 'git commit --message="long flag equals subject"', expect: "long flag equals subject" },
    { label: "--message msg", command: 'git commit --message "long flag subject"', expect: "long flag subject" },
    { label: "multiple -m (first is the subject)", command: 'git commit -m "first subject" -m "second, body-ish"', expect: "first subject" },
    { label: "combined -am (stage-all + message)", command: 'git commit -am "combined am subject"', expect: "combined am subject" },
    { label: "combined -sm (sign-off + message)", command: 'git commit -sm "combined sm subject"', expect: "combined sm subject" },
    { label: "combined -asm (stage-all + sign-off + message)", command: 'git commit -asm "combined asm subject"', expect: "combined asm subject" },
    { label: "combined -am, attached value (no space)", command: 'git commit -am"attached combined subject"', expect: "attached combined subject" },
    { label: "-am composes with a preceding global option (round four)", command: 'git commit --git-dir /repo/.git -am "global option compose subject"', expect: "global option compose subject" },
  ];

  for (const c of cases) {
    const { dir, git } = makeRepo();
    try {
      optInNoEnforcement(dir, git);
      writeState(dir, { schemaVersion: 2 });

      const r = runGuard(dir, c.command);
      assert.equal(r.status, 0, `${c.label}: ${r.stderr}`);
      const shipped = read(dir, "SHIPPED.md");
      const escaped = c.expect.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      assert.match(shipped, new RegExp("-\\s*" + escaped + "\\s*$", "m"),
        `${c.label}: subject should reach SHIPPED.md verbatim; got:\n${shipped}`);
    } finally { cleanup(dir); }
  }
});

test("extractCommitMessage: -F <file> reads the file's first line as the subject at hook time (guard-driven)", () => {
  const { dir, git } = makeRepo();
  try {
    optInNoEnforcement(dir, git);
    writeState(dir, { schemaVersion: 2 });
    write(dir, "commitmsg.txt", "file-sourced subject\n\nbody text here\n");

    const r = runGuard(dir, "git commit -F commitmsg.txt");
    assert.equal(r.status, 0, r.stderr);
    const shipped = read(dir, "SHIPPED.md");
    assert.match(shipped, /-\s*file-sourced subject\s*$/m);
  } finally { cleanup(dir); }
});

test("extractCommitMessage: -F <file> that does not exist at hook time is genuinely unavailable, not guessed", () => {
  const { dir, git } = makeRepo();
  try {
    optInNoEnforcement(dir, git);
    writeState(dir, { schemaVersion: 2 });

    const r = runGuard(dir, "git commit -F does-not-exist.txt");
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!exists(dir, "SHIPPED.md"), "no SHIPPED entry when the named file cannot be read");
  } finally { cleanup(dir); }
});

test("extractCommitMessage: -F - (message piped via stdin) is genuinely unavailable - reconcile still runs everything except the SHIPPED entry, and logs the skip", () => {
  const { dir, git } = makeRepo();
  try {
    optInNoEnforcement(dir, git);
    writeState(dir, { schemaVersion: 2 });
    const nowBefore = read(dir, "NOW.md");

    const r = runGuard(dir, "git commit -F -");
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), "");

    assert.ok(!exists(dir, "SHIPPED.md"), "no SHIPPED entry - the subject was never guessed");
    assert.notEqual(read(dir, "NOW.md"), nowBefore, "NOW.md still regenerated - only the SHIPPED entry is skipped");
    const log = read(dir, path.join(".now", "reconcile.log"));
    assert.match(log, /SHIPPED entry skipped/, "the skip is visible in reconcile's own log");
  } finally { cleanup(dir); }
});

test("extractCommitMessage: an interactive editor commit (no -m/-F at all) is also genuinely unavailable, same as -F -", () => {
  const { dir, git } = makeRepo();
  try {
    optInNoEnforcement(dir, git);
    writeState(dir, { schemaVersion: 2 });

    const r = runGuard(dir, "git commit");
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!exists(dir, "SHIPPED.md"), "no SHIPPED entry when no message flag is present at all");
  } finally { cleanup(dir); }
});

test("extractCommitMessage: the heredoc idiom (-m \"$(cat <<'EOF' ...)\") still resolves to the message body's first line, not the shell syntax", () => {
  const { dir, git } = makeRepo();
  try {
    optInNoEnforcement(dir, git);
    writeState(dir, { schemaVersion: 2 });

    const command = [
      'git commit -m "$(cat <<\'EOF\'',
      "Heredoc subject line",
      "",
      "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>",
      "EOF",
      ')"',
    ].join("\n");

    const r = runGuard(dir, command);
    assert.equal(r.status, 0, r.stderr);
    const shipped = read(dir, "SHIPPED.md");
    assert.match(shipped, /-\s*Heredoc subject line\s*$/m);
    assert.doesNotMatch(shipped, /cat <</, "the shell syntax itself must never leak into SHIPPED.md");
  } finally { cleanup(dir); }
});

test("a commit prefixed with git global options (-c key=value) is still recognized and reconciled", () => {
  const { dir, git } = makeRepo();
  try {
    optInNoEnforcement(dir, git);
    writeState(dir, { schemaVersion: 2 });

    const r = runGuard(dir, 'git -c user.name=Test commit -m "global option subject"');
    assert.equal(r.status, 0, r.stderr);
    const shipped = read(dir, "SHIPPED.md");
    assert.match(shipped, /-\s*global option subject\s*$/m);
  } finally { cleanup(dir); }
});

// --- fix round: compound clear-and-commit coherence ---

test("a sentinel-clear-then-commit compound command renders NOW.md as post-clear (idle build), the phase Status line and roadmap item still complete, and after the real compound executes .now/state.json agrees", () => {
  const { dir, git } = makeRepo();
  try {
    optInNoEnforcement(dir, git);
    write(dir, "PLAN.md", PLAN); // phase 2's status is "built" - the final phase
    write(dir, "ROADMAP.md", ROADMAP); // item carries id r-0101-1
    write(dir, "b.js", "done\n");
    git(["add", "PLAN.md", "ROADMAP.md", "b.js"]);
    writeState(dir, {
      schemaVersion: 2,
      mode: "build",
      from: "r-0101-1",
      build: {
        plan: "PLAN.md",
        phase: 2,
        files: ["b.js"],
        allow: ["PLAN.md"],
        started: new Date().toISOString(),
        session: "session-1",
      },
    });

    // The real pipeline's compound shape: the sentinel-call bypass (leading
    // two tokens "node <sentinel.js path>") lets the WHOLE thing through
    // regardless of enforcement, since PreToolUse fires before any of it runs.
    fs.mkdirSync(path.join(dir, ".gantry"), { recursive: true });
    write(dir, path.join(".gantry", "enabled"), "");
    const command = `node ${JSON.stringify(SENTINEL_JS)} clear && git add -A && git commit -m "phase 2 done, compound"`;

    const r = runGuard(dir, command);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), "", "the sentinel-call bypass allows the whole compound through, enforcement notwithstanding");

    // The hook's own reconcile already ran synchronously, before any part of
    // the compound actually executes - NOW.md must already read as
    // post-clear (idle build), never the still-active phase that is about
    // to be cleared within this same Bash call.
    const nowAfterHook = read(dir, "NOW.md");
    assert.doesNotMatch(nowAfterHook, /phase 2 of/i, "NOW.md must not show the still-active phase - the clear is about to run");
    assert.doesNotMatch(nowAfterHook, /PLAN\.md/, "NOW.md must not reference the plan as the active position");

    // The phase-status/roadmap logic still fires off the real, pre-clear
    // build - the phase IS completing in this commit, independent of the
    // render-time treatment above.
    const planAfterHook = read(dir, "PLAN.md");
    assert.match(planAfterHook, /## Phase 2: Second\s*\n\*\*Status:\*\* committed \(\d{4}-\d{2}-\d{2}\)/);
    const roadmapAfterHook = read(dir, "ROADMAP.md");
    const shippedRoadmapBody = roadmapAfterHook.slice(roadmapAfterHook.indexOf("## Shipped"));
    assert.match(shippedRoadmapBody, /Ship the widget/, "the roadmap item still moves to Shipped");
    assert.match(read(dir, "SHIPPED.md"), /phase 2 done, compound/);

    // Now actually run the compound, for real, exactly as the orchestrator
    // would: clear the sentinel, stage everything, commit.
    const clearResult = runNode(dir, [SENTINEL_JS, "clear"]);
    assert.equal(clearResult.status, 0, clearResult.stderr);
    git(["add", "-A"]);
    git(["commit", "-q", "-m", "phase 2 done, compound"]);

    const finalState = JSON.parse(read(dir, path.join(".now", "state.json")));
    assert.equal(finalState.build, null, "the real clear leaves build null");

    // Both agree: the already-committed NOW.md (rendered before the clear
    // ran) and state.json (after the clear ran for real) both read as idle.
    assert.doesNotMatch(read(dir, "NOW.md"), /phase 2 of/i, "still idle after the real clear - nothing re-rendered it stale");
  } finally { cleanup(dir); }
});
