#!/usr/bin/env node
/*
 * ClauDHD init - the /claudhd:init command.
 *
 * Scaffolds NOW.md, IDEAS.md, and SHIPPED.md into the current project from the
 * bundled templates (never overwriting an existing file), and adds .now/ to the
 * project's .gitignore. This is how a project opts in to ClauDHD.
 *
 * After scaffolding it prints a few read-only repo signals (branch, recent
 * commits, uncommitted files) so the /claudhd:init command can propose a first
 * active thread for you to confirm, instead of asking you to name it cold.
 */
"use strict";
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const TEMPLATES = path.join(__dirname, "..", "templates");

function git(args) {
  try {
    return execFileSync("git", ["-C", ROOT, ...args], {
      encoding: "utf8",
      timeout: 15000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

const created = [];
const kept = [];
for (const name of ["NOW.md", "IDEAS.md", "SHIPPED.md"]) {
  const dest = path.join(ROOT, name);
  if (fs.existsSync(dest)) { kept.push(name); continue; }
  try {
    fs.copyFileSync(path.join(TEMPLATES, name), dest);
    created.push(name);
  } catch { /* template missing; skip */ }
}

const gi = path.join(ROOT, ".gitignore");
let giTxt = "";
try { giTxt = fs.existsSync(gi) ? fs.readFileSync(gi, "utf8") : ""; } catch { /* ignore */ }
let giChanged = false;
if (!/(^|\n)\.now\/?\s*(\n|$)/.test(giTxt)) {
  try {
    fs.writeFileSync(gi, giTxt.replace(/\s*$/, "") + "\n\n# ClauDHD local session state\n.now/\n");
    giChanged = true;
  } catch { /* ignore */ }
}

console.log(
  "ClauDHD init complete.\n" +
  "  Created: " + (created.length ? created.join(", ") : "none (all already present)") + "\n" +
  "  Kept existing: " + (kept.length ? kept.join(", ") : "none") + "\n" +
  "  .gitignore: " + (giChanged ? "added .now/" : "already ignores .now/")
);

// Read-only repo signals, so the command can PROPOSE a first active thread
// instead of asking you to name it cold. Pure reads; nothing is modified.
const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
const recent = git(["log", "-8", "--oneline"]);
const changed = git(["status", "--short"]);

if (branch || recent || changed) {
  console.log("\n--- Repo signals (to propose your first active thread) ---");
  if (branch) console.log("Branch: " + branch);
  if (recent) console.log("\nRecent commits:\n" + recent);
  if (changed) console.log("\nUncommitted paths:\n" + changed);
} else {
  console.log("\n--- Repo signals: none (fresh or non-git project; just ask me what I'm working on) ---");
}
