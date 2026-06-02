"use strict";
/*
 * Tests for /claudhd:shipped first-run behavior and idempotence.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { makeRepo, cleanup, run, read, write } = require("../tools/helpers.js");

test("shipped starts tracking from current HEAD on first run", () => {
  const { dir, git } = makeRepo();
  try {
    write(dir, "README.md", "# app\n");
    git(["add", "README.md"]);
    git(["commit", "-q", "-m", "initial"]);

    const r = run(dir, "shipped.js");
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /started from here/);
    const shipped = read(dir, "SHIPPED.md");
    assert.match(shipped, /<!-- last-sha: [0-9a-f]{40} -->/);
    assert.doesNotMatch(shipped, /initial/);
  } finally { cleanup(dir); }
});

test("shipped logs only commits after the first-run marker", () => {
  const { dir, git } = makeRepo();
  try {
    write(dir, "README.md", "# app\n");
    git(["add", "README.md"]);
    git(["commit", "-q", "-m", "initial"]);
    run(dir, "shipped.js");

    write(dir, "feature.txt", "done\n");
    git(["add", "feature.txt"]);
    git(["commit", "-q", "-m", "finish feature"]);

    const r = run(dir, "shipped.js");
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Logged 1 shipped item/);
    const shipped = read(dir, "SHIPPED.md");
    assert.match(shipped, /finish feature/);
    assert.doesNotMatch(shipped, /- initial/);

    const again = run(dir, "shipped.js");
    assert.match(again.stdout, /up to date/);
  } finally { cleanup(dir); }
});
