"use strict";
/* Tests for plugins/claudhd/scripts/hooks/commit-guard.js */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const GUARD = path.join(__dirname, "..", "plugins", "claudhd", "scripts", "hooks", "commit-guard.js");

function mk() { return fs.mkdtempSync(path.join(os.tmpdir(), "claudhd-cg-")); }
function write(dir, rel, content) {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

// A fixture sentinel in the `build` section of .now/state.json (schema v2;
// Gantry's sentinel folded in). `extra` merges in other top-level fields
// (e.g. `mode`), for tests that need the deny message's mode-name assertion.
function writeSentinel(dir, overrides, extra) {
  const base = {
    plan: "docs/plan.md",
    phase: 3,
    files: ["plugins/claudhd/scripts/hooks/commit-guard.js"],
    allow: ["docs/plan.md"],
    started: new Date().toISOString(),
    session: "session-test-123",
  };
  const data = Object.assign({}, base, overrides);
  write(dir, ".now/state.json", JSON.stringify(Object.assign({ schemaVersion: 2, build: data }, extra)));
  return data;
}

// The guards' OWN enforcement marker (commit-guard.js's computeGate()). NOT
// a reconcile signal - reconcile.js's adoption gate checks `.now/enabled`
// specifically (see writeReconcileEnabled below), never this file.
//
// Since 1.0.4's S1 fix, commit-guard.js resolves root through root.js's
// walkForRoot() - the same walk file-list-guard.js uses - which honors the
// legacy `.gantry/enabled` marker ONLY when paired with a claudhd-marked
// NOW.md at that SAME level (root.js's own stricter pairing rule, needed so
// a bare legacy marker never falsely counts as adoption mid-walk). writeNow()
// satisfies that pairing so this helper keeps testing "the guard enforces via
// the legacy marker", not "no adopted ancestor was found at all".
function writeEnabled(dir) {
  write(dir, ".gantry/enabled", "");
  writeNow(dir);
}

// reconcile.js's own adoption gate (phase 4, restricted in a later fix round
// to `.now/enabled` specifically - `.gantry/enabled` activates the guards'
// enforcement only, never reconcile).
function writeReconcileEnabled(dir) {
  write(dir, ".now/enabled", "");
}

// reconcile.js's own adoption gate also requires a NOW.md carrying the
// claudhd marker. Not a git repo - these tests only need reconcile's doc
// writes, not its (best-effort, separately swallowed) git staging step.
function writeNow(dir, thread) {
  write(dir, "NOW.md", `# NOW\n<!-- claudhd: opt-in marker -->\n\n## Active thread\n\n**${thread || "main thread"}**\n\n- [ ] step\n`);
}

function runGuard(dir, payload) {
  const input = typeof payload === "string" ? payload : JSON.stringify(payload);
  return spawnSync(process.execPath, [GUARD], {
    encoding: "utf8",
    input,
    env: { ...process.env, GANTRY_PROJECT_DIR: dir },
  });
}

function parseDeny(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try { return JSON.parse(trimmed); } catch { return null; }
}

function bashPayload(dir, command, sessionId) {
  return {
    session_id: sessionId || "session-test-123",
    cwd: dir,
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command },
  };
}

// --- never denies (r-0729-1: log, don't deny) ---
// The commit guard no longer blocks any commit or push, in any command-head
// form. A live sentinel is present in each case; under the old contract every
// one of these denied. The command-parsing (gitSubcommand/commandTriggersGuard)
// is still exercised - it gates whether reconcile runs - but its outcome is
// never a deny.

