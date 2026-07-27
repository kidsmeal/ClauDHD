"use strict";
/* Tests for plugins/claudhd/scripts/hooks/file-list-guard.js */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { render } = require("../plugins/claudhd/scripts/nowrender.js");

const GUARD = path.join(__dirname, "..", "plugins", "claudhd", "scripts", "hooks", "file-list-guard.js");
const HOLD_LOCK = path.join(__dirname, "..", "tools", "hold-lock.js");

function mk() { return fs.mkdtempSync(path.join(os.tmpdir(), "claudhd-flg-")); }
function write(dir, rel, content) {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

// Write a fixture sentinel into the `build` section of .now/state.json
// (schema v2; Gantry's sentinel folded in). Any other top-level fields
// (e.g. `mode`, `override`) merge in via `extra`.
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

// Write .now/state.json with NO `build` section (sentinel absent) - the
// phase 5 inversion's entry condition - carrying whatever other top-level
// fields (mode, override) the caller names.
function writeStateNoSentinel(dir, fields) {
  write(dir, ".now/state.json", JSON.stringify(Object.assign({ schemaVersion: 2, build: null }, fields)));
}

// Write the .gantry/enabled marker under dir (the legacy activation gate,
// still honored for enforcement).
function writeEnabled(dir) {
  write(dir, ".gantry/enabled", "");
}

// Write the .now/enabled marker under dir (B1's activation gate, the one
// /claudhd:init's --enable-hooks opt-in writes going forward).
function writeNowEnabled(dir) {
  write(dir, ".now/enabled", "");
}

// Spawn the guard with a given JSON payload piped to stdin.
// Returns the spawnSync result.
function runGuard(dir, payload) {
  const input = typeof payload === "string" ? payload : JSON.stringify(payload);
  return spawnSync(process.execPath, [GUARD], {
    encoding: "utf8",
    input,
    env: { ...process.env, GANTRY_PROJECT_DIR: dir },
  });
}

// Parse the deny JSON from stdout (returns null if stdout is empty or not JSON).
function parseDeny(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try { return JSON.parse(trimmed); } catch { return null; }
}

// Build a standard PreToolUse payload for an Edit tool call.
function editPayload(dir, filePath, sessionId) {
  return {
    session_id: sessionId || "session-test-123",
    cwd: dir,
    hook_event_name: "PreToolUse",
    tool_name: "Edit",
    tool_input: { file_path: filePath },
  };
}

function readState(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, ".now", "state.json"), "utf8"));
}

