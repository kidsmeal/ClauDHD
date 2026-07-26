"use strict";
/*
 * Tests for /claudhd:shipped first-run behavior and idempotence, plus (phase
 * 4) appendEntry() - the shared entry-writer path reconcile.js calls at the
 * commit boundary.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { makeRepo, cleanup, run, read, write, exists, optIn } = require("../tools/helpers.js");
const { appendEntry, entryKey, recordedHashlessCounts } = require("../plugins/claudhd/scripts/shipped.js");

// Matches reconcile.js's todayDate() exactly (LOCAL date, not toISOString's
// UTC) - the CLI's own git log --date=short also renders in local time, so
// using UTC here would drift by a day near midnight in non-UTC timezones and
// break the occurrence-aware, date-scoped dedupe under test below.
function localDate() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

test("shipped exits without creating SHIPPED.md when NOW.md is missing", () => {
  const { dir, git } = makeRepo();
  try {
    write(dir, "README.md", "# app\n");
    git(["add", "README.md"]);
    git(["commit", "-q", "-m", "initial"]);

    const r = run(dir, "shipped.js");
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /not a ClauDHD project/);
    assert.ok(!exists(dir, "SHIPPED.md"), "SHIPPED.md should not be created in a non-ClauDHD repo");
  } finally { cleanup(dir); }
});

test("shipped exits without creating SHIPPED.md when NOW.md lacks the claudhd marker", () => {
  const { dir, git } = makeRepo();
  try {
    write(dir, "NOW.md", "# NOW\n\n## Active thread\n\nsome work\n");
    git(["add", "NOW.md"]);
    git(["commit", "-q", "-m", "initial"]);

    const r = run(dir, "shipped.js");
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /not a ClauDHD project/);
    assert.ok(!exists(dir, "SHIPPED.md"), "SHIPPED.md should not be created");
  } finally { cleanup(dir); }
});

test("shipped starts tracking from current HEAD on first run", () => {
  const { dir, git } = makeRepo();
  try {
    optIn(dir, git);
    write(dir, "README.md", "# app\n");
    git(["add", "README.md"]);
    git(["commit", "-q", "-m", "initial"]);

    const r = run(dir, "shipped.js");
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /started from here/);
    const shipped = read(dir, "SHIPPED.md");
    assert.match(shipped, /<!-- last-sha: [0-9a-f]{40} -->/);
    assert.doesNotMatch(shipped, /initial/);
  } finally { cleanup(dir); }
});

test("shipped logs only commits after the first-run marker", () => {
  const { dir, git } = makeRepo();
  try {
    optIn(dir, git);
    write(dir, "README.md", "# app\n");
    git(["add", "README.md"]);
    git(["commit", "-q", "-m", "initial"]);
    run(dir, "shipped.js");

    write(dir, "feature.txt", "done\n");
    git(["add", "feature.txt"]);
    git(["commit", "-q", "-m", "finish feature"]);

    const r = run(dir, "shipped.js");
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Logged 1 shipped item/);
    const shipped = read(dir, "SHIPPED.md");
    assert.match(shipped, /finish feature/);
    assert.doesNotMatch(shipped, /- initial/);

    const again = run(dir, "shipped.js");
    assert.match(again.stdout, /up to date/);
  } finally { cleanup(dir); }
});

// --- appendEntry: reconcile.js's shared entry-writer path (phase 4) --------

test("appendEntry writes a message+date entry with no hash", () => {
  const { dir } = makeRepo();
  try {
    appendEntry(dir, "phase 4 shipped", "2026-07-26");
    const shipped = read(dir, "SHIPPED.md");
    assert.match(shipped, /### 2026-07-26/);
    assert.match(shipped, /-\s*phase 4 shipped/);
    assert.doesNotMatch(shipped, /`[0-9a-f]{7,40}`/, "a reconcile-written entry never carries a commit hash");
  } finally { cleanup(dir); }
});

test("appendEntry creates SHIPPED.md from the standard header when absent", () => {
  const { dir } = makeRepo();
  try {
    assert.ok(!exists(dir, "SHIPPED.md"));
    appendEntry(dir, "first ship", "2026-07-26");
    assert.ok(exists(dir, "SHIPPED.md"));
    const shipped = read(dir, "SHIPPED.md");
    assert.match(shipped, /^# SHIPPED/);
    assert.match(shipped, /first ship/);
  } finally { cleanup(dir); }
});

test("appendEntry: two entries on the same date share one heading, newest first", () => {
  const { dir } = makeRepo();
  try {
    appendEntry(dir, "first commit", "2026-07-26");
    appendEntry(dir, "second commit", "2026-07-26");
    const shipped = read(dir, "SHIPPED.md");
    const headingCount = (shipped.match(/### 2026-07-26/g) || []).length;
    assert.equal(headingCount, 1, "same-day entries join one heading, not a duplicate");
    assert.ok(shipped.indexOf("second commit") < shipped.indexOf("first commit"),
      "the most recent entry sits above the older one within the same day");
  } finally { cleanup(dir); }
});

test("appendEntry: a later date opens a new heading above the previous day's", () => {
  const { dir } = makeRepo();
  try {
    appendEntry(dir, "yesterday's work", "2026-07-25");
    appendEntry(dir, "today's work", "2026-07-26");
    const shipped = read(dir, "SHIPPED.md");
    assert.ok(shipped.indexOf("### 2026-07-26") < shipped.indexOf("### 2026-07-25"),
      "the newer date heading sits above the older one");
  } finally { cleanup(dir); }
});

test("recordedHashlessCounts counts only hashless (reconcile-written) bullets, keyed by date + subject", () => {
  const body = [
    "### 2026-07-26",
    "- reconciled at the commit boundary",
    "- scanned by the CLI (`abc1234`)",
  ].join("\n");
  const counts = recordedHashlessCounts(body);
  assert.equal(counts.get(entryKey("2026-07-26", "reconciled at the commit boundary")), 1,
    "the hashless bullet counts");
  assert.equal(counts.get(entryKey("2026-07-26", "scanned by the CLI")), undefined,
    "a hashed (CLI-written) bullet is never counted as an already-reconciled entry");
});

test("recordedHashlessCounts counts N occurrences of the same (date, subject) key, for occurrence-aware matching", () => {
  const body = [
    "### 2026-07-26",
    "- duplicate subject",
    "- duplicate subject",
    "- duplicate subject (`abc1234`)",
  ].join("\n");
  const counts = recordedHashlessCounts(body);
  assert.equal(counts.get(entryKey("2026-07-26", "duplicate subject")), 2,
    "two hashless entries for the same key, the hashed third one excluded");
});

test("recordedHashlessCounts scopes matching to date - the same subject on a different day is a distinct key", () => {
  const body = [
    "### 2026-07-25",
    "- same subject",
    "### 2026-07-26",
  ].join("\n");
  const counts = recordedHashlessCounts(body);
  assert.equal(counts.get(entryKey("2026-07-25", "same subject")), 1);
  assert.equal(counts.get(entryKey("2026-07-26", "same subject")), undefined);
});

// --- interop: the CLI must not re-log what reconcile already recorded -----

test("shipped CLI dedupes against a reconcile-written entry (by subject) and still logs a genuinely uncovered commit", () => {
  const { dir, git } = makeRepo();
  try {
    optIn(dir, git);
    const first = run(dir, "shipped.js"); // stamps the marker at "init claudhd", logs nothing
    assert.match(first.stdout, /started from here/);

    // Commit A: reconcile.js already recorded this one at the commit
    // boundary (message+date, no hash) before the commit landed.
    appendEntry(dir, "feature one shipped", localDate());
    write(dir, "one.txt", "a\n");
    git(["add", "one.txt"]);
    git(["commit", "-q", "-m", "feature one shipped"]);

    // Commit B: genuinely never reconciled (e.g. made outside a session -
    // test/reconcile.test.js's known limit).
    write(dir, "two.txt", "b\n");
    git(["add", "two.txt"]);
    git(["commit", "-q", "-m", "feature two shipped"]);

    const r = run(dir, "shipped.js");
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Logged 1 shipped item/, "only the genuinely uncovered commit is logged");

    const shipped = read(dir, "SHIPPED.md");
    const occurrences = (shipped.match(/feature one shipped/g) || []).length;
    assert.equal(occurrences, 1, "the reconcile-covered commit is not duplicated");
    assert.match(shipped, /feature two shipped\s*\(`[0-9a-f]{7,40}`\)/, "the genuinely uncovered commit still gets added, with its hash");

    const again = run(dir, "shipped.js");
    assert.match(again.stdout, /up to date/, "the marker advanced, so a re-run finds nothing left");
  } finally { cleanup(dir); }
});

test("shipped CLI: two same-subject commits where only ONE was reconciled - the CLI still logs the uncovered one exactly once (occurrence-aware, not a plain set)", () => {
  const { dir, git } = makeRepo();
  try {
    optIn(dir, git);
    run(dir, "shipped.js"); // stamps the marker, logs nothing

    // Exactly one reconcile-written (hashless) entry for this subject.
    appendEntry(dir, "duplicate subject", localDate());

    // Two REAL commits share that same subject; only one of them was ever
    // actually reconciled (the other is, e.g., outside a session - the
    // known limit) - a plain subject-set dedupe would wrongly treat BOTH as
    // covered and silently lose the second commit's ship record.
    write(dir, "a.txt", "1\n");
    git(["add", "a.txt"]);
    git(["commit", "-q", "-m", "duplicate subject"]);

    write(dir, "b.txt", "2\n");
    git(["add", "b.txt"]);
    git(["commit", "-q", "-m", "duplicate subject"]);

    const r = run(dir, "shipped.js");
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Logged 1 shipped item/, "exactly one of the two same-subject commits is genuinely uncovered");

    const shipped = read(dir, "SHIPPED.md");
    const hashlessCount = (shipped.match(/^-\s*duplicate subject\s*$/gm) || []).length;
    const hashedCount = (shipped.match(/^-\s*duplicate subject\s*\(`[0-9a-f]{7,40}`\)\s*$/gm) || []).length;
    assert.equal(hashlessCount, 1, "the one reconcile-written entry survives, untouched");
    assert.equal(hashedCount, 1, "the genuinely uncovered commit is logged exactly once, with its hash - not lost, not duplicated");
  } finally { cleanup(dir); }
});

test("shipped CLI, when every commit since the marker was already reconciled, still advances the marker and reports up to date", () => {
  const { dir, git } = makeRepo();
  try {
    optIn(dir, git);
    run(dir, "shipped.js");

    appendEntry(dir, "fully reconciled commit", localDate());
    write(dir, "only.txt", "a\n");
    git(["add", "only.txt"]);
    git(["commit", "-q", "-m", "fully reconciled commit"]);

    const r = run(dir, "shipped.js");
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /up to date/);

    const occurrences = (read(dir, "SHIPPED.md").match(/fully reconciled commit/g) || []).length;
    assert.equal(occurrences, 1, "still not duplicated");

    const again = run(dir, "shipped.js");
    assert.match(again.stdout, /up to date/, "the marker advanced even though nothing new was logged");
  } finally { cleanup(dir); }
});
