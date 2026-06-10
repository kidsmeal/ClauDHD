"use strict";
/*
 * Dedicated tests for checkpoint.js behavior: happy path, no NOW.md,
 * no claudhd marker, missing Active thread section, and detached HEAD.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { makeRepo, cleanup, run, write, exists, optIn } = require("../tools/helpers.js");

test("happy path: breadcrumb written with active thread name", () => {
  const { dir, git } = makeRepo();
  try {
    optIn(dir, git, "the active thread");
    const r = run(dir, "checkpoint.js");
    assert.equal(r.status, 0, r.stderr);
    assert.ok(exists(dir, path.join(".now", "last-session.md")), "last-session.md should exist");
    const breadcrumb = fs.readFileSync(path.join(dir, ".now", "last-session.md"), "utf8");
    assert.match(breadcrumb, /the active thread/);
  } finally { cleanup(dir); }
});

test("exits silently (no files created) when NOW.md is missing", () => {
  const { dir, git } = makeRepo();
  try {
    write(dir, "README.md", "# app\n");
    git(["add", "README.md"]);
    git(["commit", "-q", "-m", "initial"]);
    const r = run(dir, "checkpoint.js");
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!exists(dir, ".now"), ".now/ should not be created");
  } finally { cleanup(dir); }
});

test("no-op when NOW.md exists but lacks the claudhd marker", () => {
  const { dir, git } = makeRepo();
  try {
    write(dir, "NOW.md", "# NOW\n\n## Active thread\n\nsome work\n");
    git(["add", "NOW.md"]);
    git(["commit", "-q", "-m", "initial"]);
    const r = run(dir, "checkpoint.js");
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!exists(dir, path.join(".now", "last-session.md")), "no breadcrumb for unmarked NOW.md");
  } finally { cleanup(dir); }
});

test("breadcrumb written with fallback note when Active thread section is absent", () => {
  const { dir, git } = makeRepo();
  try {
    // Marked NOW.md but no Active thread section.
    write(dir, "NOW.md", "# NOW\n<!-- claudhd: opt-in marker -->\n\n## Queue\n\n- item\n");
    git(["add", "NOW.md"]);
    git(["commit", "-q", "-m", "init"]);
    const r = run(dir, "checkpoint.js");
    assert.equal(r.status, 0, r.stderr);
    assert.ok(exists(dir, path.join(".now", "last-session.md")), "breadcrumb should still be written");
    const breadcrumb = fs.readFileSync(path.join(dir, ".now", "last-session.md"), "utf8");
    assert.match(breadcrumb, /no Active thread|no active thread/i);
  } finally { cleanup(dir); }
});

test("detached HEAD writes global breadcrumb but skips the per-branch copy", () => {
  const { dir, git } = makeRepo();
  try {
    optIn(dir, git, "my thread");
    // Detach HEAD by checking out the commit hash directly.
    const sha = git(["rev-parse", "HEAD"]);
    git(["checkout", "-q", "--detach", sha]);
    const r = run(dir, "checkpoint.js");
    assert.equal(r.status, 0, r.stderr);
    assert.ok(exists(dir, path.join(".now", "last-session.md")), "global breadcrumb should be written");
    // Per-branch directory should be empty (no branch-specific file for a detached HEAD).
    const branchDir = path.join(dir, ".now", "branches");
    if (fs.existsSync(branchDir)) {
      const files = fs.readdirSync(branchDir).filter((f) => f.endsWith(".md"));
      assert.equal(files.length, 0, "no per-branch file expected for detached HEAD");
    }
  } finally { cleanup(dir); }
});
