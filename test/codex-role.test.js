"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SCRIPT = path.join(__dirname, "..", "plugins", "claudhd", "scripts", "codex-role.js");
const core = require("../plugins/claudhd/scripts/codex-role-core.js");

function mk() { return fs.mkdtempSync(path.join(os.tmpdir(), "claudhd-codex-role-")); }
function run(dir, role, extraEnv) {
  return spawnSync(process.execPath, [SCRIPT, "resolve", role], {
    encoding: "utf8",
    env: { ...process.env, CLAUDHD_PROJECT_DIR: dir, ...extraEnv },
  });
}
function writeOverride(dir, value) {
  fs.mkdirSync(path.join(dir, ".gantry"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".gantry", "models.codex.json"), value);
}

test("default profile emits explicit Codex spawn settings for every role", () => {
  const dir = mk();
  try {
    const expected = {
      chat: ["orchestrator", "gpt-6-astra", "medium", null],
      orchestrator: ["orchestrator", "gpt-6-astra", "medium", null],
      "phase-planner": ["phase-planner", "gpt-6-astra", "medium", "phase-planner.md"],
      "design-reviewer": ["design-reviewer", "gpt-5.6-sol", "high", "design-reviewer.md"],
      "phase-reviewer": ["phase-reviewer", "gpt-5.6-sol", "high", "phase-reviewer.md"],
      implementer: ["implementer", "gpt-5.6-terra", "high", "implementer.md"],
    };
    for (const [role, [canonical, model, effort, instructionName]] of Object.entries(expected)) {
      const result = run(dir, role, { CODEX_MODEL: "do-not-inherit-this" });
      assert.equal(result.status, 0, result.stderr);
      const profile = JSON.parse(result.stdout);
      assert.equal(profile.requested_role, role);
      assert.equal(profile.role, canonical);
      assert.equal(profile.model, model);
      assert.equal(profile.reasoning_effort, effort);
      assert.equal(profile.fork_turns, "none");
      if (instructionName === null) assert.equal(profile.instruction_path, null);
      else {
        assert.equal(path.basename(profile.instruction_path), instructionName);
        assert.equal(fs.existsSync(profile.instruction_path), true);
      }
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("project override replaces one complete role profile", () => {
  const dir = mk();
  try {
    writeOverride(dir, JSON.stringify({
      roles: { "phase-planner": { model: "gpt-5.6-sol", reasoning_effort: "high" } },
    }));
    const result = run(dir, "phase-planner");
    assert.equal(result.status, 0, result.stderr);
    const profile = JSON.parse(result.stdout);
    assert.equal(profile.model, "gpt-5.6-sol");
    assert.equal(profile.reasoning_effort, "high");
    assert.equal(profile.fork_turns, "none");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("explicit malformed or invalid override fails instead of falling back", () => {
  const dir = mk();
  try {
    writeOverride(dir, "{");
    let result = run(dir, "phase-reviewer");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /models\.codex\.json contains invalid JSON/);

    writeOverride(dir, JSON.stringify({
      roles: { "phase-reviewer": { model: "gpt-5.6-sol", reasoning_effort: "turbo" } },
    }));
    result = run(dir, "phase-reviewer");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /reasoning_effort 'turbo' is unsupported/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("override schema rejects unknown role and partial assignment", () => {
  assert.throws(
    () => core.parseOverride(JSON.stringify({ roles: { reviewer: { model: "gpt-5.6-sol", reasoning_effort: "high" } } }), "override"),
    /unknown role 'reviewer'/
  );
  assert.throws(
    () => core.parseOverride(JSON.stringify({ roles: { implementer: { model: "gpt-5.6-terra" } } }), "override"),
    /reasoning_effort must be a non-empty string/
  );
});
