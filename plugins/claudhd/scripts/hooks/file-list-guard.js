/*
 * file-list-guard.js - PreToolUse hook: deny Edit|Write|MultiEdit calls that
 * target a file outside the active phase's file list.
 *
 * Reads the active sentinel via sentinel-core and decides through
 * modes.decide("build", relPath, sentinel.files + sentinel.allow) - the SAME
 * decision function the mode-inversion branch below uses, so build mode's
 * state-dir allowance (.now/, .gantry/, .claude/) applies under a live
 * sentinel too, not only when the sentinel is absent (review round 3: the
 * legacy files/allow-only check never consulted modes.js at all). Emits a
 * deny JSON block to stdout when enforcement is active and the path is out
 * of scope.
 *
 * Phase 5 inversion (design section 6): a sentinel-absent read used to fail
 * open unconditionally. Inside an adopted project (the marker check below
 * already confirmed adoption) it is now a REAL state, not a crash/unknown
 * condition: it resolves to the project's current mode (state.json's `mode`
 * field; null mode reads as idle) and enforces modes.js's deny-by-default
 * allowlist. This is the ONLY inverted branch - every OTHER fail-open path
 * below (malformed stdin, missing tool_input, missing file_path,
 * unresolvable root, stale sentinel, the top-level catch) is unchanged.
 * Malformed/unreadable state.json content in an adopted project is DEFINED
 * as mode null = idle (readState's null-normalization IS the contract, not a
 * crash) - the fail-open guarantee covers guard crashes and unparseable hook
 * input, never semantic state content (review round 2026-07-26).
 *
 * The escape hatch: /claudhd:override (override.js) records a per-session
 * override into state.json's own `override` key. "Outside any phase" covers
 * BOTH an unguarded-mode edit (this branch) AND an out-of-list edit under a
 * LIVE sentinel (build mode, wrong file - step 7b below): both call sites
 * funnel through override.js's noteOverrideFile(), which performs the whole
 * read-check-modify-write as one atomic operation under its own lock, so an
 * active override permits an otherwise-denied edit AND counts it, loudly,
 * never silently, even under concurrent guard invocations.
 *
 * TOCTOU note (review round 2): noteOverrideFile()'s own fresh read, taken
 * AFTER acquiring override.lock, is the ONLY thing that may decide whether
 * an override applies - never a snapshot read earlier in this function. An
 * earlier version of this file pre-checked a state snapshot taken before the
 * lock and skipped calling noteOverrideFile() at all when that snapshot
 * showed no override, which could miss an override recorded in the window
 * between the snapshot and the (skipped) lock acquisition. Below, every
 * candidate deny unconditionally asks permitViaOverride() before it is
 * emitted, and permitViaOverride() never consults `state` at all.
 *
 * state.js/modes.js/override.js are required LAZILY, inside main(), and
 * deliberately NOT wrapped in their own local try/catch: a broken sibling
 * module (a real deployment bug, not a hook-input problem) throws naturally
 * up to the outer try/catch at the bottom of this file, which is what keeps
 * "always exits 0" true even then - see test/file-list-guard.test.js's
 * dedicated module-init-failure fixture.
 *
 * Hard invariants:
 *   - Always exits 0, on every path including denies and errors.
 *   - Fails OPEN (exits 0, no output) on malformed stdin, missing fields,
 *     unresolvable root, a stale sentinel, or any unexpected crash.
 *   - The deny is communicated via stdout JSON, NOT a non-zero exit code.
 */
"use strict";
const fs = require("fs");
const path = require("path");

const { resolveRoot, readSentinel, isStale, normalize, FAIL_OPEN } = require("../sentinel-core.js");

// ---------------------------------------------------------------------------
// Deny output
// ---------------------------------------------------------------------------

function writeDenyJSON(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    }) + "\n"
  );
}

function deny(phase) {
  writeDenyJSON(
    "outside phase " + phase + "'s file list. report this as scope drift, or amend " +
    "the plan and re-run /claudhd:build to widen the phase. " +
    "(to clear enforcement by hand: run `node sentinel.js clear`)"
  );
}

// Phase 5's one inverted deny path: modes.js's reason string already names
// the mode and its remedy command, so this just forwards it unchanged.
function denyMode(reason) {
  writeDenyJSON(reason);
}

// B1's activation gate: `.now/enabled` (written by /claudhd:init's explicit
// 1.0 opt-in) OR the legacy `.gantry/enabled` (still honored for enforcement
// so gantry-era projects stay enforced - see reconcile.js's header comment
// for why ITS OWN adoption gate deliberately does not honor the legacy
// marker). A repo with neither marker is entirely inert.
function isAdopted(root) {
  try { fs.accessSync(path.join(root, ".now", "enabled")); return true; } catch { /* fall through */ }
  try { fs.accessSync(path.join(root, ".gantry", "enabled")); return true; } catch { return false; }
}

