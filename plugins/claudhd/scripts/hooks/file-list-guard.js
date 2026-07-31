/*
 * file-list-guard.js - PreToolUse hook: RECORD Edit|Write|MultiEdit calls that
 * target a file outside the active build phase's file list. It never denies.
 *
 * r-0729-1 (log, don't deny): ClauDHD 1.0 denied out-of-scope edits, which
 * blocked ordinary work and manufactured the drift it meant to prevent. This
 * hook now allows every edit and drops a line in the out-of-scope log
 * (drift-log.js) when one lands outside a live phase's scope. Drift stays
 * visible; work never stops.
 *
 * Scope only exists inside a live build sentinel. With NO sentinel (idle,
 * design, or any unguarded state) there is no declared file list, so nothing
 * is "out of scope" and nothing is logged - the hook simply returns. The one
 * recorded case is an edit outside the file list of a phase you are actively
 * in: sentinel live, path not in files+allow. That, and only that, is drift.
 *
 * state.js/modes.js/drift-log.js are required LAZILY, inside main(), and
 * deliberately NOT wrapped in their own local try/catch: a broken sibling
 * module (a real deployment bug, not a hook-input problem) throws naturally
 * up to the outer try/catch at the bottom of this file, which is what keeps
 * "always exits 0" true even then - see test/file-list-guard.test.js's
 * dedicated module-init-failure fixture.
 *
 * Hard invariants:
 *   - Always exits 0, and NEVER denies - it has no deny path at all.
 *   - Fails silent (exits 0, no log) on malformed stdin, missing fields,
 *     unresolvable root, a stale sentinel, or any unexpected crash.
 *   - Logging an out-of-scope edit never affects that edit's fate.
 */
"use strict";
const fs = require("fs");
const path = require("path");

const { resolveRoot, readSentinel, isStale, normalize, FAIL_OPEN } = require("../sentinel-core.js");

// B1's activation gate: `.now/enabled` (written by /claudhd:init's explicit
// 1.0 opt-in) OR the legacy `.gantry/enabled` (still honored for enforcement
// so gantry-era projects stay enforced - see reconcile.js's header comment
// for why ITS OWN adoption gate deliberately does not honor the legacy
// marker). A repo with neither marker is entirely inert.
function isAdopted(root) {
  try { fs.accessSync(path.join(root, ".now", "enabled")); return true; } catch { /* fall through */ }
  try { fs.accessSync(path.join(root, ".gantry", "enabled")); return true; } catch { return false; }
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

  // 3. Resolve project root: prefer the nearest adopted ancestor of the
  // edited file itself (root.js's walkForRoot) over the session's env-pinned
  // root, so an edit inside a DIFFERENT adopted repo than the one the
  // session's env vars point at is still enforced against its own repo, not
  // silently invisible to the guard. A CLEAN "no adopted ancestor" result
  // (null) falls back to the env-resolved root - unchanged behavior for
  // every session rooted at (or above) the repo it is actually editing. A
  // genuine internal walk failure (WALK_FAILED) is NEVER treated the same
  // way: trusting the env root's mode/sentinel when the walk itself could
  // not be trusted risks denying (or allowing) against the wrong repo's
  // rules, so this fails open outright instead.
  const envRoot = resolveRoot(process.env);
  const walkedRoot = resolveRoot.walkForRoot(path.dirname(filePath));
  if (walkedRoot === resolveRoot.WALK_FAILED) return;
  const root = walkedRoot || envRoot;

  // 4. Check the activation marker (B1). Absent -> hook inactive; a project
  // with neither marker is entirely unaffected by anything below.
  if (!isAdopted(root)) return;

  // 5. Read the sentinel. NO sentinel means no declared scope - idle, design,
  // or any unguarded state - so nothing is out of scope and nothing is
  // logged. This is the whole of the "idle/design no longer gate" change:
  // the hook only has an opinion inside a live build phase.
  const sentinel = readSentinel(root);
  if (sentinel === null) return;

  // 6. A stale sentinel (a phase abandoned in another session) declares no
  // scope this session either - return, log nothing.
  if (isStale(sentinel, sessionId)) return;

  // 7. Is the edit inside the live phase's file list? Route through
  // modes.decide("build", ...) so build mode's state-dir allowance (.now/,
  // .gantry/, .claude/) and the sentinel's own allow-list (the plan, audit
  // docs, ROADMAP.md) are honored exactly as before.
  const rel = normalize(filePath, root);
  if (rel === FAIL_OPEN) return; // cannot normalize the path -> log nothing

  // A malformed (non-array) files or allow list means we cannot judge scope;
  // do not record a false out-of-scope line.
  if (!Array.isArray(sentinel.files) || !Array.isArray(sentinel.allow)) return;

  const modes = require("../modes.js");
  const combinedFiles = sentinel.files.concat(sentinel.allow);
  const decision = modes.decide("build", rel, combinedFiles);
  if (decision.allow) return;

  // 8. Out of the live phase's scope. RECORD it and ALLOW it - the edit
  // proceeds; the drift log gets one line so the out-of-scope work is
  // visible without ever having been blocked.
  const { logDrift } = require("../drift-log.js");
  logDrift(root, {
    ts: new Date().toISOString(),
    session: sessionId || null,
    phase: sentinel.phase,
    plan: sentinel.plan || null,
    path: rel,
    tool: payload.tool_name || null,
  });
  // ALLOW: no output, exit 0.
}

try {
  main();
} catch {
  // Last-resort catch: any unexpected error -> fail open (no output, exit 0).
}
// Always exit 0.
process.exit(0);
