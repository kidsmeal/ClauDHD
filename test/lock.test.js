"use strict";
/*
 * Deterministic tests for the cross-process lock (lock.js) that protects
 * IDEAS.md captures.
 *
 * These carry the real teeth: a process-level "fire N captures at once" test
 * can't reliably reproduce the microsecond read-modify-write race (process
 * startup stagger serializes the windows by luck), so it can pass even when the
 * lock is broken. Here we instead hold the lock for a long, fixed window and
 * assert two holders never overlap - a property that follows from the lock
 * working, not from timing. Without a real lock, both holders would ENTER before
 * either EXITs and the ordering assertion fails.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const FIXTURE = path.join(__dirname, "..", "tools", "hold-lock.js");

function holder(lockDir, id, holdMs, logFile) {
  return new Promise((resolve, reject) => {
    const c = spawn(process.execPath, [FIXTURE, lockDir, id, String(holdMs), logFile]);
    let stderr = "";
    c.stderr.on("data", (d) => (stderr += d));
    c.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`holder ${id} failed: ${stderr}`))));
  });
}

test("withLock serializes two processes (critical sections never overlap)", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "claudhd-lock-"));
  const lockDir = path.join(tmp, "the.lock");
  const log = path.join(tmp, "events.log");
  fs.writeFileSync(log, "");
  try {
    // Both started together, each holds for 200ms. The lock must force one to
    // run fully before the other starts.
    await Promise.all([
      holder(lockDir, "A", 200, log),
      holder(lockDir, "B", 200, log),
    ]);

    const ev = fs.readFileSync(log, "utf8").trim().split(/\r?\n/)
      .map((l) => { const [id, kind, ts] = l.split(" "); return { id, kind, ts: Number(ts) }; });

    assert.equal(ev.length, 4, `expected 4 events, got: ${ev.map((e) => e.id + e.kind).join(",")}`);
    // The sequence must be ENTER x, EXIT x, ENTER y, EXIT y (fully nested), with
    // x and y the two different holders.
    assert.equal(ev[0].kind, "ENTER");
    assert.equal(ev[1].kind, "EXIT");
    assert.equal(ev[1].id, ev[0].id, "first holder must EXIT before the second ENTERs (no overlap)");
    assert.equal(ev[2].kind, "ENTER");
    assert.equal(ev[3].kind, "EXIT");
    assert.equal(ev[3].id, ev[2].id);
    assert.notEqual(ev[0].id, ev[2].id, "the two holders should be distinct");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("withLock breaks a stale lock left by a crashed holder", () => {
  const { withLock } = require("../plugins/claudhd/scripts/lock.js");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "claudhd-stale-"));
  const lockDir = path.join(tmp, "stale.lock");
  try {
    fs.mkdirSync(lockDir, { recursive: true }); // a lock a dead process never released
    let ran = false;
    withLock(lockDir, () => { ran = true; }, { staleMs: 0, timeoutMs: 2000 });
    assert.ok(ran, "a stale lock must be broken so a new acquirer can run");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
