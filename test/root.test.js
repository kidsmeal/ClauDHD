"use strict";
/*
 * Tests for root.js - the single project-root resolver every ClauDHD script
 * (and the two ported guards, via sentinel-core.js's re-export) must go
 * through. See design/claudhd-1.0-design_reviewed.md cross-cutting concern 3.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT_JS = path.join(__dirname, "..", "plugins", "claudhd", "scripts", "root.js");
const resolveRoot = require(ROOT_JS);
const sentinelCore = require(path.join(__dirname, "..", "plugins", "claudhd", "scripts", "sentinel-core.js"));

function mk() { return fs.mkdtempSync(path.join(os.tmpdir(), "claudhd-root-")); }
function scriptPath(name) {
  return path.join(__dirname, "..", "plugins", "claudhd", "scripts", name);
}

// --- env precedence across all four sources ---

test("resolveRoot prefers CLAUDHD_PROJECT_DIR over every other source", () => {
  const dir = mk();
  try {
    const result = resolveRoot({
      CLAUDHD_PROJECT_DIR: dir,
      GANTRY_PROJECT_DIR: "/other/gantry",
      CLAUDE_PROJECT_DIR: "/other/claude",
    });
    assert.equal(result, dir);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("resolveRoot falls back to GANTRY_PROJECT_DIR when CLAUDHD_PROJECT_DIR is absent", () => {
  const dir = mk();
  try {
    const result = resolveRoot({ GANTRY_PROJECT_DIR: dir, CLAUDE_PROJECT_DIR: "/other/claude" });
    assert.equal(result, dir);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("resolveRoot falls back to CLAUDE_PROJECT_DIR when neither CLAUDHD_PROJECT_DIR nor GANTRY_PROJECT_DIR is set", () => {
  const dir = mk();
  try {
    const result = resolveRoot({ CLAUDE_PROJECT_DIR: dir });
    assert.equal(result, dir);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("resolveRoot falls back to cwd when none of the three env vars are set", () => {
  const result = resolveRoot({});
  assert.equal(result, process.cwd());
});

test("resolveRoot defaults to process.env when called with no argument", () => {
  const dir = mk();
  const prev = process.env.CLAUDHD_PROJECT_DIR;
  try {
    process.env.CLAUDHD_PROJECT_DIR = dir;
    assert.equal(resolveRoot(), dir);
  } finally {
    if (prev === undefined) delete process.env.CLAUDHD_PROJECT_DIR;
    else process.env.CLAUDHD_PROJECT_DIR = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- the guards resolve root through this exact function, not a second copy ---

test("sentinel-core.js's resolveRoot IS root.js's resolver (re-exported, not reimplemented)", () => {
  assert.equal(sentinelCore.resolveRoot, resolveRoot,
    "the guards must resolve root through the exact same function root.js exports");
});

// --- cross-check: a state writer (checkpoint.js) and a guard (file-list-guard.js)
// resolve the SAME root from the SAME env, so a guard can never enforce against
// a different repo than the one the writer just updated. ---

test("checkpoint.js (a state writer) and file-list-guard.js (a guard) resolve the identical root from GANTRY_PROJECT_DIR", () => {
  const dir = mk();
  try {
    fs.writeFileSync(
      path.join(dir, "NOW.md"),
      "# NOW\n<!-- claudhd: opt-in marker -->\n\n## Active thread\n\n**x**\n"
    );
    const env = { ...process.env, GANTRY_PROJECT_DIR: dir };
    delete env.CLAUDHD_PROJECT_DIR;
    delete env.CLAUDE_PROJECT_DIR;

    const cp = spawnSync(process.execPath, [scriptPath("checkpoint.js")], { encoding: "utf8", env });
    assert.equal(cp.status, 0, cp.stderr);
    assert.ok(
      fs.existsSync(path.join(dir, ".now", "last-session.md")),
      "checkpoint.js must have resolved GANTRY_PROJECT_DIR as root, exactly like the guards do"
    );

    // Now prove the guard resolves the SAME root: write a sentinel in this exact
    // dir and confirm the guard (given the same env) finds it and denies an
    // out-of-scope path - it could only do that by resolving to this dir.
    fs.mkdirSync(path.join(dir, ".gantry"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".gantry", "enabled"), "");
    fs.writeFileSync(path.join(dir, ".gantry", "active-phase.json"), JSON.stringify({
      plan: "plan.md", phase: 1, files: ["src/a.js"], allow: [],
      started: new Date().toISOString(), session: "s",
    }));
    const guardPayload = JSON.stringify({
      session_id: "s",
      cwd: dir,
      hook_event_name: "PreToolUse",
      tool_name: "Edit",
      tool_input: { file_path: path.join(dir, "src", "unrelated.js") },
    });
    const g = spawnSync(process.execPath, [scriptPath(path.join("hooks", "file-list-guard.js"))], {
      encoding: "utf8", input: guardPayload, env,
    });
    assert.equal(g.status, 0, g.stderr);
    assert.ok(
      g.stdout.trim().length > 0,
      "the guard must have found the sentinel in the SAME dir checkpoint.js just wrote to, and denied the out-of-scope path"
    );
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