for (const [label, command] of [
  ["git commit -m x", "git commit -m x"],
  ["git push", "git push"],
  ["foo && git commit", "foo && git commit -m msg"],
  ["x; git push", "x; git push"],
  ["( git commit )", "( git commit -m x )"],
  ["git -C ./sub commit", "git -C ./sub commit -m x"],
  ["git -c key=value commit", "git -c user.name=Test commit -m x"],
  ["git --git-dir X --work-tree Y commit", "git --git-dir /repo/.git --work-tree /repo commit -m x"],
]) {
  test(`commit-guard: never denies ${label} (sentinel live)`, () => {
    const dir = mk();
    try {
      writeEnabled(dir);
      writeSentinel(dir, {});
      const r = runGuard(dir, bashPayload(dir, command));
      assert.equal(r.status, 0, "exit code must be 0\nstderr: " + r.stderr);
      assert.equal(parseDeny(r.stdout), null, `${label} must not be denied; got: ` + r.stdout);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}

// --- allow cases ---

test("commit-guard: allows echo containing git commit text (not a real commit)", () => {
  const dir = mk();
  try {
    writeEnabled(dir);
    writeSentinel(dir, {});
    const r = runGuard(dir, bashPayload(dir, 'echo "how to git commit"'));
    assert.equal(r.status, 0, "exit code must be 0\nstderr: " + r.stderr);
    assert.equal(r.stdout.trim(), "", "stdout must be empty (allow) for echo; got: " + r.stdout);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("commit-guard: allows git status", () => {
  const dir = mk();
  try {
    writeEnabled(dir);
    writeSentinel(dir, {});
    const r = runGuard(dir, bashPayload(dir, "git status"));
    assert.equal(r.status, 0, "exit code must be 0\nstderr: " + r.stderr);
    assert.equal(r.stdout.trim(), "", "stdout must be empty for git status");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("commit-guard: allows git log", () => {
  const dir = mk();
  try {
    writeEnabled(dir);
    writeSentinel(dir, {});
    const r = runGuard(dir, bashPayload(dir, "git log --oneline -10"));
    assert.equal(r.status, 0, "exit code must be 0\nstderr: " + r.stderr);
    assert.equal(r.stdout.trim(), "", "stdout must be empty for git log");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("commit-guard: allows node sentinel.js write call (orchestrator plumbing must never be denied)", () => {
  const dir = mk();
  try {
    writeEnabled(dir);
    writeSentinel(dir, {});
    const sentinelPath = path.join(
      __dirname, "..", "plugins", "claudhd", "scripts", "sentinel.js"
    );
    const r = runGuard(dir, bashPayload(dir, "node " + sentinelPath + " write plan.md 3"));
    assert.equal(r.status, 0, "exit code must be 0 for sentinel.js call\nstderr: " + r.stderr);
    assert.equal(
      r.stdout.trim(),
      "",
      "stdout must be empty for node sentinel.js call (never denied); got: " + r.stdout
    );
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// The gate command must be recognized wherever the clear sits, not only as the
// command's very first token. isSentinelCall() requires tokens[0] === "node",
// so before commandClearsSentinelBeforeCommit() was added to the deny path any
// prefix ahead of the clear denied the one command review.md prescribes. A
// leading `cd <root> &&` is the shape that actually bit: the orchestrator's own
// habit of anchoring the working directory turned the documented gate command
// into a deny whose message sent the reader off to re-run a review that had
// already passed.
function sentinelJsPath() {
  return path.join(__dirname, "..", "plugins", "claudhd", "scripts", "sentinel.js");
}

for (const [label, prefix] of [
  ["cd prefix", "cd /some/root && "],
  ["env assignment prefix", "FOO=bar "],
  ["set -e prefix", "set -e && "],
]) {
  test(`commit-guard: allows the gate command behind a ${label}`, () => {
    const dir = mk();
    try {
      writeEnabled(dir);
      writeSentinel(dir, {});
      const command =
        prefix + "node " + sentinelJsPath() + " clear && git add -A && git commit -m msg";
      const r = runGuard(dir, bashPayload(dir, command));
      assert.equal(r.status, 0, "exit code must be 0\nstderr: " + r.stderr);
      assert.equal(
        parseDeny(r.stdout),
        null,
        "the gate command must not be denied behind a " + label + "; got: " + r.stdout
      );
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}

// isSentinelClearSegment() tokenizes quote-aware, so a script path containing a
// space still lands `clear` in the position the check reads. A naive whitespace
// split shifted it and made an ordinary quoted gate command deny.
test("commit-guard: allows the gate command with a quoted path containing a space", () => {
  const dir = mk();
  try {
    writeEnabled(dir);
    writeSentinel(dir, {});
    const spaced = "C:/some dir/scripts/sentinel.js";
    const command =
      'node "' + spaced + '" clear && git add -A && git commit -m msg';
    const r = runGuard(dir, bashPayload(dir, command));
    assert.equal(r.status, 0, "exit code must be 0\nstderr: " + r.stderr);
    assert.equal(
      parseDeny(r.stdout),
      null,
      "a quoted sentinel path with a space must still be recognized; got: " + r.stdout
    );
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// The order-aware half of the same rule: a clear that lands AFTER the commit
// has not taken the documented route, so it must still deny.
test("commit-guard: never denies when the sentinel clear follows the commit", () => {
  const dir = mk();
  try {
    writeEnabled(dir);
    writeSentinel(dir, {});
    const command =
      "git commit -m msg && node " + sentinelJsPath() + " clear";
    const r = runGuard(dir, bashPayload(dir, command));
    assert.equal(r.status, 0, "exit code must be 0\nstderr: " + r.stderr);
    assert.equal(parseDeny(r.stdout), null, "no commit form is denied anymore; got: " + r.stdout);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// --- fail-open cases ---

test("commit-guard: fail-open when enabled marker is absent", () => {
  const dir = mk();
  try {
    // No writeEnabled()
    writeSentinel(dir, {});
    const r = runGuard(dir, bashPayload(dir, "git commit -m x"));
    assert.equal(r.status, 0, "exit code must be 0 when not opted in\nstderr: " + r.stderr);
    assert.equal(r.stdout.trim(), "", "stdout must be empty when not opted in (no enforce)");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("commit-guard: fail-open when no sentinel exists", () => {
  const dir = mk();
  try {
    writeEnabled(dir);
    // No sentinel
    const r = runGuard(dir, bashPayload(dir, "git commit -m x"));
    assert.equal(r.status, 0, "exit code must be 0 when no sentinel\nstderr: " + r.stderr);
    assert.equal(r.stdout.trim(), "", "stdout must be empty when no sentinel");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("commit-guard: fail-open for malformed stdin", () => {
  const dir = mk();
  try {
    writeEnabled(dir);
    writeSentinel(dir, {});
    const r = runGuard(dir, "{ not valid json !!!");
    assert.equal(r.status, 0, "exit code must be 0 for malformed stdin\nstderr: " + r.stderr);
    assert.equal(r.stdout.trim(), "", "stdout must be empty for malformed stdin");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("commit-guard: fail-open for stale sentinel", () => {
  const dir = mk();
  try {
    writeEnabled(dir);
    const old = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();
    writeSentinel(dir, { started: old, session: "old-session" });
    const payload = bashPayload(dir, "git commit -m x", "new-session");
    const r = runGuard(dir, payload);
    assert.equal(r.status, 0, "exit code must be 0 for stale sentinel\nstderr: " + r.stderr);
    assert.equal(r.stdout.trim(), "", "stdout must be empty for stale sentinel");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// --- exit code is always 0 ---

test("commit-guard: exit code is always 0 for a commit under a live sentinel", () => {
  const dir = mk();
  try {
    writeEnabled(dir);
    writeSentinel(dir, {});
    const r = runGuard(dir, bashPayload(dir, "git push origin main"));
    assert.equal(r.status, 0, "exit code MUST be 0; got: " + r.status);
    assert.equal(parseDeny(r.stdout), null, "no deny is emitted");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// --- reconcile in front of the (now deny-less) gate ---

test("commit-guard: a bare mid-phase commit (sentinel live, no clear) is allowed but NOT reconciled - reconcile still waits for the gate commit that clears the sentinel", () => {
  const dir = mk();
  try {
    writeEnabled(dir);
    writeReconcileEnabled(dir);
    writeSentinel(dir, {});
    writeNow(dir);
    const r = runGuard(dir, bashPayload(dir, 'git commit -m "mid-phase wip"'));
    assert.equal(r.status, 0, r.stderr);
    assert.equal(parseDeny(r.stdout), null, "a mid-phase commit is allowed now, not denied");
    assert.ok(!fs.existsSync(path.join(dir, "SHIPPED.md")),
      "a bare mid-phase commit still does not reconcile - the sentinel is not cleared, so the phase is not done");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("commit-guard: a commit outside a build phase (no sentinel) is reconciled too", () => {
  const dir = mk();
  try {
    writeEnabled(dir);
    writeReconcileEnabled(dir); // reconcile's own B1 signal - see the helper's comment
    // No writeSentinel(dir) - sentinel absent, so the pre-phase-4 guard did
    // nothing at all here; now it must still reconcile.
    writeNow(dir);
    const r = runGuard(dir, bashPayload(dir, 'git commit -m "ad hoc fix"'));
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), "", "must still allow (fail open), unchanged from before phase 4");
    assert.ok(fs.existsSync(path.join(dir, "SHIPPED.md")), "reconcile must have run with no active build phase");
    assert.match(fs.readFileSync(path.join(dir, "SHIPPED.md"), "utf8"), /ad hoc fix/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// --- fix round: a module-init failure in reconcile.js must never crash the hook ---

test("commit-guard: a module-init failure in reconcile.js (lazy, in-try require) never produces a nonzero exit or blocks the commit", () => {
  // A self-contained copy of the guard's own relative layout (hooks/
  // commit-guard.js requires ../sentinel-core.js, ../state.js, ../modes.js
  // and ../reconcile.js - state.js's own leaf dependencies come along too),
  // with a reconcile.js stand-in that throws during its own top-level
  // evaluation - exactly the module-initialization failure the lazy, in-try
  // require guards against. The real installed files are never touched.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "claudhd-cg-scratch-"));
  const repoDir = mk();
  try {
    const scriptsDir = path.join(scratch, "scripts");
    const hooksDir = path.join(scriptsDir, "hooks");
    fs.mkdirSync(hooksDir, { recursive: true });

    const REAL_SCRIPTS = path.join(__dirname, "..", "plugins", "claudhd", "scripts");
    for (const name of ["root.js", "sentinel-core.js", "state.js", "modes.js", "lock.js", "constants.js", "nowfile.js", "roadmapids.js"]) {
      fs.copyFileSync(path.join(REAL_SCRIPTS, name), path.join(scriptsDir, name));
    }
    fs.copyFileSync(path.join(REAL_SCRIPTS, "hooks", "commit-guard.js"), path.join(hooksDir, "commit-guard.js"));
    fs.writeFileSync(path.join(scriptsDir, "reconcile.js"), "throw new Error('simulated reconcile.js module-init failure');\n");

    const r = spawnSync(process.execPath, [path.join(hooksDir, "commit-guard.js")], {
      encoding: "utf8",
      input: JSON.stringify(bashPayload(repoDir, 'git commit -m "should still be allowed"')),
      env: { ...process.env, GANTRY_PROJECT_DIR: repoDir },
    });

    assert.equal(r.status, 0, "exit code must still be 0 even though reconcile.js's module failed to load\nstderr: " + r.stderr);
    assert.equal(r.stdout.trim(), "", "no deny JSON - the commit is still permitted");
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(repoDir, { recursive: true, force: true });
  }
});

test("commit-guard: fail-open (exit 0) when the resolved root genuinely does not exist on disk (review round 2, finding 1)", () => {
  // Empty env vars merely fall back to cwd (a REAL, valid directory - the
  // test runner's own cwd), which never actually exercises an unresolvable
  // root: it just re-tests "marker absent" in an arbitrary real directory,
  // already covered elsewhere. This fixture instead points every root env
  // var at a path guaranteed to NOT exist, so isAdopted's accessSync (and
  // anything reached after it) genuinely throws ENOENT.
  const bogusRoot = path.join(
    os.tmpdir(),
    "claudhd-cg-does-not-exist-" + Date.now() + "-" + Math.random().toString(36).slice(2)
  );
  assert.ok(!fs.existsSync(bogusRoot), "sanity: the bogus root must not exist before the guard runs");
  try {
    const r = spawnSync(process.execPath, [GUARD], {
      encoding: "utf8",
      input: JSON.stringify(bashPayload(bogusRoot, "git commit -m x")),
      env: { ...process.env, CLAUDHD_PROJECT_DIR: "", GANTRY_PROJECT_DIR: bogusRoot, CLAUDE_PROJECT_DIR: "" },
    });
    assert.equal(r.status, 0, "exit code must be 0 with a genuinely nonexistent root\nstderr: " + r.stderr);
    assert.equal(r.stdout.trim(), "", "stdout must be empty with a genuinely nonexistent root");
    assert.ok(!fs.existsSync(bogusRoot), "the guard must never have created the bogus root as a side effect");
  } finally {
    fs.rmSync(bogusRoot, { recursive: true, force: true });
  }
});

// (The former "broken modes.js" fail-open test is gone: the commit guard no
// longer requires modes.js at all - that require lived only in the deleted
// deny message. The reconcile.js module-init-failure test above is the
// remaining broken-sibling fail-open coverage.)

// ---------------------------------------------------------------------------
// 1.0.4 S1 fix: cross-repo root resolution. A `git commit`/`push` that runs
// in a DIFFERENT directory than the session's env-pinned root (via a leading
// `cd` chain, or the commit's own `-C`) must be judged against the repo it
// ACTUALLY runs in, never the env root - see commit-guard.js's header
// comment. These mirror the live-test scenario exactly.
// ---------------------------------------------------------------------------

// These no longer have a deny to observe, so they assert the thing S1 actually
// protects: RECONCILE runs against the repo the commit truly runs in, never the
// env-pinned root. Each drives a real commit (no sentinel in the target repo,
// so the gate is null and reconcile fires) and checks the target repo's
// SHIPPED.md got the entry while the env root's did not.

function readShipped(dir) {
  try { return fs.readFileSync(path.join(dir, "SHIPPED.md"), "utf8"); } catch { return null; }
}

test("commit-guard: `git commit --dry-run` does NOT reconcile - a dry run creates no commit and must not log shipped work", () => {
  const dir = mk();
  try {
    writeEnabled(dir);
    writeReconcileEnabled(dir);
    writeNow(dir);
    // No sentinel, so gate is null: a real `git commit` here WOULD reconcile.
    // --dry-run must not, because it creates nothing.
    const r = runGuard(dir, bashPayload(dir, 'git commit --dry-run -m "not a real commit"'));
    assert.equal(r.status, 0, r.stderr);
    assert.equal(parseDeny(r.stdout), null, "a dry run is never denied");
    assert.equal(readShipped(dir), null, "a dry-run commit must not create or append to SHIPPED.md");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("commit-guard: a real `git commit` (no --dry-run) still reconciles, confirming the dry-run exclusion is not over-broad", () => {
  const dir = mk();
  try {
    writeEnabled(dir);
    writeReconcileEnabled(dir);
    writeNow(dir);
    const r = runGuard(dir, bashPayload(dir, 'git commit -m "a real one"'));
    assert.equal(r.status, 0, r.stderr);
    assert.match(readShipped(dir) || "", /a real one/, "a real commit must still reconcile");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("S1: `cd <scratch> && git commit` (quoted path with a space) reconciles the SCRATCH repo, not the env root", () => {
  const sessionRoot = mk();
  const scratchParent = mk();
  const scratchDir = path.join(scratchParent, "scratch repo with spaces");
  fs.mkdirSync(scratchDir, { recursive: true });
  try {
    writeEnabled(sessionRoot); writeReconcileEnabled(sessionRoot); writeNow(sessionRoot);
    writeEnabled(scratchDir); writeReconcileEnabled(scratchDir); writeNow(scratchDir);

    const command = "cd '" + scratchDir + "' && git commit -m \"scratch commit\"";
    const r = runGuard(sessionRoot, bashPayload(sessionRoot, command));
    assert.equal(r.status, 0, r.stderr);
    assert.match(readShipped(scratchDir) || "", /scratch commit/,
      "reconcile must have run against the scratch repo the commit actually runs in");
    assert.equal(readShipped(sessionRoot), null,
      "the env root must NOT be reconciled for a commit that runs in the scratch repo");
  } finally {
    fs.rmSync(sessionRoot, { recursive: true, force: true });
    fs.rmSync(scratchParent, { recursive: true, force: true });
  }
});

test("S1: `git -C <scratch> commit` reconciles the scratch repo the same way the cd-chain form does", () => {
  const sessionRoot = mk();
  const scratchDir = mk();
  try {
    writeEnabled(sessionRoot); writeReconcileEnabled(sessionRoot); writeNow(sessionRoot);
    writeEnabled(scratchDir); writeReconcileEnabled(scratchDir); writeNow(scratchDir);

    const command = "git -C " + JSON.stringify(scratchDir) + " commit -m \"dash-C commit\"";
    const r = runGuard(sessionRoot, bashPayload(sessionRoot, command));
    assert.equal(r.status, 0, r.stderr);
    assert.match(readShipped(scratchDir) || "", /dash-C commit/, "git -C must resolve root the same way the cd-chain form does");
    assert.equal(readShipped(sessionRoot), null, "the env root must not be reconciled");
  } finally {
    fs.rmSync(sessionRoot, { recursive: true, force: true });
    fs.rmSync(scratchDir, { recursive: true, force: true });
  }
});

test("S1 sol fix: `git -C \"path with spaces\" commit` (quoted -C value with a space) is still recognized and reconciles the scratch repo", () => {
  const sessionRoot = mk();
  const scratchParent = mk();
  const scratchDir = path.join(scratchParent, "scratch repo with spaces");
  fs.mkdirSync(scratchDir, { recursive: true });
  try {
    writeEnabled(sessionRoot); writeReconcileEnabled(sessionRoot); writeNow(sessionRoot);
    writeEnabled(scratchDir); writeReconcileEnabled(scratchDir); writeNow(scratchDir);

    const command = "git -C " + JSON.stringify(scratchDir) + " commit -m \"quoted C commit\"";
    const r = runGuard(sessionRoot, bashPayload(sessionRoot, command));
    assert.equal(r.status, 0, r.stderr);
    assert.match(readShipped(scratchDir) || "", /quoted C commit/,
      "a quoted -C value with a space must still be recognized as `git ... commit` and resolved against the scratch repo");
    assert.equal(readShipped(sessionRoot), null, "the env root must not be reconciled");
  } finally {
    fs.rmSync(sessionRoot, { recursive: true, force: true });
    fs.rmSync(scratchParent, { recursive: true, force: true });
  }
});

test("S1: an UNADOPTED scratch directory stays entirely inert, even though the env root IS adopted with an active sentinel", () => {
  const sessionRoot = mk(); // adopted, active sentinel - would deny if it were consulted
  const scratchDir = mk(); // no markers at all
  try {
    writeEnabled(sessionRoot);
    writeSentinel(sessionRoot, {});

    const command = "cd " + JSON.stringify(scratchDir) + " && git commit -m x";
    const r = runGuard(sessionRoot, bashPayload(sessionRoot, command));
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), "",
      "an unadopted scratch dir must leave the guard entirely inert, never falling back to the env root's sentinel; got: " + r.stdout);
  } finally {
    fs.rmSync(sessionRoot, { recursive: true, force: true });
    fs.rmSync(scratchDir, { recursive: true, force: true });
  }
});

test("S1: a genuine internal walk failure at the effective directory fails open, even though the env root would otherwise deny", () => {
  const sessionRoot = mk(); // adopted, active sentinel - would deny if consulted
  const scratchDir = mk(); // where the walk itself will crash
  try {
    writeEnabled(sessionRoot);
    writeSentinel(sessionRoot, {});

    // Force a genuine internal walk failure: a legacy marker paired with a
    // NOW.md that is a DIRECTORY, not a file - readFileSync throws EISDIR
    // mid-walk (root.js's walkForRoot returns WALK_FAILED for this).
    fs.mkdirSync(path.join(scratchDir, ".gantry"), { recursive: true });
    fs.writeFileSync(path.join(scratchDir, ".gantry", "enabled"), "");
    fs.mkdirSync(path.join(scratchDir, "NOW.md"));

    const command = "cd " + JSON.stringify(scratchDir) + " && git commit -m x";
    const r = runGuard(sessionRoot, bashPayload(sessionRoot, command));
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), "",
      "a genuine walk failure must fail open, never fall back to the env root's sentinel; got: " + r.stdout);
  } finally {
    fs.rmSync(sessionRoot, { recursive: true, force: true });
    fs.rmSync(scratchDir, { recursive: true, force: true });
  }
});
