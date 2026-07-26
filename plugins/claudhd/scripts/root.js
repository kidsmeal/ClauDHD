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
function resolveRoot(env) {
  const e = env || process.env;
  return (e.CLAUDHD_PROJECT_DIR || e.GANTRY_PROJECT_DIR || e.CLAUDE_PROJECT_DIR) || process.cwd();
}

module.exports = resolveRoot;
