"use strict";
/* Tests for plugins/claudhd/scripts/drift-log.js (r-0729-1: log, don't deny). */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { logDrift, readDriftLog, clearDriftLog, driftLogPath } = require("../plugins/claudhd/scripts/drift-log.js");

function mk() { return fs.mkdtempSync(path.join(os.tmpdir(), "claudhd-drift-")); }

test("logDrift appends a record readable by readDriftLog", () => {
  const dir = mk();
  try {
    logDrift(dir, { ts: "2026-07-31T00:00:00Z", session: "s1", phase: 3, path: "src/a.js", tool: "Edit" });
    const recs = readDriftLog(dir);
    assert.equal(recs.length, 1);
    assert.equal(recs[0].path, "src/a.js");
    assert.equal(recs[0].phase, 3);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("logDrift dedupes by (session, path) but records a distinct path", () => {
  const dir = mk();
  try {
    logDrift(dir, { session: "s1", path: "src/a.js" });
    logDrift(dir, { session: "s1", path: "src/a.js" });
    assert.equal(readDriftLog(dir).length, 1, "same (session, path) records once");
    logDrift(dir, { session: "s1", path: "src/b.js" });
    assert.equal(readDriftLog(dir).length, 2, "a new path adds a line");
    logDrift(dir, { session: "s2", path: "src/a.js" });
    assert.equal(readDriftLog(dir).length, 3, "a different session for the same path is a distinct record");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("readDriftLog returns [] for an absent log and skips a torn line", () => {
  const dir = mk();
  try {
    assert.deepEqual(readDriftLog(dir), [], "absent log reads as empty");
    fs.mkdirSync(path.join(dir, ".now"), { recursive: true });
    fs.writeFileSync(driftLogPath(dir), '{"path":"ok"}\n{ this is not json\n{"path":"ok2"}\n');
    const recs = readDriftLog(dir);
    assert.equal(recs.length, 2, "a torn middle line is skipped, valid lines survive");
    assert.deepEqual(recs.map((r) => r.path), ["ok", "ok2"]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("clearDriftLog removes the log; a subsequent read is empty; clearing an absent log is a no-op", () => {
  const dir = mk();
  try {
    logDrift(dir, { session: "s1", path: "src/a.js" });
    assert.equal(readDriftLog(dir).length, 1);
    clearDriftLog(dir);
    assert.equal(readDriftLog(dir).length, 0, "the log is gone after clear");
    clearDriftLog(dir); // absent now - must not throw
    assert.equal(readDriftLog(dir).length, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("logging never throws on an unwritable .now path (best-effort)", () => {
  const dir = mk();
  try {
    // Make .now a FILE, so mkdirSync/appendFileSync inside logDrift fail.
    fs.writeFileSync(path.join(dir, ".now"), "not a directory");
    assert.doesNotThrow(() => logDrift(dir, { session: "s", path: "src/a.js" }));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