// Async (non-blocking) guard spawn, needed for the concurrency test below:
// two spawnSync calls in the same process can never actually overlap (each
// blocks the event loop until it returns), so racing two real guard
// invocations requires spawn() + Promise.
function runGuardAsync(dir, payload) {
  return new Promise((resolve, reject) => {
    const input = typeof payload === "string" ? payload : JSON.stringify(payload);
    const c = spawn(process.execPath, [GUARD], { env: { ...process.env, GANTRY_PROJECT_DIR: dir } });
    let stdout = "", stderr = "";
    c.stdout.on("data", (d) => (stdout += d));
    c.stderr.on("data", (d) => (stderr += d));
    c.on("error", reject);
    c.on("close", (status) => resolve({ status, stdout, stderr }));
    c.stdin.end(input);
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

// A real, generated NOW.md (nowrender.render({})), the same shape init.js
// and reconcile.js actually produce - not a hand-rolled fixture that could
// drift from the real "## Loose ends" heading/placeholder shape.
function writeRealNow(dir) {
  fs.writeFileSync(path.join(dir, "NOW.md"), render({}));
}

// --- allow cases: exit 0 + empty stdout (sentinel present, unchanged behavior) ---

test("file-list-guard: allows file in sentinel files list (exit 0, empty stdout)", () => {
  const dir = mk();
  try {
    writeEnabled(dir);
    writeSentinel(dir, {});
    const absPath = path.join(dir, "plugins", "claudhd", "scripts", "hooks", "file-list-guard.js");
    const r = runGuard(dir, editPayload(dir, absPath));
    assert.equal(r.status, 0, "exit code must be 0 for in-files path\nstderr: " + r.stderr);
    assert.equal(r.stdout.trim(), "", "stdout must be empty for allowed path");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("file-list-guard: allows file in sentinel allow list (exit 0, empty stdout)", () => {
  const dir = mk();
  try {
    writeEnabled(dir);
    writeSentinel(dir, { allow: ["docs/plan.md"] });
    const absPath = path.join(dir, "docs", "plan.md");
    const r = runGuard(dir, editPayload(dir, absPath));
    assert.equal(r.status, 0, "exit code must be 0 for in-allow path\nstderr: " + r.stderr);
    assert.equal(r.stdout.trim(), "", "stdout must be empty for allowed path");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("file-list-guard (review round 3): under a LIVE sentinel, .now/, .gantry/, .claude/ paths allow, an unlisted source path still denies, and an allow-listed path still allows", () => {
  const dir = mk();
  try {
    writeEnabled(dir);
    writeSentinel(dir, { allow: ["docs/plan.md"] });

    // build mode's state-dir allowance (modes.js's table) applies under a
    // live sentinel too - the legacy files/allow-only check never granted
    // this before this round's fix.
    for (const rel of [".now/state.json", ".gantry/models.json", ".claude/settings.local.json"]) {
      const r = runGuard(dir, editPayload(dir, path.join(dir, ...rel.split("/"))));
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout.trim(), "", rel + " must be allowed under a live sentinel; stdout: " + r.stdout);
    }

    // sentinel.allow is preserved - still allowed, exactly as before.
    const allowR = runGuard(dir, editPayload(dir, path.join(dir, "docs", "plan.md")));
    assert.equal(allowR.status, 0, allowR.stderr);
    assert.equal(allowR.stdout.trim(), "", "an allow-listed path must still be allowed under a live sentinel");

    // An unlisted, non-state-dir source path must still deny.
    const denyR = runGuard(dir, editPayload(dir, path.join(dir, "src", "unlisted.js")));
    assert.equal(denyR.status, 0, denyR.stderr);
    const deny = parseDeny(denyR.stdout);
    assert.ok(deny !== null, "an unlisted source path must still deny under a live sentinel; got: " + denyR.stdout);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("file-list-guard: allows when sentinel is stale (session mismatch + age > 6h)", () => {
  const dir = mk();
  try {
    writeEnabled(dir);
    const old = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();
    writeSentinel(dir, { started: old, session: "old-session" });
    const absPath = path.join(dir, "src", "other.js");
    // current session differs from "old-session" AND age > 6h -> stale
    const payload = editPayload(dir, absPath, "new-session");
    const r = runGuard(dir, payload);
    assert.equal(r.status, 0, "exit code must be 0 for stale sentinel\nstderr: " + r.stderr);
    assert.equal(r.stdout.trim(), "", "stdout must be empty for stale sentinel");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// --- deny case (sentinel present, unchanged behavior) ---

test("file-list-guard: denies file outside both files and allow lists", () => {
  const dir = mk();
  try {
    writeEnabled(dir);
    writeSentinel(dir, {});
    const absPath = path.join(dir, "src", "unauthorized.js");
    const r = runGuard(dir, editPayload(dir, absPath));
    assert.equal(r.status, 0, "exit code must be 0 even on deny\nstderr: " + r.stderr);
    const deny = parseDeny(r.stdout);
    assert.ok(deny !== null, "stdout should be parseable JSON on deny; got: " + r.stdout);
    assert.equal(
      deny.hookSpecificOutput.hookEventName,
      "PreToolUse",
      "hookEventName must be PreToolUse"
    );
    assert.equal(
      deny.hookSpecificOutput.permissionDecision,
      "deny",
      "permissionDecision must be deny"
    );
    assert.ok(
      typeof deny.hookSpecificOutput.permissionDecisionReason === "string" &&
        deny.hookSpecificOutput.permissionDecisionReason.length > 0,
      "permissionDecisionReason must be a non-empty string"
    );
    // Message should reference "scope drift" and phase number
    assert.match(
      deny.hookSpecificOutput.permissionDecisionReason,
      /scope drift/,
      "deny reason should mention scope drift"
    );
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// Phase 5: the inversion (sentinel-absent, inside an adopted project).
// ---------------------------------------------------------------------------

test("file-list-guard INVERSION: denies a source-shaped path when no sentinel exists and mode is idle (absent)", () => {
  const dir = mk();
  try {
    writeEnabled(dir);
    writeStateNoSentinel(dir); // no `mode` field either -> null -> idle
    const absPath = path.join(dir, "src", "other.js");
    const r = runGuard(dir, editPayload(dir, absPath));
    assert.equal(r.status, 0, "exit code must always be 0, even for the new inverted deny\nstderr: " + r.stderr);
    const deny = parseDeny(r.stdout);
    assert.ok(deny !== null, "sentinel-absent + idle mode + source path must now DENY, not fail open; got: " + r.stdout);
    assert.equal(deny.hookSpecificOutput.permissionDecision, "deny");
    assert.match(deny.hookSpecificOutput.permissionDecisionReason, /idle mode/);
    assert.match(deny.hookSpecificOutput.permissionDecisionReason, /\/claudhd:design/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("file-list-guard INVERSION: denies a source-shaped path when no sentinel exists and mode is design", () => {
  const dir = mk();
  try {
    writeEnabled(dir);
    writeStateNoSentinel(dir, { mode: "design" });
    const absPath = path.join(dir, "src", "other.js");
    const r = runGuard(dir, editPayload(dir, absPath));
    assert.equal(r.status, 0, r.stderr);
    const deny = parseDeny(r.stdout);
    assert.ok(deny !== null, "design mode must deny a source-shaped path; got: " + r.stdout);
    assert.match(deny.hookSpecificOutput.permissionDecisionReason, /design mode/);
    assert.match(deny.hookSpecificOutput.permissionDecisionReason, /\/claudhd:build/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("file-list-guard INVERSION: allows a *.md path when no sentinel exists (idle or design mode)", () => {
  const dir = mk();
  try {
    writeEnabled(dir);
    writeStateNoSentinel(dir, { mode: "design" });
    const absPath = path.join(dir, "docs", "notes.md");
    const r = runGuard(dir, editPayload(dir, absPath));
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), "", "a *.md edit must be allowed in design mode with no sentinel; stdout: " + r.stdout);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("file-list-guard INVERSION: allows a state-dir path (.now/, .gantry/, .claude/) when no sentinel exists, regardless of mode", () => {
  const dir = mk();
  try {
    writeEnabled(dir);
    writeStateNoSentinel(dir); // idle
    const absPath = path.join(dir, ".claude", "settings.local.json");
    const r = runGuard(dir, editPayload(dir, absPath));
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), "", "a state-dir edit must always be allowed; stdout: " + r.stdout);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("file-list-guard INVERSION: build mode with no sentinel (edge case) denies a source path not in any file list", () => {
  const dir = mk();
  try {
    writeEnabled(dir);
    // Sentinel absent but mode still claims "build" (e.g. a stale mode field
    // after a clear) - there is no file list to check against, so the
    // allowlist is empty and everything source-shaped denies.
    writeStateNoSentinel(dir, { mode: "build" });
    const absPath = path.join(dir, "src", "other.js");
    const r = runGuard(dir, editPayload(dir, absPath));
    assert.equal(r.status, 0, r.stderr);
    const deny = parseDeny(r.stdout);
    assert.ok(deny !== null, "build mode with an empty/absent file list must still deny; got: " + r.stdout);
    assert.match(deny.hookSpecificOutput.permissionDecisionReason, /build mode/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("file-list-guard INVERSION: malformed state.json funnels into the SAME mode-enforcement path (not a special-cased fail-open)", () => {
  const dir = mk();
  try {
    writeEnabled(dir);
    // Malformed JSON: readSentinel() returns null exactly as it would for a
    // genuinely absent build section, so this exercises the inversion, not
    // a distinct fail-open branch (see the plan's six-branch enumeration,
    // which does not include "malformed sentinel").
    write(dir, ".now/state.json", "{ broken json");
    const absPath = path.join(dir, "src", "other.js");
    const r = runGuard(dir, editPayload(dir, absPath));
    assert.equal(r.status, 0, r.stderr);
    const deny = parseDeny(r.stdout);
    assert.ok(deny !== null, "malformed state.json must resolve to idle mode and deny a source path; got: " + r.stdout);
    assert.match(deny.hookSpecificOutput.permissionDecisionReason, /idle mode/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// --- fleet-safety invariant: neither marker present -> entirely inert ---

test("file-list-guard: allows (entirely inert) when NEITHER .now/enabled NOR .gantry/enabled is present, sentinel present", () => {
  const dir = mk();
  try {
    // No writeEnabled(), no writeNowEnabled() - neither marker present.
    writeSentinel(dir, {});
    const absPath = path.join(dir, "src", "other.js");
    const r = runGuard(dir, editPayload(dir, absPath));
    assert.equal(r.status, 0, "exit code must be 0 when neither marker is present\nstderr: " + r.stderr);
    assert.equal(r.stdout.trim(), "", "stdout must be empty when guard is inactive");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("file-list-guard: allows (entirely inert) when NEITHER marker is present, sentinel absent - the inversion never fires unadopted", () => {
  const dir = mk();
  try {
    // No writeEnabled(), no writeNowEnabled(). The inversion is B1-gated: an
    // unadopted project must be untouched even for a source-shaped path that
    // WOULD deny under mode enforcement.
    writeStateNoSentinel(dir, { mode: "idle" });
    const absPath = path.join(dir, "src", "other.js");
    const r = runGuard(dir, editPayload(dir, absPath));
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), "", "an unadopted project must never be denied by the inversion; stdout: " + r.stdout);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// --- B1: the new .now/enabled marker alone activates enforcement ---

test("file-list-guard: .now/enabled alone (no legacy .gantry/enabled) activates enforcement and the inversion", () => {
  const dir = mk();
  try {
    writeNowEnabled(dir);
    writeStateNoSentinel(dir); // idle
    const absPath = path.join(dir, "src", "other.js");
    const r = runGuard(dir, editPayload(dir, absPath));
    assert.equal(r.status, 0, r.stderr);
    const deny = parseDeny(r.stdout);
    assert.ok(deny !== null, ".now/enabled alone must activate enforcement; got: " + r.stdout);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("file-list-guard: legacy .gantry/enabled alone still activates enforcement and the inversion", () => {
  const dir = mk();
  try {
    writeEnabled(dir); // legacy marker only
    writeStateNoSentinel(dir); // idle
    const absPath = path.join(dir, "src", "other.js");
    const r = runGuard(dir, editPayload(dir, absPath));
    assert.equal(r.status, 0, r.stderr);
    const deny = parseDeny(r.stdout);
    assert.ok(deny !== null, "legacy .gantry/enabled alone must still activate enforcement; got: " + r.stdout);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// --- the escape hatch: an active override permits and counts ---

test("file-list-guard OVERRIDE: an active override for the CURRENT session permits an edit modes.js would otherwise deny, and records it", () => {
  const dir = mk();
  try {
    writeEnabled(dir);
    writeStateNoSentinel(dir, {
      mode: "idle",
      override: { session: "override-session-1", files: [], startedAt: new Date().toISOString() },
    });
    const absPath = path.join(dir, "src", "unscoped.js");
    const r = runGuard(dir, editPayload(dir, absPath, "override-session-1"));
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), "", "an active override must permit the edit; stdout: " + r.stdout);

    const state = readState(dir);
    assert.deepEqual(state.override.files, ["src/unscoped.js"], "the permitted edit must be counted into the override record");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("file-list-guard OVERRIDE: an override recorded for a DIFFERENT session does not bypass enforcement", () => {
  const dir = mk();
  try {
    writeEnabled(dir);
    writeStateNoSentinel(dir, {
      mode: "idle",
      override: { session: "some-other-session", files: [], startedAt: new Date().toISOString() },
    });
    const absPath = path.join(dir, "src", "unscoped.js");
    const r = runGuard(dir, editPayload(dir, absPath, "current-session"));
    assert.equal(r.status, 0, r.stderr);
    const deny = parseDeny(r.stdout);
    assert.ok(deny !== null, "an override for a DIFFERENT session must not bypass enforcement; got: " + r.stdout);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("file-list-guard OVERRIDE: counts accumulate across repeated edits without duplicating a repeated path", () => {
  const dir = mk();
  try {
    writeEnabled(dir);
    writeStateNoSentinel(dir, {
      mode: "idle",
      override: { session: "override-session-2", files: ["src/first.js"], startedAt: new Date().toISOString() },
    });
    const absPath1 = path.join(dir, "src", "first.js"); // already recorded
    const absPath2 = path.join(dir, "src", "second.js");
    runGuard(dir, editPayload(dir, absPath1, "override-session-2"));
    runGuard(dir, editPayload(dir, absPath2, "override-session-2"));
    const state = readState(dir);
    assert.deepEqual(state.override.files.sort(), ["src/first.js", "src/second.js"]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("file-list-guard OVERRIDE (review item 1): a current-session override permits AND counts an out-of-list edit under a LIVE sentinel (build mode), not only the mode-inversion branch", () => {
  const dir = mk();
  try {
    writeEnabled(dir);
    writeSentinel(dir, {}, {
      mode: "build",
      override: { session: "build-override-session", files: [], startedAt: new Date().toISOString() },
    });
    // "outside.js" is in neither sentinel.files nor sentinel.allow (see
    // writeSentinel's fixture) - normally step 8 would deny this.
    const absPath = path.join(dir, "src", "outside.js");
    const r = runGuard(dir, editPayload(dir, absPath, "build-override-session"));
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), "", "the override must permit an out-of-list edit under a live sentinel too; stdout: " + r.stdout);

    const state = readState(dir);
    assert.deepEqual(state.override.files, ["src/outside.js"], "the out-of-list edit must be counted");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("file-list-guard OVERRIDE (review item 1): with NO active override, an out-of-list edit under a live sentinel still denies as before", () => {
  const dir = mk();
  try {
    writeEnabled(dir);
    writeSentinel(dir, {}, { mode: "build" }); // no `override` key at all
    const absPath = path.join(dir, "src", "outside.js");
    const r = runGuard(dir, editPayload(dir, absPath, "session-test-123"));
    assert.equal(r.status, 0, r.stderr);
    const deny = parseDeny(r.stdout);
    assert.ok(deny !== null, "no active override -> the existing sentinel-present deny is unchanged; got: " + r.stdout);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("file-list-guard OVERRIDE (review item 2): the REAL flow - record an override, drive two edits through the actual guard, and read the count back off the RENDERED NOW.md", () => {
  const dir = mk();
  try {
    writeEnabled(dir);
    writeRealNow(dir);
    const override = require("../plugins/claudhd/scripts/override.js");
    override.recordOverride(dir, "freshness-session"); // the REAL start-of-override write

    // Two guard-permitted edits, through the real hook - no artificial
    // second recordOverride() or hand-seeded state.override.files.
    const r1 = runGuard(dir, editPayload(dir, path.join(dir, "src", "a.js"), "freshness-session"));
    const r2 = runGuard(dir, editPayload(dir, path.join(dir, "src", "b.js"), "freshness-session"));
    assert.equal(r1.status, 0, r1.stderr);
    assert.equal(r2.status, 0, r2.stderr);
    assert.equal(r1.stdout.trim(), "");
    assert.equal(r2.stdout.trim(), "");

    const state = readState(dir);
    assert.deepEqual(state.override.files.sort(), ["src/a.js", "src/b.js"]);

    const now = fs.readFileSync(path.join(dir, "NOW.md"), "utf8");
    assert.match(now, /unguarded session/i, "the guard's own permitted edits must re-render NOW.md, not just state.json");
    assert.match(now, /2 files outside any phase/, "the rendered count must reflect BOTH guard-permitted edits");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("file-list-guard OVERRIDE (sol round-one finding 1): entering build mode invalidates a prior override - the same edit that was permitted now denies", () => {
  const dir = mk();
  try {
    writeEnabled(dir);
    writeRealNow(dir);
    const override = require("../plugins/claudhd/scripts/override.js");
    const thread = require("../plugins/claudhd/scripts/thread.js");
    override.recordOverride(dir, "emergency-session");

    const absPath = path.join(dir, "src", "unscoped.js");
    const permitted = runGuard(dir, editPayload(dir, absPath, "emergency-session"));
    assert.equal(permitted.status, 0, permitted.stderr);
    assert.equal(permitted.stdout.trim(), "", "the override must permit the edit before the mode transition");

    // Entering build (a properly-scoped mode) must invalidate the override -
    // it is a per-emergency escape, not a standing permit that survives into
    // whatever comes next.
    thread.enterBuild(dir);

    const denied = runGuard(dir, editPayload(dir, absPath, "emergency-session"));
    assert.equal(denied.status, 0, denied.stderr);
    const deny = parseDeny(denied.stdout);
    assert.ok(deny !== null, "the SAME edit, SAME session must now deny after enterBuild cleared the override; got: " + denied.stdout);

    const state = readState(dir);
    assert.ok(!state.override, "state.override must be cleared (absent), not merely stale");

    const now = fs.readFileSync(path.join(dir, "NOW.md"), "utf8");
    assert.doesNotMatch(now, /unguarded session/i, "the rendered Loose ends line must not linger after the override is cleared");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("file-list-guard OVERRIDE (sol round-one finding 1): entering design mode invalidates a prior override the same way", () => {
  const dir = mk();
  try {
    writeEnabled(dir);
    writeRealNow(dir);
    const override = require("../plugins/claudhd/scripts/override.js");
    const thread = require("../plugins/claudhd/scripts/thread.js");
    override.recordOverride(dir, "emergency-session-2");

    const absPath = path.join(dir, "src", "unscoped2.js");
    const permitted = runGuard(dir, editPayload(dir, absPath, "emergency-session-2"));
    assert.equal(permitted.stdout.trim(), "", "the override must permit the edit before the mode transition");

    thread.enterDesign(dir, {});

    // A source-shaped path is denied under design mode regardless of the
    // override, since the override no longer applies at all.
    const denied = runGuard(dir, editPayload(dir, absPath, "emergency-session-2"));
    const deny = parseDeny(denied.stdout);
    assert.ok(deny !== null, "the edit must deny after enterDesign cleared the override; got: " + denied.stdout);

    const state = readState(dir);
    assert.ok(!state.override, "state.override must be cleared (absent) after enterDesign");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("file-list-guard OVERRIDE (sol round-six finding 3): setDesignDoc invalidates a prior override too, WITHOUT wiping the accumulated design board (still true post round-seven, though design.md's audit entry point is now auditDesign - see below)", () => {
  const dir = mk();
  try {
    writeEnabled(dir);
    writeRealNow(dir);
    const override = require("../plugins/claudhd/scripts/override.js");
    const thread = require("../plugins/claudhd/scripts/thread.js");

    // An in-progress design board, accumulated before a mid-grill doc write.
    thread.enterDesign(dir, { from: "r-0725-8", thread: "t", next: "n" });
    thread.addDecision(dir, "open", "still deciding this one");
    thread.addDecision(dir, "resolved", "already settled this one");

    override.recordOverride(dir, "emergency-session-3");
    const absPath = path.join(dir, "src", "unscoped3.js");
    const permitted = runGuard(dir, editPayload(dir, absPath, "emergency-session-3"));
    assert.equal(permitted.stdout.trim(), "", "the override must permit the edit before the transition");

    thread.setDesignDoc(dir, "design/existing-draft.md");

    const denied = runGuard(dir, editPayload(dir, absPath, "emergency-session-3"));
    const deny = parseDeny(denied.stdout);
    assert.ok(deny !== null, "the edit must deny after setDesignDoc cleared the override; got: " + denied.stdout);

    const state = readState(dir);
    assert.ok(!state.override, "state.override must be cleared (absent) after setDesignDoc");

    // The board itself must survive - this is what distinguishes setDesignDoc
    // from enterDesign.
    assert.equal(state.design.doc, "design/existing-draft.md");
    assert.deepEqual(state.design.open, ["still deciding this one"]);
    assert.deepEqual(state.design.resolved, ["already settled this one"]);
    assert.equal(state.from, "r-0725-8", "from must also survive - setDesignDoc never touches it");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("file-list-guard OVERRIDE (sol round-seven): auditDesign's CONTINUATION branch (re-auditing the currently-active doc) invalidates a prior override too, WITHOUT wiping the accumulated design board", () => {
  const dir = mk();
  try {
    writeEnabled(dir);
    writeRealNow(dir);
    const override = require("../plugins/claudhd/scripts/override.js");
    const thread = require("../plugins/claudhd/scripts/thread.js");

    // An in-progress audit, accumulated before a re-audit of the SAME doc.
    thread.enterDesign(dir, { from: "r-0725-9", thread: "t", next: "n" });
    thread.setDesignDoc(dir, "design/existing-draft.md");
    thread.addDecision(dir, "open", "still deciding this one");
    thread.addDecision(dir, "resolved", "already settled this one");

    override.recordOverride(dir, "emergency-session-4");
    const absPath = path.join(dir, "src", "unscoped4.js");
    const permitted = runGuard(dir, editPayload(dir, absPath, "emergency-session-4"));
    assert.equal(permitted.stdout.trim(), "", "the override must permit the edit before the transition");

    // design.md's own existing-doc entry point - re-auditing the SAME doc.
    thread.auditDesign(dir, "design/existing-draft.md");

    const denied = runGuard(dir, editPayload(dir, absPath, "emergency-session-4"));
    const deny = parseDeny(denied.stdout);
    assert.ok(deny !== null, "the edit must deny after auditDesign cleared the override; got: " + denied.stdout);

    const state = readState(dir);
    assert.ok(!state.override, "state.override must be cleared (absent) after auditDesign's continuation branch");
    assert.equal(state.design.doc, "design/existing-draft.md");
    assert.deepEqual(state.design.open, ["still deciding this one"]);
    assert.deepEqual(state.design.resolved, ["already settled this one"]);
    assert.equal(state.from, "r-0725-9", "from must survive the continuation branch too");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("file-list-guard OVERRIDE (sol round-seven): auditDesign's FRESH-ENTRY branch (a different doc, or idle) invalidates a prior override AND does not leak a prior unrelated thread's board/from", () => {
  const dir = mk();
  try {
    writeEnabled(dir);
    writeRealNow(dir);
    const override = require("../plugins/claudhd/scripts/override.js");
    const thread = require("../plugins/claudhd/scripts/thread.js");

    // A completed, unrelated prior design thread.
    thread.enterDesign(dir, { from: "r-0710-2", thread: "old thread", next: "old next" });
    thread.setDesignDoc(dir, "design/old-draft.md");
    thread.addDecision(dir, "resolved", "an old, unrelated decision");
    thread.enterBuild(dir); // the old thread moved on

    override.recordOverride(dir, "emergency-session-5");
    const absPath = path.join(dir, "src", "unscoped5.js");
    const permitted = runGuard(dir, editPayload(dir, absPath, "emergency-session-5"));
    assert.equal(permitted.stdout.trim(), "", "the override must permit the edit before the transition");

    // A brand-new existing-doc audit, unrelated to the old thread above.
    thread.auditDesign(dir, "design/brand-new-draft.md");

    const denied = runGuard(dir, editPayload(dir, absPath, "emergency-session-5"));
    const deny = parseDeny(denied.stdout);
    assert.ok(deny !== null, "the edit must deny after auditDesign cleared the override; got: " + denied.stdout);

    const state = readState(dir);
    assert.ok(!state.override, "state.override must be cleared (absent) after auditDesign's fresh-entry branch");
    assert.equal(state.mode, "design");
    assert.equal(state.from, null, "a fresh existing-doc audit never carries an unrelated thread's from");
    assert.deepEqual(state.design, { doc: "design/brand-new-draft.md", resolved: [], open: [] },
      "the old thread's resolved decisions must not leak into this fresh audit's board");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// --- the quick sentinel must include NOW.md (sol round-one finding 3) ---

test("file-list-guard: a quick sentinel (write-files) permits the source edit AND the NOW.md batch check-off, end to end", () => {
  const dir = mk();
  try {
    writeEnabled(dir);
    writeRealNow(dir);
    const sentinelScript = path.join(__dirname, "..", "plugins", "claudhd", "scripts", "sentinel.js");

    // The real /claudhd:quick clearing pass: write a scoped sentinel over the
    // batch's own files via write-files (as quick.md instructs).
    const write = spawnSync(process.execPath, [sentinelScript, "write-files", "src/quickfix.js"], {
      encoding: "utf8",
      env: { ...process.env, GANTRY_PROJECT_DIR: dir },
    });
    assert.equal(write.status, 0, "sentinel write-files should exit 0\n" + write.stderr);

    // 1. The source edit itself must be permitted.
    const sourceEdit = runGuard(dir, editPayload(dir, path.join(dir, "src", "quickfix.js")));
    assert.equal(sourceEdit.status, 0, sourceEdit.stderr);
    assert.equal(sourceEdit.stdout.trim(), "", "the batch's own file must be permitted under the quick sentinel");

    // 2. Checking off the item in NOW.md (part of the same clearing pass)
    // must ALSO be permitted - this is finding 3: a live sentinel's allow
    // list has no generic *.md allowance, so NOW.md must be named explicitly.
    const nowEdit = runGuard(dir, editPayload(dir, path.join(dir, "NOW.md")));
    assert.equal(nowEdit.status, 0, nowEdit.stderr);
    assert.equal(nowEdit.stdout.trim(), "", "checking off the batch item in NOW.md must be permitted under the quick sentinel");

    // 3. An unrelated source file, outside the scoped list, must still deny.
    const outside = runGuard(dir, editPayload(dir, path.join(dir, "src", "unrelated.js")));
    const deny = parseDeny(outside.stdout);
    assert.ok(deny !== null, "a file outside the quick sentinel's scope must still deny");

    // 4. Clearing the sentinel closes the gate.
    const clear = spawnSync(process.execPath, [sentinelScript, "clear"], {
      encoding: "utf8",
      env: { ...process.env, GANTRY_PROJECT_DIR: dir },
    });
    assert.equal(clear.status, 0, clear.stderr);
    const afterClear = readState(dir);
    assert.equal(afterClear.build, null, "the quick sentinel must be cleared from state.json");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("file-list-guard OVERRIDE (review item 4): two racing guard invocations for the SAME session never lose either file (atomic read-modify-write under the shared lock)", async () => {
  const dir = mk();
  try {
    writeEnabled(dir);
    writeStateNoSentinel(dir, { mode: "idle", override: { session: "race-session", files: [], startedAt: new Date().toISOString() } });

    const nowDir = path.join(dir, ".now");
    const lockDir = path.join(nowDir, "override.lock");
    const logFile = path.join(dir, "lock-events.log");
    fs.writeFileSync(logFile, "");

    // Hold override.lock for a fixed window, then fire two REAL, concurrent
    // guard invocations targeting DIFFERENT paths while it is held, so both
    // are queued on the exact lock noteOverrideFile() uses - mirrors
    // test/state-concurrency.test.js's established hold-lock pattern.
    const holdMs = 300;
    const holdPromise = holdLockAsync(lockDir, "HOLDER", holdMs, logFile);
    await new Promise((r) => setTimeout(r, 50));

    const jobA = runGuardAsync(dir, editPayload(dir, path.join(dir, "src", "race-a.js"), "race-session"));
    const jobB = runGuardAsync(dir, editPayload(dir, path.join(dir, "src", "race-b.js"), "race-session"));

    const [, resultA, resultB] = await Promise.all([holdPromise, jobA, jobB]);
    assert.equal(resultA.status, 0, resultA.stderr);
    assert.equal(resultB.status, 0, resultB.stderr);

    const state = readState(dir);
    assert.deepEqual(
      state.override.files.sort(),
      ["src/race-a.js", "src/race-b.js"],
      "both racing writes must be preserved - no lost update"
    );
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("file-list-guard OVERRIDE (review round 2, finding 2 - TOCTOU): an override that lands WHILE the guard is blocked waiting for the lock is still seen, and permits+counts exactly once", async () => {
  const dir = mk();
  try {
    writeEnabled(dir);
    writeRealNow(dir);
    // NO override recorded at all yet - a pre-lock snapshot taken now would
    // show nothing. If the guard's decision were still gated on such a
    // snapshot (the bug this test targets), it would never even ATTEMPT the
    // locked check below, and would incorrectly deny.
    writeStateNoSentinel(dir, { mode: "idle" });

    const nowDir = path.join(dir, ".now");
    const lockDir = path.join(nowDir, "override.lock");

    // We hold override.lock OURSELVES, BEFORE the guard is even spawned, so
    // the guard's own noteOverrideFile() call is GUARANTEED to block until
    // we release it - not timing-dependent, since mkdir is atomic and the
    // guard cannot win a race against a lock we already hold.
    fs.mkdirSync(lockDir);
    try {
      const guardJob = runGuardAsync(dir, editPayload(dir, path.join(dir, "src", "unscoped.js"), "toctou-session"));

      // Give the guard a moment to actually reach and start retrying on the
      // held lock (not required for correctness - the mkdir-holder ordering
      // above already guarantees it - but makes the "still blocked" premise
      // observable rather than theoretical).
      await new Promise((r) => setTimeout(r, 150));

      // Record the override for real WHILE we still hold override.lock -
      // exactly what recordOverride() does under the hood (the same
      // merge-preserving writeStateAtomic call), but invoked directly here
      // because recordOverride() itself would try to acquire override.lock
      // and deadlock against ourselves.
      const { writeStateAtomic } = require("../plugins/claudhd/scripts/state.js");
      writeStateAtomic(
        nowDir,
        { override: { session: "toctou-session", files: [], startedAt: new Date().toISOString() } },
        ["override"]
      );

      // Release the lock - the blocked guard can now acquire it and take a
      // FRESH read that sees the override we just wrote.
      fs.rmdirSync(lockDir);

      const result = await guardJob;
      assert.equal(result.status, 0, result.stderr);
      assert.equal(
        result.stdout.trim(),
        "",
        "the override, recorded only AFTER the guard started waiting, must still permit the edit - the locked read must be authoritative, not the earlier snapshot"
      );

      const state = readState(dir);
      assert.deepEqual(state.override.files, ["src/unscoped.js"], "the edit must be counted exactly once");
    } finally {
      try { fs.rmdirSync(lockDir); } catch { /* already released above */ }
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// --- fail-open cases: crashes/malformed input, EVERY OTHER path stays open ---

test("file-list-guard: fail-open (exit 0) when tool_input is entirely missing from the payload", () => {
  const dir = mk();
  try {
    writeEnabled(dir);
    writeSentinel(dir, {});
    const payload = {
      session_id: "session-test-123",
      cwd: dir,
      hook_event_name: "PreToolUse",
      tool_name: "Edit",
      // no tool_input key at all
    };
    const r = runGuard(dir, payload);
    assert.equal(r.status, 0, "exit code must be 0 when tool_input is missing\nstderr: " + r.stderr);
    assert.equal(r.stdout.trim(), "", "stdout must be empty (fail-open) when tool_input is missing");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("file-list-guard: fail-open (exit 0) when file_path is missing from tool_input", () => {
  const dir = mk();
  try {
    writeEnabled(dir);
    writeSentinel(dir, {});
    const payload = {
      session_id: "session-test-123",
      cwd: dir,
      hook_event_name: "PreToolUse",
      tool_name: "Edit",
      tool_input: {}, // no file_path
    };
    const r = runGuard(dir, payload);
    assert.equal(r.status, 0, "exit code must be 0 when file_path is missing\nstderr: " + r.stderr);
    assert.equal(r.stdout.trim(), "", "stdout must be empty (fail-open) when file_path missing");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("file-list-guard: fail-open (exit 0) for malformed/unparseable stdin", () => {
  const dir = mk();
  try {
    writeEnabled(dir);
    writeSentinel(dir, {});
    const r = runGuard(dir, "{ not valid json !!!");
    assert.equal(r.status, 0, "exit code must be 0 for malformed stdin\nstderr: " + r.stderr);
    assert.equal(r.stdout.trim(), "", "stdout must be empty for malformed stdin");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("file-list-guard: fail-open (exit 0) via the TOP-LEVEL catch, when a required sibling module (modes.js) is broken", () => {
  // A self-contained copy of the guard's own relative layout, mirroring
  // commit-guard.test.js's module-init-failure fixture: modes.js is lazily
  // required only once the inversion branch actually needs it (sentinel
  // absent, adopted project - see file-list-guard.js's header comment), and
  // deliberately NOT wrapped in its own local try/catch, so a broken modes.js
  // throws naturally up to the outer try/catch at the bottom of the file -
  // this IS "the top-level catch" branch, exercised for real, not simulated.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "claudhd-flg-scratch-"));
  const repoDir = mk();
  try {
    const scriptsDir = path.join(scratch, "scripts");
    const hooksDir = path.join(scriptsDir, "hooks");
    fs.mkdirSync(hooksDir, { recursive: true });

    const REAL_SCRIPTS = path.join(__dirname, "..", "plugins", "claudhd", "scripts");
    for (const name of ["root.js", "sentinel-core.js", "state.js", "lock.js", "constants.js", "nowfile.js", "roadmapids.js"]) {
      fs.copyFileSync(path.join(REAL_SCRIPTS, name), path.join(scriptsDir, name));
    }
    fs.copyFileSync(path.join(REAL_SCRIPTS, "hooks", "file-list-guard.js"), path.join(hooksDir, "file-list-guard.js"));
    fs.writeFileSync(path.join(scriptsDir, "modes.js"), "throw new Error('simulated modes.js module-init failure');\n");

    writeEnabled(repoDir);
    write(repoDir, ".now/state.json", JSON.stringify({ schemaVersion: 2, build: null, mode: "idle" }));

    const r = spawnSync(process.execPath, [path.join(hooksDir, "file-list-guard.js")], {
      encoding: "utf8",
      input: JSON.stringify(editPayload(repoDir, path.join(repoDir, "src", "other.js"))),
      env: { ...process.env, GANTRY_PROJECT_DIR: repoDir },
    });

    assert.equal(r.status, 0, "exit code must still be 0 even though modes.js failed to load\nstderr: " + r.stderr);
    assert.equal(r.stdout.trim(), "", "no deny JSON - a broken dependency must fail open, never deny");
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(repoDir, { recursive: true, force: true });
  }
});

test("file-list-guard: fail-open (exit 0) when the resolved root genuinely does not exist on disk (review round 2, finding 1)", () => {
  // Empty env vars merely fall back to cwd (a REAL, valid directory - the
  // test runner's own cwd), which never actually exercises an unresolvable
  // root: it just re-tests "marker absent" in an arbitrary real directory,
  // already covered by the fleet-safety tests above. This fixture instead
  // points every root env var at a path that is guaranteed to NOT exist, so
  // every fs call against it (isAdopted's accessSync, and if it somehow got
  // further, readSentinel/readState's readFileSync) genuinely throws ENOENT
  // rather than silently resolving to something real.
  const bogusRoot = path.join(
    os.tmpdir(),
    "claudhd-flg-does-not-exist-" + Date.now() + "-" + Math.random().toString(36).slice(2)
  );
  assert.ok(!fs.existsSync(bogusRoot), "sanity: the bogus root must not exist before the guard runs");
  try {
    const absPath = path.join(bogusRoot, "src", "other.js");
    const payload = editPayload(bogusRoot, absPath);
    const r = spawnSync(process.execPath, [GUARD], {
      encoding: "utf8",
      input: JSON.stringify(payload),
      env: { ...process.env, CLAUDHD_PROJECT_DIR: "", GANTRY_PROJECT_DIR: bogusRoot, CLAUDE_PROJECT_DIR: "" },
    });
    assert.equal(r.status, 0, "exit code must be 0 with a genuinely nonexistent root\nstderr: " + r.stderr);
    assert.equal(r.stdout.trim(), "", "stdout must be empty with a genuinely nonexistent root");
    assert.ok(!fs.existsSync(bogusRoot), "the guard must never have created the bogus root as a side effect");
  } finally {
    fs.rmSync(bogusRoot, { recursive: true, force: true });
  }
});

// --- exit code is always 0 (even on deny, and even on the new inverted deny) ---

test("file-list-guard: exit code is always 0 even when producing deny JSON (sentinel present)", () => {
  const dir = mk();
  try {
    writeEnabled(dir);
    writeSentinel(dir, {});
    const absPath = path.join(dir, "totally", "outside.js");
    const r = runGuard(dir, editPayload(dir, absPath));
    assert.equal(r.status, 0, "exit code MUST be 0 even on deny; got: " + r.status);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("file-list-guard: exit code is always 0 even for the new inverted deny (sentinel absent)", () => {
  const dir = mk();
  try {
    writeEnabled(dir);
    writeStateNoSentinel(dir);
    const absPath = path.join(dir, "totally", "outside.js");
    const r = runGuard(dir, editPayload(dir, absPath));
    assert.equal(r.status, 0, "exit code MUST be 0 even on the inverted deny; got: " + r.status);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
