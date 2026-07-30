#!/usr/bin/env node
"use strict";
/*
 * ClauDHD release loop - one command to cut a release.
 *
 *   preconditions (on main, clean tree)
 *   -> run tests -> validate both manifests
 *   -> bump version in BOTH manifests (kept in sync)
 *   -> commit -> push -> tag --push
 *
 * Usage:
 *   node tools/release.js [patch|minor|major|X.Y.Z] [--dry-run]
 *   npm run release -- minor
 *
 * Tests + validation run BEFORE any file is touched, so a failure never
 * leaves the tree half-bumped. Lives in tools/ so it never ships with the
 * installed plugin. Zero dependencies; shells out to git + claude.
 */
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const PLUGIN_JSON = path.join(ROOT, "plugins", "claudhd", ".claude-plugin", "plugin.json");
const MARKET_JSON = path.join(ROOT, ".claude-plugin", "marketplace.json");
const PLUGIN_DIR = path.join("plugins", "claudhd"); // relative, for `claude plugin tag`

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const bumpArg = args.find((a) => !a.startsWith("-")) || "patch";

function loud(cmd, cmdArgs) {
  // Stream output so the operator sees tests/validation as they run.
  execFileSync(cmd, cmdArgs, { cwd: ROOT, stdio: "inherit" });
}
function quiet(cmd, cmdArgs) {
  try { return execFileSync(cmd, cmdArgs, { cwd: ROOT, encoding: "utf8" }).trim(); }
  catch { return ""; }
}
function die(msg) { console.error("✘ " + msg); process.exit(1); }

// --- preconditions ---
const branch = quiet("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
if (branch !== "main") die(`on branch '${branch}', expected 'main'. Switch to main first.`);
const dirty = quiet("git", ["status", "--porcelain"]);
if (dirty) die("working tree is not clean. Commit or stash first:\n" + dirty);

// --- current + next version ---
const curr = JSON.parse(fs.readFileSync(PLUGIN_JSON, "utf8")).version;
if (!/^\d+\.\d+\.\d+$/.test(curr)) die("plugin.json has no semver version (got: " + curr + ")");
let next;
if (/^\d+\.\d+\.\d+$/.test(bumpArg)) {
  next = bumpArg;
} else {
  const [maj, min, pat] = curr.split(".").map(Number);
  if (bumpArg === "major") next = `${maj + 1}.0.0`;
  else if (bumpArg === "minor") next = `${maj}.${min + 1}.0`;
  else if (bumpArg === "patch") next = `${maj}.${min}.${pat + 1}`;
  else die(`unknown bump '${bumpArg}'. Use patch|minor|major|X.Y.Z.`);
}
const tag = `claudhd--v${next}`;
console.log(`ClauDHD release: ${curr} -> ${next}  (tag ${tag})${DRY ? "  [DRY RUN]" : ""}\n`);

// --- gate on a green, valid tree BEFORE bumping anything ---
console.log("• running tests...");
// Scoped to the plugin's own zero-dependency suite, matching package.json's
// `test` script. A bare `node --test` discovers app/test/*.test.ts too - the
// desktop app's vitest suite, which node's runner cannot execute - so it failed
// unconditionally once the app was folded in under app/, blocking every
// release. The app ships separately and has its own gate (`npm run test:app`);
// a plugin release is gated on what the plugin actually ships.
loud("node", ["--test", "test/*.test.js"]);
console.log("• validating manifests...");
loud("claude", ["plugin", "validate", PLUGIN_DIR]);
loud("claude", ["plugin", "validate", "."]);

if (DRY) {
  console.log(`\n[DRY RUN] tree is green + valid. Would bump to ${next}, commit "chore: release v${next}", push, and tag ${tag} --push.`);
  process.exit(0);
}

// --- bump, commit, push, tag ---
function setVersion(file) {
  const txt = fs.readFileSync(file, "utf8");
  const out = txt.replace(/("version"\s*:\s*")\d+\.\d+\.\d+(")/g, `$1${next}$2`);
  if (out === txt) die("no version field updated in " + file);
  fs.writeFileSync(file, out);
}
try {
  setVersion(PLUGIN_JSON);
  setVersion(MARKET_JSON);
  loud("git", ["add", PLUGIN_JSON, MARKET_JSON]);
  loud("git", ["commit", "-m", "chore: release v" + next]);
  loud("git", ["push", "origin", "main"]);
  loud("claude", ["plugin", "tag", PLUGIN_DIR, "--push", "-m", "ClauDHD %s"]);
} catch (e) {
  die("release step failed (tree may have a local bump/commit to inspect):\n" + (e.message || String(e)));
}

console.log(`\n✔ Released v${next} and pushed tag ${tag}.`);
console.log("  Consumers (incl. you) update with:");
console.log("    claude plugin marketplace update claudhd && claude plugin update claudhd@claudhd");
console.log("  then restart Claude Code.");
