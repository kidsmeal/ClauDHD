#!/usr/bin/env node
/*
 * ClauDHD init - the /claudhd:init command.
 *
 * Scaffolds NOW.md, IDEAS.md, and SHIPPED.md into the current project from the
 * bundled templates (never overwriting an existing file), and adds .now/ to the
 * project's .gitignore. This is how a project opts in to ClauDHD.
 */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const TEMPLATES = path.join(__dirname, "..", "templates");

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
