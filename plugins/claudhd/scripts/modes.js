"use strict";
/*
 * modes.js - the deny-by-default mode allowlist (design section 6, phase 5).
 *
 * decide(mode, relPath, buildFiles) is pure: mode + a normalized path in,
 * an allow/deny decision out. No filesystem access, no state.json read - the
 * caller (a guard) resolves mode and buildFiles from state.json and passes
 * them in, and normalizes filePath to a root-relative POSIX string via
 * sentinel-core.js's normalize() before calling this. That split is what
 * keeps this module testable as a flat table with no fixture repo.
 *
 * Allowlist (one rule per mode, no extension taxonomy beyond *.md):
 *   - design and idle (idle = null/unrecognized mode - the safe default for
 *     "neither marker"): *.md files, plus the plugin's own state dirs
 *     (.now/, .gantry/, .claude/).
 *   - build: the active sentinel's file list (buildFiles, passed in - this
 *     module never reads it from disk), plus the same state dirs.
 *   - everything else denies: not matching the mode's allowlist means the
 *     path is source-shaped by definition.
 *
 * Deny reasons always name the mode and a remedy command drawn from the
 * fixed set {/claudhd:build, /claudhd:design, /claudhd:override} - never an
 * in-app action, since only a session can actually change mode or widen
 * scope.
 */

const STATE_DIR_PREFIXES = [".now/", ".gantry/", ".claude/"];

function isStateDirPath(relPath) {
  return STATE_DIR_PREFIXES.some((d) => relPath === d.slice(0, -1) || relPath.startsWith(d));
}

function isMarkdownPath(relPath) {
  return /\.md$/i.test(relPath);
}

// Unknown/absent mode values normalize to "idle" - the deny-by-default safe
// direction (design section 6: "idle (neither)" is the no-active-mode state,
// and state.json's `mode` field being null reads the same way).
function normalizeMode(mode) {
  if (mode === "build" || mode === "design") return mode;
  return "idle";
}

// Human label for a mode value, shared by both guards' messages.
function describeMode(mode) {
  return normalizeMode(mode);
}

// The one remedy command each mode's deny reason leads with (design section
// 6's "entered by" column, read from the DENY side): build mode denied a
// path outside the phase's file list -> re-run /claudhd:build to widen the
// phase; design mode denied a source edit -> /claudhd:build is where that
// edit actually belongs; idle mode denied everything source-shaped ->
// /claudhd:design picks a mode. /claudhd:override is the one alternate path
// out of any of the three - mentioned alongside the primary remedy in every
// deny reason below, never in place of it.
function remedyFor(mode) {
  const m = normalizeMode(mode);
  if (m === "build") return "/claudhd:build";
  if (m === "design") return "/claudhd:build";
  return "/claudhd:design";
}

function denyReason(mode, relPath) {
  const m = normalizeMode(mode);
  const remedy = remedyFor(m);
  const path = relPath == null || relPath === "" ? "(no path)" : relPath;
  let why;
  if (m === "build") why = "is not in the active phase's file list";
  else if (m === "design") why = "is a source edit; design mode allows *.md and state-dir edits only";
  else why = "is source-shaped; idle mode (no active build or design) allows *.md and state-dir edits only";
  return (
    m + " mode denies " + path + ": " + why + ". run " + remedy +
    (m === "build" ? " to widen the phase" : m === "design" ? " to start implementing" : " to start one") +
    ", or /claudhd:override to record an unguarded session and proceed anyway."
  );
}

// decide(mode, relPath, buildFiles) -> { allow: boolean, reason: string|null }
function decide(mode, relPath, buildFiles) {
  if (relPath == null || relPath === "") {
    return { allow: false, reason: denyReason(mode, relPath) };
  }
  if (isStateDirPath(relPath)) return { allow: true, reason: null };

  const m = normalizeMode(mode);
  if (m === "build") {
    const files = Array.isArray(buildFiles) ? buildFiles : [];
    if (files.includes(relPath)) return { allow: true, reason: null };
    return { allow: false, reason: denyReason(mode, relPath) };
  }

  // design and idle share the exact same allowlist (*.md + state dirs) -
  // this phase's own spec states it explicitly, and design section 6's
  // prose ("design and idle modes may write *.md files plus the plugin's
  // own state dirs") is authoritative over the mode table's more cryptic
  // "idle: doc/design edits denied for source-shaped paths" cell, which
  // means the same rule worded from the source side.
  if (isMarkdownPath(relPath)) return { allow: true, reason: null };
  return { allow: false, reason: denyReason(mode, relPath) };
}

module.exports = {
  decide,
  normalizeMode,
  describeMode,
  remedyFor,
  isStateDirPath,
  isMarkdownPath,
};
