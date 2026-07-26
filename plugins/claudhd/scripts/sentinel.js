#!/usr/bin/env node
/*
 * sentinel.js - write, clear, and append to the `build` section of
 * .now/state.json (schema v2; Gantry's sentinel folded in).
 *
 * Subcommands:
 *   write <plan-path> <phase-number> [session-id]
 *       Read the named phase's Files list from the plan file, compute the
 *       allow-list (plan path + two scaffolded audit docs at docs/ or root +
 *       ROADMAP.md if present), stamp started (ISO) and session, and write the
 *       sentinel into state.json's build section. Overwrites any prior
 *       sentinel.
 *
 *   clear
 *       Set the build section back to null. No-op (no throw) when already
 *       absent.
 *
 *   add-files <path> [<path>...]
 *       Append one or more paths to the active sentinel's files list,
 *       idempotently. No-op when no sentinel exists.
 *
 * The sentinel is ONLY written/removed by this script (invoked over Bash by the
 * orchestrator). It is never written or removed via a tool op (Edit/Write/rm),
 * which preserves the deadlock-avoidance property: the file-list guard matches
 * Edit|Write|MultiEdit (not Bash), and the commit-guard only denies git
 * commit/push, so a `node sentinel.js` Bash call passes both guards untouched.
 *
 * Every write goes through state.js's merge-preserving, locked writeStateAtomic,
 * naming `build` as the only key this script owns, so a Stop hook checkpoint
 * racing a sentinel write can never clobber the other's section.
 *
 * Path normalization reuses sentinel-core.js so the write side and read side
 * (the guards) cannot drift on path interpretation.
 */
"use strict";
const fs = require("fs");
const path = require("path");

const { resolveRoot, normalize, readSentinel } = require("./sentinel-core.js");
const { writeStateAtomic } = require("./state.js");

const ROOT = resolveRoot(process.env);
const NOW_DIR = path.join(ROOT, ".now");

// ---------------------------------------------------------------------------
// Plan parsing
// ---------------------------------------------------------------------------

