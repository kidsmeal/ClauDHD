/*
 * sentinel-core.js - shared helper for sentinel read + path normalization.
 *
 * Used by both the phase-enforcement guards (read side) and sentinel.js (write
 * side) so the two sides cannot drift on how they interpret file paths or decide
 * whether a sentinel is still active.
 *
 * All exported functions are fail-open: every error path returns a value the
 * caller can interpret as "allow" rather than throwing. A throw from this module
 * must be treated as a bug; callers should wrap in try/catch and fail open on
 * any exception.
 *
 * Exported API:
 *   FAIL_OPEN        - sentinel value returned by normalize() on any error path
 *   readSentinel(root)            -> object | null
 *   isStale(sentinel, sessionId)  -> boolean
 *   resolveRoot(env)              -> string (root.js's resolver, re-exported)
 *   normalize(filePath, root)     -> string | FAIL_OPEN
 *   isInList(filePath, list, root)-> boolean
 */
"use strict";
const fs = require("fs");
const path = require("path");

// resolveRoot is root.js's resolver, re-exported unchanged - the guards and
// sentinel.js call it as core.resolveRoot(process.env), same as before.
const resolveRoot = require("./root.js");

// Sentinel value for "caller should fail open". A unique symbol so callers can
// do an identity check rather than testing for null/undefined/empty-string.
const FAIL_OPEN = Symbol("FAIL_OPEN");

// Staleness threshold: 6 hours in milliseconds.
const STALE_MS = 6 * 60 * 60 * 1000;

// Read the active sentinel: the `build` section of .now/state.json (schema v2;
// Gantry's sentinel folded in). Returns null when state.json is absent, its
// build section is absent/null, or the file is malformed. Never throws.
//
// One-shot legacy migration: if the build section is absent AND a legacy
// .gantry/active-phase.json exists (a project that never re-ran /claudhd:build
// since upgrading), and that legacy sentinel is not stale (isStale()'s own
// rule), import it into state.json's build section, delete the legacy file,
// and return the imported value - so the very read that would otherwise see
// "no sentinel" still enforces against the phase that was actually in
// flight. A STALE legacy sentinel is never imported (the legacy file is
// still removed) - importing a dead phase with enforcement on would gate
// every future edit against a build nobody is running. Every read after the
// first sees state.json only; no
// code path reads the legacy file again once it is gone.
function readSentinel(root) {
  const nowDir = path.join(root, ".now");

  let build = null;
  try {
    const raw = fs.readFileSync(path.join(nowDir, "state.json"), "utf8");
    const state = JSON.parse(raw);
    if (state && typeof state === "object" && state.build != null) build = state.build;
  } catch {
    // state.json absent or malformed - fall through to the legacy check below.
  }
  if (build != null) return build;

  const legacyPath = path.join(root, ".gantry", "active-phase.json");
  let legacy = null;
  try {
    legacy = JSON.parse(fs.readFileSync(legacyPath, "utf8"));
  } catch {
    return null; // no legacy file, or it is malformed - nothing to import.
  }
  if (legacy == null || typeof legacy !== "object") return null;

  // A stale legacy sentinel must never be imported live: importing a
  // 26-day-old dead phase into state.json's build section with enforcement on
  // gates every future edit against a build nobody is running. isStale() is
  // the SAME rule the guards use; there is no "current session" at import
  // time, so the session half of its AND is passed as undefined - trivially
  // true for any real legacy sentinel (its own session field is never
  // undefined), which leaves the age check as the real gate here. The legacy
  // file is still removed either way - it is one-shot regardless of outcome.
  if (isStale(legacy, undefined)) {
    try { fs.unlinkSync(legacyPath); } catch { /* ignore */ }
    try {
      process.stderr.write(
        "sentinel-core: found stale in-flight build state from " + legacy.started + ", not imported\n"
      );
    } catch { /* ignore */ }
    return null;
  }

  try {
    // Lazy require: state.js requires nowfile.js/lock.js/constants.js only, so
    // this has no cycle back into sentinel-core.js; kept lazy anyway so a
    // future refactor can't quietly introduce one without this file noticing.
    const { writeStateAtomic } = require("./state.js");
    writeStateAtomic(nowDir, { build: legacy }, ["build"]);
  } catch {
    // Import is best-effort: even if the write fails, still enforce against
    // the legacy value for this read rather than fail open.
  }
  try { fs.unlinkSync(legacyPath); } catch { /* ignore */ }

  return legacy;
}

