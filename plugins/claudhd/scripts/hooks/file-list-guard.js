/*
 * file-list-guard.js - PreToolUse hook: deny Edit|Write|MultiEdit calls that
 * target a file outside the active phase's file list.
 *
 * Reads the active sentinel via sentinel-core and compares the tool's
 * file_path against sentinel.files and sentinel.allow. Emits a deny JSON
 * block to stdout when enforcement is active and the path is out of scope.
 *
 * Hard invariants:
 *   - Always exits 0, on every path including denies and errors.
 *   - Fails OPEN (exits 0, no output) on ANY error: malformed stdin, missing
 *     fields, unresolvable root, absent/stale sentinel, malformed sentinel.
 *   - The deny is communicated via stdout JSON, NOT a non-zero exit code.
 */
"use strict";
const fs = require("fs");
const path = require("path");

const { resolveRoot, readSentinel, isStale, isInList } = require("../sentinel-core.js");

// ---------------------------------------------------------------------------
// Deny output
// ---------------------------------------------------------------------------

function deny(phase) {
  const reason =
    "outside phase " + phase + "'s file list. report this as scope drift, or amend " +
    "the plan and re-run /claudhd:build to widen the phase. " +
    "(to clear enforcement by hand: run `node sentinel.js clear`)";
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

  // 4. Check opt-in marker (.gantry/enabled).
  const markerPath = path.join(root, ".gantry", "enabled");
  try {
    fs.accessSync(markerPath);
  } catch {
    // Marker absent -> guard inactive, fail open.
    return;
  }

  // 5. Read the sentinel; fail open if absent.
  const sentinel = readSentinel(root);
  if (sentinel === null) return;

  // 6. Fail open if the sentinel is stale.
  if (isStale(sentinel, sessionId)) return;

  // 7. Check file_path against files and allow lists.
  if (isInList(filePath, sentinel.files, root)) return;
  if (isInList(filePath, sentinel.allow, root)) return;

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
