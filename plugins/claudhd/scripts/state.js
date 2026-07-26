"use strict";
/*
 * ClauDHD machine-readable state - the .now/state.json contract.
 *
 * checkpoint.js (the Stop hook) writes the cursor/ideas/shipped/roadmap/git
 * facts here so an external watcher (a dashboard, another tool) gets a clean
 * parse without reading freeform NOW.md prose. FACTS ONLY: counts, names,
 * dates. No thresholds and no judgments - consumers derive their own flags
 * from these numbers. Missing source files become null sections, never errors.
 *
 * schemaVersion 2 adds four fields alongside those facts, each owned by a
 * different writer: `mode` and `from` (the roadmap-id parent link) get real
 * writers in phases 5 and 3 respectively; `design` (doc path, resolved/open
 * decision lists) lands in a later phase too; `build` (plan ref, phase, files,
 * allow, started, session - Gantry's sentinel, folded in) gets its writer in
 * THIS phase (sentinel.js) and its readers in this phase too (both guards, via
 * sentinel-core.js's readSentinel). All four are first-class in the schema as
 * of this phase even though only `build` has a real writer yet: a v1 file (no
 * mode/from/build/design keys) and a v2 file both read cleanly through
 * readState(), which normalizes each absent field to null rather than
 * undefined, so phase 3/5 write into a schema that is already complete rather
 * than one they have to finish designing.
 *
 * buildState is a pure function (strings + git facts in, object out) so the whole
 * contract is testable without spawning the hook. It only ever produces the
 * facts sections above (schemaVersion/generatedAt/branch/cursor/ideas/shipped/
 * roadmap/git) - never build/design - so a caller that writes its output
 * through writeStateAtomic can never clobber another writer's section.
 *
 * writeStateAtomic is merge-preserving: every write reads the file that is
 * there, replaces only the keys the caller names as its own, and leaves every
 * other top-level key untouched, all inside withLock so two writers (the Stop
 * hook, sentinel.js, and later the reconcile and the write vocabulary) can
 * never race each other into a half-written or clobbered file. The atomic
 * temp-file + rename (and its Windows EPERM retry) happens inside the lock.
 */
const fs = require("fs");
const path = require("path");
const { withLock, sleep } = require("./lock.js");
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
const SCHEMA_VERSION = 2;

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

// The lock every state.json writer (checkpoint's Stop hook, sentinel.js, and
// later the reconcile and the write vocabulary) must go through - one lock
// dir per project, sharing lock.js's mkdir-is-atomic mutex. Exported so a test
// can hold the exact same lock (e.g. via tools/hold-lock.js) to prove two
// writers serialize rather than race.
function stateLockPath(nowDir) {
  return path.join(nowDir, "state.lock");
}

// Read <nowDir>/state.json and normalize it for a consumer that must accept
// both schema v1 and v2: an absent or unreadable file returns null (there is
// no state yet - not an error); a parsed v1 file (no mode/from/build/design
// keys) comes back with all four added as null rather than undefined, so a v1
// and a v2 file are indistinguishable to a reader that only cares about
// presence. Never throws.
function readState(nowDir) {
  try {
    const raw = fs.readFileSync(path.join(nowDir, "state.json"), "utf8");
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object") return null;
    return {
      ...obj,
      mode: obj.mode != null ? obj.mode : null,
      from: obj.from != null ? obj.from : null,
      build: obj.build != null ? obj.build : null,
      design: obj.design != null ? obj.design : null,
    };
  } catch {
    return null;
  }
}

// Merge-preserving write to <nowDir>/state.json, serialized by stateLockPath's
// lock so two writers can never observe or clobber each other's half of the
// file. `ownedKeys` names exactly the top-level keys this call is allowed to
// set (defaulting to patch's own keys when omitted); every other existing
// top-level key - including sections this caller has never heard of - passes
// through unchanged. schemaVersion is always stamped to the current
// SCHEMA_VERSION regardless of what the caller passed.
//
// The write itself is the same atomic temp-file + rename as before: a full
// temp file then a rename, so a reader never observes a partial write.
// Windows can throw EPERM/EACCES transiently if a watcher holds the
// destination open at the instant of rename; retry briefly, then give up and
// remove the temp so it can't accumulate. Throws on a hard failure - callers
// that must never fail a caller-visible action (the Stop hook) swallow it.
function writeStateAtomic(nowDir, patch, ownedKeys) {
  return withLock(stateLockPath(nowDir), () => {
    fs.mkdirSync(nowDir, { recursive: true });
    const dest = path.join(nowDir, "state.json");

    let existing = {};
    try {
      const parsed = JSON.parse(fs.readFileSync(dest, "utf8"));
      if (parsed && typeof parsed === "object") existing = parsed;
    } catch { /* absent or malformed - start from an empty object */ }

    const keys = Array.isArray(ownedKeys) ? ownedKeys : Object.keys(patch || {});
    const merged = { ...existing };
    for (const k of keys) merged[k] = patch ? patch[k] : undefined;
    merged.schemaVersion = SCHEMA_VERSION;

    const tmp = path.join(nowDir, "state.json." + process.pid + ".tmp");
    fs.writeFileSync(tmp, JSON.stringify(merged, null, 2) + "\n");
    const deadline = Date.now() + 2000;
    for (;;) {
      try { fs.renameSync(tmp, dest); return merged; }
      catch (e) {
        if ((e.code === "EPERM" || e.code === "EACCES" || e.code === "EEXIST") && Date.now() < deadline) {
          sleep(50);
          continue;
        }
        try { fs.unlinkSync(tmp); } catch { /* ignore */ }
        throw e;
      }
    }
  });
}

module.exports = {
  SCHEMA_VERSION,
  buildState,
  writeStateAtomic,
  readState,
  stateLockPath,
  // exported for focused unit tests
  cursorFacts,
  ideasFacts,
  shippedFacts,
  roadmapFacts,
};
