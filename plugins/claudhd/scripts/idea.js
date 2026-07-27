#!/usr/bin/env node
/*
 * ClauDHD idea capture - the /claudhd:idea command.
 *
 * Thin CLI over vocab.js's append-capture verb (phase 6: one write path -
 * idea.js no longer writes IDEAS.md itself; it delegates to
 * vocab.appendCapture, the same function the vocab.js CLI's own
 * `append-capture` verb and (later) Object Permanence v2 both call). Pure
 * local append, zero model tokens: capturing is cheaper than chasing, so the
 * current thread survives instead of getting abandoned for a new chat.
 */
"use strict";
const vocab = require("./vocab.js");

// Single resolver for every ClauDHD script (see root.js).
const ROOT = require("./root.js")(process.env);

const text = process.argv.slice(2).join(" ").trim();
if (!text) {
  console.log("Nothing captured. Usage: /claudhd:idea <your idea>");
  process.exit(0);
}

try {
  vocab.appendCapture(ROOT, text);
  console.log(`Captured -> IDEAS.md: ${text}`);
} catch (e) {
  console.error("! ClauDHD: could not write IDEAS.md (" + e.message + "). Idea not captured.");
  process.exit(1);
}
