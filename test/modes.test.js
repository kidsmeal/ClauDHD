"use strict";
/* Tests for plugins/claudhd/scripts/modes.js */
const { test } = require("node:test");
const assert = require("node:assert/strict");

const modes = require("../plugins/claudhd/scripts/modes.js");

const BUILD_FILES = ["src/scoped.js", "docs/plan.md"];

// The full matrix (design section 6 / phase 5 spec): three modes x four path
// classes. `allow` is the expected decision; `note` documents why.
const MATRIX = [
  // --- build mode ---
  { mode: "build", path: "src/other.js", buildFiles: BUILD_FILES, allow: false, note: "build: source path not in the file list" },
  { mode: "build", path: "README.md", buildFiles: BUILD_FILES, allow: false, note: "build: markdown NOT in the file list still denies - build's allowlist is the file list, not *.md" },
  { mode: "build", path: ".now/state.json", buildFiles: BUILD_FILES, allow: true, note: "build: state-dir path always allowed" },
  { mode: "build", path: "src/scoped.js", buildFiles: BUILD_FILES, allow: true, note: "build: path IS in the active phase's file list" },

  // --- design mode ---
  { mode: "design", path: "src/other.js", buildFiles: BUILD_FILES, allow: false, note: "design: source path denied" },
  { mode: "design", path: "README.md", buildFiles: BUILD_FILES, allow: true, note: "design: markdown allowed" },
  { mode: "design", path: ".gantry/models.json", buildFiles: BUILD_FILES, allow: true, note: "design: state-dir path allowed" },
  { mode: "design", path: "src/scoped.js", buildFiles: BUILD_FILES, allow: false, note: "design: build's file list is irrelevant outside build mode" },

  // --- idle mode (mode === null) ---
  { mode: null, path: "src/other.js", buildFiles: BUILD_FILES, allow: false, note: "idle: source path denied" },
  { mode: null, path: "docs/design.md", buildFiles: BUILD_FILES, allow: true, note: "idle: markdown allowed" },
  { mode: null, path: ".claude/settings.local.json", buildFiles: BUILD_FILES, allow: true, note: "idle: state-dir path allowed" },
  { mode: null, path: "docs/plan.md", buildFiles: BUILD_FILES, allow: true, note: "idle: docs/plan.md is *.md, allowed on its own merit, not because it's in buildFiles" },
];

for (const c of MATRIX) {
  test("modes.decide: " + c.note, () => {
    const d = modes.decide(c.mode, c.path, c.buildFiles);
    assert.equal(d.allow, c.allow, JSON.stringify(c) + " -> " + JSON.stringify(d));
    if (!c.allow) {
      assert.equal(typeof d.reason, "string");
      assert.ok(d.reason.length > 0, "a deny must always carry a reason");
    } else {
      assert.equal(d.reason, null, "an allow must never carry a reason");
    }
  });
}

test("modes.decide: an unrecognized mode string normalizes to idle (safe default)", () => {
  const d = modes.decide("some-future-mode", "src/x.js", null);
  assert.equal(d.allow, false);
  assert.match(d.reason, /idle mode/);
});

test("modes.decide: build mode with no file list (null buildFiles) denies every source path", () => {
  const d = modes.decide("build", "src/x.js", null);
  assert.equal(d.allow, false);
});

test("modes.decide: build mode with no file list still allows a state-dir path", () => {
  const d = modes.decide("build", ".now/state.json", null);
  assert.equal(d.allow, true);
});

test("modes.decide: a null/empty path denies with a reason (never throws)", () => {
  const d1 = modes.decide("design", null, null);
  assert.equal(d1.allow, false);
  assert.equal(typeof d1.reason, "string");

  const d2 = modes.decide("idle", "", null);
  assert.equal(d2.allow, false);
  assert.equal(typeof d2.reason, "string");
});

// --- deny reason content: names the mode and a remedy from the fixed set ---

test("modes.decide: build-mode deny names the mode and /claudhd:build", () => {
  const d = modes.decide("build", "src/unscoped.js", BUILD_FILES);
  assert.match(d.reason, /build mode/);
  assert.match(d.reason, /\/claudhd:build/);
  assert.doesNotMatch(d.reason, /run the app|click|button|tap/i, "remedy must never be an in-app action");
});

test("modes.decide: design-mode deny names the mode and /claudhd:build", () => {
  const d = modes.decide("design", "src/unscoped.js", null);
  assert.match(d.reason, /design mode/);
  assert.match(d.reason, /\/claudhd:build/);
});

test("modes.decide: idle-mode deny names the mode and /claudhd:design", () => {
  const d = modes.decide(null, "src/unscoped.js", null);
  assert.match(d.reason, /idle mode/);
  assert.match(d.reason, /\/claudhd:design/);
});

test("modes.decide: every deny reason mentions /claudhd:override as the escape hatch", () => {
  for (const [mode, path] of [["build", "x.js"], ["design", "x.js"], [null, "x.js"]]) {
    const d = modes.decide(mode, path, []);
    assert.match(d.reason, /\/claudhd:override/, "mode " + mode + " deny reason: " + d.reason);
  }
});

// --- helper exports ---

test("modes.normalizeMode: build/design pass through, everything else is idle", () => {
  assert.equal(modes.normalizeMode("build"), "build");
  assert.equal(modes.normalizeMode("design"), "design");
  assert.equal(modes.normalizeMode(null), "idle");
  assert.equal(modes.normalizeMode(undefined), "idle");
  assert.equal(modes.normalizeMode("idle"), "idle");
  assert.equal(modes.normalizeMode("bogus"), "idle");
});

test("modes.isStateDirPath: matches the three state dirs and their contents, nothing else", () => {
  assert.equal(modes.isStateDirPath(".now/state.json"), true);
  assert.equal(modes.isStateDirPath(".gantry/models.json"), true);
  assert.equal(modes.isStateDirPath(".claude/settings.local.json"), true);
  assert.equal(modes.isStateDirPath("src/now/state.json"), false, "must not match a subpath that merely contains the segment");
  assert.equal(modes.isStateDirPath("README.md"), false);
});

test("modes.isMarkdownPath: case-insensitive .md match only", () => {
  assert.equal(modes.isMarkdownPath("README.md"), true);
  assert.equal(modes.isMarkdownPath("README.MD"), true);
  assert.equal(modes.isMarkdownPath("README.md.js"), false);
  assert.equal(modes.isMarkdownPath("src/a.js"), false);
});
