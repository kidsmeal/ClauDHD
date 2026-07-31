"use strict";
/* Tests for plugins/claudhd/scripts/hooks/file-list-guard.js
 *
 * r-0729-1 (log, don't deny): the guard NEVER denies. It records an edit that
 * lands outside a live build phase's file list into .now/out-of-scope.jsonl
 * and allows it. With no live sentinel (idle, design, unguarded) there is no
 * scope, so nothing is logged. These tests assert that contract: allow always,
 * log only the genuine out-of-scope case, never emit a deny.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const GUARD = path.join(__dirname, "..", "plugins", "claudhd", "scripts", "hooks", "file-list-guard.js");

function mk() { return fs.mkdtempSync(path.join(os.tmpdir(), "claudhd-flg-")); }
function write(dir, rel, content) {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

// Write a fixture sentinel into the `build` section of .now/state.json.
function writeSentinel(dir, overrides, extra) {
  const base = {
    plan: "docs/plan.md",
    phase: 3,
    files: ["plugins/claudhd/scripts/hooks/file-list-guard.js",
            "plugins/claudhd/scripts/hooks/commit-guard.js"],
    allow: ["docs/plan.md"],
    started: new Date().toISOString(),
    session: "session-test-123",
  };
  const data = Object.assign({}, base, overrides);
  write(dir, ".now/state.json", JSON.stringify(Object.assign({ schemaVersion: 2, build: data }, extra)));
  return data;
}

// Write .now/state.json with NO `build` section (sentinel absent).
function writeStateNoSentinel(dir, fields) {
  write(dir, ".now/state.json", JSON.stringify(Object.assign({ schemaVersion: 2, build: null }, fields)));
}

function writeEnabled(dir) { write(dir, ".gantry/enabled", ""); }   // legacy marker
function writeNowEnabled(dir) { write(dir, ".now/enabled", ""); }   // B1 marker

function runGuard(dir, payload) {
  const input = typeof payload === "string" ? payload : JSON.stringify(payload);
  return spawnSync(process.execPath, [GUARD], {
    encoding: "utf8",
    input,
    env: { ...process.env, GANTRY_PROJECT_DIR: dir },
  });
}

// Parse a deny JSON block from stdout, or null. The guard should NEVER produce
// one now; this exists so tests can assert its absence explicitly.
function parseDeny(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try { return JSON.parse(trimmed); } catch { return null; }
}

function editPayload(dir, filePath, sessionId) {
  return {
    session_id: sessionId || "session-test-123",
    cwd: dir,
    hook_event_name: "PreToolUse",
    tool_name: "Edit",
    tool_input: { file_path: filePath },
  };
}

function driftFile(dir) { return path.join(dir, ".now", "out-of-scope.jsonl"); }
function readDrift(dir) {
  try {
    return fs.readFileSync(driftFile(dir), "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
  } catch { return []; }
}
function driftExists(dir) { return fs.existsSync(driftFile(dir)); }

// A single assertion reused everywhere: the guard allowed the edit (exit 0,
// empty stdout) and, crucially, emitted no deny of any kind.
function assertAllowed(r) {
  assert.equal(r.status, 0, "exit code must be 0\nstderr: " + r.stderr);
  assert.equal(r.stdout.trim(), "", "the guard must never deny; stdout: " + r.stdout);
  assert.equal(parseDeny(r.stdout), null, "no deny JSON may be emitted");
}

// --- allow + no log: in-scope edits under a live sentinel ---

test("file-list-guard: allows a file in the sentinel files list, logs nothing", () => {
  const dir = mk();
  try {
    writeEnabled(dir);
    writeSentinel(dir, {});
    const abs = path.join(dir, "plugins", "claudhd", "scripts", "hooks", "file-list-guard.js");
    assertAllowed(runGuard(dir, editPayload(dir, abs)));
    assert.equal(driftExists(dir), false, "an in-scope edit must not write the drift log");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("file-list-guard: allows a file in the sentinel allow list, logs nothing", () => {
  const dir = mk();
  try {
    writeEnabled(dir);
    writeSentinel(dir, { allow: ["docs/plan.md"] });
    assertAllowed(runGuard(dir, editPayload(dir, path.join(dir, "docs", "plan.md"))));
    assert.equal(driftExists(dir), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("file-list-guard: under a live sentinel, state-dir and allow-listed paths pass; an unlisted source path is LOGGED, not denied", () => {
  const dir = mk();
  try {
    writeEnabled(dir);
    writeSentinel(dir, { allow: ["docs/plan.md"] });

    // build mode's state-dir allowance applies under a live sentinel.
    for (const rel of [".now/state.json", ".gantry/models.json", ".claude/settings.local.json"]) {
      assertAllowed(runGuard(dir, editPayload(dir, path.join(dir, ...rel.split("/")))));
    }
    // allow-listed path passes.
    assertAllowed(runGuard(dir, editPayload(dir, path.join(dir, "docs", "plan.md"))));
    // No drift written by any of the in-scope edits above.
    assert.equal(driftExists(dir), false, "in-scope edits must not log");

    // An unlisted, non-state-dir source path is allowed AND recorded.
    assertAllowed(runGuard(dir, editPayload(dir, path.join(dir, "src", "unlisted.js"))));
    const drift = readDrift(dir);
    assert.equal(drift.length, 1, "the out-of-scope edit must be logged exactly once");
    assert.equal(drift[0].path, "src/unlisted.js");
    assert.equal(drift[0].phase, 3);
    assert.equal(drift[0].session, "session-test-123");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("file-list-guard: an out-of-scope edit records ts, session, phase, plan, path, and tool", () => {
  const dir = mk();
  try {
    writeEnabled(dir);
    writeSentinel(dir, { plan: "docs/myplan.md", phase: 5 });
    assertAllowed(runGuard(dir, editPayload(dir, path.join(dir, "src", "x.js"), "sess-9")));
    const [rec] = readDrift(dir);
    assert.ok(rec, "a record must exist");
    assert.equal(rec.path, "src/x.js");
    assert.equal(rec.session, "sess-9");
    assert.equal(rec.phase, 5);
    assert.equal(rec.plan, "docs/myplan.md");
    assert.equal(rec.tool, "Edit");
    assert.ok(typeof rec.ts === "string" && rec.ts.length > 0, "ts must be a non-empty ISO string");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("file-list-guard: the drift log is deduped by (session, path) - two edits of the same file record one line", () => {
  const dir = mk();
  try {
    writeEnabled(dir);
    writeSentinel(dir, {});
    const abs = path.join(dir, "src", "repeated.js");
    assertAllowed(runGuard(dir, editPayload(dir, abs)));
    assertAllowed(runGuard(dir, editPayload(dir, abs)));
    assert.equal(readDrift(dir).length, 1, "a repeated out-of-scope path must not duplicate");

    // A different path in the same session adds a second line.
    assertAllowed(runGuard(dir, editPayload(dir, path.join(dir, "src", "other.js"))));
    assert.equal(readDrift(dir).length, 2, "a distinct out-of-scope path adds a line");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// --- no live scope: allow everything, log nothing ---

test("file-list-guard: no sentinel + idle (absent mode) allows a source edit and logs nothing", () => {
  const dir = mk();
  try {
    writeEnabled(dir);
    writeStateNoSentinel(dir); // no mode field -> idle
    assertAllowed(runGuard(dir, editPayload(dir, path.join(dir, "src", "other.js"))));
    assert.equal(driftExists(dir), false, "idle has no scope, so nothing is out of scope");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("file-list-guard: no sentinel + design mode allows a source edit and logs nothing", () => {
  const dir = mk();
  try {
    writeEnabled(dir);
    writeStateNoSentinel(dir, { mode: "design" });
    assertAllowed(runGuard(dir, editPayload(dir, path.join(dir, "src", "other.js"))));
    assert.equal(driftExists(dir), false, "design no longer gates source edits");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("file-list-guard: no sentinel + a stale 'build' mode field allows a source edit (no file list to be outside of)", () => {
  const dir = mk();
  try {
    writeEnabled(dir);
    writeStateNoSentinel(dir, { mode: "build" }); // mode says build but no sentinel exists
    assertAllowed(runGuard(dir, editPayload(dir, path.join(dir, "src", "other.js"))));
    assert.equal(driftExists(dir), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("file-list-guard: malformed state.json (readSentinel null) is treated as no scope - allow, no log", () => {
  const dir = mk();
  try {
    writeEnabled(dir);
    write(dir, ".now/state.json", "{ broken json");
    assertAllowed(runGuard(dir, editPayload(dir, path.join(dir, "src", "other.js"))));
    assert.equal(driftExists(dir), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("file-list-guard: a *.md edit with no sentinel is allowed", () => {
  const dir = mk();
  try {
    writeEnabled(dir);
    writeStateNoSentinel(dir, { mode: "design" });
    assertAllowed(runGuard(dir, editPayload(dir, path.join(dir, "docs", "notes.md"))));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("file-list-guard: allows when the sentinel is stale (session mismatch + age > 6h), logs nothing", () => {
  const dir = mk();
  try {
    writeEnabled(dir);
    const old = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();
    writeSentinel(dir, { started: old, session: "old-session" });
    assertAllowed(runGuard(dir, editPayload(dir, path.join(dir, "src", "other.js"), "new-session")));
    assert.equal(driftExists(dir), false, "a stale phase declares no scope this session");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// --- fleet safety: neither marker -> entirely inert (no allow-list opinion, no log) ---

test("file-list-guard: entirely inert when NEITHER marker is present, even for an out-of-scope path under a sentinel", () => {
  const dir = mk();
  try {
    writeSentinel(dir, {}); // sentinel present but project not adopted
    assertAllowed(runGuard(dir, editPayload(dir, path.join(dir, "src", "other.js"))));
    assert.equal(driftExists(dir), false, "an unadopted project must never log");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// --- activation: either marker arms the recording ---

test("file-list-guard: .now/enabled alone arms out-of-scope recording", () => {
  const dir = mk();
  try {
    writeNowEnabled(dir);
    writeSentinel(dir, {});
    assertAllowed(runGuard(dir, editPayload(dir, path.join(dir, "src", "other.js"))));
    assert.equal(readDrift(dir).length, 1, ".now/enabled alone must arm recording");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("file-list-guard: legacy .gantry/enabled alone arms out-of-scope recording", () => {
  const dir = mk();
  try {
    writeEnabled(dir);
    writeSentinel(dir, {});
    assertAllowed(runGuard(dir, editPayload(dir, path.join(dir, "src", "other.js"))));
    assert.equal(readDrift(dir).length, 1, "legacy .gantry/enabled alone must still arm recording");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// --- fail-open: allow, no log, no crash ---

test("file-list-guard: fail-open when tool_input is missing", () => {
  const dir = mk();
  try {
    writeEnabled(dir);
    writeSentinel(dir, {});
    const r = runGuard(dir, { session_id: "s", cwd: dir, hook_event_name: "PreToolUse", tool_name: "Edit" });
    assertAllowed(r);
    assert.equal(driftExists(dir), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("file-list-guard: fail-open when file_path is missing", () => {
  const dir = mk();
  try {
    writeEnabled(dir);
    writeSentinel(dir, {});
    const r = runGuard(dir, { session_id: "s", cwd: dir, hook_event_name: "PreToolUse", tool_name: "Edit", tool_input: {} });
    assertAllowed(r);
    assert.equal(driftExists(dir), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("file-list-guard: fail-open for malformed stdin", () => {
  const dir = mk();
  try {
    writeEnabled(dir);
    writeSentinel(dir, {});
    assertAllowed(runGuard(dir, "{ not valid json !!!"));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("file-list-guard: fail-open via the TOP-LEVEL catch when a required sibling module (modes.js) is broken", () => {
  // The guard requires modes.js lazily to judge in-scope vs out-of-scope under
  // a live sentinel, NOT wrapped in a local try/catch, so a broken modes.js
  // throws up to the outer catch -> exit 0, no output, no drift line (it never
  // reaches the drift-log require).
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "claudhd-flg-scratch-"));
  const repoDir = mk();
  try {
    const scriptsDir = path.join(scratch, "scripts");
    const hooksDir = path.join(scriptsDir, "hooks");
    fs.mkdirSync(hooksDir, { recursive: true });

    const REAL_SCRIPTS = path.join(__dirname, "..", "plugins", "claudhd", "scripts");
    for (const name of ["root.js", "sentinel-core.js", "state.js", "lock.js", "constants.js", "nowfile.js", "roadmapids.js", "drift-log.js"]) {
      fs.copyFileSync(path.join(REAL_SCRIPTS, name), path.join(scriptsDir, name));
    }
    fs.copyFileSync(path.join(REAL_SCRIPTS, "hooks", "file-list-guard.js"), path.join(hooksDir, "file-list-guard.js"));
    fs.writeFileSync(path.join(scriptsDir, "modes.js"), "throw new Error('simulated modes.js module-init failure');\n");

    writeEnabled(repoDir);
    // A LIVE sentinel + out-of-scope path forces the modes.js require to run.
    write(repoDir, ".now/state.json", JSON.stringify({
      schemaVersion: 2,
      build: { plan: "p.md", phase: 1, files: ["only/this.js"], allow: [], started: new Date().toISOString(), session: "session-test-123" },
    }));

    const r = spawnSync(process.execPath, [path.join(hooksDir, "file-list-guard.js")], {
      encoding: "utf8",
      input: JSON.stringify(editPayload(repoDir, path.join(repoDir, "src", "other.js"))),
      env: { ...process.env, GANTRY_PROJECT_DIR: repoDir },
    });

    assert.equal(r.status, 0, "exit code must be 0 even though modes.js failed to load\nstderr: " + r.stderr);
    assert.equal(r.stdout.trim(), "", "a broken dependency must fail open, never deny");
    assert.equal(driftExists(repoDir), false, "a crash before the drift-log require must not write a line");
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(repoDir, { recursive: true, force: true });
  }
});

test("file-list-guard: fail-open when the resolved root genuinely does not exist on disk", () => {
  const bogusRoot = path.join(os.tmpdir(), "claudhd-flg-does-not-exist-" + process.pid + "-" + process.hrtime.bigint());
  assert.ok(!fs.existsSync(bogusRoot), "sanity: the bogus root must not exist before the guard runs");
  try {
    const r = spawnSync(process.execPath, [GUARD], {
      encoding: "utf8",
      input: JSON.stringify(editPayload(bogusRoot, path.join(bogusRoot, "src", "other.js"))),
      env: { ...process.env, CLAUDHD_PROJECT_DIR: "", GANTRY_PROJECT_DIR: bogusRoot, CLAUDE_PROJECT_DIR: "" },
    });
    assert.equal(r.status, 0, "exit code must be 0 with a genuinely nonexistent root\nstderr: " + r.stderr);
    assert.equal(r.stdout.trim(), "", "stdout must be empty with a genuinely nonexistent root");
    assert.ok(!fs.existsSync(bogusRoot), "the guard must never have created the bogus root as a side effect");
  } finally {
    fs.rmSync(bogusRoot, { recursive: true, force: true });
  }
});

// --- per-file root resolution: the log is recorded against the repo the file lives in ---

test("file-list-guard PER-FILE ROOT: an out-of-scope edit inside a scratch adopted repo is logged there, even when env pins a different root", () => {
  const sessionRoot = mk(); // env points here - unadopted, unrelated
  const scratchRepo = mk(); // where the file actually lives - adopted
  try {
    writeNowEnabled(scratchRepo);
    writeSentinel(scratchRepo, { files: ["src/allowed.js"], allow: [] });

    const abs = path.join(scratchRepo, "src", "unlisted.js");
    const r = spawnSync(process.execPath, [GUARD], {
      encoding: "utf8",
      input: JSON.stringify(editPayload(scratchRepo, abs)),
      env: { ...process.env, GANTRY_PROJECT_DIR: sessionRoot },
    });
    assertAllowed(r);
    assert.equal(readDrift(scratchRepo).length, 1, "the edit must be logged against the scratch repo's own sentinel");
    assert.equal(driftExists(sessionRoot), false, "the env root must not receive the log");
  } finally {
    fs.rmSync(sessionRoot, { recursive: true, force: true });
    fs.rmSync(scratchRepo, { recursive: true, force: true });
  }
});

test("file-list-guard PER-FILE ROOT: an edit with no adopted ancestor stays unlogged, even though the walk runs", () => {
  const sessionRoot = mk();
  const unadoptedDir = mk();
  try {
    const r = spawnSync(process.execPath, [GUARD], {
      encoding: "utf8",
      input: JSON.stringify(editPayload(unadoptedDir, path.join(unadoptedDir, "src", "whatever.js"))),
      env: { ...process.env, GANTRY_PROJECT_DIR: sessionRoot },
    });
    assertAllowed(r);
    assert.equal(driftExists(unadoptedDir), false);
  } finally {
    fs.rmSync(sessionRoot, { recursive: true, force: true });
    fs.rmSync(unadoptedDir, { recursive: true, force: true });
  }
});

test("file-list-guard PER-FILE ROOT: nested adoption logs against the NEAREST (inner) sentinel", () => {
  const outer = mk();
  try {
    writeEnabled(outer);
    writeSentinel(outer, { files: ["outer/allowed.js"], allow: [] });

    const inner = path.join(outer, "vendor", "adopted-subrepo");
    fs.mkdirSync(inner, { recursive: true });
    write(inner, ".now/enabled", "");
    write(inner, ".now/state.json", JSON.stringify({
      schemaVersion: 2,
      build: { plan: "inner-plan.md", phase: 1, files: ["inner/allowed.js"], allow: [], started: new Date().toISOString(), session: "inner-session" },
    }));

    // Allowed by the inner sentinel -> passes, no log.
    assertAllowed(runGuard(outer, editPayload(inner, path.join(inner, "inner", "allowed.js"), "inner-session")));
    assert.equal(driftExists(inner), false, "an inner-allowed edit must not log");

    // Only in the OUTER sentinel's scope -> out of the INNER phase's scope -> logged against inner.
    assertAllowed(runGuard(outer, editPayload(inner, path.join(inner, "outer", "allowed.js"), "inner-session")));
    assert.equal(readDrift(inner).length, 1, "the inner (nearest) root is the one consulted");
    assert.equal(driftExists(outer), false, "the outer repo must not receive the inner edit's log");
  } finally { fs.rmSync(outer, { recursive: true, force: true }); }
});

test("file-list-guard PER-FILE ROOT: a forced internal walk failure fails open (allow, no log)", () => {
  const envRoot = mk();
  const scratchRepo = mk();
  try {
    writeEnabled(envRoot);
    writeSentinel(envRoot, {});

    // Force a genuine walk failure: a legacy marker paired with a NOW.md that
    // is a DIRECTORY, so readFileSync throws EISDIR mid-walk (WALK_FAILED).
    fs.mkdirSync(path.join(scratchRepo, ".gantry"), { recursive: true });
    fs.writeFileSync(path.join(scratchRepo, ".gantry", "enabled"), "");
    fs.mkdirSync(path.join(scratchRepo, "NOW.md"));

    const r = spawnSync(process.execPath, [GUARD], {
      encoding: "utf8",
      input: JSON.stringify(editPayload(scratchRepo, path.join(scratchRepo, "src", "file.js"))),
      env: { ...process.env, GANTRY_PROJECT_DIR: envRoot },
    });
    assertAllowed(r);
    assert.equal(driftExists(scratchRepo), false, "a walk failure must fail open, logging nothing");
  } finally {
    fs.rmSync(envRoot, { recursive: true, force: true });
    fs.rmSync(scratchRepo, { recursive: true, force: true });
  }
});

// --- exit code is always 0 ---

test("file-list-guard: exit code is always 0 for an out-of-scope (logged) edit", () => {
  const dir = mk();
  try {
    writeEnabled(dir);
    writeSentinel(dir, {});
    const r = runGuard(dir, editPayload(dir, path.join(dir, "totally", "outside.js")));
    assert.equal(r.status, 0, "exit code MUST be 0; got: " + r.status);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
