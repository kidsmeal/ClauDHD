"use strict";
/*
 * root.js - the single project-root resolver for every ClauDHD script.
 *
 * Order: CLAUDHD_PROJECT_DIR > GANTRY_PROJECT_DIR > CLAUDE_PROJECT_DIR > cwd.
 * ClauDHD's own scripts read CLAUDHD_PROJECT_DIR first (unchanged from 0.9);
 * the scripts folded in from Gantry (sentinel-core.js, role.js, and everything
 * wired through them) fall back to GANTRY_PROJECT_DIR next, so both plugins'
 * existing env contracts keep working now that they live in one project.
 * CLAUDE_PROJECT_DIR is Claude Code's own var; cwd is the last resort for a
 * manual invocation outside the harness.
 *
 * A guard resolving a different root than the writer would enforce against -
 * or read state from - the wrong repo, so every script under
 * plugins/claudhd/scripts/ MUST resolve root through this module and no other
 * path (see design/claudhd-1.0-design_reviewed.md cross-cutting concern 3).
 *
 * env is an explicit object rather than an implicit read of process.env, so
 * tests can pin a root without mutating the real environment - this mirrors
 * sentinel-core.js's pre-merge resolveRoot(env) signature exactly, so it can
 * re-export this function unchanged.
 */
const fs = require("fs");
const path = require("path");

function resolveRoot(env) {
  const e = env || process.env;
  return (e.CLAUDHD_PROJECT_DIR || e.GANTRY_PROJECT_DIR || e.CLAUDE_PROJECT_DIR) || process.cwd();
}

// Sentinel value walkForRoot returns on a genuine internal error (a thrown
// fs/path call, NOT a clean walk that simply found no marker). Deliberately
// distinct from `null` ("no adopted ancestor"): callers must fail open on
// this value, never silently fall back to the env-resolved root the way they
// do for a clean "no ancestor" result - an internal error means the walk's
// answer cannot be trusted, so trusting the OTHER root's mode/sentinel
// instead could deny (or allow) against the wrong repo's rules.
const WALK_FAILED = Symbol("WALK_FAILED");

// walkForRoot(startDir) - resolve the guarded root PER FILE rather than per
// session: walk UP from startDir (an edited file's own directory) to the
// nearest ancestor that is itself an adopted project - `.now/enabled`, or
// legacy `.gantry/enabled` paired with a claudhd-marked NOW.md at that SAME
// level (the stricter pairing avoids a bare `.gantry/enabled` in an unrelated
// directory falsely counting as adoption during the walk; isAdopted()'s own
// per-root check, used once a root is already chosen, keeps its looser
// either-marker rule unchanged). Closes the gap where a session's env root
// (CLAUDHD_PROJECT_DIR et al.) points at a different repo than the one the
// edited file actually lives in, which left that other repo's enforcement
// blind to edits happening inside it.
//
// Bounded: stops at the filesystem root (path.dirname(dir) === dir), which
// returns `null` ("no adopted ancestor found" - a clean, expected result).
// Returns `WALK_FAILED` on a genuine internal error instead (see above) -
// callers MUST distinguish the two: `null` falls back to the env-resolved
// root exactly as if no walk ran; `WALK_FAILED` must fail open outright.
function walkForRoot(startDir) {
  try {
    let dir = path.resolve(startDir);
    for (;;) {
      if (fs.existsSync(path.join(dir, ".now", "enabled"))) return dir;

      if (fs.existsSync(path.join(dir, ".gantry", "enabled"))) {
        const nowPath = path.join(dir, "NOW.md");
        if (fs.existsSync(nowPath) && fs.readFileSync(nowPath, "utf8").includes("<!-- claudhd")) {
          return dir;
        }
      }

      const parent = path.dirname(dir);
      if (parent === dir) return null; // filesystem root reached, no ancestor matched
      dir = parent;
    }
  } catch {
    return WALK_FAILED; // genuine internal error - never conflate with "no ancestor"
  }
}

resolveRoot.walkForRoot = walkForRoot;
resolveRoot.WALK_FAILED = WALK_FAILED;
module.exports = resolveRoot;
