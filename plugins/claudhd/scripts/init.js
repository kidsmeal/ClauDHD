#!/usr/bin/env node
/*
 * ClauDHD init - the /claudhd:init command.
 *
 * Scaffolds NOW.md, IDEAS.md, and SHIPPED.md into the current project from the
 * bundled templates (never overwriting an existing file), ensures NOW.md carries
 * the opt-in marker the hooks gate on, and adds .now/ to the project's
 * .gitignore. This is how a project opts in to ClauDHD.
 *
 * Unlike the silent Stop/SessionStart hooks, init is an explicit command: if it
 * cannot write a file it says so clearly and exits non-zero, rather than
 * shrugging.
 *
 * After scaffolding it prints a few read-only repo signals (branch, recent
 * commits, uncommitted files) so the /claudhd:init command can propose a first
 * active thread for you to confirm, instead of asking you to name it cold.
 */
"use strict";
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// Provider-neutral first, then Claude Code's var, then cwd.
const ROOT = process.env.CLAUDHD_PROJECT_DIR || process.env.CLAUDE_PROJECT_DIR || process.cwd();
const TEMPLATES = path.join(__dirname, "..", "templates");
const MARKER = "<!-- claudhd: opt-in marker (do not remove) -->";

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
const failed = [];
for (const name of ["NOW.md", "IDEAS.md", "SHIPPED.md", "ROADMAP.md"]) {
  const dest = path.join(ROOT, name);
  if (fs.existsSync(dest)) { kept.push(name); continue; }
  try {
    fs.copyFileSync(path.join(TEMPLATES, name), dest);
    created.push(name);
  } catch (e) {
    failed.push(name + " (" + e.message + ")");
  }
}

// Ensure NOW.md carries the opt-in marker the hooks gate on, even if it
// pre-existed without one. Without this, an already-present NOW.md would go
// dormant under the marker gate.
let markerNote = "present";
const nowPath = path.join(ROOT, "NOW.md");
try {
  if (fs.existsSync(nowPath)) {
    const c = fs.readFileSync(nowPath, "utf8");
    if (!c.includes("<!-- claudhd")) {
      fs.writeFileSync(nowPath, MARKER + "\n\n" + c);
      markerNote = "added to existing NOW.md";
    }
  }
} catch (e) {
  failed.push("NOW.md marker (" + e.message + ")");
}

const gi = path.join(ROOT, ".gitignore");
let giTxt = "";
try { giTxt = fs.existsSync(gi) ? fs.readFileSync(gi, "utf8") : ""; } catch { /* ignore */ }
let giNote;
if (/(^|\n)\.now\/?\s*(\n|$)/.test(giTxt)) {
  giNote = "already ignores .now/";
} else {
  try {
    fs.writeFileSync(gi, giTxt.replace(/\s*$/, "") + "\n\n# ClauDHD local session state\n.now/\n");
    giNote = "added .now/";
  } catch (e) {
    giNote = "FAILED to update (" + e.message + ")";
  }
}

console.log(
  "ClauDHD init complete.\n" +
  "  Created: " + (created.length ? created.join(", ") : "none (all already present)") + "\n" +
  "  Kept existing: " + (kept.length ? kept.join(", ") : "none") + "\n" +
  "  NOW.md marker: " + markerNote + "\n" +
  "  .gitignore: " + giNote
);

if (failed.length) {
  console.error("! ClauDHD: could not write " + failed.join("; ") + ".\n" +
    "  Fix the cause (permissions / disk) and re-run /claudhd:init.");
  process.exit(1);
}

// Read-only repo signals, so the command can PROPOSE a first active thread
// instead of asking you to name it cold. Pure reads; nothing is modified.
const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
const recent = git(["log", "-8", "--oneline"]);

// Real uncommitted work only - filter out ClauDHD's own footprint (the
// NOW.md/IDEAS.md/SHIPPED.md we just scaffolded, plus the .gitignore we just
// touched, all already reported above), so init doesn't echo its own changes
// back as drift. Use plain paths (diff --name-only + ls-files), not
// `status --short` columns: git() trims its output, which would shift the first
// line's status code and corrupt column parsing (same reason brief.js avoids it).
// Match the exact root-relative path git reports, NOT the basename - else a real
// file like docs/NOW.md would be wrongly swallowed as our own scaffolding.
const own = new Set(["NOW.md", "IDEAS.md", "SHIPPED.md", "ROADMAP.md", ".gitignore"]);
const tracked = git(["diff", "--name-only", "HEAD"]);
const untracked = git(["ls-files", "--others", "--exclude-standard"]);
const dirty = [...new Set(
  (tracked + "\n" + untracked)
    .split(/\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((p) => !own.has(p))
)];

if (branch || recent || dirty.length) {
  console.log("\n--- Repo signals (to propose your first active thread) ---");
  if (branch) console.log("Branch: " + branch);
  if (recent) console.log("\nRecent commits:\n" + recent);
  if (dirty.length) console.log("\nUncommitted paths:\n" + dirty.map((p) => "  " + p).join("\n"));
} else {
  console.log("\n--- Repo signals: none (fresh or non-git project; just ask me what I'm working on) ---");
}
