"use strict";
/*
 * paths.js: the per-project location resolver for ClauDHD's state, audit and
 * design files (.claude/claudhd.json). Covers the no-config defaults, the
 * audit "auto" rule, a valid config, every rejection path, stray detection,
 * the warning sinks, and the CLI.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { makeRepo, cleanup, run, write, writeConfig } = require("../tools/helpers.js");
const P = require("../plugins/claudhd/scripts/paths.js");

// In-process resolves write warnings to stderr; silence them so the test
// output stays readable, and capture them for the assertions that need them.
function quiet(fn) {
  const orig = process.stderr.write.bind(process.stderr);
  const captured = [];
  process.stderr.write = (chunk) => { captured.push(String(chunk)); return true; };
  try { return { value: fn(), stderr: captured.join("") }; }
  finally { process.stderr.write = orig; }
}

function resolveFresh(dir) {
  P.clearCache();
  return quiet(() => P.resolvePaths(dir));
}

test("no config: every path sits at the root, audit docs at the root when docs/ is absent", () => {
  const { dir } = makeRepo();
  try {
    const { value: p, stderr } = resolveFresh(dir);
    assert.equal(p.configSource, "default");
    assert.equal(p.now.rel, "NOW.md");
    assert.equal(p.roadmap.rel, "ROADMAP.md");
    assert.equal(p.ideas.rel, "IDEAS.md");
    assert.equal(p.shipped.rel, "SHIPPED.md");
    assert.equal(p.audit.rel, "CURRENTNESS_AUDIT.md");
    assert.equal(p.rvq.rel, "RUNTIME_VERIFICATION_QUEUE.md");
    assert.equal(p.designDir, null);
    assert.equal(p.now.abs, path.join(path.resolve(dir), "NOW.md"));
    assert.deepEqual([...p.ownRel].sort(), ["IDEAS.md", "NOW.md", "ROADMAP.md", "SHIPPED.md"]);
    assert.deepEqual(p.warnings, []);
    assert.deepEqual(p.strays, []);
    assert.equal(stderr, "");
  } finally { cleanup(dir); }
});

test("audit auto: docs/ present puts the audit docs under docs/", () => {
  const { dir } = makeRepo();
  try {
    fs.mkdirSync(path.join(dir, "docs"));
    const { value: p } = resolveFresh(dir);
    assert.equal(p.audit.rel, "docs/CURRENTNESS_AUDIT.md");
    assert.equal(p.rvq.rel, "docs/RUNTIME_VERIFICATION_QUEUE.md");
    assert.equal(p.auditMode, "auto");
  } finally { cleanup(dir); }
});

test("audit auto re-evaluates when docs/ appears after a cached resolve", () => {
  const { dir } = makeRepo();
  try {
    P.clearCache();
    assert.equal(P.resolvePaths(dir).audit.rel, "CURRENTNESS_AUDIT.md");
    fs.mkdirSync(path.join(dir, "docs"));
    assert.equal(P.resolvePaths(dir).audit.rel, "docs/CURRENTNESS_AUDIT.md");
  } finally { cleanup(dir); }
});

test("valid config: state, audit and design directories are honored, normalized to POSIX", () => {
  const { dir } = makeRepo();
  try {
    writeConfig(dir, { state: "docs\\dev\\", audit: "./docs/dev", design: "docs/dev/design" });
    const { value: p, stderr } = resolveFresh(dir);
    assert.equal(p.configSource, "config");
    assert.equal(p.stateDir, "docs/dev");
    assert.equal(p.now.rel, "docs/dev/NOW.md");
    assert.equal(p.shipped.rel, "docs/dev/SHIPPED.md");
    assert.equal(p.audit.rel, "docs/dev/CURRENTNESS_AUDIT.md");
    assert.equal(p.rvq.rel, "docs/dev/RUNTIME_VERIFICATION_QUEUE.md");
    assert.equal(p.designDir.rel, "docs/dev/design");
    assert.ok(p.ownRel.has("docs/dev/ROADMAP.md"));
    assert.ok(!p.ownRel.has("ROADMAP.md"));
    assert.equal(stderr, "");
  } finally { cleanup(dir); }
});

test("config with only some keys keeps the defaults for the rest", () => {
  const { dir } = makeRepo();
  try {
    writeConfig(dir, { state: "notes" });
    const { value: p } = resolveFresh(dir);
    assert.equal(p.now.rel, "notes/NOW.md");
    assert.equal(p.auditMode, "auto");
    assert.equal(p.audit.rel, "CURRENTNESS_AUDIT.md");
    assert.equal(p.designDir, null);
  } finally { cleanup(dir); }
});

test("state '.' in a config is the root", () => {
  const { dir } = makeRepo();
  try {
    writeConfig(dir, { state: "." });
    const { value: p } = resolveFresh(dir);
    assert.equal(p.configSource, "config");
    assert.equal(p.now.rel, "NOW.md");
  } finally { cleanup(dir); }
});

function assertRejected(dir, pattern) {
  const { value: p, stderr } = resolveFresh(dir);
  assert.equal(p.configSource, "invalid");
  assert.equal(p.now.rel, "NOW.md", "invalid config falls back to the default state dir");
  assert.equal(p.warnings.length, 1);
  assert.match(p.warnings[0], pattern);
  assert.equal(stderr.trim().split("\n").length, 1, "exactly one warning line on stderr");
  assert.match(stderr, /claudhd\.json ignored/);
  return p;
}

test("malformed JSON falls back to defaults with one warning", () => {
  const { dir } = makeRepo();
  try {
    fs.mkdirSync(path.join(dir, ".claude"));
    write(dir, ".claude/claudhd.json", "{ not json");
    assertRejected(dir, /malformed JSON/);
  } finally { cleanup(dir); }
});

test("wrong version falls back to defaults", () => {
  const { dir } = makeRepo();
  try {
    writeConfig(dir, { state: "docs/dev" }, 2);
    assertRejected(dir, /version must be 1/);
  } finally { cleanup(dir); }
});

test("absolute path is rejected (POSIX and drive-letter forms)", () => {
  for (const bad of ["/tmp/state", "C:/state", "C:\\state", "\\\\server\\share"]) {
    const { dir } = makeRepo();
    try {
      writeConfig(dir, { state: bad });
      assertRejected(dir, /must be relative/);
    } finally { cleanup(dir); }
  }
});

test("'..' segment is rejected, even when it would normalize back inside", () => {
  for (const bad of ["../elsewhere", "docs/../../x", "docs/../dev"]) {
    const { dir } = makeRepo();
    try {
      writeConfig(dir, { audit: bad });
      assertRejected(dir, /must not contain '\.\.'/);
    } finally { cleanup(dir); }
  }
});

test(".git/, .now/ and .gantry/ targets are rejected", () => {
  for (const bad of [".git", ".git/state", ".now", "./.now/x", ".gantry/state", ".GIT/x"]) {
    const { dir } = makeRepo();
    try {
      writeConfig(dir, { design: bad });
      assertRejected(dir, /must not be under/);
    } finally { cleanup(dir); }
  }
});

test("non-string and empty values are rejected", () => {
  for (const bad of [42, "", "   ", ["docs"]]) {
    const { dir } = makeRepo();
    try {
      writeConfig(dir, { state: bad });
      assertRejected(dir, /non-empty string/);
    } finally { cleanup(dir); }
  }
});

// Directory symlinks: a junction on Windows (no admin rights needed), a plain
// dir symlink elsewhere. If the platform refuses both, the test is skipped
// with the reason printed.
function trySymlinkDir(target, linkPath) {
  try {
    fs.symlinkSync(target, linkPath, process.platform === "win32" ? "junction" : "dir");
    return null;
  } catch (e) {
    return e.code || e.message;
  }
}

test("a directory that escapes the root through a symlink is rejected", (t) => {
  const { dir } = makeRepo();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "claudhd-outside-"));
  try {
    const err = trySymlinkDir(outside, path.join(dir, "linked"));
    if (err) { t.skip("symlink creation failed on this platform (" + err + ")"); return; }
    writeConfig(dir, { state: "linked/dev" });
    assertRejected(dir, /outside the project root through a symlink/);
  } finally { cleanup(dir); cleanup(outside); }
});

test("a symlink that stays inside the root is accepted", (t) => {
  const { dir } = makeRepo();
  try {
    fs.mkdirSync(path.join(dir, "real"));
    const err = trySymlinkDir(path.join(dir, "real"), path.join(dir, "alias"));
    if (err) { t.skip("symlink creation failed on this platform (" + err + ")"); return; }
    writeConfig(dir, { state: "alias" });
    const { value: p } = resolveFresh(dir);
    assert.equal(p.configSource, "config");
    assert.equal(p.now.rel, "alias/NOW.md");
  } finally { cleanup(dir); }
});

test("strays: default-location state files are reported when the config points elsewhere", () => {
  const { dir } = makeRepo();
  try {
    write(dir, "NOW.md", "# NOW\n");
    write(dir, "SHIPPED.md", "# SHIPPED\n");
    fs.mkdirSync(path.join(dir, "docs"));
    write(dir, "docs/CURRENTNESS_AUDIT.md", "# audit\n");
    writeConfig(dir, { state: "docs/dev", audit: "docs/dev" });
    const { value: p } = resolveFresh(dir);
    assert.deepEqual(p.strays.sort(), ["NOW.md", "SHIPPED.md", "docs/CURRENTNESS_AUDIT.md"]);
  } finally { cleanup(dir); }
});

test("strays: none without a config, and none for a root state dir", () => {
  const { dir } = makeRepo();
  try {
    write(dir, "NOW.md", "# NOW\n");
    assert.deepEqual(resolveFresh(dir).value.strays, []);
    writeConfig(dir, { state: "." });
    assert.deepEqual(resolveFresh(dir).value.strays, []);
  } finally { cleanup(dir); }
});

test("invalid config: the warning also lands in .now/reconcile.log when .now/ exists, and is not repeated within a process", () => {
  const { dir } = makeRepo();
  try {
    fs.mkdirSync(path.join(dir, ".now"));
    writeConfig(dir, { state: "../x" });
    P.clearCache();
    const { stderr } = quiet(() => { P.resolvePaths(dir); P.resolvePaths(dir); return P.resolvePaths(dir); });
    assert.equal(stderr.trim().split("\n").length, 1);
    const log = fs.readFileSync(path.join(dir, ".now", "reconcile.log"), "utf8");
    assert.equal(log.trim().split("\n").length, 1);
    assert.match(log, /claudhd\.json ignored/);
  } finally { cleanup(dir); }
});

test("invalid config never creates .now/ in a project that has none", () => {
  const { dir } = makeRepo();
  try {
    writeConfig(dir, { state: "/abs" });
    resolveFresh(dir);
    assert.ok(!fs.existsSync(path.join(dir, ".now")));
  } finally { cleanup(dir); }
});

test("CLI prints the one-line summary for the resolved root", () => {
  const { dir } = makeRepo();
  try {
    writeConfig(dir, { state: "docs/dev", audit: "docs/dev", design: "docs/dev" });
    const r = run(dir, "paths.js");
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(),
      "NOW=docs/dev/NOW.md ROADMAP=docs/dev/ROADMAP.md IDEAS=docs/dev/IDEAS.md SHIPPED=docs/dev/SHIPPED.md " +
      "AUDIT=docs/dev/CURRENTNESS_AUDIT.md RVQ=docs/dev/RUNTIME_VERIFICATION_QUEUE.md DESIGN_DIR=docs/dev");
  } finally { cleanup(dir); }
});

test("CLI defaults print DESIGN_DIR=(default); --root and --json work", () => {
  const { dir } = makeRepo();
  const other = makeRepo();
  try {
    const r = run(other.dir, "paths.js", ["--root", dir]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^NOW=NOW\.md .* DESIGN_DIR=\(default\)\s*$/);
    const j = run(dir, "paths.js", ["--json"]);
    const obj = JSON.parse(j.stdout);
    assert.equal(obj.configSource, "default");
    assert.deepEqual(obj.ownRel.sort(), ["IDEAS.md", "NOW.md", "ROADMAP.md", "SHIPPED.md"]);
  } finally { cleanup(dir); cleanup(other.dir); }
});

test("CLI: invalid config warns on stderr once and still prints default paths", () => {
  const { dir } = makeRepo();
  try {
    writeConfig(dir, { state: ".now" });
    const r = run(dir, "paths.js");
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^NOW=NOW\.md /);
    assert.equal(r.stderr.trim().split("\n").length, 1);
    assert.match(r.stderr, /must not be under \.now\//);
  } finally { cleanup(dir); }
});
