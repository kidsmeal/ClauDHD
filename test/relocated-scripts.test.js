"use strict";
/*
 * The remaining scripts with the state files relocated by
 * .claude/claudhd.json: vocab/idea capture, quick, thread and override
 * renders, sentinel's allow list, and init's scaffold all use the configured
 * locations and create nothing at the root.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { makeRepo, cleanup, run, write, read, exists, optIn, writeConfig } = require("../tools/helpers.js");

const STATE = "docs/dev";
const ROOT_FILES = ["NOW.md", "IDEAS.md", "SHIPPED.md", "ROADMAP.md", "CURRENTNESS_AUDIT.md", "RUNTIME_VERIFICATION_QUEUE.md"];

const PLAN = `# Plan

## Phase 1: one
**Goal:** g.
**Files:**
- create \`src/a.js\`
**Verification:** node --test
**Exit criteria:** pass.
**Blockers:** None.
`;

function assertNothingAtRoot(dir) {
  for (const name of ROOT_FILES) assert.ok(!exists(dir, name), name + " must not be created at the root");
}

function relocated(thread) {
  const repo = makeRepo();
  optIn(repo.dir, repo.git, thread || "reloc", { stateDir: STATE });
  return repo;
}

test("idea.js captures into the configured IDEAS.md", () => {
  const { dir } = relocated();
  try {
    const r = run(dir, "idea.js", ["a relocated idea"]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Captured -> docs\/dev\/IDEAS\.md/);
    assert.match(read(dir, STATE + "/IDEAS.md"), /a relocated idea/);
    assertNothingAtRoot(dir);
  } finally { cleanup(dir); }
});

test("vocab.js move promotes from the configured IDEAS.md into the configured ROADMAP.md", () => {
  const { dir } = relocated();
  try {
    write(dir, STATE + "/ROADMAP.md", "# ROADMAP\n\n## Next\n\n## Later\n\n## Shipped\n");
    run(dir, "idea.js", ["promote me"]);
    const line = read(dir, STATE + "/IDEAS.md").split("\n").find((l) => l.includes("promote me"));
    const r = run(dir, "vocab.js", ["move", "1", line, "Next"]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(read(dir, STATE + "/ROADMAP.md"), /promote me/);
    assertNothingAtRoot(dir);
  } finally { cleanup(dir); }
});

test("quick.js adds to the configured NOW.md", () => {
  const { dir } = relocated();
  try {
    const r = run(dir, "quick.js", ["fix the thing"]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Quick fix added -> docs\/dev\/NOW\.md/);
    assert.match(read(dir, STATE + "/NOW.md"), /- \[ \] fix the thing/);
    assertNothingAtRoot(dir);
  } finally { cleanup(dir); }
});

test("thread.js and override.js render into the configured NOW.md", () => {
  const { dir } = relocated();
  try {
    let r = run(dir, "thread.js", ["enter-design", "-", "design thread", "first step"]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(read(dir, STATE + "/NOW.md"), /design thread/);
    r = run(dir, "override.js", ["s1"]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(read(dir, STATE + "/NOW.md"), /unguarded session/);
    assertNothingAtRoot(dir);
  } finally { cleanup(dir); }
});

test("sentinel write: allow names the configured audit docs and ROADMAP.md", () => {
  const { dir } = relocated();
  try {
    writeConfig(dir, { state: STATE, audit: STATE });
    write(dir, STATE + "/ROADMAP.md", "# ROADMAP\n");
    fs.mkdirSync(path.join(dir, "docs", "plans"), { recursive: true });
    write(dir, "docs/plans/p.md", PLAN);
    const r = run(dir, "sentinel.js", ["write", "docs/plans/p.md", "1", "s1"]);
    assert.equal(r.status, 0, r.stderr);
    const build = JSON.parse(read(dir, ".now/state.json")).build;
    assert.deepEqual(build.allow, [
      "docs/plans/p.md", "docs/dev/CURRENTNESS_AUDIT.md", "docs/dev/RUNTIME_VERIFICATION_QUEUE.md", "docs/dev/ROADMAP.md",
    ]);
  } finally { cleanup(dir); }
});

test("sentinel write-files: the quick sentinel allows the configured NOW.md", () => {
  const { dir } = relocated();
  try {
    const r = run(dir, "sentinel.js", ["write-files", "src/a.js"]);
    assert.equal(r.status, 0, r.stderr);
    const build = JSON.parse(read(dir, ".now/state.json")).build;
    assert.deepEqual(build.allow, ["docs/dev/NOW.md"]);
  } finally { cleanup(dir); }
});

test("init scaffolds state, audit docs into the configured dirs and nothing at the root", () => {
  const { dir } = makeRepo();
  try {
    writeConfig(dir, { state: STATE, audit: "docs/audit" });
    const r = run(dir, "init.js");
    assert.equal(r.status, 0, r.stderr);
    for (const name of ["NOW.md", "IDEAS.md", "SHIPPED.md", "ROADMAP.md"]) {
      assert.ok(exists(dir, STATE + "/" + name), STATE + "/" + name + " should be scaffolded");
    }
    assert.ok(exists(dir, "docs/audit/CURRENTNESS_AUDIT.md"));
    assert.ok(exists(dir, "docs/audit/RUNTIME_VERIFICATION_QUEUE.md"));
    assert.match(r.stdout, /Created: docs\/dev\/NOW\.md, docs\/dev\/IDEAS\.md, docs\/dev\/SHIPPED\.md, docs\/dev\/ROADMAP\.md/);
    assert.match(r.stdout, /Audit docs \(docs\/audit\/\)/);
    assert.doesNotMatch(r.stdout, /Uncommitted paths:[\s\S]*docs\/dev\/NOW\.md/);
    assertNothingAtRoot(dir);
  } finally { cleanup(dir); }
});

test("init with an invalid config scaffolds at the default locations and warns", () => {
  const { dir } = makeRepo();
  try {
    writeConfig(dir, { state: "../outside" });
    const r = run(dir, "init.js");
    assert.equal(r.status, 0, r.stderr);
    assert.ok(exists(dir, "NOW.md"));
    assert.match(r.stderr, /claudhd\.json ignored/);
  } finally { cleanup(dir); }
});
