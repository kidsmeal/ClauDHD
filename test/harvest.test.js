"use strict";
/*
 * Tests for /claudhd:harvest (harvest.js) - the most Claude-specific script and,
 * until now, the least covered. harvest.js does not read transcript contents; it
 * only resolves locations and decides what is in scope, so that resolution logic
 * is exactly what these tests pin down: the ~/.claude/projects/<slug> layout, the
 * incremental watermark, --full and --dry-run, the dedup-file listing, and the
 * folder-name fallback when the exact slug dir is absent.
 *
 * The transcript root is redirected with CLAUDE_CONFIG_DIR (harvest reads
 * <config>/projects/<slug>), so the tests never touch the real ~/.claude.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { makeRepo, cleanup, run, exists } = require("../tools/helpers.js");

// Claude Code's project-dir slug: drive colon and path separators become dashes.
// Mirrors resolveTranscriptDir() in harvest.js.
function slugFor(dir) {
  return dir.replace(/[\\/:]/g, "-");
}

function makeConfig() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "claudhd-cfg-"));
}

// Drop a transcript .jsonl under <config>/projects/<projectDir>/ with an explicit
// mtime so watermark/incremental behavior is deterministic (no reliance on clock).
function addTranscript(config, projectDir, name, mtimeMs) {
  const pdir = path.join(config, "projects", projectDir);
  fs.mkdirSync(pdir, { recursive: true });
  const f = path.join(pdir, name);
  fs.writeFileSync(f, '{"type":"user"}\n');
  fs.utimesSync(f, new Date(mtimeMs), new Date(mtimeMs));
  return f;
}

// Comfortably-valid, fixed timestamps (no Date.now(), so runs are reproducible).
const T_OLD = 1_600_000_000_000; // 2020-09
const T_MID = 1_650_000_000_000; // 2022-04
const T_NEW = 1_700_000_000_000; // 2023-11

test("reports no transcripts when none exist for this project", () => {
  const { dir } = makeRepo();
  const config = makeConfig();
  try {
    const r = run(dir, "harvest.js", [], { CLAUDE_CONFIG_DIR: config });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /No transcripts found for this project/);
    assert.match(r.stdout, /Nothing to harvest/);
  } finally { cleanup(dir); cleanup(config); }
});

test("first harvest scans every session and prints a watermark to record", () => {
  const { dir } = makeRepo();
  const config = makeConfig();
  try {
    const slug = slugFor(dir);
    addTranscript(config, slug, "a.jsonl", T_OLD);
    addTranscript(config, slug, "b.jsonl", T_NEW);

    const r = run(dir, "harvest.js", [], { CLAUDE_CONFIG_DIR: config });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /first harvest: scanning all/);
    assert.match(r.stdout, /Total sessions: 2/);
    assert.match(r.stdout, /In scope this run: 2/);
    assert.match(r.stdout, /a\.jsonl/);
    assert.match(r.stdout, /b\.jsonl/);
    // It should offer a concrete watermark value to write back.
    assert.match(r.stdout, /record this run as the new/);
    assert.match(r.stdout, /write\s+\d+\s+to/);
  } finally { cleanup(dir); cleanup(config); }
});

test("incremental harvest only scans sessions newer than the watermark", () => {
  const { dir } = makeRepo();
  const config = makeConfig();
  try {
    const slug = slugFor(dir);
    addTranscript(config, slug, "old.jsonl", T_OLD);
    addTranscript(config, slug, "new.jsonl", T_NEW);
    fs.mkdirSync(path.join(dir, ".now"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".now", "last-harvest"), String(T_MID));

    const r = run(dir, "harvest.js", [], { CLAUDE_CONFIG_DIR: config });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /incremental since last harvest/);
    assert.match(r.stdout, /In scope this run: 1/);
    assert.match(r.stdout, /new\.jsonl/);
    assert.doesNotMatch(r.stdout, /old\.jsonl/);
  } finally { cleanup(dir); cleanup(config); }
});

test("--full re-scans everything despite a watermark past the newest session", () => {
  const { dir } = makeRepo();
  const config = makeConfig();
  try {
    const slug = slugFor(dir);
    addTranscript(config, slug, "old.jsonl", T_OLD);
    addTranscript(config, slug, "new.jsonl", T_NEW);
    fs.mkdirSync(path.join(dir, ".now"), { recursive: true });
    // Watermark above both: incremental would see zero; --full ignores it.
    fs.writeFileSync(path.join(dir, ".now", "last-harvest"), String(T_NEW + 1));

    const r = run(dir, "harvest.js", ["--full"], { CLAUDE_CONFIG_DIR: config });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /--full: scanning all/);
    assert.match(r.stdout, /In scope this run: 2/);
  } finally { cleanup(dir); cleanup(config); }
});

test("--dry-run previews without offering a watermark or creating .now/", () => {
  const { dir } = makeRepo();
  const config = makeConfig();
  try {
    const slug = slugFor(dir);
    addTranscript(config, slug, "a.jsonl", T_NEW);

    const r = run(dir, "harvest.js", ["--dry-run"], { CLAUDE_CONFIG_DIR: config });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /DRY RUN/);
    assert.match(r.stdout, /preview only/);
    assert.doesNotMatch(r.stdout, /write\s+\d+\s+to/, "dry run must not offer to record a watermark");
    assert.equal(exists(dir, ".now"), false, "dry run must not create .now/");
  } finally { cleanup(dir); cleanup(config); }
});

test("lists the dedup files and marks missing ones", () => {
  const { dir } = makeRepo();
  const config = makeConfig();
  try {
    const slug = slugFor(dir);
    addTranscript(config, slug, "a.jsonl", T_NEW);

    const r = run(dir, "harvest.js", [], { CLAUDE_CONFIG_DIR: config });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Dedup against/);
    // Fresh repo has none of the tracking files yet -> all flagged missing.
    assert.match(r.stdout, /IDEAS\.md\s+\(missing\)/);
    assert.match(r.stdout, /NOW\.md\s+\(missing\)/);
    assert.match(r.stdout, /SHIPPED\.md\s+\(missing\)/);
  } finally { cleanup(dir); cleanup(config); }
});

test("resolves the transcript dir by folder-name fallback when the slug differs", () => {
  const { dir } = makeRepo();
  const config = makeConfig();
  try {
    // No exact-slug dir; instead a single projects subdir whose name merely ends
    // with this project's folder name. harvest should still find it.
    const fallback = "host-prefix-" + path.basename(dir);
    addTranscript(config, fallback, "x.jsonl", T_NEW);

    const r = run(dir, "harvest.js", [], { CLAUDE_CONFIG_DIR: config });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Transcript dir:.*host-prefix-/);
    assert.match(r.stdout, /Total sessions: 1/);
  } finally { cleanup(dir); cleanup(config); }
});

test("never throws on a malformed watermark - treats it as a first harvest", () => {
  const { dir } = makeRepo();
  const config = makeConfig();
  try {
    const slug = slugFor(dir);
    addTranscript(config, slug, "a.jsonl", T_NEW);
    fs.mkdirSync(path.join(dir, ".now"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".now", "last-harvest"), "not-a-number");

    const r = run(dir, "harvest.js", [], { CLAUDE_CONFIG_DIR: config });
    assert.equal(r.status, 0, r.stderr);
    // Bad watermark parses to 0, so everything is in scope.
    assert.match(r.stdout, /In scope this run: 1/);
  } finally { cleanup(dir); cleanup(config); }
});
