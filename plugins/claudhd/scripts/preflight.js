#!/usr/bin/env node
/*
 * ClauDHD preflight - the pipeline skill runs this before any stage.
 *
 * The pipeline's guarantees (sentinel, file-list scope log, commit-boundary
 * reconcile, per-role tool limits) are Claude Code hooks and agent files.
 * Under another harness the skill text still reads fine and none of that
 * runs: on 2026-09-08 the same skill drove a Codex session with no guards
 * and no reconcile. role.js already refuses to send the implementer to a
 * non-harness backend; this is the same rule one level up, for the
 * orchestrator itself.
 *
 * Detection: Claude Code sets CLAUDECODE=1 in every shell it spawns.
 * Exit 0 when present, 2 otherwise. Zero tokens; local script.
 */
"use strict";

const entry = process.env.CLAUDE_CODE_ENTRYPOINT || "";
if (process.env.CLAUDECODE === "1") {
  console.log("ClauDHD preflight: ok - Claude Code harness" + (entry ? " (" + entry + ")" : "") + ", hooks and agent files apply.");
  process.exit(0);
}
console.error(
  "ClauDHD preflight: refused - CLAUDECODE is not set, so this is not a Claude Code shell.\n" +
  "  The sentinel, scope log, commit reconcile, and per-role tool limits only run under Claude Code hooks.\n" +
  "  Pipeline mode has no guarantees here. Do not run any stage. Use the Claude Code harness, or a harness adapter that ports the hooks."
);
process.exit(2);
