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
const { render } = require("../plugins/claudhd/scripts/nowrender.js");

test("init scaffolds a fresh NOW.md by rendering render({}), not by copying templates/NOW.md", () => {
  const { dir } = makeRepo();
  try {
    const r = run(dir, "init.js");
    assert.equal(r.status, 0, r.stderr);
    assert.equal(read(dir, "NOW.md"), render({}), "a freshly scaffolded NOW.md must be byte-identical to the canonical render");
  } finally { cleanup(dir); }
});

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

// ---------------------------------------------------------------------------
// Phase 3: roadmap id backfill (design section 4).
// ---------------------------------------------------------------------------

test("backfills r-MMDD-N ids onto an existing ROADMAP.md's id-less items, without touching their wording", () => {
  const { dir } = makeRepo();
  try {
    write(dir, "ROADMAP.md", [
      "# ROADMAP",
      "## Next",
      "- [ ] ship the widget - done: it renders",
      "## Later",
      "- [ ] someday: rewrite the parser",
    ].join("\n"));

    const r = run(dir, "init.js");
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /backfilled ids/i);

    const roadmap = read(dir, "ROADMAP.md");
    assert.match(roadmap, /ship the widget - done: it renders\s*`r-\d{4}-1`/);
    assert.match(roadmap, /someday: rewrite the parser\s*`r-\d{4}-2`/);
  } finally { cleanup(dir); }
});

test("roadmap id backfill is idempotent: a second init run does not re-tag or duplicate ids", () => {
  const { dir } = makeRepo();
  try {
    write(dir, "ROADMAP.md", "## Next\n- [ ] ship the widget\n");
    run(dir, "init.js");
    const once = read(dir, "ROADMAP.md");
    const r2 = run(dir, "init.js");
    assert.equal(r2.status, 0, r2.stderr);
    const twice = read(dir, "ROADMAP.md");
    assert.equal(twice, once, "a second run must not change an already-backfilled ROADMAP.md");
    assert.match(r2.stdout, /already has an id/i);
  } finally { cleanup(dir); }
});

test("the roadmap id ledger persisted in state.json prevents a later init run from reissuing a deleted id", () => {
  const { dir } = makeRepo();
  try {
    write(dir, "ROADMAP.md", "## Next\n- [ ] first item\n- [ ] second item\n");
    const r1 = run(dir, "init.js");
    assert.equal(r1.status, 0, r1.stderr);
    const afterFirstInit = read(dir, "ROADMAP.md");
    assert.match(afterFirstInit, /second item\s*`r-\d{4}-2`/, "sanity: second item got the expected counter");

    // Delete the highest-numbered item's line entirely (its id is now nowhere
    // in the file), and add a brand-new id-less item in its place.
    const withoutSecond = afterFirstInit.split(/\r?\n/).filter((l) => !l.includes("second item")).join("\n");
    write(dir, "ROADMAP.md", withoutSecond + "\n- [ ] third item\n");

    const r2 = run(dir, "init.js");
    assert.equal(r2.status, 0, r2.stderr);
    const finalRoadmap = read(dir, "ROADMAP.md");
    assert.doesNotMatch(finalRoadmap, /third item\s*`r-\d{4}-2`/, "must not reissue the id whose line was deleted");
    assert.match(finalRoadmap, /third item\s*`r-\d{4}-3`/, "the persisted ledger keeps the counter moving forward past the deleted id");
  } finally { cleanup(dir); }
});

test("a real read failure on ROADMAP.md (a directory in its place, not a missing file) makes init exit non-zero and name the error, not silently no-op", () => {
  const { dir } = makeRepo();
  try {
    // A directory where ROADMAP.md should be: fs.existsSync sees it as
    // present, but reading it as a file throws (EISDIR on every platform,
    // including Windows) - the exact "real read failure" shape this fix
    // guards, as opposed to ENOENT (genuinely absent, which stays silent/ok).
    fs.mkdirSync(path.join(dir, "ROADMAP.md"));

    const r = run(dir, "init.js");
    assert.notEqual(r.status, 0, "init must exit non-zero on a real read failure, not silently succeed");
    assert.match(r.stderr, /ROADMAP\.md id backfill/i, "the failure must be named as the roadmap id backfill step");
    assert.match(r.stderr, /EISDIR|illegal operation on a directory/i, "the underlying fs error must be named, not swallowed");
  } finally { cleanup(dir); }
});

test("a freshly-scaffolded ROADMAP.md gets real ids assigned for today's date, not a hardcoded sample", () => {
  const { dir } = makeRepo();
  try {
    const r = run(dir, "init.js");
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /backfilled ids/i, "the template's placeholder items are id-less, so a fresh init must backfill them");

    const roadmap = read(dir, "ROADMAP.md");
    const now = new Date();
    const mmdd = String(now.getMonth() + 1).padStart(2, "0") + String(now.getDate()).padStart(2, "0");
    const idsForToday = (roadmap.match(new RegExp("`r-" + mmdd + "-\\d+`", "g")) || []).length;
    assert.ok(idsForToday >= 4, "every placeholder item (Next/Later/Shipped/Non-goals) should get a real, current-date id");
    assert.doesNotMatch(roadmap, /r-0801-/, "no hardcoded sample id from the template should ever appear");
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
