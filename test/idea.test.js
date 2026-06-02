"use strict";
/*
 * Tests for /claudhd:idea capture (idea.js).
 *
 * The deterministic proof that concurrent captures can't clobber each other
 * lives in lock.test.js (it tests the lock primitive directly). The concurrent
 * test here is an end-to-end smoke check that idea.js actually wires the lock in
 * and that many simultaneous captures all land - it can't, on its own, force the
 * race, but it guards against the lock being dropped from this script entirely.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { makeRepo, cleanup, run, runAsync, read, write, nowFile } = require("../tools/helpers.js");

test("captures a single idea into IDEAS.md", () => {
  const { dir } = makeRepo();
  try {
    const r = run(dir, "idea.js", ["buy milk"]);
    assert.equal(r.status, 0);
    const ideas = read(dir, "IDEAS.md");
    assert.match(ideas, /buy milk/);
    assert.match(ideas, /## Inbox/);
  } finally { cleanup(dir); }
});

test("captures multiple ideas sequentially without loss", () => {
  const { dir } = makeRepo();
  try {
    for (let i = 0; i < 5; i++) run(dir, "idea.js", [`idea number ${i}`]);
    const ideas = read(dir, "IDEAS.md");
    for (let i = 0; i < 5; i++) assert.match(ideas, new RegExp(`idea number ${i}`));
  } finally { cleanup(dir); }
});

test("tags the capture with the active thread from NOW.md", () => {
  const { dir } = makeRepo();
  try {
    write(dir, "NOW.md", nowFile("test thread"));
    run(dir, "idea.js", ["something"]);
    assert.match(read(dir, "IDEAS.md"), /while: test thread/);
  } finally { cleanup(dir); }
});

test("empty input captures nothing and does not create IDEAS.md", () => {
  const { dir } = makeRepo();
  try {
    const r = run(dir, "idea.js", []);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Nothing captured/);
    assert.equal(require("node:fs").existsSync(require("node:path").join(dir, "IDEAS.md")), false);
  } finally { cleanup(dir); }
});

test("concurrent captures do not drop ideas (lock regression)", async () => {
  const { dir } = makeRepo();
  try {
    const N = 12;
    const jobs = [];
    for (let i = 0; i < N; i++) jobs.push(runAsync(dir, "idea.js", [`concurrent-idea-${i}`]));
    const results = await Promise.all(jobs);
    for (const r of results) assert.equal(r.status, 0, `a capture failed: ${r.stderr}`);

    const ideas = read(dir, "IDEAS.md");
    const missing = [];
    for (let i = 0; i < N; i++) {
      if (!ideas.includes(`concurrent-idea-${i}`)) missing.push(i);
    }
    assert.equal(missing.length, 0, `dropped ${missing.length}/${N} ideas: ${missing.join(", ")}`);
  } finally { cleanup(dir); }
});
