#!/usr/bin/env node
/*
 * Plugin test entry point: `npm test` runs this.
 *
 * Lists test/*.test.js itself and passes explicit paths to `node --test`,
 * because no single positional form works across the CI matrix:
 * - `node --test "test/*.test.js"`: Node 20 does not expand globs
 *   (glob arguments landed in 21), so it fails with "Could not find".
 * - `node --test test/`: Node 20 searches the directory, Node 22+ treats
 *   it as one file and fails.
 * - `node --test` (no args): default patterns also match app/test/*.test.ts
 *   on Node 22+, which are the app's tests, not the plugin's.
 */
"use strict";
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const testDir = path.join(__dirname, "..", "test");
const files = fs.readdirSync(testDir)
  .filter((name) => name.endsWith(".test.js"))
  .sort()
  .map((name) => path.join(testDir, name));

if (files.length === 0) {
  console.error("run-tests: no test/*.test.js files found");
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
process.exit(result.status === null ? 1 : result.status);
