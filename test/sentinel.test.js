"use strict";
/* Tests for sentinel.js - write / clear / add-files subcommands. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawn, spawnSync, execSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { runAsync } = require("../tools/helpers.js");

const SENTINEL_SCRIPT = path.join(__dirname, "..", "plugins", "claudhd", "scripts", "sentinel.js");
const FILE_LIST_GUARD = path.join(__dirname, "..", "plugins", "claudhd", "scripts", "hooks", "file-list-guard.js");
const HOLD_LOCK = path.join(__dirname, "..", "tools", "hold-lock.js");
const override = require("../plugins/claudhd/scripts/override.js");

// A minimal plan fixture with two phases, used across most tests.
// Phase 2 has two Files entries; phase 3 has one.
const FIXTURE_PLAN = `# Test Plan
Source design: docs/design.md
Conventions read: none
Verification command(s): node --test

## Summary
Fixture plan for sentinel.test.js.

## Blockers / Open Questions
None.

## Phase 2: test phase two
**Goal:** Test phase two goal.
**Files:**
- create \`src/foo.js\` (some description)
- modify \`src/bar.js\`: some description
**Verification:** node --test
**Exit criteria:** tests pass.
**Blockers:** None.

## Phase 3: test phase three
**Goal:** Test phase three goal.
**Files:**
- create \`lib/baz.js\`
**Verification:** node --test
**Exit criteria:** tests pass.
**Blockers:** None.

## Cross-cutting concerns
None.
`;

function mk() { return fs.mkdtempSync(path.join(os.tmpdir(), "claudhd-sent-")); }
function write(dir, rel, content) {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}
// The sentinel now lives in the `build` section of .now/state.json (schema
// v2; Gantry's sentinel folded in - see sentinel-core.js/state.js).
function readSentinel(dir) {
  const p = path.join(dir, ".now", "state.json");
  return JSON.parse(fs.readFileSync(p, "utf8")).build;
}
function sentinelExists(dir) {
  try {
    return readSentinel(dir) != null;
  } catch {
    return false;
  }
}

// Run sentinel.js with the given args and a GANTRY_PROJECT_DIR pointing at dir.
// planPath defaults to a temp plan file in dir when not specified.
function run(dir, args, extraEnv) {
  return spawnSync(process.execPath, [SENTINEL_SCRIPT, ...args], {
    encoding: "utf8",
    env: { ...process.env, GANTRY_PROJECT_DIR: dir, ...extraEnv },
  });
}

// Write the fixture plan into dir and return its absolute path.
function writePlan(dir) {
  const planPath = path.join(dir, "docs", "plan.md");
  write(dir, "docs/plan.md", FIXTURE_PLAN);
  return planPath;
}

// --- write subcommand: files list ---

test("write: files list equals the plan phase's Files entries", () => {
  const dir = mk();
  try {
    const planPath = writePlan(dir);
    const r = run(dir, ["write", planPath, "2"]);
    assert.equal(r.status, 0, "write should exit 0\nstdout: " + r.stdout + "\nstderr: " + r.stderr);
    const s = readSentinel(dir);
    assert.deepEqual(s.files, ["src/foo.js", "src/bar.js"],
      "files should match the two entries in Phase 2 Files");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("write: files list for a different phase number", () => {
  const dir = mk();
  try {
    const planPath = writePlan(dir);
    const r = run(dir, ["write", planPath, "3"]);
    assert.equal(r.status, 0, r.stderr);
    const s = readSentinel(dir);
    assert.deepEqual(s.files, ["lib/baz.js"], "files should match Phase 3 Files");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// --- write: INLINE Files format (canonical PLAN.md template shape) ---

// A plan fixture that uses the canonical INLINE **Files:** format where paths
// sit on the same line as the heading, not in bullet lines below it.
const INLINE_PLAN = `# Inline Plan
Source design: docs/design.md
Conventions read: none
Verification command(s): node --test

## Summary
Plan with inline Files format.

## Blockers / Open Questions
None.

## Phase 1: inline phase
**Status:** pending
**Goal:** Test inline Files parsing.
**Files:** \`src/alpha.js\`, \`src/beta.js\`
**Verification:** node --test
**Exit criteria:** tests pass.
**Blockers:** None.

## Cross-cutting concerns
None.
`;

// --- write: BULLET format with multiple backtick-quoted paths on one bullet ---

// Regression fixture for the multi-file-per-bullet bug: a bullet like
// "- modify `a.js`, `b.js`, `c.js`" must contribute all three files, not just
// the first. Phase 2 also carries a trailing description bullet with extra
// backtick-quoted text that is NOT a file path (e.g. "(`SCHEMA_VERSION = 2`)"),
// which must NOT be swept into the files list just because it shares the line.
const MULTI_FILE_PLAN = `# Multi Plan
Source design: docs/design.md
Conventions read: none
Verification command(s): node --test

## Summary
Fixture plan with multi-file bullets, mirroring real phase-2-style plans.

## Phase 2: multi-file phase
**Goal:** Test multi-file Files bullets.
**Files:**
- modify \`a.js\`, \`b.js\`, \`c.js\` (three files, one bullet)
- modify \`d.js\` (\`SOME_CONST = 1\`; add \`helperFn\` and \`otherThing\` - description text, not file paths)
- create \`e.js\`, \`f.js\`
**Verification:** node --test
**Exit criteria:** tests pass.
**Blockers:** None.

## Cross-cutting concerns
None.
`;

test("write: a bullet with multiple comma-separated backtick paths contributes every path", () => {
  const dir = mk();
  try {
    const planPath = path.join(dir, "plan.md");
    fs.writeFileSync(planPath, MULTI_FILE_PLAN);
    const r = run(dir, ["write", planPath, "2"]);
    assert.equal(r.status, 0, "write should exit 0\nstdout: " + r.stdout + "\nstderr: " + r.stderr);
    const s = readSentinel(dir);
    assert.deepEqual(
      s.files,
      ["a.js", "b.js", "c.js", "d.js", "e.js", "f.js"],
      "every backtick-quoted path across all bullets must be captured, in order"
    );
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// Hermetic regression against the real plan's shape: a verbatim copy of this
// repo's design/claudhd-1.0-design_reviewed-plan.md Phase 2 Files section (not
// a read of the live file, so a future edit to the real plan can't silently
// break this test's expectations or make it pass for the wrong reason). This
// mirrors the actual bug report: the live plan's phase 2 names 15 files.
const PHASE2_SHAPE_PLAN = `# Phase 2 Shape Plan
Source design: docs/design.md
Conventions read: none
Verification command(s): node --test

## Summary
Verbatim copy of the real plan's Phase 2 Files section, frozen as a fixture.

## Phase 2: state.json schemaVersion 2, with the sentinel folded in
**Status:** pending
**Goal:** \`.now/state.json\` becomes the single machine-readable truth, carrying mode, active roadmap id, plan ref, phase and file list alongside today's cursor/ideas/shipped/roadmap/git facts, readable by both v1 and v2 consumers and written without clobbering.
**Files:**
- modify \`plugins/claudhd/scripts/state.js\` (\`SCHEMA_VERSION = 2\`; add \`mode\`, \`from\` (the roadmap-id parent link), \`build\` (plan ref, phase, files, allow, started, session) and \`design\` (doc path, resolved/open decision lists) sections; add \`readState(nowDir)\` that accepts v1 and v2 and returns absent build/design sections as \`null\`; convert \`writeStateAtomic\` into a merge-preserving write that reads the existing object, applies only the fields the caller owns, and keeps everything else, all inside \`withLock\` from \`lock.js\`)
- modify \`plugins/claudhd/scripts/sentinel-core.js\` (\`readSentinel(root)\` now reads the \`build\` section of \`.now/state.json\`; on first run it imports a legacy \`.gantry/active-phase.json\` into that section and then removes the legacy file; \`isStale\`, \`normalize\`, \`isInList\`, \`FAIL_OPEN\` keep their exact current semantics)
- modify \`plugins/claudhd/scripts/sentinel.js\` (\`write\` / \`clear\` / \`add-files\` operate on the \`build\` section through the merge-preserving writer; the "zero files parsed means do not write a sentinel" fail-open rule at lines 196-202 stays exactly as it is)
- modify \`plugins/claudhd/scripts/checkpoint.js\` (the Stop hook's \`buildState\` + write path must merge, never replace, so a Stop between two phase edits cannot erase the build section)
- modify \`plugins/claudhd/scripts/hooks/file-list-guard.js\`, \`plugins/claudhd/scripts/hooks/commit-guard.js\` (deny reasons stop telling the user to delete \`.gantry/active-phase.json\` and name the real clear path instead; no behavior change)
- modify \`plugins/claudhd/scripts/role-core.js\` (\`buildGuardSettings\` comment and the headless-implementer settings path text reference the new sentinel location)
- create \`test/state-v2.test.js\` (v1 file reads without error and yields null build/design; first v2 write preserves every pre-existing cursor fact; a v2 file round-trips; unknown keys survive a write)
- create \`test/state-concurrency.test.js\` (a \`sentinel.js write\` racing a \`checkpoint.js\` Stop leaves both the build section and the cursor facts intact; reuse the pattern in the existing \`test/lock.test.js\` and \`tools/hold-lock.js\`)
- modify \`test/state.test.js\`, \`test/checkpoint.test.js\`, \`test/sentinel.test.js\`, \`test/sentinel-core.test.js\`, \`test/file-list-guard.test.js\`, \`test/commit-guard.test.js\` (retarget to the new sentinel location; the legacy-import case gets its own named test)
**Verification:** \`npm test\`. Three assertions carry the phase.
**Exit criteria:** \`npm test\` passes.
**Blockers:** None.

## Cross-cutting concerns
None.
`;

test("write: the real plan's phase-2 Files shape (frozen fixture copy) yields all 15 named files", () => {
  const dir = mk();
  try {
    const planPath = path.join(dir, "plan.md");
    fs.writeFileSync(planPath, PHASE2_SHAPE_PLAN);
    const r = run(dir, ["write", planPath, "2"]);
    assert.equal(r.status, 0, "write should exit 0\nstdout: " + r.stdout + "\nstderr: " + r.stderr);
    const s = readSentinel(dir);
    assert.equal(s.files.length, 15, "phase 2's Files section names 15 files; got: " + JSON.stringify(s.files));
    assert.deepEqual(s.files, [
      "plugins/claudhd/scripts/state.js",
      "plugins/claudhd/scripts/sentinel-core.js",
      "plugins/claudhd/scripts/sentinel.js",
      "plugins/claudhd/scripts/checkpoint.js",
      "plugins/claudhd/scripts/hooks/file-list-guard.js",
      "plugins/claudhd/scripts/hooks/commit-guard.js",
      "plugins/claudhd/scripts/role-core.js",
      "test/state-v2.test.js",
      "test/state-concurrency.test.js",
      "test/state.test.js",
      "test/checkpoint.test.js",
      "test/sentinel.test.js",
      "test/sentinel-core.test.js",
      "test/file-list-guard.test.js",
      "test/commit-guard.test.js",
    ]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("write: parses inline Files format (paths on the **Files:** line itself)", () => {
  const dir = mk();
  try {
    const planPath = path.join(dir, "plan.md");
    fs.writeFileSync(planPath, INLINE_PLAN);
    const r = run(dir, ["write", planPath, "1"]);
    assert.equal(r.status, 0, "write should exit 0 for inline Files format\nstderr: " + r.stderr);
    const s = readSentinel(dir);
    assert.deepEqual(s.files, ["src/alpha.js", "src/beta.js"],
      "files should match the two inline backtick-quoted tokens on the **Files:** line");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// A plan fixture with no backtick-quoted paths - simulates a phase where the
// parser cannot extract any file paths (e.g. missing backticks, prose-only Files).
const NO_FILES_PLAN = `# No Files Plan
Source design: docs/design.md
Conventions read: none
Verification command(s): node --test

## Summary
Plan with no parseable file paths.

## Phase 1: empty files phase
**Goal:** Phase with no parseable files.
**Files:** (see design doc for full list)
**Verification:** node --test
**Exit criteria:** tests pass.
**Blockers:** None.

## Cross-cutting concerns
None.
`;

test("write: exits non-zero and writes NO sentinel when phase yields zero parseable files", () => {
  const dir = mk();
  try {
    const planPath = path.join(dir, "plan.md");
    fs.writeFileSync(planPath, NO_FILES_PLAN);
    const r = run(dir, ["write", planPath, "1"]);
    assert.notEqual(r.status, 0,
      "write must exit non-zero when no files can be parsed (fail-open: do not write broken sentinel)");
    assert.ok(!sentinelExists(dir),
      "no sentinel file should be written when zero files were parsed");
    assert.ok(r.stderr.includes("could not parse any files"),
      "stderr should contain the diagnostic message; got: " + r.stderr);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// --- write subcommand: allow list - docs/ vs root ---

test("write: allow resolves audit docs into docs/ when docs/ exists", () => {
  const dir = mk();
  try {
    // docs/ already exists (we wrote the plan there)
    const planPath = writePlan(dir);
    const r = run(dir, ["write", planPath, "2"]);
    assert.equal(r.status, 0, r.stderr);
    const s = readSentinel(dir);
    // Plan path itself should be in allow (relative to root)
    assert.ok(s.allow.includes("docs/plan.md"), "allow should include the plan path (docs/plan.md)");
    // Audit docs should be in docs/
    assert.ok(s.allow.includes("docs/CURRENTNESS_AUDIT.md"),
      "allow should include docs/CURRENTNESS_AUDIT.md when docs/ exists");
    assert.ok(s.allow.includes("docs/RUNTIME_VERIFICATION_QUEUE.md"),
      "allow should include docs/RUNTIME_VERIFICATION_QUEUE.md when docs/ exists");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("write: allow resolves audit docs to root when docs/ is absent", () => {
  const dir = mk();
  try {
    // Write the plan at the root level (no docs/ dir)
    const planPath = path.join(dir, "plan.md");
    fs.writeFileSync(planPath, FIXTURE_PLAN);
    const r = run(dir, ["write", planPath, "2"]);
    assert.equal(r.status, 0, r.stderr);
    const s = readSentinel(dir);
    // Plan path at root
    assert.ok(s.allow.includes("plan.md"), "allow should include plan.md (root)");
    // Audit docs at root
    assert.ok(s.allow.includes("CURRENTNESS_AUDIT.md"),
      "allow should include CURRENTNESS_AUDIT.md at root when docs/ is absent");
    assert.ok(s.allow.includes("RUNTIME_VERIFICATION_QUEUE.md"),
      "allow should include RUNTIME_VERIFICATION_QUEUE.md at root when docs/ is absent");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// --- write subcommand: ROADMAP.md ---

test("write: ROADMAP.md included in allow only when the file exists", () => {
  const dir = mk();
  try {
    const planPath = writePlan(dir);

    // Without ROADMAP.md
    const r1 = run(dir, ["write", planPath, "2"]);
    assert.equal(r1.status, 0, r1.stderr);
    const s1 = readSentinel(dir);
    assert.ok(!s1.allow.includes("ROADMAP.md"), "allow must NOT include ROADMAP.md when file is absent");

    // With ROADMAP.md present
    write(dir, "ROADMAP.md", "# Roadmap\n");
    const r2 = run(dir, ["write", planPath, "2"]);
    assert.equal(r2.status, 0, r2.stderr);
    const s2 = readSentinel(dir);
    assert.ok(s2.allow.includes("ROADMAP.md"), "allow MUST include ROADMAP.md when file exists");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// --- write subcommand: metadata stamping ---

test("write: stamps started as ISO string and plan/phase fields", () => {
  const dir = mk();
  try {
    const planPath = writePlan(dir);
    const before = new Date();
    const r = run(dir, ["write", planPath, "2"]);
    const after = new Date();
    assert.equal(r.status, 0, r.stderr);
    const s = readSentinel(dir);
    assert.equal(s.phase, 2, "phase should be 2");
    const started = new Date(s.started);
    assert.ok(started >= before && started <= after, "started should be within the test window");
    // plan field should be the relative path of the plan from the project root
    assert.equal(s.plan, "docs/plan.md", "plan field should be relative path");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("write: session stamped from third argument when provided", () => {
  const dir = mk();
  try {
    const planPath = writePlan(dir);
    const r = run(dir, ["write", planPath, "2", "my-session-123"]);
    assert.equal(r.status, 0, r.stderr);
    const s = readSentinel(dir);
    assert.equal(s.session, "my-session-123");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("write: session stamped from GANTRY_SESSION_ID env when no arg provided", () => {
  const dir = mk();
  try {
    const planPath = writePlan(dir);
    const r = run(dir, ["write", planPath, "2"], { GANTRY_SESSION_ID: "env-session-456" });
    assert.equal(r.status, 0, r.stderr);
    const s = readSentinel(dir);
    assert.equal(s.session, "env-session-456");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("write: session stamped from CLAUDE_CODE_SESSION_ID when no arg and no GANTRY_SESSION_ID", () => {
  const dir = mk();
  try {
    const planPath = writePlan(dir);
    // Unset GANTRY_SESSION_ID explicitly so we fall through to CLAUDE_CODE_SESSION_ID.
    const envOverride = { CLAUDE_CODE_SESSION_ID: "cc-session-789" };
    // spawnSync inherits process.env via run(); override GANTRY_SESSION_ID to empty.
    const r = run(dir, ["write", planPath, "2"], { ...envOverride, GANTRY_SESSION_ID: "" });
    assert.equal(r.status, 0, "write with CLAUDE_CODE_SESSION_ID should exit 0\nstderr: " + r.stderr);
    const s = readSentinel(dir);
    assert.equal(s.session, "cc-session-789",
      "session should equal CLAUDE_CODE_SESSION_ID when no explicit arg or GANTRY_SESSION_ID");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// --- write overwrites prior sentinel (single-writer property) ---

test("write: second write overwrites a prior sentinel", () => {
  const dir = mk();
  try {
    const planPath = writePlan(dir);

    run(dir, ["write", planPath, "2", "session-a"]);
    const first = readSentinel(dir);
    assert.equal(first.phase, 2);
    assert.equal(first.session, "session-a");

    run(dir, ["write", planPath, "3", "session-b"]);
    const second = readSentinel(dir);
    assert.equal(second.phase, 3, "second write should overwrite to phase 3");
    assert.equal(second.session, "session-b", "second write should overwrite session");
    assert.deepEqual(second.files, ["lib/baz.js"], "second write should overwrite files");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// --- clear subcommand ---

test("clear: removes the sentinel file", () => {
  const dir = mk();
  try {
    const planPath = writePlan(dir);
    run(dir, ["write", planPath, "2"]);
    assert.ok(sentinelExists(dir), "sentinel should exist before clear");
    const r = run(dir, ["clear"]);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!sentinelExists(dir), "sentinel should be removed after clear");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("clear: no-op (no throw, exit 0) when sentinel is absent", () => {
  const dir = mk();
  try {
    assert.ok(!sentinelExists(dir), "no sentinel should pre-exist");
    const r = run(dir, ["clear"]);
    assert.equal(r.status, 0, "clear on absent sentinel must exit 0\nstdout: " + r.stdout + "\nstderr: " + r.stderr);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// --- add-files subcommand ---

test("add-files: appends new paths to the sentinel's files list", () => {
  const dir = mk();
  try {
    const planPath = writePlan(dir);
    run(dir, ["write", planPath, "2"]);
    const r = run(dir, ["add-files", "src/extra.js", "lib/helper.js"]);
    assert.equal(r.status, 0, r.stderr);
    const s = readSentinel(dir);
    assert.ok(s.files.includes("src/extra.js"), "src/extra.js should be appended");
    assert.ok(s.files.includes("lib/helper.js"), "lib/helper.js should be appended");
    // Original entries still present
    assert.ok(s.files.includes("src/foo.js"), "original src/foo.js should remain");
    assert.ok(s.files.includes("src/bar.js"), "original src/bar.js should remain");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("add-files: idempotent - does not duplicate an already-listed path", () => {
  const dir = mk();
  try {
    const planPath = writePlan(dir);
    run(dir, ["write", planPath, "2"]);
    // src/foo.js is already in files from the plan
    const r = run(dir, ["add-files", "src/foo.js", "src/new.js"]);
    assert.equal(r.status, 0, r.stderr);
    const s = readSentinel(dir);
    const count = s.files.filter((f) => f === "src/foo.js").length;
    assert.equal(count, 1, "src/foo.js should appear exactly once (no duplicate)");
    assert.ok(s.files.includes("src/new.js"), "src/new.js should be added");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("add-files: no-op (no throw, exit 0) when sentinel is absent", () => {
  const dir = mk();
  try {
    assert.ok(!sentinelExists(dir), "no sentinel should pre-exist");
    const r = run(dir, ["add-files", "src/extra.js"]);
    assert.equal(r.status, 0, "add-files on absent sentinel must exit 0\nstdout: " + r.stdout + "\nstderr: " + r.stderr);
    assert.ok(!sentinelExists(dir), "no sentinel should be created");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// --- write: same-plan+phase re-write preserves add-files widening (fix-relay path) ---

test("write: a re-write for the SAME plan+phase keeps files widened in by add-files", () => {
  const dir = mk();
  try {
    const planPath = writePlan(dir);
    run(dir, ["write", planPath, "2"]);
    run(dir, ["add-files", "reviewer/cited.js"]);
    const r = run(dir, ["write", planPath, "2"]);
    assert.equal(r.status, 0, r.stderr);
    const s = readSentinel(dir);
    assert.ok(s.files.includes("reviewer/cited.js"),
      "the fix-relay path must not lose a reviewer-cited file on re-write");
    assert.ok(s.files.includes("src/foo.js"), "the plan's own files must still be present");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("write: a re-write for a DIFFERENT phase does NOT carry over add-files widening", () => {
  const dir = mk();
  try {
    const planPath = writePlan(dir);
    run(dir, ["write", planPath, "2"]);
    run(dir, ["add-files", "reviewer/cited.js"]);
    const r = run(dir, ["write", planPath, "3"]);
    assert.equal(r.status, 0, r.stderr);
    const s = readSentinel(dir);
    assert.ok(!s.files.includes("reviewer/cited.js"),
      "a fresh phase must not inherit the prior phase's widened files");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// --- write-files subcommand: /claudhd:quick's scoped, plan-less sentinel ---

test("write-files: writes a sentinel with plan null and phase 'quick'", () => {
  const dir = mk();
  try {
    const r = run(dir, ["write-files", "src/a.js", "src/b.js"]);
    assert.equal(r.status, 0, "write-files should exit 0\nstdout: " + r.stdout + "\nstderr: " + r.stderr);
    const s = readSentinel(dir);
    assert.equal(s.plan, null);
    assert.equal(s.phase, "quick");
    assert.deepEqual(s.files, ["src/a.js", "src/b.js"]);
    assert.deepEqual(s.allow, ["NOW.md"],
      "allow must include NOW.md - the clearing pass checks off batch items there");
    assert.ok(s.started, "started must be stamped");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("write-files: no args exits non-zero with usage, no sentinel written", () => {
  const dir = mk();
  try {
    const r = run(dir, ["write-files"]);
    assert.notEqual(r.status, 0, "write-files with no files must be refused");
    assert.match(r.stderr, /usage/i);
    assert.ok(!sentinelExists(dir), "no sentinel should be written");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("write-files: refuses to clobber an ACTIVE plan-backed build phase - sentinel and recorded review rounds stay byte-untouched, commit gate stays closed (sol round-four ruling)", () => {
  const dir = mk();
  try {
    const planPath = writePlan(dir);
    run(dir, ["write", planPath, "2"]);
    const roundResult = runIn(dir, ["record-round", planPath, "2", "FAIL"], "1. fix the thing\n2. fix the other thing\n");
    assert.equal(roundResult.status, 0, "recording the round should exit 0\n" + roundResult.stderr);

    const stateJsonPath = path.join(dir, ".now", "state.json");
    const roundJsonPath = path.join(dir, ".gantry", "review-round.json");
    const stateBefore = fs.readFileSync(stateJsonPath, "utf8");
    const roundBefore = fs.readFileSync(roundJsonPath, "utf8");

    const r = run(dir, ["write-files", "quick/fix.js"]);
    assert.notEqual(r.status, 0, "write-files must refuse while an active plan-backed phase is in flight");
    assert.match(r.stderr, /active build phase/i, "the refusal must name it as an active build phase");
    assert.match(r.stderr, /phase 2/, "the refusal must name the blocking phase number");
    assert.match(r.stderr, /docs\/plan\.md/, "the refusal must name the blocking plan path");
    assert.match(r.stderr, /claudhd:review|sentinel\.js clear/i, "the refusal must name a remedy: finish or clear the phase");

    const stateAfter = fs.readFileSync(stateJsonPath, "utf8");
    const roundAfter = fs.readFileSync(roundJsonPath, "utf8");
    assert.equal(stateAfter, stateBefore, "state.json (the sentinel) must be byte-untouched by a refused write-files");
    assert.equal(roundAfter, roundBefore, "review-round.json must be byte-untouched by a refused write-files");

    const s = readSentinel(dir);
    assert.equal(s.plan, "docs/plan.md", "the real phase's sentinel must still be the active one, not replaced");
    assert.equal(s.phase, 2, "the commit gate stays closed on the real phase, never silently reset to the quick lane");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("write-files: a STALE plan-backed sentinel does not block - an abandoned phase is not really active", () => {
  const dir = mk();
  try {
    const planPath = writePlan(dir);
    run(dir, ["write", planPath, "2"], { GANTRY_SESSION_ID: "stale-session" });

    // Backdate `started` so isStale()'s AND condition (different session +
    // > 6h old) is satisfied, simulating an abandoned phase.
    const stateJsonPath = path.join(dir, ".now", "state.json");
    const state = JSON.parse(fs.readFileSync(stateJsonPath, "utf8"));
    state.build.started = new Date(Date.now() - 7 * 3600 * 1000).toISOString();
    fs.writeFileSync(stateJsonPath, JSON.stringify(state, null, 2));

    const r = run(dir, ["write-files", "quick/fix.js"], { GANTRY_SESSION_ID: "current-session" });
    assert.equal(r.status, 0, "a stale sentinel must not block write-files\nstderr: " + r.stderr);
    const s = readSentinel(dir);
    assert.equal(s.plan, null, "the stale phase's sentinel is replaced by the quick sentinel");
    assert.equal(s.phase, "quick");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("write-files: a plan-less quick sentinel does not block a later write-files call", () => {
  const dir = mk();
  try {
    run(dir, ["write-files", "first/fix.js"]);
    const r = run(dir, ["write-files", "second/fix.js"]);
    assert.equal(r.status, 0, "a prior quick (plan: null) sentinel must never block another quick pass\nstderr: " + r.stderr);
    const s = readSentinel(dir);
    assert.deepEqual(s.files, ["second/fix.js"]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// --- record-round subcommand: re-review context rounds ---

// Like run(), but with stdin content (the fixes text record-round expects).
function runIn(dir, args, input) {
  return spawnSync(process.execPath, [SENTINEL_SCRIPT, ...args], {
    encoding: "utf8",
    input,
    env: { ...process.env, GANTRY_PROJECT_DIR: dir },
  });
}
function readRounds(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, ".gantry", "review-round.json"), "utf8"));
}
function roundsExist(dir) {
  return fs.existsSync(path.join(dir, ".gantry", "review-round.json"));
}

test("record-round: creates review-round.json with round 1 from stdin fixes", () => {
  const dir = mk();
  try {
    const planPath = writePlan(dir);
    const r = runIn(dir, ["record-round", planPath, "2", "FAIL"], "1. fix the thing\n2. fix the other thing\n");
    assert.equal(r.status, 0, "record-round should exit 0\nstdout: " + r.stdout + "\nstderr: " + r.stderr);
    const s = readRounds(dir);
    assert.equal(s.plan, "docs/plan.md", "plan must be stored root-relative posix");
    assert.equal(s.phase, 2);
    assert.equal(s.rounds.length, 1);
    assert.equal(s.rounds[0].round, 1);
    assert.equal(s.rounds[0].verdict, "FAIL");
    assert.match(s.rounds[0].fixes, /fix the thing/);
    assert.ok(s.rounds[0].recorded, "round must carry a recorded timestamp");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("record-round: appends round 2 for the same plan and phase", () => {
  const dir = mk();
  try {
    const planPath = writePlan(dir);
    runIn(dir, ["record-round", planPath, "2", "FAIL"], "round one fixes");
    const r = runIn(dir, ["record-round", planPath, "2", "PASS-WITH-NOTES"], "round two fixes");
    assert.equal(r.status, 0, r.stderr);
    const s = readRounds(dir);
    assert.equal(s.rounds.length, 2, "rounds must accumulate for the same plan+phase");
    assert.equal(s.rounds[1].round, 2);
    assert.equal(s.rounds[1].verdict, "PASS-WITH-NOTES");
    assert.match(s.rounds[1].fixes, /round two fixes/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("record-round: a different phase starts a fresh file (no cross-phase leak)", () => {
  const dir = mk();
  try {
    const planPath = writePlan(dir);
    runIn(dir, ["record-round", planPath, "2", "FAIL"], "phase two fixes");
    const r = runIn(dir, ["record-round", planPath, "3", "FAIL"], "phase three fixes");
    assert.equal(r.status, 0, r.stderr);
    const s = readRounds(dir);
    assert.equal(s.phase, 3);
    assert.equal(s.rounds.length, 1, "prior phase's rounds must be discarded");
    assert.match(s.rounds[0].fixes, /phase three fixes/);
    assert.doesNotMatch(JSON.stringify(s), /phase two fixes/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("record-round: empty stdin exits non-zero and writes nothing", () => {
  const dir = mk();
  try {
    const planPath = writePlan(dir);
    const r = runIn(dir, ["record-round", planPath, "2", "FAIL"], "");
    assert.notEqual(r.status, 0, "a round with no fixes text must be refused");
    assert.match(r.stderr, /stdin/i, "the error must say the fixes go on stdin");
    assert.ok(!roundsExist(dir), "no round file should be written");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("record-round: missing args exit non-zero with usage", () => {
  const dir = mk();
  try {
    const r = runIn(dir, ["record-round", "plan.md", "2"], "fixes");
    assert.notEqual(r.status, 0, "record-round without a verdict must fail");
    assert.match(r.stderr, /usage/i);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("write: removes a stale round file recorded for a different phase", () => {
  const dir = mk();
  try {
    const planPath = writePlan(dir);
    runIn(dir, ["record-round", planPath, "2", "FAIL"], "phase two fixes");
    assert.ok(roundsExist(dir));
    const r = run(dir, ["write", planPath, "3"]);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!roundsExist(dir),
      "starting phase 3 must remove phase 2's recorded rounds");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("write: keeps the round file for the same plan and phase (the fix-relay path)", () => {
  const dir = mk();
  try {
    const planPath = writePlan(dir);
    run(dir, ["write", planPath, "2"]);
    runIn(dir, ["record-round", planPath, "2", "FAIL"], "mid-loop fixes");
    // /claudhd:build re-invoked for the fix pass runs write again for the SAME
    // plan+phase; the live rounds must survive or the re-review loses its context.
    const r = run(dir, ["write", planPath, "2"]);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(roundsExist(dir), "same-phase re-write must keep the recorded rounds");
    assert.match(readRounds(dir).rounds[0].fixes, /mid-loop fixes/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("clear: removes the round file along with the sentinel", () => {
  const dir = mk();
  try {
    const planPath = writePlan(dir);
    run(dir, ["write", planPath, "2"]);
    runIn(dir, ["record-round", planPath, "2", "FAIL"], "some fixes");
    const r = run(dir, ["clear"]);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!sentinelExists(dir), "sentinel must be cleared");
    assert.ok(!roundsExist(dir), "recorded rounds die with the phase");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// --- persistent review-round log (.now/review-log.jsonl) ---

function readReviewLogLines(dir) {
  const p = path.join(dir, ".now", "review-log.jsonl");
  const text = fs.readFileSync(p, "utf8");
  return text.split("\n").filter(Boolean).map((l) => JSON.parse(l));
}
function reviewLogExists(dir) {
  return fs.existsSync(path.join(dir, ".now", "review-log.jsonl"));
}

test("clear: appends a review-log line with the recorded rounds intact", () => {
  const dir = mk();
  try {
    const planPath = writePlan(dir);
    run(dir, ["write", planPath, "2"]);
    runIn(dir, ["record-round", planPath, "2", "FAIL"], "round one fixes");
    runIn(dir, ["record-round", planPath, "2", "PASS-WITH-NOTES"], "round two fixes");
    const r = run(dir, ["clear"]);
    assert.equal(r.status, 0, r.stderr);

    const lines = readReviewLogLines(dir);
    assert.equal(lines.length, 1, "clear must append exactly one line");
    const entry = lines[0];
    assert.equal(entry.plan, "docs/plan.md");
    assert.equal(entry.phase, 2);
    assert.equal(entry.rounds.length, 2, "both recorded rounds must be carried verbatim");
    assert.equal(entry.rounds[0].verdict, "FAIL");
    assert.match(entry.rounds[0].fixes, /round one fixes/);
    assert.equal(entry.rounds[1].verdict, "PASS-WITH-NOTES");
    assert.match(entry.rounds[1].fixes, /round two fixes/);
    assert.ok(entry.started, "started must be carried from the sentinel");
    assert.ok(entry.cleared, "cleared must be stamped");
    assert.deepEqual(entry.originalFiles, ["src/foo.js", "src/bar.js"]);
    assert.deepEqual(entry.finalFiles, ["src/foo.js", "src/bar.js"]);
    assert.ok(Array.isArray(entry.changedFiles), "changedFiles must be an array");
    // The exact values changedFiles carries for a real git repo are asserted
    // by the dedicated git-backed test below, not repeated here.
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("clear: changedFiles carries the EXACT real `git status --porcelain -z` result at clear time, not just an array shape", () => {
  const dir = mk();
  try {
    execSync("git init -q", { cwd: dir });
    execSync('git config user.email "t@t.example"', { cwd: dir });
    execSync('git config user.name "Test"', { cwd: dir });

    const planPath = writePlan(dir);
    write(dir, "committed.js", "// base\n");
    write(dir, ".gitignore", ".now/\n.gantry/\n");
    execSync("git add -A", { cwd: dir });
    execSync('git commit -q -m base', { cwd: dir });

    run(dir, ["write", planPath, "2"]); // creates .now/state.json - gitignored, must not appear below

    // Real, deliberate changes after the base commit: one tracked-file edit,
    // one brand-new untracked file.
    fs.writeFileSync(path.join(dir, "committed.js"), "// changed\n");
    write(dir, "feature.js", "// new\n");

    const r = run(dir, ["clear"]);
    assert.equal(r.status, 0, r.stderr);

    const lines = readReviewLogLines(dir);
    const entry = lines[lines.length - 1];
    assert.deepEqual(
      entry.changedFiles.slice().sort(),
      ["committed.js", "feature.js"].sort(),
      "changedFiles must be the exact real git-status paths, no more, no less; got: " + JSON.stringify(entry.changedFiles)
    );
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("clear: changedFiles preserves a special-character filename VERBATIM (spaces and parentheses) - the -z form must never quote/escape it", () => {
  const dir = mk();
  try {
    execSync("git init -q", { cwd: dir });
    execSync('git config user.email "t@t.example"', { cwd: dir });
    execSync('git config user.name "Test"', { cwd: dir });

    const planPath = writePlan(dir);
    write(dir, ".gitignore", ".now/\n.gantry/\n");
    execSync("git add -A", { cwd: dir });
    execSync('git commit -q -m base', { cwd: dir });

    run(dir, ["write", planPath, "2"]);

    // A real untracked file whose name would be quoted/escaped by plain
    // `git status --porcelain` (no -z): spaces and parentheses. Safe across
    // Windows/POSIX filesystems, unlike embedded quotes or non-ASCII bytes.
    const specialName = "weird file (v2).js";
    write(dir, specialName, "// special\n");

    const r = run(dir, ["clear"]);
    assert.equal(r.status, 0, r.stderr);

    const lines = readReviewLogLines(dir);
    const entry = lines[lines.length - 1];
    assert.deepEqual(
      entry.changedFiles, [specialName],
      "the special-character filename must land in changedFiles byte-for-byte, with no quoting artifacts; got: " + JSON.stringify(entry.changedFiles)
    );
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("clear: originalFiles stays frozen across an add-files widening, while finalFiles reflects the widened list", () => {
  const dir = mk();
  try {
    const planPath = writePlan(dir);
    run(dir, ["write", planPath, "2"]);
    run(dir, ["add-files", "reviewer/cited.js"]);

    const r = run(dir, ["clear"]);
    assert.equal(r.status, 0, r.stderr);

    const lines = readReviewLogLines(dir);
    const entry = lines[lines.length - 1];
    assert.deepEqual(entry.originalFiles, ["src/foo.js", "src/bar.js"],
      "originalFiles must stay frozen at the phase's first-parsed scope, unaffected by the later add-files widening");
    assert.deepEqual(entry.finalFiles, ["src/foo.js", "src/bar.js", "reviewer/cited.js"],
      "finalFiles must reflect the add-files widening");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("clear: with no rounds recorded still appends a scope record line", () => {
  const dir = mk();
  try {
    const planPath = writePlan(dir);
    run(dir, ["write", planPath, "2"]);
    // no record-round call at all
    const r = run(dir, ["clear"]);
    assert.equal(r.status, 0, r.stderr);

    const lines = readReviewLogLines(dir);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].phase, 2);
    assert.deepEqual(lines[0].rounds, [], "no rounds were recorded, so rounds must be an empty array");
    assert.deepEqual(lines[0].originalFiles, ["src/foo.js", "src/bar.js"]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("clear: an ORPHANED round file (no readable sentinel) still gets logged, using the round file's own plan/phase, before it is destroyed", () => {
  const dir = mk();
  try {
    const planPath = writePlan(dir);
    run(dir, ["write", planPath, "2"]);
    runIn(dir, ["record-round", planPath, "2", "FAIL"], "orphaned round fixes");
    assert.ok(roundsExist(dir), "sanity: the round file must exist before the sentinel is wiped");

    // Simulate the sentinel becoming unreadable/absent out from under the
    // round file: reset state.json's build section to null directly,
    // leaving .gantry/review-round.json untouched.
    const stateJsonPath = path.join(dir, ".now", "state.json");
    const state = JSON.parse(fs.readFileSync(stateJsonPath, "utf8"));
    state.build = null;
    fs.writeFileSync(stateJsonPath, JSON.stringify(state, null, 2));
    assert.ok(!sentinelExists(dir), "sanity: readSentinel must now see no active sentinel");

    const r = run(dir, ["clear"]);
    assert.equal(r.status, 0, r.stderr);

    const lines = readReviewLogLines(dir);
    assert.equal(lines.length, 1, "the orphaned round data must still produce exactly one log line");
    assert.equal(lines[0].plan, "docs/plan.md", "plan must come from the round file's own field");
    assert.equal(lines[0].phase, 2, "phase must come from the round file's own field");
    assert.equal(lines[0].rounds.length, 1);
    assert.match(lines[0].rounds[0].fixes, /orphaned round fixes/);
    assert.ok(!roundsExist(dir), "the orphaned round file must still be removed");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("clear: a log-write failure does not block the clear", () => {
  const dir = mk();
  try {
    const planPath = writePlan(dir);
    run(dir, ["write", planPath, "2"]);
    // Sabotage the log path itself: a directory sitting where the file must
    // go makes appendFileSync throw (EISDIR), simulating a write failure.
    fs.mkdirSync(path.join(dir, ".now", "review-log.jsonl"));

    const r = run(dir, ["clear"]);
    assert.equal(r.status, 0, "clear must still succeed even when the log append fails\nstderr: " + r.stderr);
    assert.ok(!sentinelExists(dir), "the sentinel must still be cleared despite the logging failure");
    assert.ok(!roundsExist(dir), "recorded rounds must still die with the phase despite the logging failure");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("clear: no sentinel present logs nothing (no phase was actually closing)", () => {
  const dir = mk();
  try {
    const r = run(dir, ["clear"]);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!reviewLogExists(dir), "clear on an absent sentinel has no phase to log");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("write: a re-write for a DIFFERENT phase logs the discarded phase's rounds before removing them", () => {
  const dir = mk();
  try {
    const planPath = writePlan(dir);
    run(dir, ["write", planPath, "2"]);
    runIn(dir, ["record-round", planPath, "2", "FAIL"], "phase two fixes");

    const r = run(dir, ["write", planPath, "3"]);
    assert.equal(r.status, 0, r.stderr);

    const lines = readReviewLogLines(dir);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].plan, "docs/plan.md");
    assert.equal(lines[0].phase, 2, "the CLOSED phase (2), not the newly-opened one (3), is what gets logged");
    assert.equal(lines[0].rounds.length, 1);
    assert.match(lines[0].rounds[0].fixes, /phase two fixes/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("write-files: logs a stale phase's recorded rounds to review-log.jsonl before clearing them", () => {
  const dir = mk();
  try {
    const planPath = writePlan(dir);
    run(dir, ["write", planPath, "2"], { GANTRY_SESSION_ID: "stale-session" });
    runIn(dir, ["record-round", planPath, "2", "FAIL"], "stale phase fixes");

    // Backdate `started` so the sentinel reads as stale (write-files' own
    // non-blocking rule), the same technique the existing stale test uses.
    const stateJsonPath = path.join(dir, ".now", "state.json");
    const state = JSON.parse(fs.readFileSync(stateJsonPath, "utf8"));
    state.build.started = new Date(Date.now() - 7 * 3600 * 1000).toISOString();
    fs.writeFileSync(stateJsonPath, JSON.stringify(state, null, 2));

    const r = run(dir, ["write-files", "quick/fix.js"], { GANTRY_SESSION_ID: "current-session" });
    assert.equal(r.status, 0, r.stderr);

    const lines = readReviewLogLines(dir);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].plan, "docs/plan.md");
    assert.equal(lines[0].phase, 2);
    assert.match(lines[0].rounds[0].fixes, /stale phase fixes/);
    assert.ok(!roundsExist(dir), "the stale phase's round file must be cleared, not left orphaned");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// 1.0.4 fix, item 2b: an override recorded under a prior (or no) scope must
// not survive into a freshly-established scope - reproducing the live
// test's row-4b confound exactly, driven through the real hooks/scripts, not
// a hand-edited state.json.
// ---------------------------------------------------------------------------

function runFileListGuard(dir, filePath, sessionId) {
  const payload = {
    session_id: sessionId,
    cwd: dir,
    hook_event_name: "PreToolUse",
    tool_name: "Edit",
    tool_input: { file_path: filePath },
  };
  return spawnSync(process.execPath, [FILE_LIST_GUARD], {
    encoding: "utf8",
    input: JSON.stringify(payload),
    env: { ...process.env, GANTRY_PROJECT_DIR: dir },
  });
}

function adoptForFileListGuard(dir) {
  fs.mkdirSync(path.join(dir, ".now"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".now", "enabled"), "");
  write(dir, "NOW.md", "# NOW\n<!-- claudhd: opt-in marker -->\n\n## Loose ends\n\n(none yet)\n");
}

test("ROW-4B: write-files clears a recorded override - the edit it used to permit now denies under the fresh sentinel", () => {
  const dir = mk();
  try {
    adoptForFileListGuard(dir);
    const sessionId = "session-row4b";
    const outOfScopeFile = path.join(dir, "src", "unrelated.js");

    // 1. Record a real override (no sentinel exists yet - unguarded mode).
    override.recordOverride(dir, sessionId);

    // 2. The override permits the out-of-scope edit, exactly as designed.
    const before = runFileListGuard(dir, outOfScopeFile, sessionId);
    assert.equal(before.status, 0, before.stderr);
    assert.equal(before.stdout.trim(), "", "the override must permit the edit before any scope is established");

    // 3. Establish a fresh scope via write-files - must clear the override,
    //    with no hand-editing of state.json.
    const w = run(dir, ["write-files", "src/scoped.js"], { GANTRY_SESSION_ID: sessionId });
    assert.equal(w.status, 0, "write-files should exit 0\nstdout: " + w.stdout + "\nstderr: " + w.stderr);
    const state = JSON.parse(fs.readFileSync(path.join(dir, ".now", "state.json"), "utf8"));
    assert.ok(!state.override, "write-files must clear the override key");

    // 4. The SAME previously-permitted out-of-scope edit must now deny.
    const after = runFileListGuard(dir, outOfScopeFile, sessionId);
    assert.equal(after.status, 0, after.stderr);
    const deny = JSON.parse(after.stdout.trim());
    assert.equal(deny.hookSpecificOutput.permissionDecision, "deny",
      "the override must not survive into the fresh write-files scope; got: " + after.stdout);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("ROW-4B: write (plan-backed) also clears a recorded override", () => {
  const dir = mk();
  try {
    adoptForFileListGuard(dir);
    const planPath = writePlan(dir);
    const sessionId = "session-row4b-plan";
    const outOfScopeFile = path.join(dir, "totally", "unrelated.js");

    override.recordOverride(dir, sessionId);
    const before = runFileListGuard(dir, outOfScopeFile, sessionId);
    assert.equal(before.stdout.trim(), "", "the override must permit the edit before any scope is established");

    const w = run(dir, ["write", planPath, "2"], { GANTRY_SESSION_ID: sessionId });
    assert.equal(w.status, 0, w.stderr);
    const state = JSON.parse(fs.readFileSync(path.join(dir, ".now", "state.json"), "utf8"));
    assert.ok(!state.override, "write must clear the override key");

    const after = runFileListGuard(dir, outOfScopeFile, sessionId);
    const deny = JSON.parse(after.stdout.trim());
    assert.equal(deny.hookSpecificOutput.permissionDecision, "deny",
      "the override must not survive into the fresh plan-backed scope; got: " + after.stdout);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// Sol review fix: write/write-files must serialize their override clear
// through the SAME override.lock override.js's own recordOverride()/
// noteOverrideFile() hold, or the two read-modify-write cycles can interleave
// (noteOverrideFile reads the override BEFORE write-files clears it, then
// writes its update back AFTER the clear - resurrecting a record write-files
// already removed). Reuses the hold-lock.js pattern from
// test/state-concurrency.test.js, but holds `stateLockPath` specifically, NOT
// override.lock: without the fix, write-files's writeStateAtomic() call
// never touches override.lock at all, so holding override.lock alone lets an
// unfixed write-files complete unimpeded (proven empirically while building
// this test - holding override.lock never reproduced the bug). Holding the
// state lock instead forces BOTH real operations to have already done their
// own pre-write work (noteOverrideFile's read-and-decide; write-files'
// sentinel-object construction) before either can land its writeStateAtomic
// call, which is the exact window the resurrection bug needs. With the fix
// applied, write-files cannot even REACH the state lock until it first
// acquires override.lock - which noteOverrideFile already holds for its
// entire read-decide-write span - so the race is resolved before either
// commits, and the result is deterministically never a resurrection.
// ---------------------------------------------------------------------------

function holdLock(lockDir, id, holdMs, logFile) {
  return new Promise((resolve, reject) => {
    const c = spawn(process.execPath, [HOLD_LOCK, lockDir, id, String(holdMs), logFile]);
    let stderr = "";
    c.stderr.on("data", (d) => (stderr += d));
    c.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`hold-lock failed: ${stderr}`))));
  });
}

test("RACE (sol fix): noteOverrideFile racing sentinel.js write-files never resurrects the override write-files clears - both serialize on override.lock", async () => {
  const dir = mk();
  try {
    adoptForFileListGuard(dir);
    const sessionId = "session-race";

    // A real, pre-existing active override with one accumulated file - both
    // real calls below (never hand-edited state.json).
    override.recordOverride(dir, sessionId);
    override.noteOverrideFile(dir, sessionId, "a.js");

    const stateLockDir = path.join(dir, ".now", "state.lock");
    const logFile = path.join(dir, "lock-events.log");
    fs.writeFileSync(logFile, "");

    // Hold the state lock (see the section comment above for why THIS lock,
    // not override.lock) for a fixed window, then fire the two real
    // operations while it is held - both must queue behind it.
    const holdMs = 300;
    const holdPromise = holdLock(stateLockDir, "HOLDER", holdMs, logFile);
    await new Promise((r) => setTimeout(r, 50));

    // The real sentinel.js write-files subprocess - establishes a fresh
    // scope, which must clear `override` under override.lock (the fix).
    const sentinelJob = runAsync(dir, "sentinel.js", ["write-files", "src/scoped.js"], { GANTRY_SESSION_ID: sessionId });

    // The real, in-process noteOverrideFile call - synchronous and
    // lock-blocking (withLock's Atomics.wait busy-poll), so it genuinely
    // contends for the state lock against the subprocess above rather than
    // merely running before or after it by construction-order luck.
    const noteJob = Promise.resolve(override.noteOverrideFile(dir, sessionId, "b.js"));

    const [, sentinelResult] = await Promise.all([holdPromise, sentinelJob, noteJob]);
    assert.equal(sentinelResult.status, 0, "sentinel.js write-files should exit 0\n" + sentinelResult.stderr);

    const state = JSON.parse(fs.readFileSync(path.join(dir, ".now", "state.json"), "utf8"));
    assert.ok(!state.override,
      "the override must never be resurrected after write-files clears it, regardless of race order; got: " + JSON.stringify(state.override));
    assert.ok(state.build, "the fresh write-files sentinel must still be in force");
    assert.deepEqual(state.build.files, ["src/scoped.js"]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
