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
 *       sentinel into state.json's build section. A re-write for the SAME
 *       plan+phase (the /claudhd:build fix-relay path) keeps any paths a
 *       prior sentinel.js add-files call widened in, so a fix pass never
 *       loses the exact files it was sent to fix. A write for a different
 *       plan/phase overwrites cleanly.
 *
 *   clear
 *       Set the build section back to null and remove any recorded review
 *       rounds (see record-round below) - the phase is closing, so its
 *       rounds die with it. No-op (no throw) when already absent.
 *
 *   add-files <path> [<path>...]
 *       Append one or more paths to the active sentinel's files list,
 *       idempotently. No-op when no sentinel exists.
 *
 *   write-files <path> [<path>...]
 *       Write an ad-hoc sentinel scoped to an explicit file list, with no
 *       plan or phase (plan: null, phase: "quick"). This is /claudhd:quick's
 *       "scoped sentinel" (design section 6/7): the batch's clearing pass is
 *       ordinary source edits, so it needs a live sentinel like any other
 *       mode-enforced work, but it has no plan/phase to parse Files from.
 *       `allow` always includes NOW.md, since the clearing pass checks off
 *       batch items there and a live sentinel's build-mode allowlist has no
 *       generic *.md allowance to fall back on.
 *
 *       REFUSES (exit non-zero, no write) when the current build section
 *       carries an ACTIVE plan-backed phase - build.plan non-null and not
 *       stale (sol round-four ruling). Quick fixes clear BETWEEN phases,
 *       never mid-phase: overwriting a live plan-backed sentinel would
 *       silently discard its file scope, and the quick lane's own
 *       `sentinel.js clear` at the end of /claudhd:quick would then remove
 *       the phase's recorded review rounds and open the commit gate as if
 *       the phase's review had passed, when it never ran. A STALE sentinel
 *       (abandoned phase - same staleness rule the guards use) does not
 *       block; it is not really active anymore. Only when no plan-backed
 *       phase is blocking does write-files proceed, overwriting any prior
 *       (non-blocking) sentinel the same way `write` does.
 *
 *   record-round <plan-path> <phase-number> <verdict>
 *       Append one review round (verdict + the required fixes piped on
 *       stdin) to .gantry/review-round.json, for role.js to relay as
 *       re-review context (`run --context` / `show-round`). A round file
 *       recorded for a DIFFERENT plan or phase is replaced on the next
 *       `write` (see below), so another phase's rounds can never leak in.
 *       This file is a plain fs read/write, independent of state.json's
 *       merge-preserving writer - it is advisory re-review context, not part
 *       of the frozen state.json contract (docs/STATE-SCHEMA.md).
 *
 * The review-round file shares the sentinel's lifecycle: `write` for a
 * DIFFERENT plan/phase removes it (a fresh phase starts with no prior
 * rounds; a re-write for the SAME plan+phase - the /claudhd:build fix-relay
 * path - keeps it), `write-files` removes it unconditionally (it always
 * overwrites whatever sentinel preceded it), and `clear` always removes it.
 * In every one of those removal cases, the closing phase is first appended
 * as one JSON line to `.now/review-log.jsonl` (plan, phase, every recorded
 * round, started/cleared timestamps, and the original-vs-final files list
 * plus the actual git-status changed files) - see docs/STATE-SCHEMA.md for
 * the line shape. `.now/` is gitignored; this log is local-only, append-only,
 * and never blocks the phase lifecycle command that triggered it: a logging
 * failure is reported to stderr and swallowed.
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
const { execSync } = require("child_process");

const { resolveRoot, normalize, readSentinel, isStale } = require("./sentinel-core.js");
const { writeStateAtomic } = require("./state.js");

const ROOT = resolveRoot(process.env);
const NOW_DIR = path.join(ROOT, ".now");
const ROUND_PATH = path.join(ROOT, ".gantry", "review-round.json");
const REVIEW_LOG_PATH = path.join(NOW_DIR, "review-log.jsonl");

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
// Review-round file helpers
// ---------------------------------------------------------------------------

