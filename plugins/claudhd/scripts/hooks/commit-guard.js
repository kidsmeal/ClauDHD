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
 * the orchestrator's plumbing which writes/clears the sentinel via Bash -
 * INCLUDING a compound `node sentinel.js clear && git commit ...` call,
 * since the exception matches on the command's leading two tokens only. That
 * is deliberate (design section 5): a PreToolUse hook fires before ANY part
 * of the Bash call executes, so state.json's `build` section is still
 * whatever was on disk before the clear - which is exactly the sentinel the
 * reconcile below needs to close out the phase it just shipped.
 *
 * Phase 4 (design section 5): the reconcile runs at this same interception
 * point, before the gate decision, so every commit the guard actually lets
 * through - never one it denies - regenerates state.json/NOW.md/the plan's
 * Status line/SHIPPED.md/the roadmap item's state and stages them, so they
 * ride the same commit. A denied (mid-build, never-executed) commit must
 * never be recorded as shipped, so reconcile only runs when `gate` (below) is
 * null. See reconcile.js's own header comment for the full contract.
 *
 * commandClearsSentinelBeforeCommit() detects the real pipeline's compound
 * shape above (a sentinel clear preceding the commit, in the SAME command)
 * and tells reconcile.js to render NOW.md as post-clear (idle build) even
 * though state.json's `build` section is still pre-clear at this instant -
 * otherwise the committed NOW.md would read "in flight, phase N" while the
 * clear that is ABOUT to run in this same Bash call makes state.json idle
 * moments later, and the two would permanently disagree. The phase-status
 * line flip and the roadmap item's move still fire off the real pre-clear
 * `build` - the phase IS completing in this commit; only the RENDER is
 * adjusted, not the completion logic.
 *
 * Cross-repo root resolution (1.0.4 fix, S1): a `git commit`/`push` this hook
 * intercepts does not necessarily run in the session's env-pinned root - a
 * leading `cd <dir> &&`/`;` chain, or the commit invocation's own `-C <dir>`
 * global option, can point it at an entirely different directory. Both the
 * deny decision AND the reconcile must be judged against the repo the commit
 * ACTUALLY runs in, never the env root, or a commit made in a scratch repo
 * gets reconciled into an unrelated adopted project's SHIPPED.md/NOW.md (the
 * live-test finding). effectiveCommandDir() recovers that directory from the
 * command string itself (composing a cd-chain with a -C on the same
 * invocation, mirroring GIT_GLOBAL_OPTS_WITH_ARG's own option-skipping),
 * falling back to the hook payload's own `cwd` field, then the env root, when
 * neither is present. root.js's walkForRoot(effectiveDir) - the SAME walk
 * file-list-guard.js uses - then resolves the nearest ADOPTED ancestor from
 * there; that walked root is what both computeGate() and reconcile() key off
 * from this point on, never the env root. `null` (no adopted ancestor found
 * anywhere up from the effective directory) leaves this hook entirely inert
 * for that commit - no deny, no reconcile, exactly like an unadopted project
 * - deliberately NOT falling back to the env root the way file-list-guard.js
 * does, since that fallback is exactly the cross-repo corruption this fix
 * closes. `WALK_FAILED` (a genuine internal error during the walk) fails
 * open outright, same as every other unresolvable-state path in this file.
 *
 * Hard invariants:
 *   - Always exits 0, on every path including denies and errors.
 *   - Fails OPEN on ANY error: malformed stdin, missing fields, absent
 *     sentinel, stale sentinel, malformed sentinel.
 *   - The deny is communicated via stdout JSON, NOT a non-zero exit code.
 *   - A reconcile failure never blocks or fails the commit: it is attempted,
 *     and any throw is swallowed and logged to .now/reconcile.log, never to
 *     this hook's own stdout/exit code. This includes a broken reconcile.js
 *     ITSELF: requiring it happens lazily, inside the same try/catch as the
 *     call, so a module-initialization error (a syntax error, or a throw
 *     during reconcile.js's own top-level evaluation, in it or a transitive
 *     dependency) can never produce an uncaught exception here - Node's
 *     default nonzero exit on an uncaught exception would otherwise violate
 *     "always exit 0" before main()'s own outer try/catch ever got a chance.
 *   - state.js/modes.js (needed only for the mode-aware deny message) are
 *     required lazily too, deliberately NOT wrapped in their own local
 *     try/catch: a broken sibling module there throws naturally up to the
 *     outer try/catch at the bottom of this file, the same "top-level catch"
 *     safety net file-list-guard.js relies on for the same reason.
 */
"use strict";
const fs = require("fs");
const path = require("path");

const { resolveRoot, readSentinel, isStale } = require("../sentinel-core.js");

// ---------------------------------------------------------------------------
// Deny output
// ---------------------------------------------------------------------------

// Mode-aware (phase 5): names the project's current mode alongside the
// existing phase/commit-gate reason. describeMode() is modes.js's own
// normalization (null/unrecognized -> "idle"), reused here so the two
// guards never label the same mode value differently. This is a message-only
// change - the commit gate's DECISION still turns solely on sentinel
// presence/staleness (computeGate(), unchanged).
function deny(phase, mode) {
  const { describeMode } = require("../modes.js");
  const reason =
    "ClauDHD holds the commit gate (mode: " + describeMode(mode) + "). phase " + phase +
    " is mid-build and not yet reviewed. finish /claudhd:review and commit at the gate. " +
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

// git's global options that take a SEPARATE following argument token (as
// opposed to an attached `--flag=value` form, which needs nothing extra
// consumed - the loop below already advances past it as one token). Missing
// one of these here means the option's VALUE gets mistaken for the
// subcommand (e.g. "git -c user.name=x commit" returning "user.name=x"
// instead of "commit", silently failing to recognize the commit).
const GIT_GLOBAL_OPTS_WITH_ARG = new Set([
  "-C", "-c", "--git-dir", "--work-tree", "--namespace", "--super-prefix",
  "--exec-path", "--config-env",
]);

// The git subcommand of a single command segment, or null if the segment is
// not a `git [flags] <subcommand>` invocation. Handles:
//   git commit ...
//   git push ...
//   git -C <path> commit ...
//   git -C "path with spaces" commit ...
//   git -c key=value commit ...
//   git --git-dir <path> --work-tree <path> commit ...
// Sol review fix: tokenized via tokenizeCommand() (quote-aware), not a naive
// whitespace split - a quoted `-C "path with spaces"` value used to split
// into multiple tokens, which shifted every following token (including the
// subcommand itself) out of place and made a perfectly ordinary quoted `git
// -C "..." commit` invocation invisible to isGitCommitOrPush()/isGitCommit()
// entirely (never denied, never reconciled). tokenizeCommand() is declared
// later in this file as a function declaration, so it is fully hoisted here.
function gitSubcommand(segment) {
  // Must start with "git" (possibly with leading whitespace already stripped).
  // Allow: git [flags] [subcommand]
  // Strip any leading "git" then optional flags then check the subcommand.
  const tokens = tokenizeCommand(segment);
  if (tokens.length === 0) return null;
  if (tokens[0] !== "git") return null;

  let i = 1;
  while (i < tokens.length) {
    const t = tokens[i];
    if (!t.startsWith("-")) break; // not a flag - must be the subcommand
    i++;
    if (GIT_GLOBAL_OPTS_WITH_ARG.has(t) && i < tokens.length) {
      i++; // consume this option's separate argument token
    }
  }

  if (i >= tokens.length) return null;
  return tokens[i];
}

// Return true if a single command segment represents a git commit or git push
// invocation. Does NOT match git status, git log, git diff, etc.
function isGitCommitOrPush(segment) {
  const sub = gitSubcommand(segment);
  return sub === "commit" || sub === "push";
}

// Return true if a single command segment is specifically a git commit
// invocation (never push) - used only to decide whether to reconcile, a
// distinct question from whether to deny (see isCommitCommand() below).
function isGitCommit(segment) {
  return gitSubcommand(segment) === "commit";
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

// Return true if the command contains a git commit invocation in ANY segment,
// including a compound `node sentinel.js clear && git commit ...` call. This
// deliberately does NOT apply commandTriggersGuard's sentinel-call bypass:
// that bypass answers "should the DENY trust this as orchestrator plumbing",
// a different question from "did a real commit happen in here" - the second
// question is what decides whether to reconcile.
function isCommitCommand(command) {
  const segments = splitSegments(command);
  for (const seg of segments) {
    if (seg.startsWith('"') || seg.startsWith("'")) continue;
    if (isGitCommit(seg)) return true;
  }
  return false;
}

// Return true if a single segment is specifically a `node <sentinel.js path>
// clear` invocation - not `write` or `add-files`, which do not null `build`.
function isSentinelClearSegment(segment) {
  const tokens = segment.trim().split(/\s+/);
  if (tokens.length < 3) return false;
  if (tokens[0] !== "node") return false;
  const unquoted = tokens[1].replace(/^["']|["']$/g, "");
  if (!unquoted.endsWith("sentinel.js")) return false;
  return tokens[2] === "clear";
}

// Return true if the command carries a sentinel-clear invocation BEFORE its
// git commit segment, in the same compound command - the real pipeline's
// shape: `node .../sentinel.js clear && git add -A && git commit -m ...`.
// The PreToolUse hook fires before ANY part of this executes, so at the
// instant reconcile.js runs, state.json's `build` section is still the
// PRE-clear value even though the clear (and the resulting post-clear idle
// state) is about to become real within the same Bash call. Iterates
// segments in their original left-to-right order and stops as soon as it
// reaches the commit segment, so a clear appearing AFTER the commit (an
// unusual, not-yet-real ordering) does not count as "preceding".
function commandClearsSentinelBeforeCommit(command) {
  const segments = splitSegments(command);
  for (const seg of segments) {
    if (seg.startsWith('"') || seg.startsWith("'")) continue;
    if (isSentinelClearSegment(seg)) return true;
    if (isGitCommit(seg)) break;
  }
  return false;
}

// A light, quote-aware tokenizer - NOT a full shell parser (matches the rest
// of this file's stated scope). Splits on unquoted whitespace; a quoted span
// (single or double) contributes its content, verbatim, to the CURRENT
// token even when that content contains whitespace, so an attached form like
// `-m"two words"` or `-m=foo` still comes out as one token, and a quoted `-m
// "two words"` still comes out as its own token. Backslash-escapes inside a
// double-quoted span are honored; nothing is escaped inside a single-quoted
// span (matches POSIX shell quoting rules closely enough for argv recovery).
function tokenizeCommand(command) {
  const tokens = [];
  let current = "";
  let has = false;
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (inSingle) {
      if (c === "'") { inSingle = false; continue; }
      current += c; has = true; continue;
    }
    if (inDouble) {
      if (c === '"') { inDouble = false; continue; }
      if (c === "\\" && i + 1 < command.length) { current += command[++i]; has = true; continue; }
      current += c; has = true; continue;
    }
    if (c === "'") { inSingle = true; has = true; continue; }
    if (c === '"') { inDouble = true; has = true; continue; }
    if (/\s/.test(c)) {
      if (has) { tokens.push(current); current = ""; has = false; }
      continue;
    }
    current += c; has = true;
  }
  if (has) tokens.push(current);
  return tokens;
}

// ---------------------------------------------------------------------------
// Cross-repo root resolution (1.0.4 fix, S1) - see this file's header comment.
// ---------------------------------------------------------------------------

// The LAST `cd <dir>` segment seen while scanning `command` left to right,
// stopping as soon as a git commit/push segment is reached (a leading
// `cd <dir> &&`/`;` prefix chain - every `cd` AFTER the target invocation is
// irrelevant, since it never runs before the commit/push does). tokenizeCommand
// is used per-segment (the same quote-aware tokenizeCommand() gitSubcommand() uses)
// so a quoted path with spaces (`cd "my dir"`) still yields one token.
// Returns null when no `cd` segment precedes the target invocation.
function leadingCdDir(command) {
  const segments = splitSegments(command);
  let cdDir = null;
  for (const seg of segments) {
    if (seg.startsWith('"') || seg.startsWith("'")) continue;
    const tokens = tokenizeCommand(seg);
    if (tokens[0] === "cd" && tokens.length > 1) { cdDir = tokens[1]; continue; }
    if (isGitCommitOrPush(seg)) break;
  }
  return cdDir;
}

// The `-C <path>` value on the FIRST git commit/push segment in `command`,
// composing with the same GIT_GLOBAL_OPTS_WITH_ARG consumption gitSubcommand()
// uses so a chained global option before -C is never mis-skipped. Returns
// null when that segment carries no -C (or no such segment exists at all).
function commitDashCDir(command) {
  const segments = splitSegments(command);
  for (const seg of segments) {
    if (seg.startsWith('"') || seg.startsWith("'")) continue;
    if (!isGitCommitOrPush(seg)) continue;
    const tokens = tokenizeCommand(seg);
    let i = 1;
    while (i < tokens.length) {
      const t = tokens[i];
      if (!t.startsWith("-")) break;
      if (t === "-C" && i + 1 < tokens.length) return tokens[i + 1];
      i++;
      if (GIT_GLOBAL_OPTS_WITH_ARG.has(t) && i < tokens.length) i++;
    }
    return null; // found the target segment but it carries no -C
  }
  return null; // no commit/push segment in this command at all
}

// The directory a git commit/push segment found in `command` ACTUALLY runs
// in: the cd-chain (if any), resolved against `payloadCwd` (falling back to
// `envRoot` only when the payload carries no cwd at all), then the target
// invocation's own -C (if any), resolved against THAT - matching the order a
// real shell would apply them. Pure string/path composition; the only
// filesystem access is the walk the caller performs on the result.
function effectiveCommandDir(command, payloadCwd, envRoot) {
  let dir = payloadCwd || envRoot;
  const cdDir = leadingCdDir(command);
  if (cdDir != null) dir = path.isAbsolute(cdDir) ? cdDir : path.resolve(dir, cdDir);
  const dashC = commitDashCDir(command);
  if (dashC != null) dir = path.isAbsolute(dashC) ? dashC : path.resolve(dir, dashC);
  return dir;
}

// Find the token index right after the FIRST `git [global-options] commit`
// invocation in an already-tokenized stream, mirroring gitSubcommand()'s
// exact global-option consumption (round four) so the two never drift apart.
// Returns -1 if no such invocation is found.
function commitArgsStart(tokens) {
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] !== "git") continue;
    let j = i + 1;
    while (j < tokens.length) {
      const t = tokens[j];
      if (!t.startsWith("-")) break;
      j++;
      if (GIT_GLOBAL_OPTS_WITH_ARG.has(t) && j < tokens.length) j++;
    }
    if (j < tokens.length && tokens[j] === "commit") return j + 1;
  }
  return -1;
}

// Pull the commit subject (first non-blank line of the message) out of the
// raw command string, across every form `git commit`/the orchestrator's own
// commits actually use:
//   -m "..." / -m '...' / -m word            (quoted, or the next argv token)
//   -m"..."  / -m=...                         (attached to the flag)
//   --message ... / --message=...
//   -am / -sm / -asm / ...                    (combined short-option clusters
//                                               ending in "m" - the "m"
//                                               consumes the attached
//                                               remainder or the next token)
//   -m "$(cat <<'EOF' ... EOF)"               (the heredoc idiom for a
//                                               multi-line message + trailer)
//   -F <file>                                 (read the file at hook time)
//   multiple -m/--message                     (the FIRST is the subject,
//                                               matching git's own "first -m
//                                               is the subject line" rule)
// Parsed from the commit's OWN arguments only - everything after the
// "commit" word, once global options before it are consumed
// (commitArgsStart()) - so a message-like flag can never be picked up from
// an unrelated earlier command or a global option's value in a compound
// command.
// Returns null - genuinely unavailable, never guessed - for an interactive
// editor commit (no -m/-F at all) and for `-F -` (message piped via stdin,
// which this hook cannot see): reconcile.js still runs everything except the
// SHIPPED.md entry in that case (see reconcile.js's header comment).
function extractCommitMessage(command, root) {
  // The heredoc idiom is structural, not just quoted text: a naive "first
  // line of the quoted argument" would return the `$(cat <<'EOF'` shell
  // syntax itself rather than the message. Checked first, against the raw
  // string (never segment-scoped: the heredoc's own `$(...)` contains a "("
  // that a segment boundary would misparse as a subshell-open).
  const heredocRe = /-m\s+"\$\(cat\s+<<'?(\S+?)'?\s*\r?\n([\s\S]*?)\r?\n\s*\1\s*\)"/;
  const hd = heredocRe.exec(command);
  if (hd) {
    const firstLine = hd[2].split(/\r?\n/).find((l) => l.trim() !== "");
    return firstLine ? firstLine.trim() : null;
  }

  const tokens = tokenizeCommand(command);
  const start = commitArgsStart(tokens);
  if (start === -1) return null; // no commit invocation found - nothing to parse

  const messages = [];
  let fileArg = null;
  let stdinMessage = false;

  for (let i = start; i < tokens.length; i++) {
    const t = tokens[i];

    if (t.startsWith("--message=")) { messages.push(t.slice("--message=".length)); continue; }
    if (t === "--message" && i + 1 < tokens.length) { messages.push(tokens[++i]); continue; }

    if (t.startsWith("-m=")) { messages.push(t.slice(3)); continue; }
    if (t.startsWith("-m") && t !== "-m") { messages.push(t.slice(2)); continue; }
    if (t === "-m" && i + 1 < tokens.length) { messages.push(tokens[++i]); continue; }

    // Combined short-option clusters ending in "m" (git's -a/-s/-e/... + -m
    // bundling: -am, -sm, -asm, ...) - a token starting with "-m" itself is
    // already handled above, so anything reaching here provably does not.
    // Everything after the "m" IN THE SAME TOKEN is the value (attached,
    // e.g. "-amFoo"); if nothing follows, the value is the NEXT token
    // (e.g. "-am" "Foo").
    const combinedM = /^-[a-zA-Z]*m(.*)$/.exec(t);
    if (combinedM) {
      if (combinedM[1] !== "") { messages.push(combinedM[1]); continue; }
      if (i + 1 < tokens.length) { messages.push(tokens[++i]); continue; }
    }

    if (t.startsWith("--file=")) { fileArg = t.slice("--file=".length); continue; }
    if (t === "--file" && i + 1 < tokens.length) { fileArg = tokens[++i]; continue; }
    if (t.startsWith("-F") && t !== "-F") { fileArg = t.slice(2); continue; }
    if (t === "-F" && i + 1 < tokens.length) { fileArg = tokens[++i]; continue; }
  }

  if (fileArg === "-") stdinMessage = true;

  if (messages.length) {
    const firstLine = String(messages[0]).split(/\r?\n/).find((l) => l.trim() !== "");
    return firstLine ? firstLine.trim() : null;
  }

  if (fileArg != null && !stdinMessage) {
    try {
      const abs = path.isAbsolute(fileArg) ? fileArg : path.join(root, fileArg);
      const text = fs.readFileSync(abs, "utf8");
      const firstLine = text.split(/\r?\n/).find((l) => l.trim() !== "");
      return firstLine ? firstLine.trim() : null;
    } catch {
      return null; // named file does not exist at hook time
    }
  }

  return null; // -F -, an interactive editor commit, or no message flag at all
}

// Log a reconcile failure without ever letting it affect the commit's fate:
// no throw here reaches main(), and nothing is written to this hook's own
// stdout/exit code (both are the deny-decision channel, not a log).
function logReconcileFailure(root, err) {
  try {
    const nowDir = path.join(root, ".now");
    fs.mkdirSync(nowDir, { recursive: true });
    const detail = err && err.stack ? err.stack : String(err);
    fs.appendFileSync(path.join(nowDir, "reconcile.log"), new Date().toISOString() + " reconcile failed: " + detail + "\n");
  } catch {
    // Logging itself must never affect the commit's fate.
  }
}

// B1's activation gate is now folded into root resolution itself (1.0.4 fix,
// S1): `root` here has already passed through root.js's walkForRoot(), which
// only ever returns a directory carrying `.now/enabled` or a paired legacy
// `.gantry/enabled` - see this file's header comment and main()'s own walk
// step. A separate marker re-check here would be redundant (root's adoption
// is already guaranteed by the caller), so this function no longer performs
// one.
//
// The exact steps 4-6 fail-open checks, as a pure query rather than a chain of
// early returns: null means allow (no sentinel, stale, or the command does
// not trigger it); the sentinel object means deny. Behavior is byte-identical
// to the pre-phase-4 guard for every adopted root - only the shape changed, so
// reconcile (below) can be decided before the deny is emitted.
function computeGate(root, sessionId, command) {
  const sentinel = readSentinel(root);
  if (sentinel === null) return null; // no sentinel -> allow

  if (isStale(sentinel, sessionId)) return null; // stale -> allow

  if (!commandTriggersGuard(command)) return null; // not a commit/push -> allow

  return sentinel; // deny
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

  // Nothing below (the walk, the gate, the reconcile) is reachable unless the
  // command is either a candidate deny (commandTriggersGuard) or a candidate
  // reconcile (isCommitCommand) - skip the filesystem walk entirely for every
  // OTHER Bash call this hook also intercepts (git status, npm test, ...).
  if (!commandTriggersGuard(command) && !isCommitCommand(command)) return;

  // 3. Resolve the EFFECTIVE directory the commit/push runs in (1.0.4 fix,
  // S1 - see header comment), then walk UP from there to the nearest adopted
  // ancestor. `WALK_FAILED` fails open outright; `null` (no adopted ancestor)
  // leaves this hook entirely inert for the command - never falling back to
  // the env root, which is exactly the cross-repo corruption this fix closes.
  const envRoot = resolveRoot(process.env);
  const payloadCwd = typeof payload.cwd === "string" && payload.cwd !== "" ? payload.cwd : null;
  const effectiveDir = effectiveCommandDir(command, payloadCwd, envRoot);
  const walkedRoot = resolveRoot.walkForRoot(effectiveDir);
  if (walkedRoot === resolveRoot.WALK_FAILED) return;
  if (walkedRoot === null) return;
  const root = walkedRoot;

  // 4-6 (steps renumbered from the pre-phase-4 guard, see computeGate()).
  const gate = computeGate(root, sessionId, command);

  // Reconcile at this same interception point, before the gate decision is
  // emitted (design section 5). Only for a commit the guard is about to
  // ALLOW - a denied commit never executes and must never be recorded as
  // shipped. reconcile.js has its own adoption gate (NOW.md's claudhd marker)
  // and no-ops silently in a project that never ran /claudhd:init for 1.0.
  if (gate === null && isCommitCommand(command)) {
    try {
      // Lazy, in-try require: see the header comment's "A reconcile failure
      // never blocks or fails the commit" note.
      const { reconcile } = require("../reconcile.js");
      const willClearBuild = commandClearsSentinelBeforeCommit(command);
      reconcile(root, extractCommitMessage(command, root), sessionId, willClearBuild);
    } catch (e) {
      logReconcileFailure(root, e);
    }
  }

  // 7-8. Deny if the gate says so.
  if (gate !== null) {
    const { readState } = require("../state.js"); // lazy - see header comment
    const state = readState(path.join(root, ".now")); // never throws once loaded
    deny(gate.phase, state && state.mode != null ? state.mode : null);
  }
}

try {
  main();
} catch {
  // Last-resort catch: any unexpected error -> fail open (no output, exit 0).
}
// Always exit 0.
process.exit(0);