// Decide whether a sentinel is stale. The rule is AND: both the session must
// differ from the current session AND the started timestamp must be older than
// the 6-hour threshold. Either condition alone is not enough: a session mismatch
// can happen in legitimate same-day resumed sessions, and a long age alone is
// fine within the same session.
function isStale(sentinel, currentSessionId) {
  try {
    const sessionDiffers = sentinel.session !== currentSessionId;
    const started = new Date(sentinel.started).getTime();
    const ageMs = Date.now() - started;
    return sessionDiffers && ageMs > STALE_MS;
  } catch {
    // If we cannot evaluate staleness, treat as not stale (fail-open: enforce).
    return false;
  }
}

// Normalize a file_path to a project-relative POSIX string suitable for
// comparison against a sentinel's files/allow entries (which are stored as
// repo-relative POSIX paths).
//
// Steps:
//   1. Guard against missing/empty input -> return FAIL_OPEN.
//   2. Guard against null/missing root -> return FAIL_OPEN.
//   3. Lowercase the drive letter on both filePath and root (Windows C:\ vs c:\).
//   4. Pick path semantics (win32 vs posix) from the input shape, not the host.
//   5. relative() from root to filePath using that path module.
//   6. If the result starts with ".." the target escapes the root -> return FAIL_OPEN.
//   7. Return the POSIX-relative path.
//
// Never throws.
function normalize(filePath, root) {
  try {
    if (filePath == null || filePath === "") return FAIL_OPEN;
    if (root == null || root === "") return FAIL_OPEN;

    // Lowercase drive letters (separators are normalized after relativizing).
    const normRoot = _normDrive(String(root));
    const normFile = _normDrive(String(filePath));

    // Choose path semantics from the input shape, not the host platform, so a
    // Windows-style path relativizes identically whether this runs on Windows,
    // Linux, or macOS. A drive letter (c:) or a backslash means win32; otherwise
    // posix. Relying on the host `path` makes the Windows-path cases return
    // FAIL_OPEN when CI runs on Linux/macOS (path.posix has no drive concept).
    const looksWin = (s) => /^[a-z]:/i.test(s) || s.includes("\\");
    const pmod = looksWin(normRoot) || looksWin(normFile) ? path.win32 : path.posix;
    const rel = pmod.relative(normRoot, normFile);

    // If the relative path starts with "..", the file is outside the root.
    if (rel.startsWith("..")) return FAIL_OPEN;

    // Convert any remaining backslashes to forward slashes and return.
    return rel.replace(/\\/g, "/");
  } catch {
    return FAIL_OPEN;
  }
}

// Lowercase the drive letter of an absolute path string (e.g. "C:\foo" -> "c:\foo",
// "C:/foo" -> "c:/foo"). No-op for relative paths or non-Windows-looking paths.
function _normDrive(p) {
  // Windows absolute: starts with a letter followed by ":"
  return p.replace(/^([A-Za-z]):/, (_, d) => d.toLowerCase() + ":");
}

// Return true if filePath is in the given list of project-relative POSIX entries.
// Returns true (fail-open) if normalize() returns FAIL_OPEN for the filePath.
// Returns false if the path normalizes successfully but does not appear in the list.
function isInList(filePath, list, root) {
  try {
    const norm = normalize(filePath, root);
    if (norm === FAIL_OPEN) return true; // fail-open
    if (!Array.isArray(list)) return true; // no list -> fail-open
    for (const entry of list) {
      // Normalize entries too, in case they somehow contain backslashes.
      const normEntry = typeof entry === "string" ? entry.replace(/\\/g, "/") : entry;
      if (norm === normEntry) return true;
    }
    return false;
  } catch {
    return true; // fail-open on any error
  }
}

module.exports = { FAIL_OPEN, readSentinel, isStale, resolveRoot, normalize, isInList };