// The escape hatch's ONLY decision point (see this file's header comment's
// TOCTOU note): requires override.js lazily and asks its fresh, LOCKED read
// whether an override is active for `sessionId`, permitting and counting
// `rel` if so. The one pre-lock check here (`sessionId` truthiness) can
// never itself be the source of a false negative - a session id is fixed
// for the lifetime of this single hook invocation (it comes from the same
// stdin payload throughout), so it cannot change between "now" and "after
// the lock", unlike a snapshot of `state.override`.
function permitViaOverride(root, sessionId, rel) {
  if (!sessionId) return false;
  const { noteOverrideFile } = require("../override.js");
  return noteOverrideFile(root, sessionId, rel);
}

// ---------------------------------------------------------------------------
// Main - wrapped in try/catch at the top level so no unhandled exception can
// produce a non-zero exit.
// ---------------------------------------------------------------------------

function main() {
  // 1. Read and parse stdin (fd 0). Works on both Windows and POSIX.
  let payload;
  try {
    const raw = fs.readFileSync(0, "utf8");
    payload = JSON.parse(raw);
  } catch {
    // Malformed or unreadable stdin -> fail open.
    return;
  }

  // 2. Defensive field checks - fail open on any missing/unexpected shape.
  if (!payload || typeof payload !== "object") return;

  const sessionId = payload.session_id; // may be undefined - isStale handles that
  const toolInput = payload.tool_input;
  if (!toolInput || typeof toolInput !== "object") return;

  const filePath = toolInput.file_path;
  if (filePath == null || filePath === "") {
    // Missing file_path -> fail open with a logged note (stderr only).
    process.stderr.write("file-list-guard: missing tool_input.file_path, failing open\n");
    return;
  }

  // 3. Resolve project root.
  const root = resolveRoot(process.env);

  // 4. Check the activation marker (B1). Absent -> guard inactive, fail open;
  // a project with neither marker is entirely unaffected by anything below.
  if (!isAdopted(root)) return;

  // state.js is loaded lazily here (see header comment); readState() never
  // throws once loaded (state.js's own contract) - a malformed state.json
  // reads back as null/absent fields, which IS the mode-null-means-idle
  // contract below, not a crash.
  const nowDir = path.join(root, ".now");
  const { readState } = require("../state.js");
  const state = readState(nowDir);

  // 5. Read the sentinel.
  const sentinel = readSentinel(root);
  if (sentinel === null) {
    // INVERSION: sentinel-absent inside this adopted project is a real
    // state, not a crash - see this file's header comment. Resolve mode
    // from state.json (null mode = idle) and enforce modes.js's allowlist.
    const mode = state && state.mode != null ? state.mode : null;

    const rel = normalize(filePath, root);
    if (rel === FAIL_OPEN) return; // cannot normalize the path -> fail open

    const modes = require("../modes.js");
    const decision = modes.decide(mode, rel, null);
    if (decision.allow) return;

    // Candidate deny: the override's fresh, locked check is the only thing
    // that may still permit it (see permitViaOverride()'s header comment).
    if (permitViaOverride(root, sessionId, rel)) return;

    denyMode(decision.reason);
    return;
  }

  // 6. Fail open if the sentinel is stale.
  if (isStale(sentinel, sessionId)) return;

  // 7. Route the decision through modes.decide, same as the inverted branch
  // above (review round 3): the legacy files/allow-only check never
  // consulted modes.js at all, so a live sentinel could deny a state-dir
  // edit (.now/, .gantry/, .claude/) that build mode's own allowlist always
  // covers. sentinel.allow is PRESERVED, not dropped: it is composed into
  // the file list modes.decide checks build mode against, so an allow-listed
  // path (the plan, the audit docs, ROADMAP.md) stays allowed exactly as
  // before, just through the SAME decision function the inversion uses.
  const rel = normalize(filePath, root);
  if (rel === FAIL_OPEN) return; // fail open - isInList's own normalize-failure rule, preserved

  // A malformed (non-array) files or allow list is itself a fail-open
  // condition - isInList's own per-call rule for "no list", preserved here
  // rather than silently narrowed by composing it away.
  if (!Array.isArray(sentinel.files) || !Array.isArray(sentinel.allow)) return;

  const modes = require("../modes.js");
  const combinedFiles = sentinel.files.concat(sentinel.allow);
  const decision = modes.decide("build", rel, combinedFiles);
  if (decision.allow) return;

  // 7b. Out-of-list edit under a LIVE sentinel (build mode): the escape
  // hatch still applies - "outside any phase" covers this case too, not
  // only the mode-inversion branch above.
  if (permitViaOverride(root, sessionId, rel)) return;

  // 8. File is not in scope: emit deny JSON.
  deny(sentinel.phase);
}

try {
  main();
} catch {
  // Last-resort catch: any unexpected error -> fail open (no output, exit 0).
}
// Always exit 0.
process.exit(0);
