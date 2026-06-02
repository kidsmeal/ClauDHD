"use strict";
/*
 * Tests for the provider-neutral project-dir resolution shared by every script:
 * CLAUDHD_PROJECT_DIR wins, then CLAUDE_PROJECT_DIR, then cwd. idea.js is the
 * probe because where it writes IDEAS.md makes the resolved root directly
 * observable.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { makeRepo, cleanup, run, read, exists } = require("../tools/helpers.js");

test("CLAUDHD_PROJECT_DIR takes precedence over CLAUDE_PROJECT_DIR", () => {
  const claude = makeRepo();   // helper points CLAUDE_PROJECT_DIR here
  const claudhd = makeRepo();  // ...but CLAUDHD_PROJECT_DIR should win
  try {
    const r = run(claude.dir, "idea.js", ["neutral idea"], { CLAUDHD_PROJECT_DIR: claudhd.dir });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(exists(claudhd.dir, "IDEAS.md"), true, "should write under CLAUDHD_PROJECT_DIR");
    assert.match(read(claudhd.dir, "IDEAS.md"), /neutral idea/);
    assert.equal(exists(claude.dir, "IDEAS.md"), false, "must NOT write under CLAUDE_PROJECT_DIR");
  } finally { cleanup(claude.dir); cleanup(claudhd.dir); }
});

test("falls back to CLAUDE_PROJECT_DIR when CLAUDHD_PROJECT_DIR is unset", () => {
  const { dir } = makeRepo();
  try {
    const r = run(dir, "idea.js", ["fallback idea"]); // helper sets only CLAUDE_PROJECT_DIR
    assert.equal(r.status, 0, r.stderr);
    assert.equal(exists(dir, "IDEAS.md"), true);
    assert.match(read(dir, "IDEAS.md"), /fallback idea/);
  } finally { cleanup(dir); }
});
