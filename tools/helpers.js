"use strict";
/*
 * Shared test helpers. Spins up throwaway git repos in the OS temp dir and runs
 * the real ClauDHD scripts against them with CLAUDE_PROJECT_DIR pointed at the
 * repo, exactly as the hooks/commands invoke them. Zero dependencies: Node's
 * built-in test runner + child_process only.
 *
 * Lives in tools/ (not test/) so Node's test runner doesn't execute it as a
 * test file - it is imported by the real tests under test/.
 */
const { execFileSync, spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SCRIPTS = path.join(__dirname, "..", "plugins", "claudhd", "scripts");
const MARKER = "<!-- claudhd: opt-in marker -->";

function scriptPath(name) {
  return path.join(SCRIPTS, name);
}

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "claudhd-test-"));
  const git = (args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "test@example.com"]);
  git(["config", "user.name", "Test"]);
  git(["config", "commit.gpgsign", "false"]);
  git(["config", "core.autocrlf", "false"]);
  return { dir, git };
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

// Build the child env: point the scripts at the throwaway repo, and strip any
// ambient CLAUDHD_PROJECT_DIR so a value set in the outer shell can't override
// the repo we mean to test. `extra` (e.g. CLAUDHD_PROJECT_DIR, CLAUDE_CONFIG_DIR)
// is layered on last so individual tests can exercise the env-var precedence.
function childEnv(dir, extra) {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: dir };
  delete env.CLAUDHD_PROJECT_DIR;
  return Object.assign(env, extra || {});
}

// Run a ClauDHD script synchronously in the repo. Returns { stdout, stderr, status }.
function run(dir, name, args = [], extra = {}) {
  const res = spawnSync(process.execPath, [scriptPath(name), ...args], {
    encoding: "utf8",
    env: childEnv(dir, extra),
  });
  return { stdout: res.stdout || "", stderr: res.stderr || "", status: res.status };
}

// Run a script asynchronously, for concurrency tests. Resolves on process exit.
function runAsync(dir, name, args = [], extra = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath(name), ...args], {
      env: childEnv(dir, extra),
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (status) => resolve({ stdout, stderr, status }));
  });
}

function write(dir, rel, content) {
  fs.writeFileSync(path.join(dir, rel), content);
}
function read(dir, rel) {
  return fs.readFileSync(path.join(dir, rel), "utf8");
}
function exists(dir, rel) {
  return fs.existsSync(path.join(dir, rel));
}
function nowFile(thread) {
  return `# NOW\n${MARKER}\n\n## Active thread\n\n**${thread}**\n\n- [ ] step\n`;
}

// Opt a repo into ClauDHD: marked NOW.md + .gitignore committed, so NOW.md
// rides the branch and .now/ stays local.
function optIn(dir, git, thread = "main thread") {
  write(dir, ".gitignore", ".now/\n");
  write(dir, "NOW.md", nowFile(thread));
  git(["add", ".gitignore", "NOW.md"]);
  git(["commit", "-q", "-m", "init claudhd"]);
}

module.exports = { makeRepo, cleanup, run, runAsync, write, read, exists, nowFile, optIn, scriptPath };
