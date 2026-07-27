"use strict";
/* Tests for plugins/claudhd/scripts/override.js */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const override = require("../plugins/claudhd/scripts/override.js");
const { readState, writeStateAtomic } = require("../plugins/claudhd/scripts/state.js");
const { render } = require("../plugins/claudhd/scripts/nowrender.js");

function mk() { return fs.mkdtempSync(path.join(os.tmpdir(), "claudhd-override-")); }

// Real-input NOW.md: nowrender.render({}), the same generator init.js and the
// reconcile actually call - not a hand-rolled fixture that could drift from
// the real "## Loose ends" heading/placeholder shape.
function writeRealNow(dir) {
  fs.writeFileSync(path.join(dir, "NOW.md"), render({}));
}

test("override.js: recordOverride writes state.json's own `override` key", () => {
  const dir = mk();
  try {
    writeRealNow(dir);
    const record = override.recordOverride(dir, "session-abc-123");
    assert.equal(record.session, "session-abc-123");
    assert.deepEqual(record.files, []);
    assert.equal(typeof record.startedAt, "string");

    const state = readState(path.join(dir, ".now"));
    assert.ok(state, "state.json must exist after recordOverride");
    assert.equal(state.override.session, "session-abc-123");
    assert.deepEqual(state.override.files, []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("override.js: recordOverride never clobbers other state.json keys (merge-preserving writer)", () => {
  const dir = mk();
  try {
    writeRealNow(dir);
    writeStateAtomic(path.join(dir, ".now"), { mode: "design", schemaVersion: 2 }, ["mode"]);
    override.recordOverride(dir, "session-1");
    const state = readState(path.join(dir, ".now"));
    assert.equal(state.mode, "design", "an unrelated owned key must survive the override write");
    assert.ok(state.override);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("override.js: recordOverride for the SAME session preserves an already-accumulated files list", () => {
  const dir = mk();
  try {
    writeRealNow(dir);
    const nowDir = path.join(dir, ".now");
    writeStateAtomic(nowDir, { override: { session: "session-1", files: ["a.js", "b.js"], startedAt: "2026-01-01T00:00:00.000Z" } }, ["override"]);
    const record = override.recordOverride(dir, "session-1");
    assert.deepEqual(record.files, ["a.js", "b.js"], "re-affirming the same session must not reset its accumulated files");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("override.js: recordOverride for a DIFFERENT session replaces the single active-override slot", () => {
  const dir = mk();
  try {
    writeRealNow(dir);
    const nowDir = path.join(dir, ".now");
    writeStateAtomic(nowDir, { override: { session: "session-1", files: ["a.js", "b.js"], startedAt: "2026-01-01T00:00:00.000Z" } }, ["override"]);
    const record = override.recordOverride(dir, "session-2");
    assert.equal(record.session, "session-2");
    assert.deepEqual(record.files, [], "a new session starts a fresh count, not the old session's files");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("override.js: the recorded override is visible, loud, in the rendered NOW.md's Loose ends section", () => {
  const dir = mk();
  try {
    writeRealNow(dir);
    override.recordOverride(dir, "session-abcdefgh-123");
    const now = fs.readFileSync(path.join(dir, "NOW.md"), "utf8");
    assert.match(now, /## Loose ends/);
    assert.match(now, /unguarded session session-/i);
    assert.match(now, /0 files outside any phase/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("override.js: the loud NOW.md line's count tracks noteOverrideFile's REAL accumulation, no hand-seeded state", () => {
  const dir = mk();
  try {
    writeRealNow(dir);
    override.recordOverride(dir, "session-1");
    // The real accumulation path (the same one both guards call), not a
    // hand-written writeStateAtomic seed.
    override.noteOverrideFile(dir, "session-1", "src/a.js");
    override.noteOverrideFile(dir, "session-1", "src/b.js");
    override.noteOverrideFile(dir, "session-1", "src/c.js");
    const now = fs.readFileSync(path.join(dir, "NOW.md"), "utf8");
    assert.match(now, /3 files outside any phase/);
    const state = readState(path.join(dir, ".now"));
    assert.deepEqual(state.override.files, ["src/a.js", "src/b.js", "src/c.js"]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// --- noteOverrideFile (the guards' own call) ---

test("override.js: noteOverrideFile returns false and writes nothing when there is no active override for the session", () => {
  const dir = mk();
  try {
    writeRealNow(dir);
    const before = fs.readFileSync(path.join(dir, "NOW.md"), "utf8");
    const applied = override.noteOverrideFile(dir, "no-such-session", "src/a.js");
    assert.equal(applied, false);
    assert.ok(!fs.existsSync(path.join(dir, ".now", "state.json")), "no override was ever recorded, so nothing should be written");
    assert.equal(fs.readFileSync(path.join(dir, "NOW.md"), "utf8"), before, "NOW.md must be untouched");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("override.js: noteOverrideFile does not duplicate an already-recorded path", () => {
  const dir = mk();
  try {
    writeRealNow(dir);
    override.recordOverride(dir, "session-1");
    override.noteOverrideFile(dir, "session-1", "src/a.js");
    override.noteOverrideFile(dir, "session-1", "src/a.js"); // repeat
    const state = readState(path.join(dir, ".now"));
    assert.deepEqual(state.override.files, ["src/a.js"]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("override.js: noteOverrideFile never clobbers other state.json keys either", () => {
  const dir = mk();
  try {
    writeRealNow(dir);
    writeStateAtomic(path.join(dir, ".now"), { mode: "build", schemaVersion: 2 }, ["mode"]);
    override.recordOverride(dir, "session-1");
    override.noteOverrideFile(dir, "session-1", "src/a.js");
    const state = readState(path.join(dir, ".now"));
    assert.equal(state.mode, "build");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("override.js: a second override for a different session does not leave two stale lines behind", () => {
  const dir = mk();
  try {
    writeRealNow(dir);
    // Distinct first-8-char prefixes (overrideLine() truncates the session id
    // to 8 chars), so this exercises "different session" rather than an
    // incidental short-id collision.
    override.recordOverride(dir, "sess-one-111");
    override.recordOverride(dir, "sess-two-222");
    const now = fs.readFileSync(path.join(dir, "NOW.md"), "utf8");
    const matches = now.match(/unguarded session/gi) || [];
    assert.equal(matches.length, 1, "only the current session's line should be present: " + now);
    assert.match(now, /sess-two/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("override.js: missing NOW.md is a no-op for the loud note but state.json still records the override", () => {
  const dir = mk();
  try {
    // No NOW.md written.
    const record = override.recordOverride(dir, "session-1");
    assert.equal(record.session, "session-1");
    const state = readState(path.join(dir, ".now"));
    assert.equal(state.override.session, "session-1");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// --- CLI ---

test("override.js CLI: recording with no resolvable session id exits non-zero and prints an error", () => {
  const { spawnSync } = require("node:child_process");
  const dir = mk();
  try {
    writeRealNow(dir);
    const SCRIPT = path.join(__dirname, "..", "plugins", "claudhd", "scripts", "override.js");
    const r = spawnSync(process.execPath, [SCRIPT], {
      encoding: "utf8",
      env: { ...process.env, GANTRY_PROJECT_DIR: dir, GANTRY_SESSION_ID: "", CLAUDE_CODE_SESSION_ID: "" },
    });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /no session id/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("override.js CLI: an explicit argv session id records the override", () => {
  const { spawnSync } = require("node:child_process");
  const dir = mk();
  try {
    writeRealNow(dir);
    const SCRIPT = path.join(__dirname, "..", "plugins", "claudhd", "scripts", "override.js");
    const r = spawnSync(process.execPath, [SCRIPT, "cli-session-42"], {
      encoding: "utf8",
      env: { ...process.env, GANTRY_PROJECT_DIR: dir },
    });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /recorded unguarded session/);
    const state = readState(path.join(dir, ".now"));
    assert.equal(state.override.session, "cli-session-42");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
