"use strict";
/*
 * preflight.js: the pipeline skill's harness check. Exit 0 only inside a
 * Claude Code shell (CLAUDECODE=1); exit 2 with a refusal otherwise. The
 * skill must run it before any stage.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const PLUGIN = path.join(__dirname, "..", "plugins", "claudhd");
const PREFLIGHT = path.join(PLUGIN, "scripts", "preflight.js");

function run(envPatch) {
  const env = Object.assign({}, process.env);
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  Object.assign(env, envPatch);
  return spawnSync(process.execPath, [PREFLIGHT], { encoding: "utf8", env });
}

test("preflight passes inside a Claude Code shell (CLAUDECODE=1)", () => {
  const r = run({ CLAUDECODE: "1", CLAUDE_CODE_ENTRYPOINT: "cli" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /preflight: ok/);
  assert.match(r.stdout, /\(cli\)/, "names the entrypoint when known");
});

test("preflight refuses outside Claude Code (CLAUDECODE unset), exit 2, reason on stderr", () => {
  const r = run({});
  assert.equal(r.status, 2);
  assert.match(r.stderr, /preflight: refused/);
  assert.match(r.stderr, /Do not run any stage/);
  assert.equal(r.stdout, "");
});

test("preflight refuses when CLAUDECODE carries any value other than 1", () => {
  const r = run({ CLAUDECODE: "0" });
  assert.equal(r.status, 2);
});

test("skills/pipeline/SKILL.md runs preflight.js before any stage and stops on a non-zero exit", () => {
  const text = fs.readFileSync(path.join(PLUGIN, "skills", "pipeline", "SKILL.md"), "utf8");
  const idx = text.indexOf("scripts/preflight.js");
  assert.notEqual(idx, -1, "SKILL.md must run scripts/preflight.js");
  assert.ok(idx < text.indexOf("## Stage 1"), "preflight must come before Stage 1");
  assert.match(text, /preflight[^\n]*non-zero[^\n]*stop/i, "SKILL.md must instruct stopping on a non-zero preflight exit");
});
