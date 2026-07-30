"use strict";
/*
 * Tests for readStateResult() and the `state.js read --json <project-root>`
 * CLI subcommand (phase 1 of object_permanence_v2). readState()'s own
 * behavior is pinned by test/state.test.js and test/state-v2.test.js, which
 * this suite does not touch - it only covers the new six-status result.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { readStateResult } = require("../plugins/claudhd/scripts/state.js");
const { run } = require("../tools/helpers.js");

function mk() { return fs.mkdtempSync(path.join(os.tmpdir(), "claudhd-state-result-")); }

function writeState(nowDir, contents) {
  fs.mkdirSync(nowDir, { recursive: true });
  fs.writeFileSync(path.join(nowDir, "state.json"), contents);
}

// Asserts the CLI printed exactly one JSON object on stdout, exited zero, and
// that the parsed object's status matches. Returns the parsed object so a
// caller can assert further (e.g. `reason`, `version`).
function assertCli(dir, expectedStatus) {
  const r = run(dir, "state.js", ["read", "--json", dir]);
  assert.equal(r.status, 0, "every one of the six statuses is a data result, not a usage error: " + r.stderr);
  const lines = r.stdout.split(/\r?\n/).filter((l) => l.length > 0);
  assert.equal(lines.length, 1, "stdout must carry exactly one line");
  let parsed;
  assert.doesNotThrow(() => { parsed = JSON.parse(lines[0]); }, "stdout line must be exactly one JSON object");
  assert.equal(typeof parsed, "object");
  assert.ok(parsed && !Array.isArray(parsed));
  assert.equal(parsed.status, expectedStatus);
  return parsed;
}

// --- absent -----------------------------------------------------------------

test("readStateResult: absent when .now/state.json does not exist", () => {
  const dir = mk();
  try {
    const nowDir = path.join(dir, ".now");
    const r = readStateResult(nowDir);
    assert.deepEqual(r, { status: "absent" });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("CLI: absent exits zero with one JSON object", () => {
  const dir = mk();
  try {
    assertCli(dir, "absent");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// --- unreadable ---------------------------------------------------------------

test("readStateResult: unreadable (a directory at the state.json path), distinguished from absent by the error code", () => {
  const dir = mk();
  try {
    const nowDir = path.join(dir, ".now");
    fs.mkdirSync(path.join(nowDir, "state.json"), { recursive: true });
    const r = readStateResult(nowDir);
    assert.equal(r.status, "unreadable");
    assert.equal(typeof r.reason, "string");
    assert.ok(r.reason.length > 0);
    assert.notEqual(r.reason, undefined);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("CLI: unreadable exits zero with one JSON object and a reason", () => {
  const dir = mk();
  try {
    const nowDir = path.join(dir, ".now");
    fs.mkdirSync(path.join(nowDir, "state.json"), { recursive: true });
    const parsed = assertCli(dir, "unreadable");
    assert.equal(typeof parsed.reason, "string");
    assert.ok(parsed.reason.length > 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// --- malformed ----------------------------------------------------------------

test("readStateResult: malformed on invalid JSON", () => {
  const dir = mk();
  try {
    const nowDir = path.join(dir, ".now");
    writeState(nowDir, "{ not json");
    const r = readStateResult(nowDir);
    assert.equal(r.status, "malformed");
    assert.equal(typeof r.reason, "string");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("readStateResult: malformed on a top-level array, not a valid object", () => {
  const dir = mk();
  try {
    const nowDir = path.join(dir, ".now");
    writeState(nowDir, "[1, 2, 3]");
    const r = readStateResult(nowDir);
    assert.equal(r.status, "malformed");
    assert.equal(typeof r.reason, "string");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('readStateResult: malformed on schemaVersion as a string, "2"', () => {
  const dir = mk();
  try {
    const nowDir = path.join(dir, ".now");
    writeState(nowDir, JSON.stringify({ schemaVersion: "2" }));
    const r = readStateResult(nowDir);
    assert.equal(r.status, "malformed");
    assert.equal(typeof r.reason, "string");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("readStateResult: malformed on a non-integer schemaVersion, 2.5", () => {
  const dir = mk();
  try {
    const nowDir = path.join(dir, ".now");
    writeState(nowDir, JSON.stringify({ schemaVersion: 2.5 }));
    const r = readStateResult(nowDir);
    assert.equal(r.status, "malformed");
    assert.equal(typeof r.reason, "string");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("readStateResult: malformed on a present schemaVersion: null (distinct from the key being absent, which is v1)", () => {
  const dir = mk();
  try {
    const nowDir = path.join(dir, ".now");
    writeState(nowDir, JSON.stringify({ schemaVersion: null }));
    const r = readStateResult(nowDir);
    assert.equal(r.status, "malformed");
    assert.equal(typeof r.reason, "string");
    assert.ok(r.reason.length > 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("CLI: malformed exits zero with one JSON object and a reason (invalid JSON)", () => {
  const dir = mk();
  try {
    const nowDir = path.join(dir, ".now");
    writeState(nowDir, "{ not json");
    const parsed = assertCli(dir, "malformed");
    assert.equal(typeof parsed.reason, "string");
    assert.ok(parsed.reason.length > 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("CLI: malformed exits zero with one JSON object and a reason (top-level array)", () => {
  const dir = mk();
  try {
    const nowDir = path.join(dir, ".now");
    writeState(nowDir, "[1, 2, 3]");
    const parsed = assertCli(dir, "malformed");
    assert.equal(typeof parsed.reason, "string");
    assert.ok(parsed.reason.length > 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('CLI: malformed exits zero with one JSON object and a reason (schemaVersion: "2")', () => {
  const dir = mk();
  try {
    const nowDir = path.join(dir, ".now");
    writeState(nowDir, JSON.stringify({ schemaVersion: "2" }));
    const parsed = assertCli(dir, "malformed");
    assert.equal(typeof parsed.reason, "string");
    assert.ok(parsed.reason.length > 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("CLI: malformed exits zero with one JSON object and a reason (schemaVersion: 2.5)", () => {
  const dir = mk();
  try {
    const nowDir = path.join(dir, ".now");
    writeState(nowDir, JSON.stringify({ schemaVersion: 2.5 }));
    const parsed = assertCli(dir, "malformed");
    assert.equal(typeof parsed.reason, "string");
    assert.ok(parsed.reason.length > 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("CLI: malformed exits zero with one JSON object and a reason (schemaVersion: null)", () => {
  const dir = mk();
  try {
    const nowDir = path.join(dir, ".now");
    writeState(nowDir, JSON.stringify({ schemaVersion: null }));
    const parsed = assertCli(dir, "malformed");
    assert.equal(typeof parsed.reason, "string");
    assert.ok(parsed.reason.length > 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// --- v1 -------------------------------------------------------------------

test("readStateResult: v1 when schemaVersion is missing", () => {
  const dir = mk();
  try {
    const nowDir = path.join(dir, ".now");
    writeState(nowDir, JSON.stringify({ cursor: { activeThread: "a" } }));
    const r = readStateResult(nowDir);
    assert.equal(r.status, "v1");
    assert.equal(r.reason, undefined);
    assert.ok(r.state);
    assert.equal(r.state.mode, null, "the six-field normalization still applies to v1 state");
    assert.equal(r.state.build, null);
    assert.deepEqual(r.state.cursor, { activeThread: "a" });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("readStateResult: v1 when schemaVersion is the number 1", () => {
  const dir = mk();
  try {
    const nowDir = path.join(dir, ".now");
    writeState(nowDir, JSON.stringify({ schemaVersion: 1 }));
    const r = readStateResult(nowDir);
    assert.equal(r.status, "v1");
    assert.ok(r.state);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("CLI: v1 exits zero with one JSON object and no reason (schemaVersion missing)", () => {
  const dir = mk();
  try {
    const nowDir = path.join(dir, ".now");
    writeState(nowDir, JSON.stringify({ cursor: { activeThread: "a" } }));
    const parsed = assertCli(dir, "v1");
    assert.equal(parsed.reason, undefined);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("CLI: v1 exits zero with one JSON object and no reason (schemaVersion: 1)", () => {
  const dir = mk();
  try {
    const nowDir = path.join(dir, ".now");
    writeState(nowDir, JSON.stringify({ schemaVersion: 1 }));
    const parsed = assertCli(dir, "v1");
    assert.equal(parsed.reason, undefined);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// --- v2 -------------------------------------------------------------------

test("readStateResult: v2 when schemaVersion is the number 2, carrying the normalized state", () => {
  const dir = mk();
  try {
    const nowDir = path.join(dir, ".now");
    writeState(nowDir, JSON.stringify({ schemaVersion: 2, mode: "build", from: "r-0725-1" }));
    const r = readStateResult(nowDir);
    assert.equal(r.status, "v2");
    assert.equal(r.reason, undefined);
    assert.equal(r.state.mode, "build");
    assert.equal(r.state.from, "r-0725-1");
    assert.equal(r.state.design, null, "still normalized to null when absent");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("CLI: v2 exits zero with one JSON object and no reason", () => {
  const dir = mk();
  try {
    const nowDir = path.join(dir, ".now");
    writeState(nowDir, JSON.stringify({ schemaVersion: 2 }));
    const parsed = assertCli(dir, "v2");
    assert.equal(parsed.reason, undefined);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// --- future -----------------------------------------------------------------

test("readStateResult: future when schemaVersion is an integer above 2, reporting the version", () => {
  const dir = mk();
  try {
    const nowDir = path.join(dir, ".now");
    writeState(nowDir, JSON.stringify({ schemaVersion: 3 }));
    const r = readStateResult(nowDir);
    assert.equal(r.status, "future");
    assert.equal(r.version, 3);
    assert.equal(typeof r.reason, "string");
    assert.ok(r.reason.length > 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("CLI: future exits zero with one JSON object, a reason, and the version", () => {
  const dir = mk();
  try {
    const nowDir = path.join(dir, ".now");
    writeState(nowDir, JSON.stringify({ schemaVersion: 3 }));
    const parsed = assertCli(dir, "future");
    assert.equal(parsed.version, 3);
    assert.equal(typeof parsed.reason, "string");
    assert.ok(parsed.reason.length > 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// --- CLI usage errors (the one place a non-zero exit is correct) ------------

test("CLI: an unknown subcommand is a usage error, not a data status", () => {
  const dir = mk();
  try {
    const r = run(dir, "state.js", ["bogus"]);
    assert.notEqual(r.status, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("CLI: read without --json <project-root> is a usage error", () => {
  const dir = mk();
  try {
    const r = run(dir, "state.js", ["read"]);
    assert.notEqual(r.status, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// --- readStateResult reads once, never re-reads to explain a failure -------

test("readStateResult: only one fs.readFileSync call against state.json per invocation", () => {
  const dir = mk();
  try {
    const nowDir = path.join(dir, ".now");
    writeState(nowDir, JSON.stringify({ schemaVersion: 2 }));
    const target = path.join(nowDir, "state.json");
    const original = fs.readFileSync;
    let calls = 0;
    fs.readFileSync = (p, ...rest) => {
      if (path.resolve(String(p)) === path.resolve(target)) calls++;
      return original(p, ...rest);
    };
    try {
      readStateResult(nowDir);
    } finally {
      fs.readFileSync = original;
    }
    assert.equal(calls, 1, "readStateResult must read state.json exactly once, not call readState() and re-read");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
