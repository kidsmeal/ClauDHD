"use strict";
/*
 * Tests for brief.js's mode-drift flag: NOW.md's own rendered Mode:/from:
 * lines (nowfile.js's modeLine()/fromLine(), parsed back out of the
 * generated shape) compared against the live .now/state.json. This is the
 * "board" consumer phase 3 deferred nowfile.js's extractors to (phase 7).
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { makeRepo, cleanup, run, write } = require("../tools/helpers.js");
const { render } = require("../plugins/claudhd/scripts/nowrender.js");

function writeState(dir, patch) {
  const nowDir = path.join(dir, ".now");
  fs.mkdirSync(nowDir, { recursive: true });
  fs.writeFileSync(path.join(nowDir, "state.json"), JSON.stringify({ schemaVersion: 2, ...patch }));
}

test("mode drift flag: absent when NOW.md's Mode/from lines agree with state.json", () => {
  const { dir, git } = makeRepo();
  try {
    const nowText = render({ mode: "design", from: "r-0725-1", intent: { thread: "t", next: "n" } });
    write(dir, "NOW.md", nowText);
    write(dir, ".gitignore", ".now/\n");
    git(["add", "."]);
    git(["commit", "-q", "-m", "init"]);
    writeState(dir, { mode: "design", from: "r-0725-1" });

    const r = run(dir, "brief.js", ["--plain"]);
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stdout, /Mode\/from lines/, "no drift flag should fire when they agree");
  } finally { cleanup(dir); }
});

test("mode drift flag: fires when NOW.md's rendered mode disagrees with state.json's mode", () => {
  const { dir, git } = makeRepo();
  try {
    // NOW.md was generated while mode was "design"...
    const nowText = render({ mode: "design", from: "r-0725-2", intent: { thread: "t", next: "n" } });
    write(dir, "NOW.md", nowText);
    write(dir, ".gitignore", ".now/\n");
    git(["add", "."]);
    git(["commit", "-q", "-m", "init"]);
    // ...but state.json has since moved on to build, without NOW.md being regenerated.
    writeState(dir, { mode: "build", from: "r-0725-2" });

    const r = run(dir, "brief.js", ["--plain"]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /## Drift flags/);
    assert.match(r.stdout, /Mode\/from lines/);
    assert.match(r.stdout, /"design"/);
    assert.match(r.stdout, /"build"/);
  } finally { cleanup(dir); }
});

test("mode drift flag: fires when the from id disagrees", () => {
  const { dir, git } = makeRepo();
  try {
    const nowText = render({ mode: "design", from: "r-0725-3", intent: { thread: "t", next: "n" } });
    write(dir, "NOW.md", nowText);
    write(dir, ".gitignore", ".now/\n");
    git(["add", "."]);
    git(["commit", "-q", "-m", "init"]);
    writeState(dir, { mode: "design", from: "r-0725-9" });

    const r = run(dir, "brief.js", ["--plain"]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Mode\/from lines/);
  } finally { cleanup(dir); }
});

test("mode drift flag: silent (no throw) when state.json is absent", () => {
  const { dir, git } = makeRepo();
  try {
    const nowText = render({ mode: "design", from: "r-0725-4", intent: { thread: "t", next: "n" } });
    write(dir, "NOW.md", nowText);
    write(dir, ".gitignore", ".now/\n");
    git(["add", "."]);
    git(["commit", "-q", "-m", "init"]);

    const r = run(dir, "brief.js", ["--plain"]);
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stdout, /Mode\/from lines/);
  } finally { cleanup(dir); }
});

test("mode drift flag: silent on a hand-written pre-1.0 NOW.md with no Mode:/from: lines", () => {
  const { dir, git } = makeRepo();
  try {
    write(dir, "NOW.md", "# NOW\n<!-- claudhd: opt-in marker -->\n\n## Active thread\n\n**thread**\n\n- [ ] step\n");
    write(dir, ".gitignore", ".now/\n");
    git(["add", "."]);
    git(["commit", "-q", "-m", "init"]);
    writeState(dir, { mode: null, from: null });

    const r = run(dir, "brief.js", ["--plain"]);
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stdout, /Mode\/from lines/, "both sides read as idle/unplanned - no drift");
  } finally { cleanup(dir); }
});
