"use strict";
/*
 * Tests for /claudhd:quick (quick.js) - the quick-fixes batch.
 *
 * Covers: adding into the template section, self-healing a NOW.md that predates
 * the feature, the cap signal, list mode, the no-NOW.md guard, and that
 * concurrent adds don't drop items (the same lock idea.js relies on).
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { makeRepo, cleanup, run, runAsync, read, write, nowFile } = require("../tools/helpers.js");

// A NOW.md that already carries the Quick fixes section, as the template ships it.
function nowWithQuick(thread = "main") {
  return [
    "# NOW",
    "<!-- claudhd: opt-in marker -->",
    "",
    "## Active thread",
    "",
    `**${thread}**`,
    "",
    "- [ ] step",
    "",
    "## Queue (in order, not now)",
    "",
    "(nothing queued yet)",
    "",
    "## Quick fixes (clear in one pass)",
    "",
    "Small chores.",
    "",
    "(nothing queued yet)",
    "",
    "## Idea flow",
    "",
    "stuff",
    "",
  ].join("\n");
}

test("adds a quick fix under the Quick fixes section, not the Queue", () => {
  const { dir } = makeRepo();
  try {
    write(dir, "NOW.md", nowWithQuick());
    const r = run(dir, "quick.js", ["fix the typo"]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /added/i);
    const now = read(dir, "NOW.md");
    const quickSec = now.slice(now.indexOf("## Quick fixes"), now.indexOf("## Idea flow"));
    assert.match(quickSec, /- \[ \] fix the typo/);
    assert.doesNotMatch(quickSec, /nothing queued yet/); // placeholder replaced
    const queueSec = now.slice(now.indexOf("## Queue"), now.indexOf("## Quick fixes"));
    assert.doesNotMatch(queueSec, /fix the typo/);
  } finally { cleanup(dir); }
});

test("self-heals a NOW.md that has no Quick fixes section", () => {
  const { dir } = makeRepo();
  try {
    write(dir, "NOW.md", nowFile("thread")); // no Quick fixes section
    const r = run(dir, "quick.js", ["bump the lint rule"]);
    assert.equal(r.status, 0, r.stderr);
    const now = read(dir, "NOW.md");
    assert.match(now, /## Quick fixes/);
    assert.match(now, /- \[ \] bump the lint rule/);
  } finally { cleanup(dir); }
});

test("signals when the batch grows past its cap", () => {
  const { dir } = makeRepo();
  try {
    write(dir, "NOW.md", nowWithQuick());
    let r;
    for (let i = 1; i <= 6; i++) r = run(dir, "quick.js", [`chore ${i}`]);
    assert.match(r.stdout, /cap/i); // the 6th add is over the cap of 5
    const now = read(dir, "NOW.md");
    for (let i = 1; i <= 6; i++) assert.match(now, new RegExp(`- \\[ \\] chore ${i}`));
  } finally { cleanup(dir); }
});

test("list mode prints open items with the count", () => {
  const { dir } = makeRepo();
  try {
    write(dir, "NOW.md", nowWithQuick());
    run(dir, "quick.js", ["only chore"]);
    const r = run(dir, "quick.js", []); // no args -> list
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /BATCH \(1\/5\)/);
    assert.match(r.stdout, /only chore/);
  } finally { cleanup(dir); }
});

test("list mode on an empty batch says empty", () => {
  const { dir } = makeRepo();
  try {
    write(dir, "NOW.md", nowWithQuick());
    const r = run(dir, "quick.js", []);
    assert.match(r.stdout, /empty/i);
  } finally { cleanup(dir); }
});

test("no NOW.md: guides to init and does not create NOW.md", () => {
  const { dir } = makeRepo();
  try {
    const r = run(dir, "quick.js", ["something"]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /init/i);
    assert.equal(fs.existsSync(path.join(dir, "NOW.md")), false);
  } finally { cleanup(dir); }
});

test("concurrent adds do not drop quick fixes (lock regression)", async () => {
  const { dir } = makeRepo();
  try {
    write(dir, "NOW.md", nowWithQuick());
    const N = 10;
    const jobs = [];
    for (let i = 0; i < N; i++) jobs.push(runAsync(dir, "quick.js", [`q-${i}`]));
    const results = await Promise.all(jobs);
    for (const r of results) assert.equal(r.status, 0, `an add failed: ${r.stderr}`);
    const now = read(dir, "NOW.md");
    const missing = [];
    for (let i = 0; i < N; i++) if (!now.includes(`q-${i}`)) missing.push(i);
    assert.equal(missing.length, 0, `dropped ${missing.length}/${N}: ${missing.join(", ")}`);
  } finally { cleanup(dir); }
});