// Extract the LEADING run of backtick-quoted paths from a bullet line: the
// first backtick-quoted token, plus every subsequent one that is separated
// from its predecessor by nothing but a comma and whitespace (", "). The run
// stops at the first gap that is not exactly ", " - which is exactly what
// separates a bullet's file list ("- modify `a.js`, `b.js`, `c.js`") from a
// trailing parenthetical description that happens to contain its own
// backtick-quoted identifiers ("- modify `x.js` (`SOME_CONST`; add `helper`)"
// must yield only `x.js`, not SOME_CONST or helper).
function extractLeadingBacktickRun(line) {
  const tokens = [];
  const re = /`([^`]+)`/g;
  let m;
  while ((m = re.exec(line)) !== null) {
    tokens.push({ text: m[1], start: m.index, end: m.index + m[0].length });
  }
  if (tokens.length === 0) return [];
  const run = [tokens[0].text];
  for (let i = 1; i < tokens.length; i++) {
    const between = line.slice(tokens[i - 1].end, tokens[i].start);
    if (!/^,\s*$/.test(between)) break;
    run.push(tokens[i].text);
  }
  return run;
}

// Parse the Files: list for a given phase number from plan text.
// Returns an array of repo-relative POSIX paths, in order.
//
// Handles TWO canonical formats:
//
//   INLINE (PLAN.md template canonical shape):
//     **Files:** `path/to/file.js`, `path/to/other.js`
//
//   BULLET (phase-hooks-plan.md and most real plans):
//     **Files:**
//     - create `path/to/file.js` (optional description)
//     - modify `path/to/other.js`: optional description
//     - modify `path/one.js`, `path/two.js` (both changed together)
//
// The inline form is extracted from the **Files:** line itself (every
// backtick-quoted token on that line is a path). The bullet form is extracted
// from subsequent `- ` lines until the next bold heading (**...) or ## heading:
// each bullet contributes its LEADING run of comma-separated backtick-quoted
// paths (see extractLeadingBacktickRun), so a multi-file bullet contributes
// every file it names, while backtick-quoted identifiers in a trailing
// description (constants, function names, section names) are not swept in.
//
// Returns an empty array if the phase or Files section is not found.
// Callers MUST treat an empty return as a fatal error (fail-open; do not
// write a sentinel with an empty scope).
function parsePhaseFiles(planText, phaseNumber) {
  const lines = planText.split("\n");
  const phaseRe = new RegExp("^##\\s+Phase\\s+" + phaseNumber + "[^0-9]");
  const filesHeadRe = /^\*\*Files:\*\*/;
  const nextSectionRe = /^(##\s|\*\*)/;

  // 1. Find the phase heading line.
  let phaseIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (phaseRe.test(lines[i])) { phaseIdx = i; break; }
  }
  if (phaseIdx === -1) return [];

  // 2. Find the **Files:** line within this phase.
  let filesIdx = -1;
  for (let i = phaseIdx + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) break; // reached the next phase heading - stop
    if (filesHeadRe.test(lines[i])) { filesIdx = i; break; }
  }
  if (filesIdx === -1) return [];

  const files = [];

  // 3a. INLINE format: extract all backtick-wrapped tokens from the **Files:**
  //     line itself (everything after "**Files:**").
  //     E.g. "**Files:** `src/a.js`, `src/b.js`" -> ["src/a.js", "src/b.js"]
  const filesLine = lines[filesIdx];
  const inlinePart = filesLine.replace(/^\*\*Files:\*\*/, "");
  const inlineRe = /`([^`]+)`/g;
  let m;
  while ((m = inlineRe.exec(inlinePart)) !== null) {
    files.push(m[1]);
  }

  // 3b. BULLET format: collect `- ` lines that follow until the next bold
  //     heading or ## heading, extracting each bullet's leading run of
  //     comma-separated backtick-quoted paths (every file the bullet names).
  for (let i = filesIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (nextSectionRe.test(line)) break;
    if (!/^-\s/.test(line)) continue;
    for (const f of extractLeadingBacktickRun(line)) files.push(f);
  }

  return files;
}

// ---------------------------------------------------------------------------
// Allow-list computation
// ---------------------------------------------------------------------------

// Compute the allow-list for a sentinel given the plan path and project root.
// Mirrors init.js's docDir logic: audit docs go in docs/ if it exists, else root.
// Also includes ROADMAP.md only when that file actually exists at the project root.
function computeAllow(planAbsPath) {
  // Normalize the plan path to a root-relative POSIX string.
  const planRel = _toRelPosix(planAbsPath);

  // docDir: "docs" if docs/ exists under ROOT, else "." (root)
  const docsExists = _exists(path.join(ROOT, "docs"));
  const docDir = docsExists ? "docs" : ".";

  const auditDocs = [
    "CURRENTNESS_AUDIT.md",
    "RUNTIME_VERIFICATION_QUEUE.md",
  ].map((name) => {
    const rel = docDir === "." ? name : docDir + "/" + name;
    return rel;
  });

  const allow = [planRel, ...auditDocs];

  // ROADMAP.md only when it actually exists at the project root.
  if (_exists(path.join(ROOT, "ROADMAP.md"))) {
    allow.push("ROADMAP.md");
  }

  return allow;
}

// Convert an absolute path to a root-relative POSIX string, using normalize()
// from sentinel-core so both sides use identical logic. Falls back to a best-
// effort path.join-based relative if normalize returns FAIL_OPEN (should not
// happen for valid plan paths under ROOT, but we must not throw).
const { FAIL_OPEN } = require("./sentinel-core.js");
function _toRelPosix(absPath) {
  const result = normalize(absPath, ROOT);
  if (result === FAIL_OPEN) {
    // Fallback: compute relative path manually, convert separators.
    return path.relative(ROOT, absPath).replace(/\\/g, "/");
  }
  return result;
}

function _exists(p) {
  try { return fs.existsSync(p); } catch { return false; }
}

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

function cmdWrite(args) {
  const planArg = args[0];
  const phaseArg = args[1];
  const sessionArg = args[2];

  if (!planArg || !phaseArg) {
    console.error("sentinel.js write: usage: write <plan-path> <phase-number> [session-id]");
    process.exit(1);
  }

  const phaseNumber = parseInt(phaseArg, 10);
  if (isNaN(phaseNumber)) {
    console.error("sentinel.js write: phase-number must be an integer, got: " + phaseArg);
    process.exit(1);
  }

  // Resolve the plan path relative to ROOT if it is not absolute.
  const planAbsPath = path.isAbsolute(planArg) ? planArg : path.join(ROOT, planArg);

  let planText;
  try {
    planText = fs.readFileSync(planAbsPath, "utf8");
  } catch (e) {
    console.error("sentinel.js write: cannot read plan file " + planAbsPath + ": " + e.message);
    process.exit(1);
  }

  const files = parsePhaseFiles(planText, phaseNumber);

  // Zero files = fail-open: do NOT write a sentinel with an empty scope.
  // An empty files[] would cause the guard to deny every Edit/Write (fail-CLOSED),
  // which is the cardinal sin. Print a clear diagnostic and exit non-zero so the
  // caller knows no sentinel was written and the phase runs unguarded.
  if (files.length === 0) {
    process.stderr.write(
      "sentinel: could not parse any files from phase " + phaseNumber +
      " of " + planAbsPath + "; not writing sentinel\n"
    );
    process.exit(1);
  }

  const allow = computeAllow(planAbsPath);

  // Session: explicit arg > GANTRY_SESSION_ID (explicit override) >
  // CLAUDE_CODE_SESSION_ID (the real env var Claude Code injects into Bash
  // hooks; it holds the same UUID the PreToolUse stdin delivers as session_id,
  // which is what the staleness check in the guard compares against) > "".
  const session = sessionArg ||
    process.env.GANTRY_SESSION_ID ||
    process.env.CLAUDE_CODE_SESSION_ID ||
    "";

  const planRel = _toRelPosix(planAbsPath);

  const sentinel = {
    plan: planRel,
    phase: phaseNumber,
    files,
    allow,
    started: new Date().toISOString(),
    session,
  };

  try {
    writeStateAtomic(NOW_DIR, { build: sentinel }, ["build"]);
  } catch (e) {
    console.error("sentinel.js write: cannot write sentinel: " + e.message);
    process.exit(1);
  }

  console.log("sentinel.js: wrote phase " + phaseNumber + " sentinel (" + files.length + " file(s) in scope)");
}

function cmdClear() {
  // readSentinel also performs the one-shot legacy import (see sentinel-core.js),
  // so a clear on a project that never re-ran /claudhd:build since upgrading
  // still imports-then-clears the legacy sentinel rather than leaving it
  // stranded on disk.
  let current;
  try { current = readSentinel(ROOT); } catch { current = null; }
  if (current == null) return; // no-op for an already-absent sentinel - exit 0 silently.

  try {
    writeStateAtomic(NOW_DIR, { build: null }, ["build"]);
    console.log("sentinel.js: cleared the active phase");
  } catch (e) {
    console.error("sentinel.js clear: unexpected error: " + e.message);
    process.exit(1);
  }
}

function cmdAddFiles(args) {
  if (args.length === 0) {
    // Nothing to add; no-op.
    return;
  }

  // Read the active sentinel; no-op if absent.
  let sentinel;
  try {
    sentinel = readSentinel(ROOT);
    if (sentinel == null) return;
  } catch {
    // Absent or malformed - no-op.
    return;
  }

  if (!Array.isArray(sentinel.files)) sentinel.files = [];

  let added = 0;
  for (const p of args) {
    if (!sentinel.files.includes(p)) {
      sentinel.files.push(p);
      added++;
    }
  }

  if (added > 0) {
    try {
      writeStateAtomic(NOW_DIR, { build: sentinel }, ["build"]);
      console.log("sentinel.js: added " + added + " path(s) to sentinel files");
    } catch (e) {
      console.error("sentinel.js add-files: cannot write sentinel: " + e.message);
      process.exit(1);
    }
  }
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

const [,, subcommand, ...rest] = process.argv;

switch (subcommand) {
  case "write":
    cmdWrite(rest);
    break;
  case "clear":
    cmdClear();
    break;
  case "add-files":
    cmdAddFiles(rest);
    break;
  default:
    console.error(
      "sentinel.js: unknown subcommand: " + subcommand + "\n" +
      "Usage:\n" +
      "  sentinel.js write <plan-path> <phase-number> [session-id]\n" +
      "  sentinel.js clear\n" +
      "  sentinel.js add-files <path> [<path>...]\n"
    );
    process.exit(1);
}
