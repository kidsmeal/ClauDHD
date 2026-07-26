/*
 * commit-guard.js - PreToolUse hook: deny Bash calls that contain a
 * `git commit` or `git push` invocation at any command-head position.
 *
 * A "command-head position" is: start-of-string, or after &&, ;, |, or (.
 * A leading `git -C <path>` is allowed (the -C flag selects the working dir
 * and is commonly used by tooling). Text that appears only inside a quoted
 * argument (e.g. echo "how to git commit") is NOT matched.
 *
 * Critical exception: any command that begins with `node` and whose first
 * script argument is a sentinel.js path is always allowed. This preserves
 * the orchestrator's plumbing which writes/clears the sentinel via Bash.
 *
 * Hard invariants:
 *   - Always exits 0, on every path including denies and errors.
 *   - Fails OPEN on ANY error: malformed stdin, missing fields, absent
 *     sentinel, stale sentinel, malformed sentinel.
 *   - The deny is communicated via stdout JSON, NOT a non-zero exit code.
 */
"use strict";
const fs = require("fs");
const path = require("path");

const { resolveRoot, readSentinel, isStale } = require("../sentinel-core.js");

// ---------------------------------------------------------------------------
// Deny output
// ---------------------------------------------------------------------------

function deny(phase) {
  const reason =
    "ClauDHD holds the commit gate. phase " + phase + " is mid-build and not yet " +
    "reviewed. finish /claudhd:review and commit at the gate. " +
    "(to clear: run `node sentinel.js clear`)";
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
// Command scanning
// ---------------------------------------------------------------------------

// Split a shell command string into individual command segments at &&, ;, |,
// and ( boundaries. Each segment is trimmed of surrounding whitespace.
// This is NOT a full shell parser - it handles the common orchestrator patterns.
// Note: we do not try to parse quoted strings structurally; instead we rely on
// the sentinel.js exception (checked before this function) for the one case
// that would otherwise risk a false positive.
function splitSegments(command) {
  // Split on &&, ;, |, ( - these are the valid command-head boundaries.
  // Use a regex that keeps the split but does not need the delimiters in output.
  return command.split(/&&|;|\||\(/).map((s) => s.trim()).filter(Boolean);
}

// Return true if a single command segment represents a git commit or git push
// invocation. Handles:
//   git commit ...
//   git push ...
//   git -C <path> commit ...
//   git -C <path> push ...
// Does NOT match git status, git log, git diff, etc.
function isGitCommitOrPush(segment) {
  // Must start with "git" (possibly with leading whitespace already stripped).
  // Allow: git [flags] [subcommand]
  // The -C <path> flag pattern is: -C followed by whitespace and a path token.
  // Strip any leading "git" then optional flags then check the subcommand.
  const tokens = segment.split(/\s+/);
  if (tokens.length === 0) return false;
  if (tokens[0] !== "git") return false;

  let i = 1;
  // Consume optional flags. The only flag we need to support before the
  // subcommand is -C <path> (and possibly -c key=value, --no-pager, etc.).
  // We keep it simple: consume any token that starts with "-" and if it is
  // exactly "-C" (case-sensitive), consume the next token as its argument.
  while (i < tokens.length) {
    const t = tokens[i];
    if (!t.startsWith("-")) break; // not a flag - must be the subcommand
    i++;
    if (t === "-C" && i < tokens.length) {
      i++; // consume the path argument for -C
    }
    // Other flags (-c, --no-pager, etc.) are consumed without consuming an extra token.
  }

  if (i >= tokens.length) return false;
  const subcommand = tokens[i];
  return subcommand === "commit" || subcommand === "push";
}

// Return true if the command is a `node ... sentinel.js ...` orchestrator
// plumbing call that must always be allowed through.
// Matches any command segment whose first token is "node" and whose second
// token (the script path) ends with "sentinel.js".
function isSentinelCall(command) {
  const trimmed = command.trim();
  const tokens = trimmed.split(/\s+/);
  if (tokens.length < 2) return false;
  if (tokens[0] !== "node") return false;
  const scriptArg = tokens[1];
  // Strip any surrounding quotes that might appear in the path argument.
  const unquoted = scriptArg.replace(/^["']|["']$/g, "");
  return unquoted.endsWith("sentinel.js");
}

// Return true if the command string (the full command, not a segment) contains
// a git commit or git push invocation at any command-head position.
function commandTriggersGuard(command) {
  // Exception: sentinel.js calls must always pass through (whole-command check,
  // not per-segment, because the sentinel.js node call is the entire command).
  if (isSentinelCall(command.trim())) return false;

  const segments = splitSegments(command);
  for (const seg of segments) {
    // Check each segment. Skip segments that start with a quote (they are
    // arguments to a previous command, e.g. the string body of an echo).
    // A segment starting with " or ' is a continuation of a quoted argument,
    // not a new command. This handles the `echo "how to git commit"` case where
    // splitting on ( would give `"how to git commit"` as a segment.
    if (seg.startsWith('"') || seg.startsWith("'")) continue;
    if (isGitCommitOrPush(seg)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  // 1. Read and parse stdin (fd 0). Works on both Windows and POSIX.
  let payload;
  try {
    const raw = fs.readFileSync(0, "utf8");
    payload = JSON.parse(raw);
  } catch {
    return; // malformed stdin -> fail open
  }

  // 2. Defensive field checks.
  if (!payload || typeof payload !== "object") return;

  const sessionId = payload.session_id;
  const toolInput = payload.tool_input;
  if (!toolInput || typeof toolInput !== "object") return;

  const command = toolInput.command;
  if (command == null || typeof command !== "string") return; // missing command -> fail open

  // 3. Resolve project root.
  const root = resolveRoot(process.env);

  // 4. Check opt-in marker (.gantry/enabled).
  const markerPath = path.join(root, ".gantry", "enabled");
  try {
    fs.accessSync(markerPath);
  } catch {
    return; // marker absent -> guard inactive
  }

  // 5. Read the sentinel; fail open if absent or malformed.
  const sentinel = readSentinel(root);
  if (sentinel === null) return;

  // 6. Fail open if stale.
  if (isStale(sentinel, sessionId)) return;

  // 7. Scan the command for a git commit/push invocation.
  if (!commandTriggersGuard(command)) return;

  // 8. Deny.
  deny(sentinel.phase);
}

try {
  main();
} catch {
  // Last-resort catch: any unexpected error -> fail open (no output, exit 0).
}
// Always exit 0.
process.exit(0);
