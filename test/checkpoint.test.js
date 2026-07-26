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

test("state.json is written alongside the breadcrumb with valid facts", () => {
  const { dir, git } = makeRepo();
  try {
    optIn(dir, git, "the active thread");
    const r = run(dir, "checkpoint.js");
    assert.equal(r.status, 0, r.stderr);
    const statePath = path.join(dir, ".now", "state.json");
    assert.ok(exists(dir, path.join(".now", "state.json")), "state.json should exist");
    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    assert.equal(state.schemaVersion, 2);
    assert.match(state.generatedAt, /^\d{4}-\d{2}-\d{2}T.*Z$/, "generatedAt is an ISO 8601 timestamp");
    assert.equal(state.branch, "main");
    assert.equal(state.cursor.activeThread, "the active thread");
    assert.equal(state.cursor.nextAction, "step");
    assert.equal(state.ideas, null, "no IDEAS.md -> null section");
    assert.equal(state.shipped, null);
    assert.equal(state.roadmap, null);
    assert.equal(state.git.uncommitted, 0, "clean tree, ClauDHD's own files excluded");
    assert.equal(state.git.unpushed, null, "no upstream -> null, not 0");
    assert.equal(state.git.lastCommitMsg, "init claudhd");
  } finally { cleanup(dir); }
});

test("no state.json when NOW.md lacks the claudhd marker", () => {
  const { dir, git } = makeRepo();
  try {
    write(dir, "NOW.md", "# NOW\n\n## Active thread\n\n**x**\n");
    git(["add", "NOW.md"]);
    git(["commit", "-q", "-m", "init"]);
    const r = run(dir, "checkpoint.js");
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!exists(dir, path.join(".now", "state.json")), "unmarked NOW.md must not produce state.json");
  } finally { cleanup(dir); }
});

test("state.json reflects IDEAS/SHIPPED/ROADMAP when present", () => {
  const { dir, git } = makeRepo();
  try {
    optIn(dir, git, "thread");
    write(dir, "IDEAS.md", "# IDEAS\n## Inbox\n\n- [ ] 2026-07-01 (while: t) an idea\n");
    write(dir, "SHIPPED.md", "# SHIPPED\n\n### 2026-07-08\n- shipped a thing (`1234567`)\n");
    write(dir, "ROADMAP.md", "# ROADMAP\n## Next\n- [ ] a committed intent - done: y\n");
    const r = run(dir, "checkpoint.js");
    assert.equal(r.status, 0, r.stderr);
    const state = JSON.parse(fs.readFileSync(path.join(dir, ".now", "state.json"), "utf8"));
    assert.equal(state.ideas.untriaged, 1);
    assert.equal(state.ideas.oldestUntriagedDate, "2026-07-01");
    assert.equal(state.shipped.total, 1);
    assert.equal(state.shipped.lastEntryDate, "2026-07-08");
    assert.equal(state.roadmap.count, 1);
    assert.equal(state.roadmap.topItem, "a committed intent - done: y");
  } finally { cleanup(dir); }
});

test("a Stop hook run never erases an existing build section (merge, not replace)", () => {
  const { dir, git } = makeRepo();
  try {
    optIn(dir, git, "thread");
    run(dir, "checkpoint.js"); // first Stop: creates state.json, no build section yet
    const statePath = path.join(dir, ".now", "state.json");
    const before = JSON.parse(fs.readFileSync(statePath, "utf8"));

    // Simulate a phase sentinel written between two Stops (what sentinel.js
    // write does via the merge-preserving writer, reproduced here directly so
    // this test does not depend on sentinel.js's plan-parsing machinery).
    const build = {
      plan: "docs/plan.md", phase: 2, files: ["a.js"], allow: [],
      started: new Date().toISOString(), session: "s",
    };
    fs.writeFileSync(statePath, JSON.stringify({ ...before, build }, null, 2) + "\n");

    const r = run(dir, "checkpoint.js"); // second Stop, mid-phase
    assert.equal(r.status, 0, r.stderr);
    const after = JSON.parse(fs.readFileSync(statePath, "utf8"));
    assert.deepEqual(after.build, build, "the Stop hook must not erase the build section written between two Stops");
    assert.equal(after.cursor.activeThread, "thread", "cursor facts are still refreshed normally");
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
