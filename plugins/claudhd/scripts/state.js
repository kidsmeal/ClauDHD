"use strict";
/*
 * ClauDHD machine-readable state - the .now/state.json contract.
 *
 * checkpoint.js (the Stop hook) writes this alongside last-session.md so an
 * external watcher (a dashboard, another tool) gets a clean parse of the cursor
 * without reading freeform NOW.md prose. FACTS ONLY: counts, names, dates. No
 * thresholds and no judgments - consumers derive their own flags from these
 * numbers. Missing source files become null sections, never errors.
 *
 * buildState is a pure function (strings + git facts in, object out) so the whole
 * contract is testable without spawning the hook. writeStateAtomic does the temp
 * file + rename so a watcher reading mid-write never sees a half-written file.
 */
const fs = require("fs");
const path = require("path");
const { sleep } = require("./lock.js");
const { capText, STATE_TEXT_CAP } = require("./constants.js");
const {
  activeThread,
  activeThreadLineCount,
  nextAction,
  lastTouchedDate,
  queueCount,
  quickFixCount,
} = require("./nowfile.js");

// Bump only on a BREAKING change to an existing field (rename, removed field,
// changed meaning). Additive fields do not bump: consumers ignore unknown keys.
const SCHEMA_VERSION = 1;

function capOrNull(s) {
  if (s == null || s === "") return null;
  return capText(String(s), STATE_TEXT_CAP);
}

function numOrNull(n) {
  return Number.isFinite(n) ? n : null;
}

// Body lines of a "## <name>" section (heading excluded), up to the next "## "
// heading. Generic markdown; used for the IDEAS/SHIPPED/ROADMAP sections.
function sectionBody(text, headingStartsWith) {
  const lines = String(text || "").split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith(headingStartsWith)) { start = i; break; }
  }
  if (start === -1) return [];
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i].trim())) { end = i; break; }
  }
  return lines.slice(start + 1, end);
}

// --- Cursor (from NOW.md) --------------------------------------------------
function cursorFacts(now) {
  if (now == null) return null;
  return {
    activeThread: capOrNull(activeThread(now)),
    activeThreadLineCount: activeThreadLineCount(now),
    nextAction: capOrNull(nextAction(now)),
    lastTouched: lastTouchedDate(now),
    queueCount: queueCount(now),
    quickFixCount: quickFixCount(now),
  };
}

// --- Ideas (from IDEAS.md) -------------------------------------------------
function ideasFacts(ideas) {
  if (ideas == null) return null;
  const lines = String(ideas).split(/\r?\n/);
  let total = 0;
  let untriaged = 0;
  let oldest = null;
  for (const line of lines) {
    if (/^\s*-\s*\[[ x~]\]/.test(line)) total++;
    if (/^\s*-\s*\[ \]/.test(line)) {
      untriaged++;
      const m = line.match(/^\s*-\s*\[ \]\s*(\d{4}-\d{2}-\d{2})/);
      // YYYY-MM-DD sorts lexically, so a plain string compare finds the oldest.
      if (m && (oldest == null || m[1] < oldest)) oldest = m[1];
    }
  }
  return { total, untriaged, oldestUntriagedDate: oldest };
}

// --- Shipped (from SHIPPED.md) ---------------------------------------------
function shippedFacts(shipped) {
  if (shipped == null) return null;
  const lines = String(shipped).split(/\r?\n/);
  let total = 0;
  let lastEntryDate = null;
  for (const line of lines) {
    if (/^\s*-\s+\S/.test(line)) total++;                 // one commit / bundle entry
    const m = line.match(/^###\s+(\d{4}-\d{2}-\d{2})/);   // date headers, newest first
    if (m && lastEntryDate == null) lastEntryDate = m[1];
  }
  return { total, lastEntryDate };
}

// --- Roadmap (from ROADMAP.md) ---------------------------------------------
function roadmapFacts(roadmap) {
  if (roadmap == null) return null;
  const next = sectionBody(roadmap, "## Next");
  const later = sectionBody(roadmap, "## Later");
  const open = (l) => /^\s*-\s*\[ \]/.test(l);
  const count = next.filter(open).length + later.filter(open).length;
  let topItem = null;
  for (const l of next) {
    const m = l.match(/^\s*-\s*\[ \]\s*(.+?)\s*$/);
    if (m && m[1]) { topItem = capOrNull(m[1]); break; }
  }
  return { count, topItem };
}

/*
 * Assemble the snapshot. Inputs:
 *   generatedAt  ISO 8601 string (caller stamps it; kept out of here so the
 *                builder stays deterministic and testable).
 *   branch       current branch, or null when detached/unknown.
 *   now/ideas/shipped/roadmap  file contents as strings, or null if absent.
 *   git          { uncommitted, unpushed, lastCommitAt, lastCommitMsg } already
 *                gathered by the caller (null fields where unknown).
 */
function buildState({ generatedAt, branch, now, ideas, shipped, roadmap, git }) {
  const g = git || {};
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: generatedAt || null,
    branch: branch || null,
    cursor: cursorFacts(now),
    ideas: ideasFacts(ideas),
    shipped: shippedFacts(shipped),
    roadmap: roadmapFacts(roadmap),
    git: {
      uncommitted: numOrNull(g.uncommitted),
      unpushed: numOrNull(g.unpushed),
      lastCommitAt: g.lastCommitAt || null,
      lastCommitMsg: capOrNull(g.lastCommitMsg),
    },
  };
}

// Write obj to <nowDir>/state.json atomically: a full temp file then a rename, so
// a file watcher never observes a partial write. Windows can throw EPERM/EACCES
// transiently if the watcher holds the destination open at the instant of rename;
// retry briefly, then give up (the next Stop rewrites it) and remove the temp so
// it can't accumulate. Throws on a hard failure - the Stop hook swallows it.
function writeStateAtomic(nowDir, obj) {
  fs.mkdirSync(nowDir, { recursive: true });
  const dest = path.join(nowDir, "state.json");
  const tmp = path.join(nowDir, "state.json." + process.pid + ".tmp");
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + "\n");
  const deadline = Date.now() + 2000;
  for (;;) {
    try { fs.renameSync(tmp, dest); return; }
    catch (e) {
      if ((e.code === "EPERM" || e.code === "EACCES" || e.code === "EEXIST") && Date.now() < deadline) {
        sleep(50);
        continue;
      }
      try { fs.unlinkSync(tmp); } catch { /* ignore */ }
      throw e;
    }
  }
}

module.exports = {
  SCHEMA_VERSION,
  buildState,
  writeStateAtomic,
  // exported for focused unit tests
  cursorFacts,
  ideasFacts,
  shippedFacts,
  roadmapFacts,
};
