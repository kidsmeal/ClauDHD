#!/usr/bin/env node
/*
 * ClauDHD version - the /claudhd:version command.
 *
 * Prints the installed plugin version, read from plugin.json (the single source
 * of truth). Doubles as an install check: if this resolves and prints a version,
 * the plugin loaded. Zero tokens; it is a local script.
 */
"use strict";
const fs = require("fs");
const path = require("path");

const MANIFEST = path.join(__dirname, "..", ".claude-plugin", "plugin.json");

let version = "unknown";
try {
  version = JSON.parse(fs.readFileSync(MANIFEST, "utf8")).version || "unknown";
} catch {
  console.error("! ClauDHD: could not read plugin.json - the install may be incomplete.");
  process.exit(1);
}

console.log(`ClauDHD v${version}`);
