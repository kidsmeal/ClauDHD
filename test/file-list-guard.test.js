"use strict";
/* Tests for plugins/claudhd/scripts/hooks/file-list-guard.js */
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

// Write a fixture sentinel into the `build` section of .now/state.json
// (schema v2; Gantry's sentinel folded in).
function writeSentinel(dir, overrides) {
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
  write(dir, ".now/state.json", JSON.stringify({ schemaVersion: 2, build: data }));
  return data;
}

// Write the .gantry/enabled marker under dir.
function writeEnabled(dir) {
  write(dir, ".gantry/enabled", "");
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

// --- allow cases: exit 0 + empty stdout ---

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

test("file-list-guard: allows when .gantry/enabled marker is absent (opt-in not set)", () => {
  const dir = mk();
  try {
    // No writeEnabled() call - marker absent
    writeSentinel(dir, {});
    const absPath = path.join(dir, "src", "other.js");
    const r = runGuard(dir, editPayload(dir, absPath));
    assert.equal(r.status, 0, "exit code must be 0 when enabled marker is absent\nstderr: " + r.stderr);
    assert.equal(r.stdout.trim(), "", "stdout must be empty when guard is inactive");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("file-list-guard: allows when no sentinel file exists", () => {
  const dir = mk();
  try {
    writeEnabled(dir);
    // No sentinel written
    const absPath = path.join(dir, "src", "other.js");
    const r = runGuard(dir, editPayload(dir, absPath));
    assert.equal(r.status, 0, "exit code must be 0 when no sentinel exists\nstderr: " + r.stderr);
    assert.equal(r.stdout.trim(), "", "stdout must be empty when no sentinel");
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

// --- deny case ---

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

// --- fail-open cases: missing/malformed input ---

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

test("file-list-guard: fail-open (exit 0) for malformed sentinel JSON", () => {
  const dir = mk();
  try {
    writeEnabled(dir);
    // Write a malformed state.json (the sentinel's home since schema v2).
    write(dir, ".now/state.json", "{ broken json");
    const absPath = path.join(dir, "src", "other.js");
    const r = runGuard(dir, editPayload(dir, absPath));
    assert.equal(r.status, 0, "exit code must be 0 for malformed sentinel\nstderr: " + r.stderr);
    assert.equal(r.stdout.trim(), "", "stdout must be empty when sentinel is malformed (fail-open)");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("file-list-guard: fail-open (exit 0) when GANTRY_PROJECT_DIR is unresolvable (empty root)", () => {
  const dir = mk();
  try {
    writeEnabled(dir);
    writeSentinel(dir, {});
    const absPath = path.join(dir, "src", "other.js");
    const payload = editPayload(dir, absPath);
    // Run with empty GANTRY_PROJECT_DIR - resolveRoot will fall back to cwd which
    // won't have a sentinel, so the guard should fail open.
    const r = spawnSync(process.execPath, [GUARD], {
      encoding: "utf8",
      input: JSON.stringify(payload),
      env: { ...process.env, CLAUDHD_PROJECT_DIR: "", GANTRY_PROJECT_DIR: "", CLAUDE_PROJECT_DIR: "" },
    });
    assert.equal(r.status, 0, "exit code must be 0 with unresolvable root\nstderr: " + r.stderr);
    // No deny expected since there is no sentinel in cwd.
    assert.equal(r.stdout.trim(), "", "stdout must be empty with unresolvable root");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// --- exit code is always 0 (even on deny) ---

test("file-list-guard: exit code is always 0 even when producing deny JSON", () => {
  const dir = mk();
  try {
    writeEnabled(dir);
    writeSentinel(dir, {});
    const absPath = path.join(dir, "totally", "outside.js");
    const r = runGuard(dir, editPayload(dir, absPath));
    assert.equal(r.status, 0, "exit code MUST be 0 even on deny; got: " + r.status);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
