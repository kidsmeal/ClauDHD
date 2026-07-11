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
const {
  CURSOR_STALE_HOURS,
  STATUSLINE_THREAD_CAP,
  ACTIVE_THREAD_LINE_BUDGET,
  CURSOR_DRIFT_DAYS,
} = require("./constants.js");

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

  // The attention flag reads .now/state.json (facts, written every Stop) rather
  // than re-parsing markdown. Pre-0.9 projects have no state.json, so the new
  // rungs simply don't fire and the mtime [stale] fallback still works. At most
  // one flag shows, worst first: size problem, then a rotting cursor, then away.
  let state = null;
  try {
    const p = path.join(root, ".now", "state.json");
    if (fs.existsSync(p)) state = JSON.parse(fs.readFileSync(p, "utf8"));
  } catch { state = null; }

  const cursor = state && state.cursor ? state.cursor : null;
  const over = cursor && Number.isFinite(cursor.activeThreadLineCount)
    && cursor.activeThreadLineCount > ACTIVE_THREAD_LINE_BUDGET;

  // [drift]: you are active (a fresh checkpoint) but the cursor's own "Last
  // touched" date lags well behind that activity - the cursor is rotting while you
  // keep working. Distinct from [stale], which is the file simply going untouched
  // because you are away.
  const genMs = state && state.generatedAt ? Date.parse(state.generatedAt) : NaN;
  const activeRecent = Number.isFinite(genMs) && (Date.now() - genMs) < CURSOR_STALE_HOURS * 3600000;
  let drift = false;
  if (activeRecent && cursor && cursor.lastTouched) {
    const touchedMs = Date.parse(cursor.lastTouched + "T00:00:00Z");
    if (Number.isFinite(touchedMs)) drift = (genMs - touchedMs) / 86400000 > CURSOR_DRIFT_DAYS;
  }

  const age = ageHours(nowPath);
  const stale = age !== null && age > CURSOR_STALE_HOURS;

  let flag = "";
  if (over) flag = "[over]";
  else if (drift) flag = "[drift]";
  else if (stale) flag = "[stale]";

  const parts = [thread];
  if (quickOpen > 0) parts.push("q:" + quickOpen);
  if (flag) parts.push(flag);

  process.stdout.write(parts.join(" ") + "\n");
} catch { /* stay silent */ }
process.exit(0);
