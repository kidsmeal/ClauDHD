"use strict";
/*
 * Tests for the branch-aware breadcrumbs (checkpoint.js + brief.js): per-branch
 * checkpoints, the brief following the current branch, and the drift flag
 * ignoring ClauDHD's own live files while still counting real work.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { makeRepo, cleanup, run, read, write, exists, nowFile, optIn } = require("../tools/helpers.js");

test("checkpoint writes a per-branch breadcrumb plus the global one", () => {
  const { dir, git } = makeRepo();
  try {
    optIn(dir, git, "main thread");
    const r = run(dir, "checkpoint.js");
    assert.equal(r.status, 0);
    assert.ok(exists(dir, path.join(".now", "branches", "main.md")), "expected .now/branches/main.md");
    assert.ok(exists(dir, path.join(".now", "last-session.md")), "expected .now/last-session.md");
  } finally { cleanup(dir); }
});

test("sanitizes slashes in branch names for the breadcrumb file", () => {
  const { dir, git } = makeRepo();
  try {
    optIn(dir, git, "main thread");
    git(["checkout", "-q", "-b", "feature/foo"]);
    run(dir, "checkpoint.js");
    assert.ok(exists(dir, path.join(".now", "branches", "feature-foo.md")),
      "feature/foo should map to feature-foo.md");
  } finally { cleanup(dir); }
});

test("checkpoint is a no-op without the ClauDHD opt-in marker", () => {
  const { dir, git } = makeRepo();
  try {
    // A NOW.md with no marker (someone else's file) must not trigger checkpoints.
    write(dir, "NOW.md", "# NOW\n\nunrelated project notes\n");
    git(["add", "NOW.md"]);
    git(["commit", "-q", "-m", "unrelated"]);
    run(dir, "checkpoint.js");
    assert.equal(exists(dir, ".now"), false, ".now/ should not be created in a non-ClauDHD repo");
  } finally { cleanup(dir); }
});

test("brief follows the current branch after a switch", () => {
  const { dir, git } = makeRepo();
  try {
    optIn(dir, git, "main thread");
    run(dir, "checkpoint.js");

    git(["checkout", "-q", "-b", "feat/login"]);
    write(dir, "NOW.md", nowFile("login thread"));
    git(["commit", "-q", "-am", "login cursor"]);
    run(dir, "checkpoint.js");

    git(["checkout", "-q", "main"]); // git swaps the committed NOW.md back
    const r = run(dir, "brief.js", ["--plain"]);
    assert.match(r.stdout, /on `main`/);
    assert.match(r.stdout, /main thread/);
    assert.doesNotMatch(r.stdout, /login thread/);
  } finally { cleanup(dir); }
});

test("drift flag ignores own files but counts real work", () => {
  const { dir, git } = makeRepo();
  try {
    optIn(dir, git, "main thread");

    // Only NOW.md dirty -> a live cursor is not drift.
    fs.appendFileSync(path.join(dir, "NOW.md"), "\nedit\n");
    let r = run(dir, "brief.js", ["--plain"]);
    assert.doesNotMatch(r.stdout, /uncommitted path/, "NOW.md alone should not flag drift");

    // Real work appears -> flagged, and NOW.md is still excluded from the count.
    write(dir, "src.txt", "x");
    r = run(dir, "brief.js", ["--plain"]);
    assert.match(r.stdout, /1 uncommitted path/);
  } finally { cleanup(dir); }
});

test("brief is silent (no context) in a non-ClauDHD repo", () => {
  const { dir } = makeRepo();
  try {
    const r = run(dir, "brief.js"); // hook mode, no --plain
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), "");
  } finally { cleanup(dir); }
});
