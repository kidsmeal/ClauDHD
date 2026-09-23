"use strict";
/*
 * Hooks and the commit path with the state files relocated by
 * .claude/claudhd.json (state = docs/dev). brief injects context from
 * docs/dev/NOW.md, checkpoint snapshots it, the commit-boundary reconcile
 * writes and stages docs/dev/NOW.md and docs/dev/SHIPPED.md, nothing is
 * created at the root, and the relocated files never count as drift.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { makeRepo, cleanup, run, write, read, exists, optIn, writeConfig } = require("../tools/helpers.js");

const GUARD = path.join(__dirname, "..", "plugins", "claudhd", "scripts", "hooks", "commit-guard.js");
const VERIFY = path.join(__dirname, "..", "plugins", "claudhd", "scripts", "hooks", "commit-verify.js");
const STATE = "docs/dev";
const ROOT_FILES = ["NOW.md", "IDEAS.md", "SHIPPED.md", "ROADMAP.md"];

function parseHook(stdout) {
  return JSON.parse(stdout);
}

function hookEnv(dir) {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: dir };
  delete env.CLAUDHD_PROJECT_DIR;
  delete env.GANTRY_PROJECT_DIR;
  return env;
}

function runHook(script, dir, command, sessionId) {
  const payload = {
    session_id: sessionId || "session-reloc",
    cwd: dir,
    hook_event_name: script === GUARD ? "PreToolUse" : "PostToolUse",
    tool_name: "Bash",
    tool_input: { command },
  };
  return spawnSync(process.execPath, [script], { encoding: "utf8", input: JSON.stringify(payload), env: hookEnv(dir) });
}

// Relocated, adopted project: config + docs/dev/NOW.md committed, .now/enabled
// written so the commit-boundary reconcile is active.
function relocatedRepo(thread) {
  const repo = makeRepo();
  optIn(repo.dir, repo.git, thread || "relocated thread", { stateDir: STATE });
  fs.mkdirSync(path.join(repo.dir, ".now"), { recursive: true });
  write(repo.dir, ".now/enabled", "");
  return repo;
}

function assertNothingAtRoot(dir) {
  for (const name of ROOT_FILES) assert.ok(!exists(dir, name), name + " must not be created at the root");
}

test("brief injects context from the relocated NOW.md and names the configured paths", () => {
  const { dir } = relocatedRepo("relocated thread");
  try {
    const r = run(dir, "brief.js", ["--record-visit"]);
    assert.equal(r.status, 0, r.stderr);
    const ctx = parseHook(r.stdout).hookSpecificOutput.additionalContext;
    assert.match(ctx, /relocated thread/);
    assert.match(ctx, /ClauDHD paths: NOW=docs\/dev\/NOW\.md ROADMAP=docs\/dev\/ROADMAP\.md/);
    assert.match(ctx, /Read docs\/dev\/NOW\.md first/);
    assert.doesNotMatch(ctx, /uncommitted path/);
    assertNothingAtRoot(dir);
  } finally { cleanup(dir); }
});

test("brief without a config carries no ClauDHD paths line", () => {
  const { dir, git } = makeRepo();
  try {
    optIn(dir, git, "plain thread");
    const r = run(dir, "brief.js", ["--record-visit"]);
    const ctx = parseHook(r.stdout).hookSpecificOutput.additionalContext;
    assert.doesNotMatch(ctx, /ClauDHD paths/);
  } finally { cleanup(dir); }
});

test("brief warns once per stray at the default location and still reads the configured NOW.md", () => {
  const { dir } = relocatedRepo("configured thread");
  try {
    write(dir, "NOW.md", "# NOW\n<!-- claudhd: opt-in marker -->\n\n## Active thread\n\n**stray thread**\n");
    write(dir, "IDEAS.md", "# IDEAS\n");
    const r = run(dir, "brief.js", ["--plain"]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /configured thread/);
    assert.doesNotMatch(r.stdout, /stray thread/);
    const strayLines = r.stdout.split("\n").filter((l) => /^- Stray /.test(l));
    assert.equal(strayLines.length, 2);
    assert.ok(strayLines.every((l) => /\/claudhd:init --relocate/.test(l)));
  } finally { cleanup(dir); }
});

test("brief with a config but only the old root NOW.md reports the strays instead of staying silent", () => {
  const { dir, git } = makeRepo();
  try {
    optIn(dir, git, "old root thread");
    writeConfig(dir, { state: STATE });
    const r = run(dir, "brief.js", ["--record-visit"]);
    assert.equal(r.status, 0, r.stderr);
    const ctx = parseHook(r.stdout).hookSpecificOutput.additionalContext;
    assert.match(ctx, /Stray NOW\.md/);
    assert.match(ctx, /--relocate/);
    assert.ok(!exists(dir, STATE + "/NOW.md"), "brief never creates the configured NOW.md");
  } finally { cleanup(dir); }
});

test("checkpoint snapshots the relocated NOW.md and counts no relocated file as uncommitted", () => {
  const { dir } = relocatedRepo("checkpoint thread");
  try {
    write(dir, STATE + "/IDEAS.md", "# IDEAS\n\n## Inbox\n\n- [ ] [2026-09-01] one idea\n");
    write(dir, STATE + "/NOW.md", read(dir, STATE + "/NOW.md") + "\nedited\n");
    const r = run(dir, "checkpoint.js");
    assert.equal(r.status, 0, r.stderr);
    const crumb = read(dir, ".now/last-session.md");
    assert.match(crumb, /checkpoint thread/);
    const state = JSON.parse(read(dir, ".now/state.json"));
    assert.equal(state.cursor.activeThread, "checkpoint thread");
    assert.equal(state.ideas.untriaged, 1);
    assert.equal(state.git.uncommitted, 0, "relocated state files are not drift");
    assertNothingAtRoot(dir);
  } finally { cleanup(dir); }
});

test("reconcile writes and stages docs/dev/NOW.md and docs/dev/SHIPPED.md, nothing at the root", () => {
  const { dir, git } = relocatedRepo("reconcile thread");
  try {
    write(dir, "feature.txt", "work\n");
    git(["add", "feature.txt"]);
    const r = runHook(GUARD, dir, "git commit -m \"add feature\"");
    assert.equal(r.status, 0, r.stderr);
    const staged = git(["diff", "--cached", "--name-only"]).split("\n").filter(Boolean).sort();
    assert.deepEqual(staged, ["docs/dev/NOW.md", "docs/dev/SHIPPED.md", "feature.txt"]);
    assert.match(read(dir, STATE + "/SHIPPED.md"), /- add feature/);
    assertNothingAtRoot(dir);
    const log = exists(dir, ".now/reconcile.log") ? read(dir, ".now/reconcile.log") : "";
    assert.doesNotMatch(log, /reconcile failed/);
    const state = JSON.parse(read(dir, ".now/state.json"));
    assert.equal(state.git.uncommitted, 1, "only feature.txt is drift; the relocated files are own files");
  } finally { cleanup(dir); }
});

test("reconcile backfills ids into the relocated ROADMAP.md and never touches a root stray", () => {
  const { dir, git } = relocatedRepo("roadmap thread");
  try {
    write(dir, STATE + "/ROADMAP.md", "# ROADMAP\n\n## Next\n\n- [ ] first intent\n\n## Shipped\n");
    write(dir, "ROADMAP.md", "# stray\n\n## Next\n\n- [ ] stray intent\n");
    git(["add", "."]);
    git(["commit", "-q", "-m", "add roadmaps"]);
    const strayBefore = read(dir, "ROADMAP.md");
    runHook(GUARD, dir, "git commit --allow-empty -m \"empty\"");
    assert.match(read(dir, STATE + "/ROADMAP.md"), /first intent `r-\d{4}-\d+`/);
    assert.equal(read(dir, "ROADMAP.md"), strayBefore);
    const staged = git(["diff", "--cached", "--name-only"]).split("\n").filter(Boolean);
    assert.ok(staged.includes("docs/dev/ROADMAP.md"));
    assert.ok(!staged.includes("ROADMAP.md"));
  } finally { cleanup(dir); }
});

test("commit-verify appends the post-commit SHIPPED entry to the relocated SHIPPED.md", () => {
  const { dir, git } = relocatedRepo("verify thread");
  try {
    write(dir, "feature.txt", "work\n");
    git(["add", "feature.txt"]);
    // -F - carries no parseable message, so the guard defers the entry to
    // commit-verify, which writes it with the hash after the commit lands.
    const cmd = "git commit -F -";
    runHook(GUARD, dir, cmd, "session-verify");
    git(["commit", "-q", "-m", "landed subject"]);
    const v = runHook(VERIFY, dir, cmd, "session-verify");
    assert.equal(v.status, 0, v.stderr);
    assert.match(read(dir, STATE + "/SHIPPED.md"), /- landed subject `[0-9a-f]{7}`/);
    assertNothingAtRoot(dir);
  } finally { cleanup(dir); }
});

test("shipped.js CLI catch-up scan writes the relocated SHIPPED.md", () => {
  const { dir } = relocatedRepo("shipped thread");
  try {
    const r = run(dir, "shipped.js");
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Tracking started/);
    assert.ok(exists(dir, STATE + "/SHIPPED.md"));
    assertNothingAtRoot(dir);
  } finally { cleanup(dir); }
});

test("walkForRoot pairs legacy .gantry/enabled with the relocated NOW.md", () => {
  const { dir } = relocatedRepo("legacy thread");
  try {
    fs.rmSync(path.join(dir, ".now"), { recursive: true, force: true });
    fs.mkdirSync(path.join(dir, ".gantry"));
    write(dir, ".gantry/enabled", "");
    fs.mkdirSync(path.join(dir, "src"));
    const walk = require("../plugins/claudhd/scripts/root.js").walkForRoot;
    assert.equal(walk(path.join(dir, "src")), dir);
  } finally { cleanup(dir); }
});
