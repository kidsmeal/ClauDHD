"use strict";
/*
 * commit-policy (1.0.11): the per-plan auto-commit grant. `thread.js
 * commit-policy auto <plan>` records it in state.json (its own key), the
 * rendered Position line shows it while a build is live, `commit-policy gate`
 * clears it, and the reconcile clears it by itself when the plan's final
 * phase commits. The pipeline skill and /claudhd:review consult it at the
 * commit gate. Push is never covered by the grant.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PLUGIN = path.join(__dirname, "..", "plugins", "claudhd");
const SCRIPTS = path.join(PLUGIN, "scripts");
const THREAD = path.join(SCRIPTS, "thread.js");

function mk() { return fs.mkdtempSync(path.join(os.tmpdir(), "claudhd-policy-")); }

function adopt(dir) {
  fs.mkdirSync(path.join(dir, ".now"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".now", "enabled"), "");
  const { render } = require(path.join(SCRIPTS, "nowrender.js"));
  fs.writeFileSync(path.join(dir, "NOW.md"), render({}));
}

function thread(dir, args) {
  const env = { ...process.env, GANTRY_PROJECT_DIR: dir };
  delete env.CLAUDHD_PROJECT_DIR;
  delete env.CLAUDE_PROJECT_DIR;
  return spawnSync(process.execPath, [THREAD, ...args], { encoding: "utf8", env });
}

function state(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, ".now", "state.json"), "utf8"));
}

function positionLine(dir) {
  const m = fs.readFileSync(path.join(dir, "NOW.md"), "utf8").match(/^Position: .*$/m);
  return m ? m[0] : null;
}

test("commit-policy auto <plan> records the grant in state.json and prints it back; gate clears it", () => {
  const dir = mk();
  try {
    adopt(dir);
    let r = thread(dir, ["commit-policy"]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^gate$/m, "no grant reads as gate");

    r = thread(dir, ["commit-policy", "auto", "docs/p-plan.md"]);
    assert.equal(r.status, 0, r.stderr);
    const s = state(dir);
    assert.equal(s.commitPolicy.mode, "auto");
    assert.equal(s.commitPolicy.plan, "docs/p-plan.md");
    assert.ok(s.commitPolicy.grantedAt, "grant carries a timestamp");

    r = thread(dir, ["commit-policy"]);
    assert.match(r.stdout, /^auto docs\/p-plan\.md$/m, "prints the mode and the plan it was granted for");

    r = thread(dir, ["commit-policy", "gate"]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(state(dir).commitPolicy, undefined, "gate removes the key");
    assert.match(thread(dir, ["commit-policy"]).stdout, /^gate$/m);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("commit-policy refuses an unknown mode and leaves state untouched", () => {
  const dir = mk();
  try {
    adopt(dir);
    const r = thread(dir, ["commit-policy", "yolo"]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /auto\|gate/);
    assert.ok(!fs.existsSync(path.join(dir, ".now", "state.json")) || state(dir).commitPolicy === undefined,
      "a refused mode writes no grant");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("NOW.md's Position line shows the grant only while a build is live, and render({}) is unchanged", () => {
  const dir = mk();
  try {
    adopt(dir);
    const { render } = require(path.join(SCRIPTS, "nowrender.js"));
    assert.doesNotMatch(render({}), /auto-commit/, "the idle scaffold never mentions the grant");

    thread(dir, ["commit-policy", "auto", "docs/p-plan.md"]);
    assert.doesNotMatch(positionLine(dir), /auto-commit/, "idle: no Position mention");

    thread(dir, ["enter-build"]);
    assert.match(positionLine(dir), /auto-commit granted for docs\/p-plan\.md/);

    thread(dir, ["commit-policy", "gate"]);
    assert.doesNotMatch(positionLine(dir), /auto-commit/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("the reconcile clears the grant when the plan's final phase commits, and keeps it on earlier phases", () => {
  const dir = mk();
  try {
    adopt(dir);
    const { writeStateAtomic } = require(path.join(SCRIPTS, "state.js"));
    const { reconcile } = require(path.join(SCRIPTS, "reconcile.js"));
    const { execFileSync } = require("node:child_process");
    execFileSync("git", ["-C", dir, "init", "-q"]);
    fs.mkdirSync(path.join(dir, "docs"), { recursive: true });
    const plan = [
      "# P - Implementation Plan", "",
      "## Phase 1: one", "**Status:** ready to commit", "**Files:** `a.js`", "",
      "## Phase 2: two", "**Status:** ready to commit", "**Files:** `b.js`", "",
    ].join("\n");
    fs.writeFileSync(path.join(dir, "docs", "p-plan.md"), plan);
    const sid = "s-policy";
    const sentinel = (phase) => ({
      plan: "docs/p-plan.md", phase, files: [], allow: [], started: new Date().toISOString(), session: sid, originalFiles: [],
    });

    thread(dir, ["commit-policy", "auto", "docs/p-plan.md"]);
    writeStateAtomic(path.join(dir, ".now"), { build: sentinel(1), mode: "build" }, ["build", "mode"]);
    reconcile(dir, "phase 1", sid, true);
    assert.equal(state(dir).commitPolicy.mode, "auto", "phase 1 of 2 keeps the grant");

    writeStateAtomic(path.join(dir, ".now"), { build: sentinel(2), mode: "build" }, ["build", "mode"]);
    reconcile(dir, "phase 2", sid, true);
    assert.equal(state(dir).commitPolicy, undefined, "the final phase's commit clears the grant");
    assert.match(fs.readFileSync(path.join(dir, "docs", "p-plan.md"), "utf8"), /Phase 2: two\n\*\*Status:\*\* committed/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("the pipeline skill and /claudhd:review consult commit-policy at the commit gate, and the grant never covers push", () => {
  const skill = fs.readFileSync(path.join(PLUGIN, "skills", "pipeline", "SKILL.md"), "utf8");
  const review = fs.readFileSync(path.join(PLUGIN, "commands", "review.md"), "utf8");
  for (const [name, text] of [["SKILL.md", skill], ["review.md", review]]) {
    assert.match(text, /thread\.js commit-policy/, name + " must consult thread.js commit-policy");
    assert.match(text, /push[^.\n]*(stays|remains)[^.\n]*(human|manual)/i, name + " must keep push outside the grant");
  }
  assert.match(skill, /Every commit, unless/, "the stop list carries the grant exception");
});
