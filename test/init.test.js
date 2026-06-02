"use strict";
/*
 * Tests for /claudhd:init first-run UX. Init should report what it changed,
 * but its repo signals should not echo ClauDHD's own scaffolded files back as
 * uncommitted work.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { makeRepo, cleanup, run, write } = require("../tools/helpers.js");

test("init filters its own scaffolded files from repo signals", () => {
  const { dir, git } = makeRepo();
  try {
    write(dir, "README.md", "# app\n");
    git(["add", "README.md"]);
    git(["commit", "-q", "-m", "initial"]);

    const r = run(dir, "init.js");
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Created: NOW.md, IDEAS.md, SHIPPED.md/);
    assert.doesNotMatch(r.stdout, /\?\? NOW\.md/);
    assert.doesNotMatch(r.stdout, /\?\? IDEAS\.md/);
    assert.doesNotMatch(r.stdout, /\?\? SHIPPED\.md/);
    assert.doesNotMatch(r.stdout, /\?\? \.gitignore/);
    assert.equal(fs.existsSync(path.join(dir, "NOW.md")), true);
  } finally { cleanup(dir); }
});

test("init still reports real uncommitted work", () => {
  const { dir, git } = makeRepo();
  try {
    write(dir, "README.md", "# app\n");
    git(["add", "README.md"]);
    git(["commit", "-q", "-m", "initial"]);
    write(dir, "src.txt", "work in progress\n");

    const r = run(dir, "init.js");
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Uncommitted paths:\n\s+src\.txt/);
  } finally { cleanup(dir); }
});

test("init repo signals count a nested NOW.md, not just the root cursor", () => {
  const { dir, git } = makeRepo();
  try {
    write(dir, "README.md", "# app\n");
    git(["add", "README.md"]);
    git(["commit", "-q", "-m", "initial"]);
    // Filtering is by exact root-relative path, so a nested file that only shares
    // a basename with the scaffolded cursor is still real uncommitted work.
    fs.mkdirSync(path.join(dir, "docs"), { recursive: true });
    write(dir, path.join("docs", "NOW.md"), "# real notes\n");

    const r = run(dir, "init.js");
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Uncommitted paths:[\s\S]*docs\/NOW\.md/);
  } finally { cleanup(dir); }
});
