"use strict";
/*
 * Tests for budget.js - the cursor-budget check /claudhd:wrap runs. It reads the
 * live NOW.md, measures the "## Active thread" section, and prints one status line
 * (over vs within budget), staying silent outside a ClauDHD project.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { makeRepo, cleanup, run, write, optIn } = require("../tools/helpers.js");
const { ACTIVE_THREAD_LINE_BUDGET } = require("../plugins/claudhd/scripts/constants.js");

const MARKER = "<!-- claudhd: opt-in marker -->";

function overBudgetNow() {
  const filler = [];
  for (let i = 0; i < ACTIVE_THREAD_LINE_BUDGET + 15; i++) filler.push("- settled bundle line " + i);
  return [
    "# NOW", MARKER, "",
    "## Active thread", "",
    "**a thread that bloated**", "",
    ...filler, "",
    "## Queue", "", "(nothing queued yet)", "",
  ].join("\n");
}

test("prints an over-budget line when the active thread exceeds the budget", () => {
  const { dir, git } = makeRepo();
  try {
    optIn(dir, git, "seed");
    write(dir, "NOW.md", overBudgetNow());
    const r = run(dir, "budget.js");
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /CURSOR BUDGET/);
    assert.match(r.stdout, /over by \d+/, "should report how far over");
    assert.match(r.stdout, /migrate pass/i);
  } finally { cleanup(dir); }
});

test("prints a within-budget line for a lean cursor", () => {
  const { dir, git } = makeRepo();
  try {
    optIn(dir, git, "a small thread");
    const r = run(dir, "budget.js");
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /within budget/i);
    assert.doesNotMatch(r.stdout, /migrate pass/i);
  } finally { cleanup(dir); }
});

test("silent when NOW.md lacks the claudhd marker", () => {
  const { dir, git } = makeRepo();
  try {
    write(dir, "NOW.md", "# NOW\n\n## Active thread\n\n**x**\n");
    git(["add", "NOW.md"]);
    git(["commit", "-q", "-m", "init"]);
    const r = run(dir, "budget.js");
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), "");
  } finally { cleanup(dir); }
});

test("silent when NOW.md is absent", () => {
  const { dir } = makeRepo();
  try {
    const r = run(dir, "budget.js");
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), "");
  } finally { cleanup(dir); }
});
