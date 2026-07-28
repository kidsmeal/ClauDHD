#!/usr/bin/env node
/*
 * thread.js - the state.json writers STATE-SCHEMA.md marks "reserved":
 * `mode`, `from`, `intent`, `design` (phase 7: /claudhd:start and
 * /claudhd:design are the two commands that land these write paths).
 *
 * Mirrors override.js's shape exactly: write the owned key(s) through
 * state.js's merge-preserving, locked writeStateAtomic, then re-render
 * NOW.md through nowrender.render() so the generated shape never falls out
 * of sync with the state write - this module never hand-writes NOW.md text.
 *
 * `mode: "build"` is set here too (by /claudhd:build, alongside
 * sentinel.js's own `build` write), but ONLY for NOW.md's display line.
 * Guard enforcement itself keys off the SENTINEL's presence, not this field:
 * file-list-guard.js hardcodes "build" once a sentinel exists and only
 * consults `mode` in the sentinel-absent branch (design/idle). A stale
 * "design" mode lingering after a build starts would otherwise mislabel
 * nowrender's Position line even though enforcement was already correct.
 *
 * Subcommands (CLI, structured argv only - no free-text write path beyond
 * the thread/next/text args a session composes itself, same as every other
 * ClauDHD writer):
 *   enter-design <fromId|-> [thread] [next]
 *       Set mode=design. `fromId` sets `from` (pass "-" for none/unplanned).
 *       thread/next, if given, seed `intent`. Starts a FRESH design board
 *       (design: {doc:null,resolved:[],open:[]}) every time - a completed or
 *       abandoned prior design's lists never leak into a new session, since
 *       this is always "entering", never "resuming" (resuming an in-progress
 *       design just keeps calling decision/resolve-decision/set-design-doc
 *       without a fresh enter-design). Also clears any active override (see
 *       the override note below).
 *   set-intent <thread> <next>
 *       Update intent.thread / intent.next only (mode/from/design untouched).
 *   set-design-doc <path>
 *       Set design.doc, preserving design.resolved/design.open, WITHOUT
 *       touching mode/from/override. Used mid-grill, after a FRESH design
 *       doc is written, in a session already properly in design mode (see
 *       enter-design above) - never the existing-doc audit entry point
 *       (that is audit-design, below). Locked (see the design-lock note
 *       below).
 *   audit-design <path>
 *       THE existing-doc /claudhd:design entry point (sol round-seven): a
 *       REAL design-mode entry, with continuation safety. Compares `path`
 *       to the CURRENTLY ACTIVE `design.doc` under the design lock:
 *         - Same doc (re-auditing what is already active): a continuation.
 *           Reaffirms mode=design and clears any override, but preserves
 *           the accumulated board and `from`/`intent` byte-for-byte - the
 *           settled behavior an in-progress audit pass depends on.
 *         - Different doc, or no active design thread at all (idle, a
 *           different mode, or a different doc's session): a fresh entry -
 *           full enter-design semantics. mode=design, a FRESH board
 *           ({doc:path,resolved:[],open:[]}), `from` explicitly cleared to
 *           null (an existing-doc audit never carries a roadmap parent),
 *           and the override cleared. This is what stops a stale board,
 *           `from`, or override from an unrelated prior thread leaking into
 *           this doc's audit.
 *       Locked (see the design-lock note below).
 *   decision <resolved|open> <text>
 *       Append `text` to design.resolved or design.open. Locked.
 *   resolve-decision <open-text> [-- <resolution-text>]
 *       Remove `open-text` (exact match) from design.open, then append
 *       `resolution-text` to design.resolved - or `open-text` itself if no
 *       `--`-separated resolution is given (the grill's own flow: an open
 *       fork that later resolves records the SAME text it was deferred
 *       under). The two-argument form is what the audit path needs (sol
 *       round-five): a design-reviewer's `[NEEDS USER DECISION: ...]` marker
 *       is recorded as the open text, but what actually resolves it is a
 *       different string - the real decision the user made, not the
 *       marker's own wording. Never call this on a text that was never
 *       recorded as open; it throws rather than silently resolving nothing.
 *   enter-build
 *       Set mode=build (display only - see header comment). Also clears any
 *       active override, same as enter-design.
 *   clear-mode
 *       Set mode=null (idle). Does not touch from/intent/design/override.
 *
 * Override invalidation on mode transition (sol round-one finding 1, widened
 * in round six, consolidated round seven): the override is a per-emergency
 * escape for the CURRENT unguarded stretch, not a standing permit that
 * should keep applying once a new, properly-scoped mode begins.
 * enter-design, enter-build, set-design-doc, AND audit-design all clear
 * `override` back to absent (never left as a stale, still-matching session
 * record) and strip its rendered "unguarded session ..." line out of NOW.md's
 * Loose ends section before re-rendering, so the board never shows a permit
 * that no longer applies. audit-design is now design.md's existing-doc audit
 * entry point (sol round seven) - a properly-scoped transition into design
 * work whether it turns out to be a fresh entry or a continuation of the
 * currently-active doc - so the override clear applies unconditionally,
 * independent of which of those two branches it takes. A follow-up
 * /claudhd:override call inside the new mode starts a fresh record, same as
 * any other first override.
 *
 * Design-board locking (sol round-one finding 5): setDesignDoc/addDecision/
 * resolveDecision each read the CURRENT design object, modify it, and write
 * it back - a read-modify-write that races the exact same way
 * issueRoadmapIds()'s ledger read-modify-write would without a lock spanning
 * all three steps (two concurrent decisions could each read the same prior
 * list and the second write would silently drop the first's addition).
 * designLockPath's dedicated lock wraps read+modify+write as one critical
 * section for all three functions, mirroring issueRoadmapIds()'s own
 * roadmapLockPath pattern - a SEPARATE lock from state.js's stateLockPath
 * (acquired transiently, inside this one, by writeStateAtomic itself), so
 * the two compose without self-deadlocking.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { withLock } = require("./lock.js");
const { readState, writeStateAtomic, cursorFacts, ideasFacts } = require("./state.js");
const { render } = require("./nowrender.js");
const { clearOverrideLine } = require("./override.js");

function designLockPath(nowDir) {
  return path.join(nowDir, "design.lock");
}

function readOrNull(p) {
  try { return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null; } catch { return null; }
}

function todayDate() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Re-render NOW.md from state through nowrender.render() - the same render
// path reconcile.js/override.js use. Best-effort and silent on failure (no
// NOW.md yet, or a write error): the real record is state.json, never this
// rendered mirror.
//
// When `state.override` is falsy (either it was never set, or this call just
// cleared it - see enterDesign/enterBuild), strip any stale "unguarded
// session ..." line out of the carried-forward Loose ends section first.
// Idempotent and safe on every call: with no line to strip, this is a no-op;
// with an override still genuinely active, state.override is truthy and
// nothing is touched.
function renderNow(root, state) {
  const nowMdPath = path.join(root, "NOW.md");
  let nowText = readOrNull(nowMdPath);
  if (nowText == null) return null;
  if (!state.override) nowText = clearOverrideLine(nowText);

  // `state.intent` (already the merged, just-written value - see
  // writeAndRender()) is threaded through so this cursor's activeThread/
  // nextAction never re-derive by parsing NOW.md text (see state.js's
  // cursorFacts() header comment) - even though render() itself already
  // reads intent directly for display, keeping every live cursor derivation
  // consistent closes off the same class of stale-derivation bug elsewhere.
  const cursor = Object.assign({}, cursorFacts(nowText, state.intent) || {}, { lastTouched: todayDate() });
  const ideasText = readOrNull(path.join(root, "IDEAS.md"));

  const renderState = {
    mode: state.mode != null ? state.mode : null,
    from: state.from != null ? state.from : null,
    build: state.build || null,
    design: state.design || null,
    intent: state.intent || null,
    cursor,
    ideas: ideasFacts(ideasText),
    now: nowText,
  };

  const rendered = render(renderState);
  try { fs.writeFileSync(nowMdPath, rendered); } catch { return null; }
  return rendered;
}

function writeAndRender(root, patch, ownedKeys) {
  const nowDir = path.join(root, ".now");
  const merged = writeStateAtomic(nowDir, patch, ownedKeys);
  renderNow(root, merged);
  return merged;
}

// FRESH_DESIGN is a plain data literal, never reused by reference across
// calls (each caller gets its own object), so two enterDesign() calls can
// never share (and accidentally mutate) the same array instances.
function freshDesign() {
  return { doc: null, resolved: [], open: [] };
}

function enterDesign(root, { from, thread, next } = {}) {
  const nowDir = path.join(root, ".now");
  const prior = readState(nowDir) || {};
  // Always a fresh board (finding 2): entering design starts a new session,
  // never resumes a completed or abandoned prior one's resolved/open lists.
  // Always clears any active override (finding 1): a per-emergency escape
  // must not silently carry into the properly-scoped mode that follows it.
  const patch = { mode: "design", design: freshDesign(), override: undefined };
  const ownedKeys = ["mode", "design", "override"];
  if (from !== undefined) {
    patch.from = from;
    ownedKeys.push("from");
  }
  if (thread !== undefined || next !== undefined) {
    patch.intent = {
      thread: thread !== undefined ? thread : (prior.intent && prior.intent.thread) || null,
      next: next !== undefined ? next : (prior.intent && prior.intent.next) || null,
    };
    ownedKeys.push("intent");
  }
  return writeAndRender(root, patch, ownedKeys);
}

function setIntent(root, thread, next) {
  return writeAndRender(root, { intent: { thread, next } }, ["intent"]);
}

// setDesignDoc/addDecision/resolveDecision each read-modify-write the SAME
// `design` object; designLockPath wraps the whole sequence per call so two
// concurrent calls can never both read the same prior state and have the
// second write silently drop the first's change (see this file's header
// comment).
//
// setDesignDoc() also clears any active override (sol round-six finding 3),
// the same reasoning as enterDesign()/enterBuild(): a properly-scoped
// transition invalidates a per-emergency override independent of whether the
// board itself resets. Since sol round seven, this is a mid-grill helper
// only (design.md calls it right after a FRESH design doc is written, in a
// session already properly in design mode via enterDesign) - the existing-
// doc audit entry point is auditDesign(), below, not this function. Unlike
// enterDesign(), the `design` object itself is still merge-preserved (doc
// set, resolved/open kept), never reset to fresh.
function setDesignDoc(root, docPath) {
  const nowDir = path.join(root, ".now");
  return withLock(designLockPath(nowDir), () => {
    const prior = readState(nowDir) || {};
    const design = Object.assign(freshDesign(), prior.design || {}, { doc: docPath });
    return writeAndRender(root, { design, override: undefined }, ["design", "override"]);
  });
}

// auditDesign() is design.md's existing-doc audit entry point (sol round
// seven): a REAL design-mode entry with continuation safety, choosing
// between two branches by comparing `docPath` to the CURRENTLY ACTIVE
// design.doc, all under designLockPath so the read-compare-write is one
// critical section (no two concurrent audit-design calls can each read the
// same prior design.doc and disagree about which branch applies).
//
//   - Continuation (docPath === prior.design.doc): re-auditing what is
//     already the active doc. Reaffirms mode=design and clears any override,
//     but leaves `design` (resolved/open), `from`, and `intent` byte-for-
//     byte untouched - the settled behavior an in-progress audit pass
//     depends on (see setDesignDoc's own history: this is the same
//     preserve-the-board contract, just now reached through a function that
//     also guarantees mode is actually "design").
//   - Fresh entry (any other case - idle, a different mode, or a different
//     doc's session): full enterDesign()-equivalent semantics. mode=design,
//     a FRESH board ({doc:docPath,resolved:[],open:[]}), `from` explicitly
//     cleared to null (an existing-doc audit never carries a roadmap
//     parent - it did not come from /claudhd:start), and override cleared.
//     `intent` is left untouched here (audit-design does not know a
//     thread/next pair the way enter-design's optional args do; a stale
//     intent is not the leakage this finding is about - design/from/board
//     are), matching setIntent's own scope of "only what this call knows".
function auditDesign(root, docPath) {
  const nowDir = path.join(root, ".now");
  return withLock(designLockPath(nowDir), () => {
    const prior = readState(nowDir) || {};
    const isContinuation = !!(prior.design && prior.design.doc === docPath);
    if (isContinuation) {
      return writeAndRender(root, { mode: "design", override: undefined }, ["mode", "override"]);
    }
    const design = freshDesign();
    design.doc = docPath;
    return writeAndRender(
      root,
      { mode: "design", from: null, design, override: undefined },
      ["mode", "from", "design", "override"]
    );
  });
}

function addDecision(root, kind, text) {
  if (kind !== "resolved" && kind !== "open") {
    throw new Error("addDecision: kind must be resolved or open, got: " + kind);
  }
  const nowDir = path.join(root, ".now");
  return withLock(designLockPath(nowDir), () => {
    const prior = readState(nowDir) || {};
    const design = Object.assign(freshDesign(), prior.design || {});
    design[kind] = Array.isArray(design[kind]) ? design[kind].slice() : [];
    design[kind].push(text);
    return writeAndRender(root, { design }, ["design"]);
  });
}

// `openText` is looked up (exact match) in design.open and removed; the text
// actually pushed onto design.resolved is `resolutionText` if given, else
// `openText` itself (the grill's own resolve-in-place flow - see this
// file's header comment). Throws, writing nothing, if `openText` is not
// currently in design.open: resolving a decision never recorded as open is
// always a caller bug, never a silent no-op.
function resolveDecision(root, openText, resolutionText) {
  const resolution = resolutionText !== undefined ? resolutionText : openText;
  const nowDir = path.join(root, ".now");
  return withLock(designLockPath(nowDir), () => {
    const prior = readState(nowDir) || {};
    const design = Object.assign(freshDesign(), prior.design || {});
    const open = Array.isArray(design.open) ? design.open.slice() : [];
    const idx = open.indexOf(openText);
    if (idx === -1) throw new Error("resolveDecision: no open decision matches: " + openText);
    open.splice(idx, 1);
    const resolved = Array.isArray(design.resolved) ? design.resolved.slice() : [];
    resolved.push(resolution);
    return writeAndRender(root, { design: Object.assign({}, design, { open, resolved }) }, ["design"]);
  });
}

function enterBuild(root) {
  // Clears any active override, same reasoning as enterDesign (finding 1).
  return writeAndRender(root, { mode: "build", override: undefined }, ["mode", "override"]);
}

function clearMode(root) {
  return writeAndRender(root, { mode: null }, ["mode"]);
}

module.exports = { enterDesign, setIntent, setDesignDoc, auditDesign, addDecision, resolveDecision, enterBuild, clearMode, designLockPath };

function runCli() {
  const ROOT = require("./root.js")(process.env);
  const [, , sub, ...rest] = process.argv;

  try {
    switch (sub) {
      case "enter-design": {
        const [fromArg, thread, next] = rest;
        if (!fromArg) { console.error("thread.js enter-design: usage: enter-design <fromId|-> [thread] [next]"); process.exitCode = 1; return; }
        const from = fromArg === "-" ? null : fromArg;
        enterDesign(ROOT, { from, thread, next });
        console.log("thread.js: entered design mode" + (from ? " (from " + from + ")" : ""));
        return;
      }
      case "set-intent": {
        const [thread, next] = rest;
        if (thread == null || next == null) { console.error("thread.js set-intent: usage: set-intent <thread> <next>"); process.exitCode = 1; return; }
        setIntent(ROOT, thread, next);
        console.log("thread.js: intent updated");
        return;
      }
      case "set-design-doc": {
        const [docPath] = rest;
        if (!docPath) { console.error("thread.js set-design-doc: usage: set-design-doc <path>"); process.exitCode = 1; return; }
        setDesignDoc(ROOT, docPath);
        console.log("thread.js: design.doc set to " + docPath);
        return;
      }
      case "audit-design": {
        const [docPath] = rest;
        if (!docPath) { console.error("thread.js audit-design: usage: audit-design <path>"); process.exitCode = 1; return; }
        auditDesign(ROOT, docPath);
        console.log("thread.js: audited design doc " + docPath);
        return;
      }
      case "decision": {
        const [kind, ...textParts] = rest;
        const text = textParts.join(" ").trim();
        if ((kind !== "resolved" && kind !== "open") || !text) {
          console.error("thread.js decision: usage: decision <resolved|open> <text>");
          process.exitCode = 1;
          return;
        }
        addDecision(ROOT, kind, text);
        console.log("thread.js: added to design." + kind + ": " + text);
        return;
      }
      case "resolve-decision": {
        const sepIdx = rest.indexOf("--");
        let openText, resolutionText;
        if (sepIdx === -1) {
          openText = rest.join(" ").trim();
          resolutionText = undefined;
        } else {
          openText = rest.slice(0, sepIdx).join(" ").trim();
          resolutionText = rest.slice(sepIdx + 1).join(" ").trim();
          if (!resolutionText) {
            console.error("thread.js resolve-decision: usage: resolve-decision <open text> [-- <resolution text>] (resolution text after -- must not be empty)");
            process.exitCode = 1;
            return;
          }
        }
        if (!openText) { console.error("thread.js resolve-decision: usage: resolve-decision <open text> [-- <resolution text>]"); process.exitCode = 1; return; }
        resolveDecision(ROOT, openText, resolutionText);
        console.log("thread.js: resolved decision: " + openText + (resolutionText ? " -> " + resolutionText : ""));
        return;
      }
      case "enter-build":
        enterBuild(ROOT);
        console.log("thread.js: entered build mode");
        return;
      case "clear-mode":
        clearMode(ROOT);
        console.log("thread.js: mode cleared (idle)");
        return;
      default:
        console.error(
          "thread.js: unknown subcommand: " + sub + "\n" +
          "Usage:\n" +
          "  thread.js enter-design <fromId|-> [thread] [next]\n" +
          "  thread.js set-intent <thread> <next>\n" +
          "  thread.js set-design-doc <path>\n" +
          "  thread.js audit-design <path>\n" +
          "  thread.js decision <resolved|open> <text>\n" +
          "  thread.js resolve-decision <open text> [-- <resolution text>]\n" +
          "  thread.js enter-build\n" +
          "  thread.js clear-mode\n"
        );
        process.exitCode = 1;
    }
  } catch (e) {
    console.error("thread.js: " + e.message);
    process.exitCode = 1;
  }
}

if (require.main === module) runCli();
