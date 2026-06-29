"use strict";
/*
 * Tests for the active-thread staleness flag (brief.js).
 *
 * The mtime / CURSOR_STALE_HOURS check only sees the file, so a NOW.md kept fresh
 * by an ever-growing header narrative hides an active-thread pointer that has been
 * stale for weeks. brief.js tracks the thread by its own identity (the first bold
 * name) + first-seen in .now/active-thread.json and flags one that overstays. The
 * clock resets when a different thread is promoted.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { makeRepo, cleanup, run, optIn, read } = require("../tools/helpers.js");
const { ACTIVE_THREAD_STALE_DAYS } = require("../plugins/claudhd/scripts/constants.js");

const DAY = 86400000;

// Seed .now/active-thread.json with a known key + age so the flag is deterministic
// without waiting real days.
function seedStamp(dir, key, agedDays) {
  const nowDir = path.join(dir, ".now");
  fs.mkdirSync(nowDir, { recursive: true });
  fs.writeFileSync(
    path.join(nowDir, "active-thread.json"),
    JSON.stringify({ key, since: Date.now() - agedDays * DAY })
  );
}

test("flags an active thread that has overstayed its welcome", () => {
  const { dir, git } = makeRepo();
  try {
    optIn(dir, git, "long running campaign");
    seedStamp(dir, "long running campaign", ACTIVE_THREAD_STALE_DAYS + 6);
    const r = run(dir, "brief.js", ["--plain"]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /## Drift flags/);
    assert.match(r.stdout, /Active thread "long running campaign" has been active for \d+ days/);
    assert.match(r.stdout, /\/claudhd:wrap/, "should point at the wrap ritual to close it");
  } finally { cleanup(dir); }
});

test("does not flag a thread still inside the window", () => {
  const { dir, git } = makeRepo();
  try {
    optIn(dir, git, "fresh thread");
    seedStamp(dir, "fresh thread", 1);
    const r = run(dir, "brief.js", ["--plain"]);
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stdout, /has been active for/, "a fresh thread must not be flagged");
  } finally { cleanup(dir); }
});

test("resets the clock when a different thread is promoted", () => {
  const { dir, git } = makeRepo();
  try {
    // NOW.md names a NEW thread, but the stored stamp is an OLD, long-stale one.
    optIn(dir, git, "the new thread");
    seedStamp(dir, "the old thread", ACTIVE_THREAD_STALE_DAYS + 30);
    const r = run(dir, "brief.js", ["--plain"]);
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stdout, /has been active for/, "a just-promoted thread must not inherit the old clock");
    // The stamp was rewritten to the new thread with a fresh start.
    const stamp = JSON.parse(read(dir, ".now/active-thread.json"));
    assert.equal(stamp.key, "the new thread");
    assert.ok(Date.now() - stamp.since < 5 * 1000, "since should be reset to ~now");
  } finally { cleanup(dir); }
});

test("first run on an already-stale thread starts the clock fresh (no immediate flag)", () => {
  const { dir, git } = makeRepo();
  try {
    // No stored stamp at all: brief.js must bootstrap it at now, not flag instantly.
    optIn(dir, git, "pre-existing thread");
    const r = run(dir, "brief.js", ["--plain"]);
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stdout, /has been active for/, "bootstrap run must not flag on first sight");
    const stamp = JSON.parse(read(dir, ".now/active-thread.json"));
    assert.equal(stamp.key, "pre-existing thread");
  } finally { cleanup(dir); }
});