// Read .gantry/review-round.json, or null when absent/malformed. The round
// file is advisory context, so any damage reads as "no rounds recorded".
function _readRoundFile() {
  try {
    const parsed = JSON.parse(fs.readFileSync(ROUND_PATH, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

// Remove the review-round file. Never fatal: round context is advisory and
// must not block the phase lifecycle commands that call this.
function _clearRoundFile() {
  try {
    fs.unlinkSync(ROUND_PATH);
  } catch (e) {
    if (e.code !== "ENOENT") {
      process.stderr.write("sentinel.js: could not remove review-round.json: " + e.message + "\n");
    }
  }
}

// ---------------------------------------------------------------------------
// Review log (.now/review-log.jsonl) - the persistent record review rounds
// used to leave no trace of once their phase closed. See docs/STATE-SCHEMA.md
// for the line shape.
// ---------------------------------------------------------------------------

// The actual changed-file list from `git status --porcelain -z`, repo-relative
// POSIX paths, renames resolved to their NEW path. The NUL-delimited `-z` form
// is required, not the newline form: git quotes/escapes special characters
// (spaces, non-ASCII, quotes, ...) in the plain porcelain output, which would
// corrupt a path round-tripped through this log; `-z` disables that quoting
// entirely and emits paths verbatim. It also changes the field ORDER for a
// rename/copy record: `XY NEWPATH\0OLDPATH\0` (new path first), unlike the
// human-readable `XY OLDPATH -> NEWPATH` arrow form - the loop below reads
// the first field as the (new) path and, for a rename/copy status (R or C in
// either status column), consumes and discards the second (old) field.
// Best-effort: git absent, not a repo, or any error yields an empty array
// rather than blocking the log.
function _gitStatusFiles() {
  try {
    const raw = execSync("git status --porcelain -z", { cwd: ROOT, encoding: "utf8" });
    const tokens = raw.split("\0");
    if (tokens.length && tokens[tokens.length - 1] === "") tokens.pop(); // trailing split artifact

    const files = [];
    for (let i = 0; i < tokens.length; i++) {
      const entry = tokens[i];
      if (entry.length < 3) continue; // defensive: malformed/short record
      const xy = entry.slice(0, 2);
      files.push(entry.slice(3).replace(/\\/g, "/"));
      if (xy.includes("R") || xy.includes("C")) i++; // skip the paired old-path field
    }
    return files;
  } catch {
    return [];
  }
}

// Append one closed-phase line to .now/review-log.jsonl before a phase's
// recorded rounds are destroyed. `closing` names the phase being closed
// (plan, phase, started, files, originalFiles - the sentinel object, or a
// best-effort stand-in when the exact sentinel is unavailable); `round` is
// the parsed .gantry/review-round.json contents, or null when no rounds were
// ever recorded for this phase.
//
// Never blocks the caller: any failure (disk full, .now/ unwritable, a
// directory sitting where the file should be, ...) is logged to stderr and
// swallowed, so a logging problem can never stop a phase from clearing.
function _appendReviewLog(closing, round) {
  try {
    const line = JSON.stringify({
      plan: closing.plan,
      phase: closing.phase,
      rounds: round && Array.isArray(round.rounds) ? round.rounds : [],
      started: closing.started || null,
      cleared: new Date().toISOString(),
      originalFiles: Array.isArray(closing.originalFiles) ? closing.originalFiles
        : (Array.isArray(closing.files) ? closing.files : []),
      finalFiles: Array.isArray(closing.files) ? closing.files : [],
      changedFiles: _gitStatusFiles(),
    }) + "\n";
    fs.mkdirSync(NOW_DIR, { recursive: true });
    fs.appendFileSync(REVIEW_LOG_PATH, line, "utf8");
  } catch (e) {
    process.stderr.write("sentinel.js: could not append .now/review-log.jsonl: " + e.message + "\n");
  }
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

  // An existing sentinel for the SAME plan+phase is the /claudhd:build
  // fix-relay path re-running write mid-review-loop: any paths the review
  // step widened in via add-files (reviewer-cited files outside the plan's
  // Files list) must survive, or the fix pass gets denied edits to exactly
  // the files it was sent to fix. A sentinel for a different plan or phase
  // is a fresh start and its widening does not carry over.
  let existing = null;
  try { existing = readSentinel(ROOT); } catch { existing = null; }
  const sameSentinelPhase = existing && existing.plan === planRel && existing.phase === phaseNumber;
  if (sameSentinelPhase && Array.isArray(existing.files)) {
    for (const p of existing.files) {
      if (typeof p === "string" && !files.includes(p)) files.push(p);
    }
  }

  // originalFiles freezes the phase's Files list as first parsed - a re-write
  // for the SAME plan+phase (the fix-relay path) carries the ORIGINAL forward
  // unchanged rather than re-stamping it from the current (possibly widened)
  // parse, so the review log can later show add-files widening as a diff
  // against a stable baseline. A fresh phase's original IS this write's parse.
  const originalFiles = sameSentinelPhase
    ? (Array.isArray(existing.originalFiles) ? existing.originalFiles.slice()
        : (Array.isArray(existing.files) ? existing.files.slice() : files.slice()))
    : files.slice();

  const sentinel = {
    plan: planRel,
    phase: phaseNumber,
    files,
    allow,
    started: new Date().toISOString(),
    session,
    originalFiles,
  };

  try {
    writeStateAtomic(NOW_DIR, { build: sentinel }, ["build"]);
  } catch (e) {
    console.error("sentinel.js write: cannot write sentinel: " + e.message);
    process.exit(1);
  }

  // A recorded review-round file for a DIFFERENT plan or phase is stale - a
  // fresh phase must start with no prior-round context. Same plan+phase is
  // the /claudhd:build fix-relay path re-running write mid-review-loop; its
  // rounds are live and must survive, or the re-review loses exactly the
  // context this file exists to carry. Before discarding another phase's
  // rounds, log the phase they belonged to - see docs/STATE-SCHEMA.md.
  const round = _readRoundFile();
  if (round && (round.plan !== planRel || round.phase !== phaseNumber)) {
    const closing = (existing && existing.plan === round.plan && existing.phase === round.phase)
      ? existing
      : { plan: round.plan, phase: round.phase, started: null, files: [], originalFiles: [] };
    _appendReviewLog(closing, round);
    _clearRoundFile();
  }

  console.log("sentinel.js: wrote phase " + phaseNumber + " sentinel (" + files.length + " file(s) in scope)");
}

function cmdWriteFiles(args) {
  const files = args.filter(Boolean);
  if (files.length === 0) {
    console.error("sentinel.js write-files: usage: write-files <path> [<path>...]");
    process.exit(1);
  }

  const session = process.env.GANTRY_SESSION_ID || process.env.CLAUDE_CODE_SESSION_ID || "";

  // Refuse to clobber an ACTIVE plan-backed build phase (sol round-four
  // ruling). Quick fixes clear between phases, never mid-phase: replacing a
  // live sentinel here would silently discard its file scope, and the quick
  // lane's own `sentinel.js clear` at the end of /claudhd:quick would then
  // remove the phase's recorded review rounds and open the commit gate as
  // if the phase's review had passed, when it never ran at all. A STALE
  // sentinel (abandoned phase, same rule the guards use) does not block.
  let existing = null;
  try { existing = readSentinel(ROOT); } catch { existing = null; }
  if (existing && existing.plan != null && !isStale(existing, session)) {
    console.error(
      "sentinel.js write-files: refusing - phase " + existing.phase + " of " +
      existing.plan + " is an active build phase. Quick fixes clear BETWEEN " +
      "phases, never mid-phase: finish this phase (/claudhd:review, then " +
      "commit) or clear it first (`node sentinel.js clear`), then re-run " +
      "/claudhd:quick."
    );
    process.exit(1);
  }

  const sentinel = {
    plan: null,
    phase: "quick",
    files,
    // NOW.md is always in scope: the clearing pass this sentinel guards checks
    // off batch items in NOW.md itself, and build mode's allowlist has no
    // generic *.md allowance (that is design/idle mode's rule, not build's -
    // a live sentinel routes through modes.decide("build", ...) unconditionally),
    // so without this the check-off step would deny itself.
    allow: ["NOW.md"],
    started: new Date().toISOString(),
    session,
    originalFiles: files.slice(),
  };

  // write-files always overwrites whatever sentinel preceded it (the active-
  // phase refusal above already ruled out clobbering a live one) - so any
  // round file still on disk belongs to a phase that is about to be
  // replaced. Log it, exactly like write's cross-phase case, before it dies.
  const round = _readRoundFile();
  if (round) {
    const closing = (existing && existing.plan === round.plan && existing.phase === round.phase)
      ? existing
      : { plan: round.plan, phase: round.phase, started: null, files: [], originalFiles: [] };
    _appendReviewLog(closing, round);
    _clearRoundFile();
  }

  try {
    writeStateAtomic(NOW_DIR, { build: sentinel }, ["build"]);
  } catch (e) {
    console.error("sentinel.js write-files: cannot write sentinel: " + e.message);
    process.exit(1);
  }

  console.log("sentinel.js: wrote a quick-fix sentinel (" + files.length + " file(s) in scope)");
}

function cmdClear() {
  // readSentinel also performs the one-shot legacy import (see sentinel-core.js),
  // so a clear on a project that never re-ran /claudhd:build since upgrading
  // still imports-then-clears the legacy sentinel rather than leaving it
  // stranded on disk.
  let current;
  try { current = readSentinel(ROOT); } catch { current = null; }

  // The phase is closing either way: log it (rounds, scope diff) BEFORE any
  // of that is destroyed - a phase with no rounds still gets a scope record,
  // since the log's job is "what happened to this phase", not just "what did
  // the reviewer say".
  const round = _readRoundFile();
  if (current != null) {
    _appendReviewLog(current, round);
  } else if (round != null) {
    // Orphaned round data: the sentinel is gone or unreadable (e.g. state.json
    // was reset out from under an in-flight review) but a round file still
    // exists. The round file itself carries plan/phase, so use those as a
    // fallback closing record rather than silently destroying the rounds with
    // no trace at all - the scope fields are simply unknown in this case.
    _appendReviewLog(
      { plan: round.plan, phase: round.phase, started: null, files: [], originalFiles: [] },
      round
    );
  }

  // The phase is closing either way: any recorded review rounds die with it.
  _clearRoundFile();
  if (current == null) return; // no-op for an already-absent sentinel - exit 0 silently.

  try {
    writeStateAtomic(NOW_DIR, { build: null }, ["build"]);
    console.log("sentinel.js: cleared the active phase");
  } catch (e) {
    console.error("sentinel.js clear: unexpected error: " + e.message);
    process.exit(1);
  }
}

function cmdRecordRound(args) {
  const planArg = args[0];
  const phaseArg = args[1];
  const verdict = args[2];

  if (!planArg || !phaseArg || !verdict) {
    console.error(
      "sentinel.js record-round: usage: record-round <plan-path> <phase-number> <verdict>" +
      "  (pipe the required fixes on stdin)"
    );
    process.exit(1);
  }

  const phaseNumber = parseInt(phaseArg, 10);
  if (isNaN(phaseNumber)) {
    console.error("sentinel.js record-round: phase-number must be an integer, got: " + phaseArg);
    process.exit(1);
  }

  let fixes = "";
  try { fixes = fs.readFileSync(0, "utf8"); } catch { /* no stdin */ }
  fixes = fixes.trim();
  // A round with no fixes text is useless context - refuse it loudly so the
  // caller re-runs with the reviewer's actual Required fixes piped in.
  if (!fixes) {
    console.error(
      "sentinel.js record-round: no fixes text on stdin - pipe the reviewer's" +
      " Required fixes (or Fix-now notes) verbatim."
    );
    process.exit(1);
  }

  const planAbsPath = path.isAbsolute(planArg) ? planArg : path.join(ROOT, planArg);
  const planRel = _toRelPosix(planAbsPath);

  // Rounds accumulate for the same plan+phase; anything else (different phase,
  // absent, malformed) starts a fresh file, so stale rounds never leak.
  let state = _readRoundFile();
  if (
    !state || state.plan !== planRel || state.phase !== phaseNumber ||
    !Array.isArray(state.rounds)
  ) {
    state = { plan: planRel, phase: phaseNumber, rounds: [] };
  }

  state.rounds.push({
    round: state.rounds.length + 1,
    verdict,
    fixes,
    recorded: new Date().toISOString(),
  });

  try {
    fs.mkdirSync(path.join(ROOT, ".gantry"), { recursive: true });
    fs.writeFileSync(ROUND_PATH, JSON.stringify(state, null, 2) + "\n", "utf8");
  } catch (e) {
    console.error("sentinel.js record-round: cannot write review-round.json: " + e.message);
    process.exit(1);
  }

  console.log(
    "sentinel.js: recorded review round " + state.rounds.length +
    " (" + verdict + ") for phase " + phaseNumber
  );
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
  case "write-files":
    cmdWriteFiles(rest);
    break;
  case "record-round":
    cmdRecordRound(rest);
    break;
  default:
    console.error(
      "sentinel.js: unknown subcommand: " + subcommand + "\n" +
      "Usage:\n" +
      "  sentinel.js write <plan-path> <phase-number> [session-id]\n" +
      "  sentinel.js clear\n" +
      "  sentinel.js add-files <path> [<path>...]\n" +
      "  sentinel.js write-files <path> [<path>...]\n" +
      "  sentinel.js record-round <plan-path> <phase-number> <verdict>  (fixes on stdin)\n"
    );
    process.exit(1);
}
