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
 * schemaVersion 2 adds six fields, each owned by exactly one writer: `mode`,
 * `from` (the roadmap-id parent link), `build` (Gantry's sentinel, folded
 * in), `design`, `intent`, `roadmapIds`. readState() normalizes all six to
 * null when absent, so a v1 file and a v2 file are indistinguishable to a
 * reader that only cares about presence.
 *
 * `intent` (B3): `{ thread, next }`, NOW.md's Active-thread lines. state.json
 * is their only source - nowrender.js never parses them back out of NOW.md.
 * Deliberately NOT one of checkpoint.js's STOP_HOOK_OWNED_KEYS: writeStateAtomic
 * only touches the keys its caller names, so a Stop write (which never claims
 * "intent") can never erase it - the same guarantee that keeps `build`/`mode`/
 * `from`/`design` from clobbering each other.
 *
 * `roadmapIds`: the durable ledger of every r-MMDD-N id ever issued, so
 * roadmapids.js's nextId()/backfill() never reissue one whose line was later
 * deleted (a plain text scan can't prove that on its own). Same
 * STOP_HOOK_OWNED_KEYS exclusion as `intent`, for the same reason.
 *
 * issueRoadmapIds() below is the ONE entry point for issuing ids: read
 * ROADMAP.md, read the ledger, allocate, write ROADMAP.md, persist the
 * ledger are race-safe only as a single locked transaction. Every issuer
 * must call it rather than composing those steps itself.
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
const roadmapIds = require("./roadmapids.js");

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

// --- Cursor (from NOW.md, with state.intent as the derivation's root fix) --
//
// `intent` (B3's `{ thread, next }`) is the single source of truth for the
// Active thread's two lines - nowrender.js already renders from it directly,
// never parsing it back out of NOW.md (see nowrender.js's header comment).
// cursorFacts() used to violate that same contract on the read side: it
// re-derived activeThread/nextAction by parsing NOW.md text with nowfile.js's
// parser, predating the generated shape, instead of trusting the field that
// was already authoritative. When `intent` carries a thread/next, it wins
// here too; NOW.md text is parsed for these two fields ONLY as the fallback
// for a pre-1.0 hand-written file that never went through thread.js (where
// state.intent was never set, so it stays null).
function cursorFacts(now, intent) {
  if (now == null) return null;
  const hasIntent = !!(intent && (intent.thread != null || intent.next != null));
  return {
    activeThread: hasIntent ? capOrNull(intent.thread) : capOrNull(activeThread(now)),
    activeThreadLineCount: activeThreadLineCount(now),
    nextAction: hasIntent ? capOrNull(intent.next) : capOrNull(nextAction(now)),
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
 *   intent       the CURRENT state.intent ({ thread, next }) or null, so the
 *                Stop hook's own cursor derivation never diverges from the
 *                single source of truth thread.js's setIntent already wrote
 *                (see cursorFacts()'s header comment).
 */
function buildState({ generatedAt, branch, now, ideas, shipped, roadmap, git, intent }) {
  const g = git || {};
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: generatedAt || null,
    branch: branch || null,
    cursor: cursorFacts(now, intent),
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
// no state yet - not an error); a parsed v1 file (no mode/from/build/design/
// intent/roadmapIds keys) comes back with all six added as null rather than
// undefined, so a v1 and a v2 file are indistinguishable to a reader that
// only cares about presence. Never throws.
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
      intent: obj.intent != null ? obj.intent : null,
      roadmapIds: obj.roadmapIds != null ? obj.roadmapIds : null,
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

// Dedicated lock for the roadmap-id issuance transaction (read ROADMAP.md +
// the `roadmapIds` ledger, allocate ids, persist the ledger, write
// ROADMAP.md). Deliberately NOT stateLockPath: issueRoadmapIds() below calls
// writeStateAtomic() to persist the ledger, and writeStateAtomic() acquires
// stateLockPath() itself - nesting the SAME lock inside itself would
// self-deadlock (a directory mkdir is not reentrant). A separate lock lets
// the two compose safely: this one serializes concurrent id issuers against
// EACH OTHER; the inner stateLockPath() (acquired transiently, inside this
// lock's critical section) still serializes the ledger write against every
// OTHER state.json writer (the Stop hook, sentinel.js), exactly as before.
function roadmapLockPath(nowDir) {
  return path.join(nowDir, "roadmap.lock");
}

// THE single entry point for issuing/backfilling ROADMAP.md ids. Every
// current and future issuer (init.js today; the write vocabulary in phase 6)
// MUST call this rather than composing roadmapIds.backfill() + a raw
// ROADMAP.md write + writeStateAtomic() by hand: those three steps (read
// ROADMAP.md, read the ledger, allocate, write ROADMAP.md, persist the
// ledger) are only race-safe together, under one lock covering all of them -
// otherwise two concurrent issuers can each allocate from the same stale
// ledger and duplicate an id, or one issuer's ROADMAP.md write can be
// overwritten by the other's stale read, or the persisted ledger can shrink
// back to whichever issuer's read was oldest.
//
// Returns { text, changed, issued }. `changed` is false when ROADMAP.md was
// absent (nothing to backfill) or every item already carried its own id.
//
// Only ENOENT (no file there) reads as "nothing to backfill" - init.js is an
// explicit command whose own contract is to report a real failure loudly and
// exit non-zero (see init.js's header comment), not to shrug a permissions
// error or a directory-where-a-file-should-be into silent no-op success. Any
// other read error (EACCES, EISDIR, ...) propagates out of this function so
// init.js's existing catch names it and fails the command. This is
// deliberately NOT the hooks' fail-open contract: readState() (used by the
// silent Stop/SessionStart hooks and the guards) is untouched and keeps
// swallowing every error, because THEIR contract is the opposite of this
// one's.
function issueRoadmapIds(nowDir, roadmapPath, date) {
  return withLock(roadmapLockPath(nowDir), () => {
    let before;
    try { before = fs.readFileSync(roadmapPath, "utf8"); }
    catch (e) {
      if (e.code === "ENOENT") return { text: null, changed: false, issued: [], itemSections: [] };
      throw e;
    }

    const priorState = readState(nowDir);
    const ledger = (priorState && Array.isArray(priorState.roadmapIds)) ? priorState.roadmapIds : [];

    const { text: after, issued, itemSections } = roadmapIds.backfill(before, date, ledger);
    const changed = after !== before;
    if (changed) fs.writeFileSync(roadmapPath, after);
    writeStateAtomic(nowDir, { roadmapIds: issued }, ["roadmapIds"]);

    return { text: after, changed, issued, itemSections };
  });
}

module.exports = {
  SCHEMA_VERSION,
  buildState,
  writeStateAtomic,
  readState,
  stateLockPath,
  roadmapLockPath,
  issueRoadmapIds,
  // exported for focused unit tests
  cursorFacts,
  ideasFacts,
  shippedFacts,
  roadmapFacts,
};
