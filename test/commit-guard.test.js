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

function writeSentinel(dir, overrides) {
  const base = {
    plan: "docs/plan.md",
    phase: 3,
    files: ["plugins/claudhd/scripts/hooks/commit-guard.js"],
    allow: ["docs/plan.md"],
    started: new Date().toISOString(),
    session: "session-test-123",
  };
  const data = Object.assign({}, base, overrides);
  write(dir, ".gantry/active-phase.json", JSON.stringify(data));
  return data;
}

function writeEnabled(dir) {
  write(dir, ".gantry/enabled", "");
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

// --- deny cases ---

test("commit-guard: denies git commit -m x", () => {
  const dir = mk();
  try {
    writeEnabled(dir);
    writeSentinel(dir, {});
    const r = runGuard(dir, bashPayload(dir, "git commit -m x"));
    assert.equal(r.status, 0, "exit code must be 0 even on deny\nstderr: " + r.stderr);
    const deny = parseDeny(r.stdout);
    assert.ok(deny !== null, "stdout should be parseable deny JSON; got: " + r.stdout);
    assert.equal(deny.hookSpecificOutput.permissionDecision, "deny");
    assert.equal(deny.hookSpecificOutput.hookEventName, "PreToolUse");
    assert.match(deny.hookSpecificOutput.permissionDecisionReason, /commit gate/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("commit-guard: denies git push", () => {
  const dir = mk();
  try {
    writeEnabled(dir);
    writeSentinel(dir, {});
    const r = runGuard(dir, bashPayload(dir, "git push"));
    assert.equal(r.status, 0, "exit code must be 0 even on deny\nstderr: " + r.stderr);
    const deny = parseDeny(r.stdout);
    assert.ok(deny !== null, "stdout should be parseable deny JSON; got: " + r.stdout);
    assert.equal(deny.hookSpecificOutput.permissionDecision, "deny");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("commit-guard: denies git commit after && (foo && git commit ...)", () => {
  const dir = mk();
  try {
    writeEnabled(dir);
    writeSentinel(dir, {});
    const r = runGuard(dir, bashPayload(dir, "foo && git commit -m msg"));
    assert.equal(r.status, 0, "exit code must be 0\nstderr: " + r.stderr);
    const deny = parseDeny(r.stdout);
    assert.ok(deny !== null, "should deny git commit after &&; got: " + r.stdout);
    assert.equal(deny.hookSpecificOutput.permissionDecision, "deny");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("commit-guard: denies git push after ; (x; git push)", () => {
  const dir = mk();
  try {
    writeEnabled(dir);
    writeSentinel(dir, {});
    const r = runGuard(dir, bashPayload(dir, "x; git push"));
    assert.equal(r.status, 0, "exit code must be 0\nstderr: " + r.stderr);
    const deny = parseDeny(r.stdout);
    assert.ok(deny !== null, "should deny git push after semicolon; got: " + r.stdout);
    assert.equal(deny.hookSpecificOutput.permissionDecision, "deny");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("commit-guard: denies git commit inside subshell ( git commit )", () => {
  const dir = mk();
  try {
    writeEnabled(dir);
    writeSentinel(dir, {});
    const r = runGuard(dir, bashPayload(dir, "( git commit -m x )"));
    assert.equal(r.status, 0, "exit code must be 0\nstderr: " + r.stderr);
    const deny = parseDeny(r.stdout);
    assert.ok(deny !== null, "should deny git commit inside subshell; got: " + r.stdout);
    assert.equal(deny.hookSpecificOutput.permissionDecision, "deny");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("commit-guard: denies git -C ./sub commit", () => {
  const dir = mk();
  try {
    writeEnabled(dir);
    writeSentinel(dir, {});
    const r = runGuard(dir, bashPayload(dir, "git -C ./sub commit -m x"));
    assert.equal(r.status, 0, "exit code must be 0\nstderr: " + r.stderr);
    const deny = parseDeny(r.stdout);
    assert.ok(deny !== null, "should deny git -C ./sub commit; got: " + r.stdout);
    assert.equal(deny.hookSpecificOutput.permissionDecision, "deny");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

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

test("commit-guard: exit code is always 0 even when denying", () => {
  const dir = mk();
  try {
    writeEnabled(dir);
    writeSentinel(dir, {});
    const r = runGuard(dir, bashPayload(dir, "git push origin main"));
    assert.equal(r.status, 0, "exit code MUST be 0 even on deny; got: " + r.status);
    const deny = parseDeny(r.stdout);
    assert.ok(deny !== null, "should have produced deny JSON");
    assert.equal(deny.hookSpecificOutput.permissionDecision, "deny");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// --- deny message content check ---

test("commit-guard: deny message references phase number and commit gate", () => {
  const dir = mk();
  try {
    writeEnabled(dir);
    writeSentinel(dir, { phase: 3 });
    const r = runGuard(dir, bashPayload(dir, "git commit -m test"));
    const deny = parseDeny(r.stdout);
    assert.ok(deny !== null, "should produce deny JSON");
    const reason = deny.hookSpecificOutput.permissionDecisionReason;
    assert.match(reason, /3/, "reason should mention the phase number");
    assert.match(reason, /commit gate/, "reason should mention commit gate");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
