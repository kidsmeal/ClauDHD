"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const BUILD = path.join(ROOT, "tools", "build-codex-plugin.js");
const build = require(BUILD);

test("build-codex-plugin creates a standalone Codex layout", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "claudhd-codex-build-"));
  const output = path.join(dir, "claudhd-codex");
  try {
    const result = spawnSync(process.execPath, [BUILD, output], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const manifest = JSON.parse(fs.readFileSync(path.join(output, ".codex-plugin", "plugin.json"), "utf8"));
    assert.equal(manifest.name, "claudhd-codex");
    const sharedManifest = JSON.parse(fs.readFileSync(path.join(ROOT, "plugins", "claudhd", ".claude-plugin", "plugin.json"), "utf8"));
    assert.equal(manifest.version, sharedManifest.version);
    assert.ok(fs.existsSync(path.join(output, "scripts", "codex-role.js")));
    assert.equal(fs.existsSync(path.join(output, "scripts", "codex-hook-adapter.js")), false);
    assert.ok(fs.existsSync(path.join(output, "agents", "implementer.md")));
    assert.ok(fs.existsSync(path.join(output, "templates", "NOW.md")));
    assert.ok(fs.existsSync(path.join(output, "commands", "build.md")));
    assert.ok(fs.existsSync(path.join(output, "hooks", "hooks.json")));
    assert.ok(fs.existsSync(path.join(output, "skills", "claudhd-codex-pipeline", "SKILL.md")));
    assert.equal(fs.existsSync(path.join(output, "skills", "pipeline", "SKILL.md")), false);
    const hooks = JSON.parse(fs.readFileSync(path.join(output, "hooks", "hooks.json"), "utf8"));
    assert.equal(hooks.hooks.PreToolUse.length, 1);
    assert.equal(hooks.hooks.PreToolUse[0].matcher, "Bash");
    assert.match(hooks.hooks.PreToolUse[0].hooks[0].command, /commit-guard\.js/);
    assert.equal(hooks.hooks.PostToolUse.length, 1);
    assert.equal(hooks.hooks.PostToolUse[0].matcher, "Bash");
    assert.match(hooks.hooks.PostToolUse[0].hooks[0].command, /commit-verify\.js/);
    const handlers = [
      ...hooks.hooks.PreToolUse.flatMap((entry) => entry.hooks),
      ...hooks.hooks.PostToolUse.flatMap((entry) => entry.hooks),
    ];
    assert.equal(handlers.every((handler) => typeof handler.commandWindows === "string"), true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("build-codex-plugin refuses source paths and unrelated non-empty output", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "claudhd-codex-build-safety-"));
  const unsafe = path.join(dir, "documents");
  try {
    fs.mkdirSync(unsafe);
    fs.writeFileSync(path.join(unsafe, "keep.txt"), "keep");
    assert.throws(() => build.safeOutput(ROOT), /source-related/);
    assert.throws(() => build.main([process.execPath, BUILD, unsafe]), /non-plugin or non-empty/);
    assert.equal(fs.readFileSync(path.join(unsafe, "keep.txt"), "utf8"), "keep");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
