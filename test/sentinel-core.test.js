"use strict";
/* Tests for the shared sentinel-read + path-normalization helper. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const CORE = path.join(__dirname, "..", "plugins", "claudhd", "scripts", "sentinel-core.js");

// Required once; the helpers take an explicit root argument, so each test pins
// its own temp dir as the root rather than reloading the module per case.
const core = require(CORE);

function mk() { return fs.mkdtempSync(path.join(os.tmpdir(), "claudhd-sc-")); }
function write(dir, rel, content) {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}
// The sentinel now lives in the `build` section of .now/state.json (schema
// v2; Gantry's sentinel folded in). Writing it here directly (rather than via
// the legacy .gantry/active-phase.json path) exercises the current, primary
// location; the one-shot legacy import gets its own dedicated test below.
function makeSentinel(dir, overrides) {
  const now = new Date();
  const base = {
    plan: "docs/plan.md",
    phase: 1,
    files: ["plugins/claudhd/scripts/sentinel-core.js"],
    allow: ["docs/plan.md"],
    started: now.toISOString(),
    session: "session-abc",
  };
  const data = Object.assign({}, base, overrides);
  write(dir, ".now/state.json", JSON.stringify({ schemaVersion: 2, build: data }));
  return data;
}

// --- readSentinel ---

test("readSentinel returns null when sentinel file is absent", () => {
  const dir = mk();
  try {
    const result = core.readSentinel(dir);
    assert.equal(result, null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("readSentinel returns null for malformed JSON without throwing", () => {
  const dir = mk();
  try {
    write(dir, ".now/state.json", "{ not valid json !!!");
    const result = core.readSentinel(dir);
    assert.equal(result, null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// --- one-shot legacy import (Gantry's .gantry/active-phase.json) ---

test("readSentinel imports a legacy .gantry/active-phase.json into state.json's build section on first read, then removes it", () => {
  const dir = mk();
  try {
    const legacy = {
      plan: "docs/plan.md",
      phase: 4,
      files: ["src/legacy.js"],
      allow: ["docs/plan.md"],
      started: new Date().toISOString(),
      session: "legacy-session",
    };
    write(dir, ".gantry/active-phase.json", JSON.stringify(legacy));
    assert.ok(!fs.existsSync(path.join(dir, ".now", "state.json")), "no state.json before the first read");

    const result = core.readSentinel(dir);
    assert.deepEqual(result, legacy, "first read returns the imported legacy sentinel");

    assert.ok(!fs.existsSync(path.join(dir, ".gantry", "active-phase.json")),
      "the legacy file must be removed after import");

    const state = JSON.parse(fs.readFileSync(path.join(dir, ".now", "state.json"), "utf8"));
    assert.deepEqual(state.build, legacy, "the legacy sentinel is persisted into state.json's build section");
    assert.equal(state.schemaVersion, 2);

    // Subsequent reads see state.json only - the legacy file is already gone,
    // so this also proves no code path re-reads it once it has been imported.
    const second = core.readSentinel(dir);
    assert.deepEqual(second, legacy, "a second read still returns the sentinel, now from state.json alone");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("readSentinel does not import when state.json already carries a build section", () => {
  const dir = mk();
  try {
    const current = makeSentinel(dir, { phase: 9 });
    // A stale legacy file left behind must never override the current build
    // section once state.json already owns one.
    write(dir, ".gantry/active-phase.json", JSON.stringify({
      plan: "docs/plan.md", phase: 1, files: [], allow: [],
      started: new Date().toISOString(), session: "stale",
    }));
    const result = core.readSentinel(dir);
    assert.equal(result.phase, 9, "the existing build section wins over a stray legacy file");
    assert.ok(fs.existsSync(path.join(dir, ".gantry", "active-phase.json")),
      "a legacy file is only ever consumed when state.json has no build section");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("readSentinel returns the parsed object for a valid sentinel", () => {
  const dir = mk();
  try {
    makeSentinel(dir, {});
    const result = core.readSentinel(dir);
    assert.ok(result !== null, "should return a parsed object");
    assert.equal(result.phase, 1);
    assert.deepEqual(result.files, ["plugins/claudhd/scripts/sentinel-core.js"]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// --- isStale ---

test("isStale returns false for a fresh sentinel with matching session", () => {
  const now = new Date();
  const sentinel = { started: now.toISOString(), session: "sess-1" };
  assert.equal(core.isStale(sentinel, "sess-1"), false);
});

test("isStale returns false for a non-matching session but fresh started (within 6h)", () => {
  // session mismatch alone does not make it stale - BOTH conditions must be true
  const now = new Date();
  const sentinel = { started: now.toISOString(), session: "sess-old" };
  // different session but fresh -> NOT stale (AND rule)
  assert.equal(core.isStale(sentinel, "sess-new"), false);
});

test("isStale stale-by-session-AND-age: both session differs AND started > 6h ago", () => {
  const old = new Date(Date.now() - 7 * 60 * 60 * 1000); // 7 hours ago
  const sentinel = { started: old.toISOString(), session: "sess-old" };
  assert.equal(core.isStale(sentinel, "sess-new"), true);
});

test("isStale not stale when session matches even if started > 6h ago", () => {
  // same session, just a very long session
  const old = new Date(Date.now() - 8 * 60 * 60 * 1000);
  const sentinel = { started: old.toISOString(), session: "sess-same" };
  assert.equal(core.isStale(sentinel, "sess-same"), false);
});

// --- resolveRoot (now root.js's four-source resolver, re-exported) ---

test("resolveRoot uses CLAUDHD_PROJECT_DIR from env when set", () => {
  const dir = mk();
  try {
    const result = core.resolveRoot({ CLAUDHD_PROJECT_DIR: dir });
    assert.equal(result, dir);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("resolveRoot uses GANTRY_PROJECT_DIR from env when set", () => {
  const dir = mk();
  try {
    const result = core.resolveRoot({ GANTRY_PROJECT_DIR: dir });
    assert.equal(result, dir);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("resolveRoot falls back to CLAUDE_PROJECT_DIR when GANTRY_PROJECT_DIR is absent", () => {
  const dir = mk();
  try {
    const result = core.resolveRoot({ CLAUDE_PROJECT_DIR: dir });
    assert.equal(result, dir);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("resolveRoot falls back to cwd when no env var is set", () => {
  const result = core.resolveRoot({});
  // cwd should be a non-empty string
  assert.ok(typeof result === "string" && result.length > 0);
});

// --- normalize ---

test("normalize: Windows absolute backslash path matches repo-relative POSIX files entry", () => {
  const dir = mk();
  try {
    // Simulate a Windows absolute path like C:\project\plugins\claudhd\scripts\foo.js
    // where dir is the project root.
    const absWindows = dir + "\\plugins\\claudhd\\scripts\\foo.js";
    const result = core.normalize(absWindows, dir);
    assert.equal(result, "plugins/claudhd/scripts/foo.js");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("normalize: drive-letter case difference still matches", () => {
  const dir = mk();
  try {
    // Lower the drive letter in the root but upper it in the file_path (or vice versa).
    // This only matters on Windows where paths start with e.g. C:\ or c:\.
    // We simulate by using mixed case on the drive letter portion.
    // mk() returns a path from os.tmpdir() which may be C:\Users\... or c:\users\...
    const firstChar = dir[0];
    const flipped = firstChar === firstChar.toUpperCase()
      ? firstChar.toLowerCase() + dir.slice(1)
      : firstChar.toUpperCase() + dir.slice(1);

    // The file path uses one case for drive, root uses the other.
    const absPath = flipped + path.sep + "src" + path.sep + "main.js";
    const result = core.normalize(absPath, dir);
    assert.equal(result, "src/main.js");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("normalize: forward-slash absolute path matches", () => {
  const dir = mk();
  try {
    // Convert the tempdir to forward slashes as file_path might arrive that way.
    const absForward = dir.replace(/\\/g, "/") + "/docs/plan.md";
    const result = core.normalize(absForward, dir);
    assert.equal(result, "docs/plan.md");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("normalize: a path genuinely outside the files list returns the relative path (no match is caller's job)", () => {
  const dir = mk();
  try {
    const absPath = path.join(dir, "unrelated", "other.js");
    const result = core.normalize(absPath, dir);
    assert.equal(result, "unrelated/other.js");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("normalize: target escaping the project root returns FAIL_OPEN sentinel, not a throw", () => {
  const dir = mk();
  try {
    // A path that is clearly outside the project root (e.g. the parent dir).
    const parent = path.dirname(dir);
    const escaping = path.join(parent, "outside-project.js");
    const result = core.normalize(escaping, dir);
    assert.equal(result, core.FAIL_OPEN, "escaping root must return FAIL_OPEN");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("normalize: missing file_path (null) returns FAIL_OPEN without throwing", () => {
  const dir = mk();
  try {
    const result = core.normalize(null, dir);
    assert.equal(result, core.FAIL_OPEN);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("normalize: empty string file_path returns FAIL_OPEN without throwing", () => {
  const dir = mk();
  try {
    const result = core.normalize("", dir);
    assert.equal(result, core.FAIL_OPEN);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("normalize: undefined file_path returns FAIL_OPEN without throwing", () => {
  const dir = mk();
  try {
    const result = core.normalize(undefined, dir);
    assert.equal(result, core.FAIL_OPEN);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("normalize: unresolvable root (null) returns FAIL_OPEN without throwing", () => {
  assert.doesNotThrow(() => {
    const result = core.normalize("src/main.js", null);
    assert.equal(result, core.FAIL_OPEN);
  });
});

// --- isInList: matching after normalize ---

test("isInList: Windows backslash absolute path matches a POSIX files entry", () => {
  const dir = mk();
  try {
    const absWindows = path.join(dir, "plugins", "claudhd", "scripts", "sentinel-core.js");
    const files = ["plugins/claudhd/scripts/sentinel-core.js"];
    assert.equal(core.isInList(absWindows, files, dir), true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("isInList: path genuinely not in list returns false", () => {
  const dir = mk();
  try {
    const absPath = path.join(dir, "src", "other.js");
    const files = ["plugins/claudhd/scripts/sentinel-core.js"];
    assert.equal(core.isInList(absPath, files, dir), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("isInList: FAIL_OPEN path (escaping root) returns true (fail-open)", () => {
  const dir = mk();
  try {
    const parent = path.dirname(dir);
    const escaping = path.join(parent, "outside.js");
    const files = ["src/main.js"];
    // Fail-open: when normalize returns FAIL_OPEN, isInList must allow (return true).
    assert.equal(core.isInList(escaping, files, dir), true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("isInList: missing file_path returns true (fail-open)", () => {
  const dir = mk();
  try {
    assert.equal(core.isInList(null, ["src/main.js"], dir), true);
    assert.equal(core.isInList("", ["src/main.js"], dir), true);
    assert.equal(core.isInList(undefined, ["src/main.js"], dir), true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// --- Full integration: readSentinel + isStale + isInList ---

test("full flow: fresh matching sentinel, file in files list -> allowed", () => {
  const dir = mk();
  try {
    makeSentinel(dir, { session: "sess-x", files: ["src/main.js"], allow: ["docs/plan.md"] });
    const sentinel = core.readSentinel(dir);
    assert.ok(sentinel !== null);
    assert.equal(core.isStale(sentinel, "sess-x"), false);
    const absPath = path.join(dir, "src", "main.js");
    assert.equal(core.isInList(absPath, sentinel.files, dir), true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("full flow: fresh sentinel, file in allow list -> allowed", () => {
  const dir = mk();
  try {
    makeSentinel(dir, { session: "sess-x", files: ["src/main.js"], allow: ["docs/plan.md"] });
    const sentinel = core.readSentinel(dir);
    assert.ok(sentinel !== null);
    assert.equal(core.isStale(sentinel, "sess-x"), false);
    const absPath = path.join(dir, "docs", "plan.md");
    assert.equal(core.isInList(absPath, sentinel.allow, dir), true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("full flow: stale sentinel (session + age) is treated inactive", () => {
  const dir = mk();
  try {
    const old = new Date(Date.now() - 7 * 60 * 60 * 1000);
    makeSentinel(dir, { started: old.toISOString(), session: "sess-old" });
    const sentinel = core.readSentinel(dir);
    assert.ok(sentinel !== null);
    // Different current session + old age -> stale
    assert.equal(core.isStale(sentinel, "sess-current"), true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
