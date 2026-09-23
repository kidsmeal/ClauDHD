"use strict";
/*
 * /claudhd:init --relocate (relocate.js): plans every move first, writes
 * nothing on a conflict or refusal, moves with git, rewrites stored paths in
 * .now/state.json and references in tracked *.md, writes and stages
 * .claude/claudhd.json, and never commits.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { makeRepo, cleanup, run, write, read, exists, optIn } = require("../tools/helpers.js");

function relocate(dir, args) {
  return run(dir, "init.js", ["--relocate", ...args]);
}

function snapshot(dir, git) {
  const files = [];
  const walk = (d) => {
    for (const ent of fs.readdirSync(path.join(dir, d), { withFileTypes: true })) {
      if (ent.name === ".git") continue;
      const rel = d ? d + "/" + ent.name : ent.name;
      if (ent.isDirectory()) walk(rel);
      else files.push(rel + "=" + fs.readFileSync(path.join(dir, rel), "utf8"));
    }
  };
  walk("");
  return { files: files.sort(), status: git(["status", "--porcelain"]), head: git(["rev-parse", "HEAD"]) };
}

function stateRepo() {
  const repo = makeRepo();
  optIn(repo.dir, repo.git, "reloc thread");
  write(repo.dir, "IDEAS.md", "# IDEAS\n");
  write(repo.dir, "ROADMAP.md", "# ROADMAP\n\n## Next\n");
  repo.git(["add", "."]);
  repo.git(["commit", "-q", "-m", "state files"]);
  return repo;
}

test("old-only files move with git mv; config written and staged; nothing committed", () => {
  const { dir, git } = stateRepo();
  try {
    const head = git(["rev-parse", "HEAD"]);
    const r = relocate(dir, ["--state", "docs/dev"]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /move: NOW\.md -> docs\/dev\/NOW\.md/);
    for (const name of ["NOW.md", "IDEAS.md", "ROADMAP.md"]) {
      assert.ok(exists(dir, "docs/dev/" + name), name + " moved");
      assert.ok(!exists(dir, name), name + " gone from the root");
    }
    const staged = git(["status", "--porcelain"]);
    assert.match(staged, /^R {2}NOW\.md -> docs\/dev\/NOW\.md$/m);
    assert.match(staged, /^A {2}\.claude\/claudhd\.json$/m);
    assert.deepEqual(JSON.parse(read(dir, ".claude/claudhd.json")), { version: 1, paths: { state: "docs/dev", audit: "auto", design: null } });
    assert.equal(git(["rev-parse", "HEAD"]), head, "relocate never commits");
    const p = run(dir, "paths.js");
    assert.match(p.stdout, /^NOW=docs\/dev\/NOW\.md /);
  } finally { cleanup(dir); }
});

test("--dry-run prints the plan and changes nothing", () => {
  const { dir, git } = stateRepo();
  try {
    const before = snapshot(dir, git);
    const r = relocate(dir, ["--state", "docs/dev", "--audit", "docs/dev", "--design", "docs/dev", "--dry-run"]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /ClauDHD relocate \(dry run\)/);
    assert.match(r.stdout, /move: IDEAS\.md -> docs\/dev\/IDEAS\.md/);
    assert.match(r.stdout, /Dry run\. Nothing written\./);
    assert.deepEqual(snapshot(dir, git), before);
  } finally { cleanup(dir); }
});

test("an identical duplicate at the old location is removed, the target kept", () => {
  const { dir, git } = stateRepo();
  try {
    fs.mkdirSync(path.join(dir, "docs", "dev"), { recursive: true });
    write(dir, "docs/dev/IDEAS.md", read(dir, "IDEAS.md"));
    git(["add", "docs/dev/IDEAS.md"]);
    git(["commit", "-q", "-m", "dup"]);
    const r = relocate(dir, ["--state", "docs/dev"]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /remove duplicate: IDEAS\.md \(identical to docs\/dev\/IDEAS\.md\)/);
    assert.ok(!exists(dir, "IDEAS.md"));
    assert.equal(read(dir, "docs/dev/IDEAS.md"), "# IDEAS\n");
    assert.match(git(["status", "--porcelain"]), /^D {2}IDEAS\.md$/m);
  } finally { cleanup(dir); }
});

test("a differing duplicate aborts the whole run and leaves everything untouched", () => {
  const { dir, git } = stateRepo();
  try {
    fs.mkdirSync(path.join(dir, "docs", "dev"), { recursive: true });
    write(dir, "docs/dev/IDEAS.md", "# IDEAS\n\n- [ ] different\n");
    const before = snapshot(dir, git);
    const r = relocate(dir, ["--state", "docs/dev"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /CONFLICT: IDEAS\.md and docs\/dev\/IDEAS\.md both exist and differ/);
    assert.match(r.stderr, /Refused\. Nothing written\./);
    assert.deepEqual(snapshot(dir, git), before);
  } finally { cleanup(dir); }
});

test("an active plan-backed build sentinel refuses the run", () => {
  const { dir, git } = stateRepo();
  try {
    fs.mkdirSync(path.join(dir, ".now"), { recursive: true });
    write(dir, ".now/state.json", JSON.stringify({
      schemaVersion: 2,
      build: { plan: "plan.md", phase: 1, files: [], allow: [], started: new Date().toISOString(), session: "other" },
    }));
    const before = snapshot(dir, git);
    const r = relocate(dir, ["--state", "docs/dev"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /REFUSED: build phase 1 of plan\.md is in flight/);
    assert.deepEqual(snapshot(dir, git), before);
  } finally { cleanup(dir); }
});

test("stored paths in .now/state.json follow the moved files", () => {
  const { dir, git } = stateRepo();
  try {
    fs.mkdirSync(path.join(dir, "design"));
    write(dir, "design/feat.md", "# feat\n");
    write(dir, "design/feat-plan.md", "# plan\n");
    write(dir, "CURRENTNESS_AUDIT.md", "# audit\n");
    git(["add", "."]);
    git(["commit", "-q", "-m", "docs"]);
    fs.mkdirSync(path.join(dir, ".now"), { recursive: true });
    write(dir, ".now/state.json", JSON.stringify({
      schemaVersion: 2,
      build: {
        plan: "design/feat-plan.md", phase: 2, started: "2020-01-01T00:00:00.000Z", session: "old",
        files: ["src/a.js", "NOW.md"], allow: ["design/feat-plan.md", "CURRENTNESS_AUDIT.md", "ROADMAP.md"],
        originalFiles: ["src/a.js"],
      },
      design: { doc: "design/feat.md", resolved: [], open: [] },
      commitPolicy: { mode: "auto", plan: "design/feat-plan.md", grantedAt: "2020-01-01T00:00:00.000Z" },
    }));
    const r = relocate(dir, ["--state", "docs/dev", "--audit", "docs/dev", "--also", "design/feat.md", "design/feat-plan.md"]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /state\.json build\.plan: design\/feat-plan\.md -> docs\/dev\/feat-plan\.md/);
    const s = JSON.parse(read(dir, ".now/state.json"));
    assert.equal(s.build.plan, "docs/dev/feat-plan.md");
    assert.deepEqual(s.build.allow, ["docs/dev/feat-plan.md", "docs/dev/CURRENTNESS_AUDIT.md", "docs/dev/ROADMAP.md"]);
    assert.deepEqual(s.build.files, ["src/a.js", "docs/dev/NOW.md"]);
    assert.equal(s.design.doc, "docs/dev/feat.md");
    assert.equal(s.commitPolicy.plan, "docs/dev/feat-plan.md");
    assert.ok(exists(dir, "docs/dev/feat.md"));
  } finally { cleanup(dir); }
});

test("references in tracked *.md are rewritten, relative links re-derived, SHIPPED.md and bare prose untouched", () => {
  const { dir, git } = stateRepo();
  try {
    fs.mkdirSync(path.join(dir, "design"));
    write(dir, "README.md", [
      "# app",
      "See [the cursor](NOW.md) and [roadmap](./ROADMAP.md#next).",
      "Queue lives in `IDEAS.md`; design notes in design/feat.md.",
      "NOW.md is regenerated at every commit.",
      "A lookalike: notdesign/feat.md and design/feat.md.bak stay.",
      "",
    ].join("\n"));
    write(dir, "design/feat.md", "# feat\n\nBack to [readme](../README.md), ahead to [roadmap](../ROADMAP.md).\n");
    write(dir, "SHIPPED.md", "# SHIPPED\n\n<!-- last-sha: -->\n\n### 2026-01-01\n- moved `NOW.md` and design/feat.md\n");
    git(["add", "."]);
    git(["commit", "-q", "-m", "refs"]);
    const r = relocate(dir, ["--state", "docs/dev", "--also", "design/feat.md"]);
    assert.equal(r.status, 0, r.stderr);

    const readme = read(dir, "README.md");
    assert.match(readme, /\[the cursor\]\(docs\/dev\/NOW\.md\)/);
    assert.match(readme, /\[roadmap\]\(\.\/docs\/dev\/ROADMAP\.md#next\)/);
    assert.match(readme, /`docs\/dev\/IDEAS\.md`/);
    assert.match(readme, /design notes in docs\/dev\/feat\.md\./);
    assert.match(readme, /^NOW\.md is regenerated at every commit\.$/m);
    assert.match(readme, /notdesign\/feat\.md and design\/feat\.md\.bak stay/);

    const feat = read(dir, "docs/dev/feat.md");
    assert.match(feat, /\[readme\]\(\.\.\/\.\.\/README\.md\)/);
    assert.match(feat, /\[roadmap\]\(ROADMAP\.md\)/);

    assert.match(read(dir, "docs/dev/SHIPPED.md"), /- moved `NOW\.md` and design\/feat\.md/);

    assert.match(r.stdout, /rewrite: README\.md:2 NOW\.md -> docs\/dev\/NOW\.md/);
    assert.match(r.stdout, /rewrite: README\.md:3 design\/feat\.md -> docs\/dev\/feat\.md/);
    assert.match(r.stdout, /rewrite: docs\/dev\/feat\.md:3 \.\.\/README\.md -> \.\.\/\.\.\/README\.md/);
  } finally { cleanup(dir); }
});

test("an ignored .claude/ refuses the run", () => {
  const { dir, git } = stateRepo();
  try {
    write(dir, ".gitignore", ".now/\n.claude/\n");
    git(["add", ".gitignore"]);
    git(["commit", "-q", "-m", "ignore claude"]);
    const before = snapshot(dir, git);
    const r = relocate(dir, ["--state", "docs/dev"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /REFUSED: \.claude\/claudhd\.json is ignored by git/);
    assert.deepEqual(snapshot(dir, git), before);
  } finally { cleanup(dir); }
});

test("invalid target and missing --state are refused before anything is read", () => {
  const { dir } = stateRepo();
  try {
    let r = relocate(dir, ["--state", "../out"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /REFUSED: invalid --state/);
    r = relocate(dir, ["--audit", "docs"]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /--state <dir> is required/);
    assert.ok(exists(dir, "NOW.md"));
  } finally { cleanup(dir); }
});

test("config-first: files still at the root move to the configured dir", () => {
  const { dir, git } = stateRepo();
  try {
    fs.mkdirSync(path.join(dir, ".claude"));
    write(dir, ".claude/claudhd.json", JSON.stringify({ version: 1, paths: { state: "docs/dev" } }));
    const r = relocate(dir, ["--state", "docs/dev"]);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(exists(dir, "docs/dev/NOW.md"));
    assert.ok(!exists(dir, "NOW.md"));
    assert.match(git(["status", "--porcelain"]), /^R {2}NOW\.md -> docs\/dev\/NOW\.md$/m);
  } finally { cleanup(dir); }
});
