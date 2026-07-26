#!/usr/bin/env node
/*
 * ClauDHD cursor budget - the check /claudhd:wrap runs to decide whether the
 * "## Active thread" section has outgrown its line budget and needs a migrate pass.
 *
 * Reads the CURRENT NOW.md (not the last .now/state.json snapshot), so it reflects
 * edits made this turn, and prints one authoritative status line for wrap to act
 * on - so the migrate decision is deterministic, not eyeballed. Silent in a project
 * without a ClauDHD-marked NOW.md; file read only, no git, no locks.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { activeThreadLineCount } = require("./nowfile.js");
const { ACTIVE_THREAD_LINE_BUDGET } = require("./constants.js");

// Single resolver for every ClauDHD script (see root.js).
const ROOT = require("./root.js")(process.env);
const NOW_MD = path.join(ROOT, "NOW.md");

try {
  let txt = "";
  try { txt = fs.existsSync(NOW_MD) ? fs.readFileSync(NOW_MD, "utf8") : ""; } catch { txt = ""; }
  if (!txt || !txt.includes("<!-- claudhd")) process.exit(0); // silent outside a ClauDHD project

  const lines = activeThreadLineCount(txt);
  const budget = ACTIVE_THREAD_LINE_BUDGET;
  if (lines > budget) {
    process.stdout.write(
      `CURSOR BUDGET: Active thread is ${lines} lines against a ${budget}-line budget ` +
      `(over by ${lines - budget}). Run the migrate pass before reconciling.\n`
    );
  } else {
    process.stdout.write(
      `CURSOR BUDGET: Active thread is ${lines} lines against a ${budget}-line budget ` +
      `(within budget). No migration needed; reconcile as usual.\n`
    );
  }
} catch { /* stay silent on any error */ }
process.exit(0);
