"use strict";
/*
 * Tests for /claudhd:init first-run UX. Init should report what it changed,
 * but its repo signals should not echo ClauDHD's own scaffolded files back as
 * uncommitted work.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { makeRepo, cleanup, run, write, read, exists } = require("../tools/helpers.js");

test("init filters its own scaffolded files from repo signals", () => {
  const { dir, git } = makeRepo();
  try {
    write(dir, "README.md", "# app\n");
    git(["add", "README.md"]);
    git(["commit", "-q", "-m", "initial"]);

    const r = run(dir, "init.js");
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Created: NOW.md, IDEAS.md, SHIPPED.md, ROADMAP.md/);
    assert.doesNotMatch(r.stdout, /\?\? NOW\.md/);
    assert.doesNotMatch(r.stdout, /\?\? IDEAS\.md/);
    assert.doesNotMatch(r.stdout, /\?\? SHIPPED\.md/);
    assert.doesNotMatch(r.stdout, /\?\? \.gitignore/);
    assert.equal(fs.existsSync(path.join(dir, "NOW.md")), true);
    assert.equal(fs.existsSync(path.join(dir, "ROADMAP.md")), true);
  } finally { cleanup(dir); }
});

test("init still reports real uncommitted work", () => {
  const { dir, git } = makeRepo();
  try {
    write(dir, "README.md", "# app\n");
    git(["add", "README.md"]);
    git(["commit", "-q", "-m", "initial"]);
    write(dir, "src.txt", "work in progress\n");

    const r = run(dir, "init.js");
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Uncommitted paths:\n\s+src\.txt/);
  } finally { cleanup(dir); }
});

test("init repo signals count a nested NOW.md, not just the root cursor", () => {
  const { dir, git } = makeRepo();
  try {
    write(dir, "README.md", "# app\n");
    git(["add", "README.md"]);
    git(["commit", "-q", "-m", "initial"]);
    // Filtering is by exact root-relative path, so a nested file that only shares
    // a basename with the scaffolded cursor is still real uncommitted work.
    fs.mkdirSync(path.join(dir, "docs"), { recursive: true });
    write(dir, path.join("docs", "NOW.md"), "# real notes\n");

    const r = run(dir, "init.js");
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Uncommitted paths:[\s\S]*docs\/NOW\.md/);
  } finally { cleanup(dir); }
});

// ---------------------------------------------------------------------------
// Folded in from Gantry: audit docs, model-backend config, .gantry/* gitignore,
// and the plugin-native hook opt-in marker.
// ---------------------------------------------------------------------------

test("scaffolds CURRENTNESS_AUDIT.md and RUNTIME_VERIFICATION_QUEUE.md into docs/ when docs/ exists", () => {
  const { dir } = makeRepo();
  try {
    fs.mkdirSync(path.join(dir, "docs"), { recursive: true });
    const r = run(dir, "init.js");
    assert.equal(r.status, 0, r.stderr);
    assert.ok(exists(dir, path.join("docs", "CURRENTNESS_AUDIT.md")), "docs/CURRENTNESS_AUDIT.md should be created");
    assert.ok(exists(dir, path.join("docs", "RUNTIME_VERIFICATION_QUEUE.md")), "docs/RUNTIME_VERIFICATION_QUEUE.md should be created");
    assert.match(r.stdout, /ClauDHD init complete/);
    assert.match(r.stdout, /CURRENTNESS_AUDIT\.md/);
    assert.match(r.stdout, /RUNTIME_VERIFICATION_QUEUE\.md/);
  } finally { cleanup(dir); }
});

test("scaffolds audit docs to the project root when docs/ is absent", () => {
  const { dir } = makeRepo();
  try {
    const r = run(dir, "init.js");
    assert.equal(r.status, 0, r.stderr);
    assert.ok(exists(dir, "CURRENTNESS_AUDIT.md"), "CURRENTNESS_AUDIT.md should be created at root");
    assert.ok(exists(dir, "RUNTIME_VERIFICATION_QUEUE.md"), "RUNTIME_VERIFICATION_QUEUE.md should be created at root");
  } finally { cleanup(dir); }
});

test("does not overwrite an existing audit doc", () => {
  const { dir } = makeRepo();
  try {
    write(dir, "CURRENTNESS_AUDIT.md", "# My existing audit\n");
    const r = run(dir, "init.js");
    assert.equal(r.status, 0, r.stderr);
    assert.equal(read(dir, "CURRENTNESS_AUDIT.md"), "# My existing audit\n", "existing file should not be overwritten");
    assert.match(r.stdout, /kept existing/i);
  } finally { cleanup(dir); }
});

test("scaffolds .gantry/models.json (all-native when codex is not on PATH) and gitignores the .gantry/* transient files", () => {
  const { dir } = makeRepo();
  try {
    const r = run(dir, "init.js");
    assert.equal(r.status, 0, r.stderr);
    assert.ok(exists(dir, path.join(".gantry", "models.json")), ".gantry/models.json should be created");
    const config = JSON.parse(read(dir, path.join(".gantry", "models.json")));
    assert.equal(config.roles.implementer.backend, "native");
    const gi = read(dir, ".gitignore");
    assert.match(gi, /\.now\//);
    assert.match(gi, /\.gantry\/active-phase\.json/);
    assert.match(gi, /\.gantry\/models\.json/);
    assert.match(gi, /\.gantry\/headless-implementer-settings\.json/);
  } finally { cleanup(dir); }
});

test("does not overwrite an existing .gantry/models.json", () => {
  const { dir } = makeRepo();
  try {
    fs.mkdirSync(path.join(dir, ".gantry"), { recursive: true });
    write(dir, path.join(".gantry", "models.json"), JSON.stringify({ custom: true }));
    const r = run(dir, "init.js");
    assert.equal(r.status, 0, r.stderr);
    const config = JSON.parse(read(dir, path.join(".gantry", "models.json")));
    assert.deepEqual(config, { custom: true }, "existing models.json must not be overwritten");
    assert.match(r.stdout, /kept existing \.gantry\/models\.json/);
  } finally { cleanup(dir); }
});

test("gitignore entries are appended idempotently: a second init run does not duplicate any entry", () => {
  const { dir } = makeRepo();
  try {
    run(dir, "init.js");
    const r2 = run(dir, "init.js");
    assert.equal(r2.status, 0, r2.stderr);
    const gi = read(dir, ".gitignore");
    for (const entry of [".now/", ".gantry/active-phase.json", ".gantry/models.json", ".gantry/headless-implementer-settings.json"]) {
      const count = gi.split(entry).length - 1;
      assert.equal(count, 1, entry + " must appear exactly once after two init runs");
    }
    assert.match(r2.stdout, /already ignores/);
  } finally { cleanup(dir); }
});

test("gitignore: appends the .gantry/* entries next to a pre-existing .now/ entry without duplicating it", () => {
  const { dir } = makeRepo();
  try {
    write(dir, ".gitignore", "node_modules/\n.now/\n");
    const r = run(dir, "init.js");
    assert.equal(r.status, 0, r.stderr);
    const gi = read(dir, ".gitignore");
    assert.equal(gi.split(".now/").length - 1, 1, ".now/ must appear exactly once");
    assert.match(gi, /\.gantry\/active-phase\.json/);
    assert.match(gi, /node_modules\//, "existing content must be preserved");
  } finally { cleanup(dir); }
});

test("with CLAUDE_PLUGIN_ROOT set (default run): does NOT write .gantry/enabled, but still gitignores models.json", () => {
  const { dir } = makeRepo();
  try {
    const r = run(dir, "init.js", [], { CLAUDE_PLUGIN_ROOT: "/fake/plugin/root" });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!exists(dir, path.join(".gantry", "enabled")), ".gantry/enabled must NOT be created on default run");
    const gi = read(dir, ".gitignore");
    assert.match(gi, /\.gantry\/models\.json/, "per-machine models.json must be gitignored even on default run");
    assert.match(r.stdout, /enforcement is available but NOT enabled/);
  } finally { cleanup(dir); }
});

test("with CLAUDE_PLUGIN_ROOT set and --enable-hooks: writes .gantry/enabled", () => {
  const { dir } = makeRepo();
  try {
    const r = run(dir, "init.js", ["--enable-hooks"], { CLAUDE_PLUGIN_ROOT: "/fake/plugin/root" });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(exists(dir, path.join(".gantry", "enabled")), ".gantry/enabled should be created");
    assert.match(r.stdout, /Created \.gantry\/enabled/);
  } finally { cleanup(dir); }
});

test("with CLAUDE_PLUGIN_ROOT unset: writes no .gantry/enabled, but still gitignores models.json", () => {
  const { dir } = makeRepo();
  try {
    const r = run(dir, "init.js", [], { CLAUDE_PLUGIN_ROOT: undefined });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!exists(dir, path.join(".gantry", "enabled")), ".gantry/enabled must NOT be created when CLAUDE_PLUGIN_ROOT is unset");
    const gi = read(dir, ".gitignore");
    assert.match(gi, /\.gantry\/models\.json/, "models.json must be gitignored even for a manual copy");
  } finally { cleanup(dir); }
});
