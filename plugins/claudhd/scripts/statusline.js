#!/usr/bin/env node
/*
 * ClauDHD statusline - one-line cursor display for the Claude Code status bar.
 *
 * Reads the statusline JSON from stdin (Claude Code statusline protocol).
 * Extracts cwd, reads NOW.md, and prints one line:
 *   <active thread> [q:<n>] [stale]
 *
 * Silent if NOW.md is absent or not marked as a ClauDHD project.
 * File reads only - no git calls, no locks.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { activeThread } = require("./nowfile.js");
const { CURSOR_STALE_HOURS, STATUSLINE_THREAD_CAP } = require("./constants.js");

function ageHours(p) {
  try { return (Date.now() - fs.statSync(p).mtimeMs) / 3600000; } catch { return null; }
}

function section(text, heading) {
  const esc = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = text.match(new RegExp(esc + "[\\s\\S]*?(?=\\n## |$)"));
  return m ? m[0].trim() : "";
}

// Resolve the project root from stdin JSON, with env-var fallback for tests and
// manual invocations.
let root = process.env.CLAUDHD_PROJECT_DIR || process.env.CLAUDE_PROJECT_DIR || process.cwd();
try {
  const raw = fs.readFileSync(0, "utf8").trim();
  if (raw) {
    const obj = JSON.parse(raw);
    if (obj && typeof obj.cwd === "string" && obj.cwd) root = obj.cwd;
  }
} catch { /* fallback to env/cwd */ }

const nowPath = path.join(root, "NOW.md");

try {
  let txt = "";
  try { txt = fs.existsSync(nowPath) ? fs.readFileSync(nowPath, "utf8") : ""; } catch { txt = ""; }
  if (!txt || !txt.includes("<!-- claudhd")) process.exit(0);

  let thread = activeThread(txt);
  if (!thread) process.exit(0);
  // NOW.md is committed/branch-aware, so a pulled file could carry a huge or
  // multi-line active thread. Collapse to one line and cap it so it can't flood
  // or garble the status bar (single-line ellipsis, not the brief's marker).
  thread = thread.replace(/\s+/g, " ").trim();
  if (thread.length > STATUSLINE_THREAD_CAP) {
    thread = thread.slice(0, STATUSLINE_THREAD_CAP - 1).trimEnd() + "…";
  }

  const quickSection = section(txt, "## Quick fixes");
  const quickOpen = quickSection ? (quickSection.match(/^\s*-\s*\[ \]/gm) || []).length : 0;

  const age = ageHours(nowPath);
  const stale = age !== null && age > CURSOR_STALE_HOURS;

  const parts = [thread];
  if (quickOpen > 0) parts.push("q:" + quickOpen);
  if (stale) parts.push("[stale]");

  process.stdout.write(parts.join(" ") + "\n");
} catch { /* stay silent */ }
process.exit(0);
