"use strict";
/*
 * Manifest invariants - guards the two failure modes that break a release:
 *   1. plugin.json and the marketplace entry disagreeing on version (so
 *      `claude plugin update` either misfires or never fires), and
 *   2. the manifest re-declaring the standard hooks/hooks.json, which Claude
 *      Code auto-loads - the "Hook load failed: Duplicate hooks file detected"
 *      error that made fresh installs show up disabled.
 * Pure JSON reads, zero dependencies; runs in `npm test`, in CI, and inside
 * the release gate (tools/release.js).
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const PLUGIN = path.join(ROOT, "plugins", "claudhd", ".claude-plugin", "plugin.json");
const MARKET = path.join(ROOT, ".claude-plugin", "marketplace.json");
const HOOKS = path.join(ROOT, "plugins", "claudhd", "hooks", "hooks.json");

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const entryFor = (market, plugin) => market.plugins.find((p) => p.name === plugin.name);

test("both manifests are valid JSON with a semver version", () => {
  const plugin = readJson(PLUGIN);
  const market = readJson(MARKET);
  assert.match(plugin.version, /^\d+\.\d+\.\d+$/, "plugin.json version must be semver");
  const entry = entryFor(market, plugin);
  assert.ok(entry, "marketplace.json must have a plugin entry matching plugin.json name");
  assert.match(entry.version, /^\d+\.\d+\.\d+$/, "marketplace entry version must be semver");
});

test("plugin.json and the marketplace entry agree on version (release invariant)", () => {
  const plugin = readJson(PLUGIN);
  const entry = entryFor(readJson(MARKET), plugin);
  assert.equal(entry.version, plugin.version,
    `version mismatch: plugin.json=${plugin.version} marketplace=${entry.version} - bump both together (npm run release)`);
});

test("manifest does not re-declare the auto-loaded hooks/hooks.json (fresh-install blocker)", () => {
  // Claude Code auto-loads hooks/hooks.json. A manifest "hooks" path that also
  // points at it double-registers and fails to load. The manifest may only
  // reference ADDITIONAL hook files. (An inline hooks object is fine - only a
  // path reference to the standard file is the bug.)
  const h = readJson(PLUGIN).hooks;
  const offenders = [];
  const check = (v) => {
    if (typeof v === "string" && /(^|\/)hooks\/hooks\.json$/.test(v.replace(/^\.\//, ""))) offenders.push(v);
  };
  if (typeof h === "string") check(h);
  else if (Array.isArray(h)) h.forEach(check);
  assert.equal(offenders.length, 0,
    "plugin.json must NOT reference the standard hooks/hooks.json (it auto-loads). Offending: " + JSON.stringify(offenders));
});

test("hooks/hooks.json is valid JSON and wires the Stop + SessionStart hooks", () => {
  const hooks = readJson(HOOKS).hooks;
  assert.ok(hooks && hooks.SessionStart, "SessionStart hook must be configured");
  assert.ok(hooks && hooks.Stop, "Stop hook must be configured");
});
