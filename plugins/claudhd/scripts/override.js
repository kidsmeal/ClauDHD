#!/usr/bin/env node
/*
 * override.js - the /claudhd:override escape hatch (design section 6, phase 5).
 *
 * Records a per-session, loud, never-silent override: "unguarded session,
 * N files outside any phase". This is the way out of mode enforcement (see
 * modes.js) for a genuinely unscoped edit, without a hard block with no exit.
 * "Outside any phase" covers BOTH an unguarded-mode edit (no sentinel) AND an
 * out-of-list edit under a LIVE sentinel (build mode, wrong file) - both
 * guard call sites funnel through the same noteOverrideFile() below.
 *
 * recordOverride(root, sessionId) is the /claudhd:override command's entry
 * point. It writes state.json's own top-level `override` key (owned solely
 * by this script, through the merge-preserving writer - the phase-2
 * ownership pattern, a dedicated key, never folded into `cursor`) and
 * re-renders NOW.md through nowrender.render(), exactly like reconcile.js
 * does at the commit boundary - this module never hand-writes NOW.md text.
 *
 * noteOverrideFile(root, sessionId, relPath) is the guards' own call: an
 * active override for the CURRENT session permits an edit that would
 * otherwise be denied, and counts it - both guards read/write the shared
 * `override` state key through this one function, under one lock, so two
 * racing guard invocations (or a racing /claudhd:override call) can never
 * lose an accumulated file. Both guards now call in here, so this module's
 * caller set is no longer /claudhd:override alone - the original "its only
 * caller" note (the plan's phase-5 Wired-by line) is superseded by this
 * review round's items 1/2/4.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { withLock } = require("./lock.js");
const { readState, writeStateAtomic, cursorFacts, ideasFacts } = require("./state.js");
const { render } = require("./nowrender.js");

const OVERRIDE_OWNED_KEYS = ["override"];
const LOOSE_HEADING_RE = /^##\s+Loose ends\b/i;
const LOOSE_PLACEHOLDER = "(none yet)";

// Any existing "unguarded session ...:" line, regardless of WHICH session it
// names - state.json holds exactly one `override` slot, so at most one such
// line should ever exist in NOW.md too. A session-2 recording after
// session-1 replaces session-1's now-stale line rather than accumulating one.
const OVERRIDE_LINE_RE = /^-\s*unguarded session\b/i;

function shortId(sessionId) {
  return String(sessionId || "unknown").slice(0, 8);
}

function overrideLine(sessionId, count) {
  return (
    "- unguarded session " + shortId(sessionId) + ": " + count +
    " file" + (count === 1 ? "" : "s") + " outside any phase"
  );
}

function readOrNull(p) {
  try { return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null; } catch { return null; }
}

function todayDate() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// [start, end) line indices of the "## Loose ends" section, or null if absent.
function findLooseSection(lines) {
  const start = lines.findIndex((l) => LOOSE_HEADING_RE.test(l));
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) { end = i; break; }
  }
  return { start, end };
}

// Pure string transform: upsert the override's line into `text`'s Loose ends
// section, replacing any prior override line (there is at most one active
// override) or the empty placeholder. Returns `text` unchanged if there is
// no Loose ends section to splice into. This is the ONLY place override
// state touches NOW.md's TEXT, and even this never reaches disk directly -
// it becomes the `now` (carry-forward) input to render() below, so every
// other fact on the page still comes from the renderer, not a hand-edit.
function spliceOverrideLine(text, sessionId, count) {
  const nl = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const sec = findLooseSection(lines);
  if (!sec) return text;

  const line = overrideLine(sessionId, count);
  const secLines = lines.slice(sec.start + 1, sec.end);

  const existingIdx = secLines.findIndex((l) => OVERRIDE_LINE_RE.test(l));
  const placeholderIdx = secLines.findIndex((l) => l.trim() === LOOSE_PLACEHOLDER);
  if (existingIdx !== -1) secLines[existingIdx] = line;
  else if (placeholderIdx !== -1) secLines[placeholderIdx] = line;
  else {
    let lastNonBlank = -1;
    for (let i = 0; i < secLines.length; i++) if (secLines[i].trim() !== "") lastNonBlank = i;
    if (lastNonBlank !== -1) secLines.splice(lastNonBlank + 1, 0, line);
    else secLines.push(line);
  }

  return lines.slice(0, sec.start + 1).concat(secLines, lines.slice(sec.end)).join(nl);
}

// Re-render NOW.md from state through nowrender.render(), the same render
// path reconcile.js uses at the commit boundary - mode/position/counts come
// fresh off `state`; the Queue/Quick-fixes/Loose-ends sections carry forward
// from the CURRENT NOW.md text, with the override line spliced into Loose
// ends first so it survives the carry-forward. Best-effort and silent on
// failure (no NOW.md yet, or a write error): the override's real record is
// state.json's `override` key, never this rendered mirror.
function renderNow(root, state) {
  const nowMdPath = path.join(root, "NOW.md");
  const oldNowText = readOrNull(nowMdPath);
  if (oldNowText == null) return null;

  const rec = state.override || {};
  const withOverrideLine = spliceOverrideLine(oldNowText, rec.session, Array.isArray(rec.files) ? rec.files.length : 0);

  const cursor = Object.assign({}, cursorFacts(withOverrideLine) || {}, { lastTouched: todayDate() });
  const ideasText = readOrNull(path.join(root, "IDEAS.md"));

  const renderState = {
    mode: state.mode != null ? state.mode : null,
    from: state.from != null ? state.from : null,
    build: state.build || null,
    design: state.design || null,
    intent: state.intent || null,
    cursor,
    ideas: ideasFacts(ideasText),
    now: withOverrideLine,
  };

  const rendered = render(renderState);
  try { fs.writeFileSync(nowMdPath, rendered); } catch { return null; }
  return rendered;
}

// True when `state` carries an active override for exactly `sessionId`.
function overrideActiveFor(state, sessionId) {
  return !!(sessionId && state && state.override && state.override.session === sessionId);
}

// Start (or re-affirm) an unguarded session for sessionId. Idempotent: a
// second call for the SAME session keeps its accumulated files list; a call
// for a DIFFERENT session replaces the single active-override slot (mode
// enforcement, like mode itself, is per-project, so only one override is
// meaningfully "active" at a time - consistent with the single active build
// sentinel). Locked (override.lock) against noteOverrideFile() below, so a
// guard-permitted edit racing a fresh /claudhd:override call can never lose
// either side's update.
function recordOverride(root, sessionId) {
  const nowDir = path.join(root, ".now");
  const lockPath = path.join(nowDir, "override.lock");
  return withLock(lockPath, () => {
    const prior = readState(nowDir);
    const files = (overrideActiveFor(prior, sessionId) && Array.isArray(prior.override.files))
      ? prior.override.files
      : [];
    const record = { session: sessionId, files, startedAt: new Date().toISOString() };
    const merged = writeStateAtomic(nowDir, { override: record }, OVERRIDE_OWNED_KEYS);
    renderNow(root, merged);
    return record;
  });
}

// The guards' call: true (and permitted, counted) when an override is active
// for `sessionId`; false when there is none, so the caller falls back to its
// own deny path. The read-check-modify-write happens as ONE atomic operation
// under override.lock - the SAME lock recordOverride() uses - so two racing
// guard invocations (or a racing /claudhd:override call) can never each read
// the same prior `files` array and clobber the other's addition (item 4:
// the shared-state-lock pattern from phase 2's writeStateAtomic, applied to
// the READ-MODIFY-WRITE as a whole, not just the final write).
function noteOverrideFile(root, sessionId, relPath) {
  const nowDir = path.join(root, ".now");
  const lockPath = path.join(nowDir, "override.lock");
  return withLock(lockPath, () => {
    const state = readState(nowDir);
    if (!overrideActiveFor(state, sessionId)) return false;
    const files = Array.isArray(state.override.files) ? state.override.files.slice() : [];
    if (!files.includes(relPath)) files.push(relPath);
    const record = { session: sessionId, files, startedAt: state.override.startedAt || new Date().toISOString() };
    const merged = writeStateAtomic(nowDir, { override: record }, OVERRIDE_OWNED_KEYS);
    renderNow(root, merged);
    return true;
  });
}

module.exports = { recordOverride, noteOverrideFile, OVERRIDE_OWNED_KEYS };

function runCli() {
  const ROOT = require("./root.js")(process.env);
  const sessionArg = process.argv[2];
  const sessionId = sessionArg ||
    process.env.GANTRY_SESSION_ID ||
    process.env.CLAUDE_CODE_SESSION_ID ||
    "";

  if (!sessionId) {
    console.error(
      "override.js: no session id (pass one explicitly, or set " +
      "GANTRY_SESSION_ID/CLAUDE_CODE_SESSION_ID)"
    );
    process.exit(1);
  }

  try {
    const record = recordOverride(ROOT, sessionId);
    console.log(
      "override.js: recorded unguarded session " + shortId(sessionId) +
      " (" + record.files.length + " file(s) so far). " +
      "Edits outside the active phase's scope will be permitted and counted, never silently."
    );
  } catch (e) {
    console.error("override.js: could not record override: " + e.message);
    process.exit(1);
  }
}

if (require.main === module) {
  runCli();
}
