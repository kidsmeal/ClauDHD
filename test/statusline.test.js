"use strict";
/*
 * Tests for statusline.js - the ClauDHD statusline script.
 * Verifies output for a normal cursor, q: count, stale flag, and silence cases.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SCRIPT = path.join(__dirname, "..", "plugins", "claudhd", "scripts", "statusline.js");
const MARKER = "<!-- claudhd: opt-in marker -->";
const { STATUSLINE_THREAD_CAP } = require("../plugins/claudhd/scripts/constants.js");

function mk() { return fs.mkdtempSync(path.join(os.tmpdir(), "claudhd-sl-")); }
function write(dir, rel, content) {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}
function run(dir, stdinData) {
  return spawnSync(process.execPath, [SCRIPT], {
    encoding: "utf8",
    input: stdinData != null ? stdinData : "",
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir, CLAUDHD_PROJECT_DIR: "" },
  });
}
function nowFile(thread, quickCount) {
  let content = "# NOW\n" + MARKER + "\n\n## Active thread\n\n**" + thread + "**\n\n- [ ] step\n";
  if (quickCount > 0) {
    content += "\n## Quick fixes\n\n";
    for (let i = 0; i < quickCount; i++) content += "- [ ] fix " + (i + 1) + "\n";
  }
  return content;
}

test("outputs the active thread name for a normal cursor", () => {
  const dir = mk();
  try {
    write(dir, "NOW.md", nowFile("build the feature", 0));
    const r = run(dir, JSON.stringify({ cwd: dir }));
    assert.equal(r.status, 0);
    assert.match(r.stdout.trim(), /build the feature/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("q:<n> appears when the quick batch is non-empty", () => {
  const dir = mk();
  try {
    write(dir, "NOW.md", nowFile("my thread", 2));
    const r = run(dir, JSON.stringify({ cwd: dir }));
    assert.equal(r.status, 0);
    assert.match(r.stdout, /q:2/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("no q: suffix when the quick batch is empty", () => {
  const dir = mk();
  try {
    write(dir, "NOW.md", nowFile("my thread", 0));
    const r = run(dir, JSON.stringify({ cwd: dir }));
    assert.equal(r.status, 0);
    assert.doesNotMatch(r.stdout, /q:/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("[stale] flag appears when NOW.md has not been touched recently", () => {
  const dir = mk();
  try {
    const nowPath = path.join(dir, "NOW.md");
    write(dir, "NOW.md", nowFile("old thread", 0));
    const past = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000); // 4 days ago
    fs.utimesSync(nowPath, past, past);
    const r = run(dir, JSON.stringify({ cwd: dir }));
    assert.equal(r.status, 0);
    assert.match(r.stdout, /\[stale\]/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("caps an oversized active thread so a pulled NOW.md can't flood the bar", () => {
  const dir = mk();
  try {
    const huge = "x".repeat(STATUSLINE_THREAD_CAP * 4);
    write(dir, "NOW.md", nowFile(huge, 1));
    const r = run(dir, JSON.stringify({ cwd: dir }));
    assert.equal(r.status, 0);
    const line = r.stdout.trim();
    // One line, capped, ellipsized — and the appended q: marker still survives.
    assert.equal(line.includes("\n"), false, "status line must stay single-line");
    assert.match(line, /…/, "an over-cap thread should be ellipsized");
    assert.match(line, /q:1/, "the q: marker must remain visible after the cap");
    assert.equal(line.includes("x".repeat(STATUSLINE_THREAD_CAP + 1)), false, "thread was not capped");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("silent when NOW.md is absent", () => {
  const dir = mk();
  try {
    const r = run(dir, JSON.stringify({ cwd: dir }));
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), "");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("silent when NOW.md has no claudhd marker", () => {
  const dir = mk();
  try {
    write(dir, "NOW.md", "# NOW\n\n## Active thread\n\n**my thread**\n");
    const r = run(dir, JSON.stringify({ cwd: dir }));
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), "");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("malformed stdin JSON degrades gracefully and never throws", () => {
  const dir = mk(); // no NOW.md - ensures silence regardless of fallback path
  try {
    const r = run(dir, "not-valid-json{{{");
    assert.equal(r.status, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
