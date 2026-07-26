#!/usr/bin/env node
/*
 * sentinel.js - write, clear, and append to .gantry/active-phase.json.
 *
 * Subcommands:
 *   write <plan-path> <phase-number> [session-id]
 *       Read the named phase's Files list from the plan file, compute the
 *       allow-list (plan path + two scaffolded audit docs at docs/ or root +
 *       ROADMAP.md if present), stamp started (ISO) and session, and write the
 *       sentinel via fs. Overwrites any prior sentinel.
 *
 *   clear
 *       Remove .gantry/active-phase.json. No-op (no throw) when absent.
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
 * Path normalization reuses sentinel-core.js so the write side and read side
 * (the guards) cannot drift on path interpretation.
 */
"use strict";
const fs = require("fs");
const path = require("path");

const { resolveRoot, normalize } = require("./sentinel-core.js");

const ROOT = resolveRoot(process.env);
const SENTINEL_PATH = path.join(ROOT, ".gantry", "active-phase.json");

// ---------------------------------------------------------------------------
// Plan parsing
// ---------------------------------------------------------------------------

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
//
// In both cases the first backtick-quoted token on each relevant line is a
// file path. The inline form is extracted from the **Files:** line itself;
// the bullet form is extracted from subsequent `- ` lines until the next
// bold heading (**...) or ## heading.
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
  //     heading or ## heading, extracting the FIRST backtick-quoted token.
  for (let i = filesIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (nextSectionRe.test(line)) break;
    const bm = line.match(/^-\s.*?`([^`]+)`/);
    if (bm) files.push(bm[1]);
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
    fs.mkdirSync(path.join(ROOT, ".gantry"), { recursive: true });
    fs.writeFileSync(SENTINEL_PATH, JSON.stringify(sentinel, null, 2) + "\n", "utf8");
  } catch (e) {
    console.error("sentinel.js write: cannot write sentinel: " + e.message);
    process.exit(1);
  }

  console.log("sentinel.js: wrote phase " + phaseNumber + " sentinel (" + files.length + " file(s) in scope)");
}

function cmdClear() {
  try {
    fs.unlinkSync(SENTINEL_PATH);
    console.log("sentinel.js: cleared active-phase.json");
  } catch (e) {
    // ENOENT means the file was already absent - that is the desired state.
    if (e.code !== "ENOENT") {
      console.error("sentinel.js clear: unexpected error: " + e.message);
      process.exit(1);
    }
    // No-op for absent sentinel - exit 0 silently.
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
    const raw = fs.readFileSync(SENTINEL_PATH, "utf8");
    sentinel = JSON.parse(raw);
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
      fs.writeFileSync(SENTINEL_PATH, JSON.stringify(sentinel, null, 2) + "\n", "utf8");
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
