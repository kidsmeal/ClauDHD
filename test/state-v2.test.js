"use strict";
/*
 * Tests for the schemaVersion 2 contract: readState() accepting both v1 and v2
 * shapes, and writeStateAtomic()'s merge-preserving behavior across the
 * cursor/ideas/shipped/roadmap/git facts and the new build/design sections.
 *
 * These three cases carry the phase (see design/claudhd-1.0-design_reviewed-
 * plan.md, Phase 2 Verification):
 *   1. a v1 state.json reads without throw and yields null build/design.
 *   2. a write of the build section leaves the facts byte-identical.
 *   3. (the legacy .gantry/active-phase.json import lives in
 *      test/sentinel-core.test.js, where readSentinel does the importing.)
 *
 * `mode` and `from` (the roadmap-id parent link) are first-class v2 fields
 * alongside build/design in this phase too: no writer in this phase produces
 * real values for them yet (that lands in phase 3/5), but the schema and the
 * merge-preserving writer must already treat them as known, normalized keys
 * rather than incidental unknown ones, so phase 3 has a complete contract to
 * write into rather than a partial one it has to first finish designing.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { SCHEMA_VERSION, readState, writeStateAtomic } = require("../plugins/claudhd/scripts/state.js");

function mk() { return fs.mkdtempSync(path.join(os.tmpdir(), "claudhd-state-v2-")); }

// A v1 state.json: no build/design keys at all.
const V1_STATE = {
  schemaVersion: 1,
  generatedAt: "2026-07-01T00:00:00.000Z",
  branch: "main",
  cursor: { activeThread: "a thread", activeThreadLineCount: 5, nextAction: "do it", lastTouched: "2026-07-01", queueCount: 1, quickFixCount: 0 },
  ideas: { total: 2, untriaged: 1, oldestUntriagedDate: "2026-06-30" },
  shipped: { total: 3, lastEntryDate: "2026-06-29" },
  roadmap: { count: 1, topItem: "ship it" },
  git: { uncommitted: 0, unpushed: null, lastCommitAt: null, lastCommitMsg: "init" },
};

test("readState: a v1 file reads without throw and yields null build/design", () => {
  const dir = mk();
  try {
    const nowDir = path.join(dir, ".now");
    fs.mkdirSync(nowDir, { recursive: true });
    fs.writeFileSync(path.join(nowDir, "state.json"), JSON.stringify(V1_STATE));

    let state;
    assert.doesNotThrow(() => { state = readState(nowDir); }, "readState must never throw on a v1 file");
    assert.equal(state.build, null, "a v1 file has no build key -> null, not undefined");
    assert.equal(state.design, null, "a v1 file has no design key -> null, not undefined");
    assert.equal(state.mode, null, "a v1 file has no mode key -> null, not undefined");
    assert.equal(state.from, null, "a v1 file has no from key -> null, not undefined");
    assert.equal(state.cursor.activeThread, "a thread", "the v1 facts still read through unchanged");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("readState: an absent state.json returns null rather than throwing", () => {
  const dir = mk();
  try {
    const nowDir = path.join(dir, ".now");
    assert.doesNotThrow(() => {
      assert.equal(readState(nowDir), null);
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("readState: malformed JSON returns null rather than throwing", () => {
  const dir = mk();
  try {
    const nowDir = path.join(dir, ".now");
    fs.mkdirSync(nowDir, { recursive: true });
    fs.writeFileSync(path.join(nowDir, "state.json"), "{ not json");
    assert.doesNotThrow(() => {
      assert.equal(readState(nowDir), null);
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("writeStateAtomic: a build-section write leaves cursor/ideas/shipped/roadmap/git byte-identical", () => {
  const dir = mk();
  try {
    const nowDir = path.join(dir, ".now");
    fs.mkdirSync(nowDir, { recursive: true });
    // Seed a v1-shaped file directly (as if written by a pre-2.0 checkpoint.js).
    fs.writeFileSync(path.join(nowDir, "state.json"), JSON.stringify(V1_STATE));

    const before = JSON.parse(fs.readFileSync(path.join(nowDir, "state.json"), "utf8"));

    const build = {
      plan: "docs/plan.md", phase: 2, files: ["a.js", "b.js"], allow: ["docs/plan.md"],
      started: "2026-07-02T00:00:00.000Z", session: "sess-1",
    };
    writeStateAtomic(nowDir, { build }, ["build"]);

    const after = JSON.parse(fs.readFileSync(path.join(nowDir, "state.json"), "utf8"));
    for (const key of ["cursor", "ideas", "shipped", "roadmap", "git"]) {
      assert.deepEqual(after[key], before[key], `${key} must be byte-identical after a build-section-only write`);
    }
    assert.deepEqual(after.build, build, "the build section itself is applied");
    assert.equal(after.schemaVersion, SCHEMA_VERSION, "schemaVersion is bumped to the current version on any write");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("writeStateAtomic: a build-section write leaves pre-existing mode/from untouched", () => {
  const dir = mk();
  try {
    const nowDir = path.join(dir, ".now");
    writeStateAtomic(nowDir, { mode: "design", from: "r-0701-1" }, ["mode", "from"]);

    const build = { plan: "plan.md", phase: 1, files: ["x.js"], allow: [], started: "2026-07-01T00:00:00.000Z", session: "s" };
    writeStateAtomic(nowDir, { build }, ["build"]);

    const state = readState(nowDir);
    assert.equal(state.mode, "design", "mode set by an earlier writer survives an unrelated build-section write");
    assert.equal(state.from, "r-0701-1", "from set by an earlier writer survives an unrelated build-section write");
    assert.deepEqual(state.build, build);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("writeStateAtomic: a v2 file round-trips through readState with build, design, mode and from intact", () => {
  const dir = mk();
  try {
    const nowDir = path.join(dir, ".now");
    const build = { plan: "plan.md", phase: 1, files: ["x.js"], allow: [], started: "2026-07-01T00:00:00.000Z", session: "s" };
    const design = { doc: "docs/design.md", resolved: ["r1"], open: [] };

    writeStateAtomic(nowDir, { cursor: V1_STATE.cursor }, ["cursor"]);
    writeStateAtomic(nowDir, { build }, ["build"]);
    writeStateAtomic(nowDir, { design }, ["design"]);
    writeStateAtomic(nowDir, { mode: "build", from: "r-0701-2" }, ["mode", "from"]);

    const state = readState(nowDir);
    assert.deepEqual(state.build, build);
    assert.deepEqual(state.design, design);
    assert.deepEqual(state.cursor, V1_STATE.cursor);
    assert.equal(state.mode, "build");
    assert.equal(state.from, "r-0701-2");
    assert.equal(state.schemaVersion, SCHEMA_VERSION);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("readState: mode/from default to null on a fresh v2 file that has not set them yet", () => {
  const dir = mk();
  try {
    const nowDir = path.join(dir, ".now");
    writeStateAtomic(nowDir, { build: { phase: 1 } }, ["build"]);

    const state = readState(nowDir);
    assert.equal(state.mode, null, "mode defaults to null until phase 5 writes a real value");
    assert.equal(state.from, null, "from defaults to null until phase 3 writes a real value");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("writeStateAtomic: unknown keys already in the file survive a write that does not own them", () => {
  const dir = mk();
  try {
    const nowDir = path.join(dir, ".now");
    fs.mkdirSync(nowDir, { recursive: true });
    // A key no writer in this phase - or any phase yet - knows about (e.g. a
    // future field a later phase or an external consumer added) must not be
    // dropped by a write that does not name it as owned.
    fs.writeFileSync(path.join(nowDir, "state.json"), JSON.stringify({
      schemaVersion: 2, someFutureField: "kept-verbatim",
    }));

    writeStateAtomic(nowDir, { build: { phase: 1 } }, ["build"]);

    const after = JSON.parse(fs.readFileSync(path.join(nowDir, "state.json"), "utf8"));
    assert.equal(after.someFutureField, "kept-verbatim", "an unrecognized top-level key must survive a write it does not own");
    assert.deepEqual(after.build, { phase: 1 });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
