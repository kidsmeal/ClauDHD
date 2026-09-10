"use strict";
/*
 * commit-verify.js (PostToolUse on Bash, 1.0.11): the after-the-commit half
 * of the commit boundary. The PreToolUse guard writes a pending record (via
 * pending-commit.js) when it lets a commit through; this hook reads it back
 * by session id, compares HEAD, and records the real hash or notes that the
 * commit never landed. Driven through the real scripts against throwaway
 * repos; the pending records go to a per-test temp dir (TMP/TEMP/TMPDIR are
 * pinned) so they never collide with a live session's.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SCRIPTS = path.join(__dirname, "..", "plugins", "claudhd", "scripts");
const GUARD = path.join(SCRIPTS, "hooks", "commit-guard.js");
const VERIFY = path.join(SCRIPTS, "hooks", "commit-verify.js");

function mk() { return fs.mkdtempSync(path.join(os.tmpdir(), "claudhd-verify-")); }

function git(dir, args) {
  return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

// An adopted repo with one commit, so HEAD exists before the probe commit.
function adoptedRepo() {
  const dir = mk();
  git(dir, ["init", "-q"]);
  git(dir, ["config", "user.email", "t@example.com"]);
  git(dir, ["config", "user.name", "t"]);
  fs.mkdirSync(path.join(dir, ".now"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".now", "enabled"), "");
  fs.writeFileSync(path.join(dir, "NOW.md"),
    "# NOW\n<!-- claudhd: opt-in marker -->\n\n## Active thread\n\n**t**\n\nNext physical action:\n\n- [ ] x\n");
  fs.writeFileSync(path.join(dir, "a.txt"), "1\n");
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "base"]);
  return dir;
}

function hookEnv(dir, tmp) {
  const env = { ...process.env, GANTRY_PROJECT_DIR: dir, TMP: tmp, TEMP: tmp, TMPDIR: tmp };
  delete env.CLAUDHD_PROJECT_DIR;
  delete env.CLAUDE_PROJECT_DIR;
  return env;
}

function runHook(script, dir, tmp, command, sessionId) {
  const payload = { session_id: sessionId, cwd: dir, tool_name: "Bash", tool_input: { command } };
  return spawnSync(process.execPath, [script], { encoding: "utf8", input: JSON.stringify(payload), env: hookEnv(dir, tmp) });
}

function readState(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, ".now", "state.json"), "utf8"));
}

function reconcileLog(dir) {
  try { return fs.readFileSync(path.join(dir, ".now", "reconcile.log"), "utf8"); } catch { return ""; }
}

test("guard writes a pending record; verify records lastCommit with the real hash once the commit lands, and clears the record", () => {
  const dir = adoptedRepo();
  const tmp = mk();
  try {
    const sid = "s-verify-landed";
    const g = runHook(GUARD, dir, tmp, 'git commit -q -m "probe landed"', sid);
    assert.equal(g.status, 0, g.stderr);
    const pendingFiles = fs.readdirSync(tmp).filter((f) => f.startsWith("claudhd-pending-commit-"));
    assert.equal(pendingFiles.length, 1, "the guard must write exactly one pending record");
    const pending = JSON.parse(fs.readFileSync(path.join(tmp, pendingFiles[0]), "utf8"));
    assert.equal(pending.root, dir);
    assert.equal(pending.headBefore, git(dir, ["rev-parse", "HEAD"]));
    assert.equal(pending.message, "probe landed", "the guard records the message it parsed");

    // The commit the hook was intercepting now actually happens.
    fs.writeFileSync(path.join(dir, "a.txt"), "2\n");
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-q", "-m", "probe landed"]);
    const head = git(dir, ["rev-parse", "HEAD"]);

    const v = runHook(VERIFY, dir, tmp, 'git commit -q -m "probe landed"', sid);
    assert.equal(v.status, 0, v.stderr);
    assert.equal(v.stdout, "", "verify never writes to stdout");
    const st = readState(dir);
    assert.ok(st.lastCommit, "state.json must carry lastCommit");
    assert.equal(st.lastCommit.sha, head);
    assert.equal(st.lastCommit.short, head.slice(0, 7));
    assert.equal(st.lastCommit.subject, "probe landed");
    assert.equal(fs.readdirSync(tmp).filter((f) => f.startsWith("claudhd-pending-commit-")).length, 0,
      "the pending record is consumed");
    assert.doesNotMatch(reconcileLog(dir), /did not land/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("verify notes a commit that did not land (HEAD unchanged) and records no lastCommit", () => {
  const dir = adoptedRepo();
  const tmp = mk();
  try {
    const sid = "s-verify-failed";
    const g = runHook(GUARD, dir, tmp, 'git commit -q -m "probe failed"', sid);
    assert.equal(g.status, 0, g.stderr);
    // No real commit happens (a pre-commit hook rejected it, or git errored).
    const v = runHook(VERIFY, dir, tmp, 'git commit -q -m "probe failed"', sid);
    assert.equal(v.status, 0, v.stderr);
    assert.match(reconcileLog(dir), /commit did not land: HEAD unchanged/);
    const st = readState(dir);
    assert.equal(st.lastCommit, undefined, "no lastCommit for a commit that never happened");
    assert.equal(fs.readdirSync(tmp).filter((f) => f.startsWith("claudhd-pending-commit-")).length, 0,
      "the pending record is consumed even on the failure path");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("verify is a no-op without a pending record (the common Bash call): exit 0, nothing written", () => {
  const dir = adoptedRepo();
  const tmp = mk();
  try {
    const before = fs.existsSync(path.join(dir, ".now", "state.json")) ? fs.readFileSync(path.join(dir, ".now", "state.json"), "utf8") : null;
    const v = runHook(VERIFY, dir, tmp, "ls -la", "s-verify-noop");
    assert.equal(v.status, 0, v.stderr);
    assert.equal(v.stdout, "");
    const after = fs.existsSync(path.join(dir, ".now", "state.json")) ? fs.readFileSync(path.join(dir, ".now", "state.json"), "utf8") : null;
    assert.equal(after, before, "no state write without a pending record");
    assert.equal(reconcileLog(dir), "");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("verify appends the SHIPPED entry with the hash when the guard could not parse the message (-F -)", () => {
  const dir = adoptedRepo();
  const tmp = mk();
  try {
    const sid = "s-verify-nomsg";
    const g = runHook(GUARD, dir, tmp, "git commit -q -F -", sid);
    assert.equal(g.status, 0, g.stderr);
    assert.match(reconcileLog(dir), /SHIPPED entry skipped: commit message unavailable/,
      "sanity: the pre-commit pass could not write the entry");

    fs.writeFileSync(path.join(dir, "a.txt"), "3\n");
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-q", "-m", "subject only known after the fact"]);
    const short = git(dir, ["rev-parse", "HEAD"]).slice(0, 7);

    const v = runHook(VERIFY, dir, tmp, "git commit -q -F -", sid);
    assert.equal(v.status, 0, v.stderr);
    const shipped = fs.readFileSync(path.join(dir, "SHIPPED.md"), "utf8");
    assert.match(shipped, new RegExp("- subject only known after the fact `" + short + "`"));
    assert.match(reconcileLog(dir), /SHIPPED entry written post-commit with hash/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("verify drops a stale pending record (older than the age cap) without touching git state", () => {
  const dir = adoptedRepo();
  const tmp = mk();
  try {
    const pc = require(path.join(SCRIPTS, "pending-commit.js"));
    const sid = "s-verify-stale";
    const envTmp = process.env.TMP;
    // Write the record where the hook will look: pending-commit.js keys off os.tmpdir(),
    // which honors TMP/TEMP/TMPDIR, so write it by hand at the same path shape.
    const p = path.join(tmp, path.basename(pc.pendingPath(sid)));
    fs.writeFileSync(p, JSON.stringify({ root: dir, sessionId: sid, headBefore: "x", at: new Date(Date.now() - 2 * pc.MAX_AGE_MS).toISOString(), command: "git commit -m old" }));
    void envTmp;
    const v = runHook(VERIFY, dir, tmp, "git commit -m old", sid);
    assert.equal(v.status, 0, v.stderr);
    assert.match(reconcileLog(dir), /stale pending record dropped/);
    assert.ok(!fs.existsSync(p), "stale record removed");
    const st = readStateOrNull(dir);
    assert.ok(!(st && st.lastCommit), "no lastCommit from a stale record");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

function readStateOrNull(dir) {
  try { return readState(dir); } catch { return null; }
}
