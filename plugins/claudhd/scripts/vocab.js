#!/usr/bin/env node
/*
 * vocab.js - the mechanical write vocabulary (design section 9/10, phase 6).
 *
 * Five verbs, structured argv only (paths, ids, positions, dates): a chat
 * command and (later) Object Permanence v2 both call these same functions,
 * so triage and roadmap decisions are scripts, not model work, with no
 * free-text operation anywhere except the one verb that is DEFINED to carry
 * text (appendCapture, a straight capture, never a rewrite):
 *
 *   appendCapture(root, text)                        - IDEAS.md, verbatim
 *                                                       capture.
 *   move(root, { position, expectedLine, section })   - promote an idea to
 *                                                       ROADMAP.md, verbatim.
 *   mark(root, { file, key, expectedLine, state })     - flip a checkbox
 *                                                       marker on an
 *                                                       IDEAS.md or
 *                                                       ROADMAP.md line
 *                                                       (drop, done, ...).
 *   reorder(root, { section, id, position })           - move a roadmap
 *                                                       item to a new
 *                                                       position in its
 *                                                       section.
 *   park(root, { id, to })                             - move a roadmap
 *                                                       item between Next
 *                                                       and Later.
 *
 * IDEAS.md lines carry no id of their own (they never have), so move() and
 * mark(file: "ideas") address a line the same way a triage card list would:
 * `position`, the 1-based rank of the line among ALL Inbox lines (open,
 * promoted, or dropped alike), top to bottom - a "position" per the
 * vocabulary contract, not a timestamp (two ideas captured in the same
 * minute would collide on a timestamp key). Counting every line, not just
 * open ones, is what keeps a position stable under concurrent verbs: a line
 * is never physically removed (only its marker flips in place - the
 * legend's "[x] done or dropped" stays visible forever), so marking one
 * idea can never renumber a sibling's position out from under a racing
 * caller.
 *
 * Optimistic concurrency (sol round-one fix): a position alone is not
 * enough. A capture landing between a consumer rendering its card list and
 * a tap firing shifts every position below it, so a stale tap addressed by
 * position alone could silently act on the WRONG line. Both move() and
 * mark(file: "ideas") therefore also require `expectedLine`: the EXACT line
 * text the caller last rendered at that position (structured argv - an
 * exact-match echo of a line already shown to the caller, not composed free
 * text). If the line currently at `position` no longer matches
 * `expectedLine` byte-for-byte, the verb refuses and writes nothing; the
 * caller re-renders and retries. Both verbs still separately require the
 * ADDRESSED line to be open ("- [ ]") before acting on it.
 *
 * Promotion (move) is verbatim: no model rewrites the words on a tap. The
 * idea's own wording is read back off the IDEAS.md line addressed by
 * `position` and carried unchanged into ROADMAP.md; the capture date and
 * while-context ride along on the same line. move() writes the ROADMAP.md
 * side FIRST (validate the destination, insert, stamp the id) and only
 * marks the source IDEAS.md line promoted AFTER that succeeds: a
 * missing/malformed ROADMAP.md throws before IDEAS.md is ever touched, so a
 * ROADMAP-side failure can never leave an idea marked promoted while its
 * words never actually landed anywhere. The returned `id` is read back by
 * the exact physical line index move() inserted at (stable across the
 * id-issuance backfill pass, which only appends suffixes and never reorders
 * lines), never by re-matching the item's text - two promotions with
 * byte-identical wording/date/thread would otherwise be indistinguishable
 * by text alone.
 *
 * Cross-verb stability (sol round-two fix): the insert, the id-issuance
 * backfill, and the index-based read-back above ALL happen inside ONE
 * acquisition of state.js's roadmapLockPath - the SAME lock mark(file:
 * "roadmap")/reorder()/park() already use for their own ROADMAP.md writes -
 * so none of those verbs can interleave a mutation between move()'s insert
 * and its read-back and invalidate the index. This is why move() does NOT
 * call state.js's issueRoadmapIds() (which acquires roadmapLockPath itself
 * and would self-deadlock if called from inside an already-held instance of
 * the same lock - a directory-mkdir mutex is not reentrant): it instead
 * composes the identical transaction (read the ledger, backfill, write the
 * ledger through writeStateAtomic) under its OWN already-held lock. Every
 * OTHER issuer (init.js, reconcile.js) still goes through issueRoadmapIds()
 * unchanged; only move()'s inlined copy exists, and only because holding
 * one wider critical section is what fix 2 requires.
 *
 * The triage "quick fix" button is deliberately NOT one of these five verbs:
 * B2 (plan blockers) resolved that it keeps writing through quick.js's
 * existing `## Quick fixes` batch, unchanged. See docs/SCRIPT-VOCABULARY.md.
 *
 * Every write here is atomic + locked. Locking is the shape idea.js already
 * used pre-phase-6: a file-scoped lock directory (lock.js's mkdir mutex)
 * wraps each read-modify-write. IDEAS.md writes use their own lock
 * (ideas.lock); every ROADMAP.md-mutating verb (move's roadmap side,
 * mark(roadmap), reorder, park) shares state.js's roadmapLockPath, so none
 * of them can ever observe or clobber another's half of the file. The write
 * itself (sol round-two fix) is the state.js's writeStateAtomic shape: a
 * temp file in the SAME directory as the destination, written in full, then
 * renamed over the destination, with a retry loop on Windows
 * EPERM/EACCES/EEXIST. Object Permanence's fs-watcher reads IDEAS.md/
 * ROADMAP.md without holding this module's locks, so a reader must never be
 * able to observe a partially-written file - a plain fs.writeFileSync
 * straight to the destination is not safe against that and must never be
 * used on these two files (writeFileAtomic() below is the only writer).
 *
 * Line-ending preservation (sol round-three fix): every function that
 * rewrites IDEAS.md/ROADMAP.md by splitting it into lines and rejoining
 * uses roadmapids.js's splitPreservingEol()/joinLines() (exported from
 * there for this reuse - the exact mechanism phase 3's backfill() already
 * relies on for the same file), never `text.split(/\r?\n/)` +
 * `lines.join(oneChosenEol)`. A file can be CRLF, LF, or mixed (this repo's
 * CI runs Windows with autocrlf off - cross-cutting concern 11), and a
 * single chosen eol for the whole rewritten document would silently
 * normalize every OTHER line's terminator too, even ones this call never
 * touched. splitPreservingEol() carries each line's own original
 * terminator (or lack of one, on a final line) as data; only a line this
 * call actually edits ever has its bytes changed. A brand-new line
 * (move()'s ROADMAP.md insert) gets the document's dominant eol (there is
 * no "original" terminator to preserve for content that didn't exist
 * before); a RELOCATED line (reorder()/park() moving an existing item)
 * carries its own original terminator with it as part of the same
 * {content, eol} unit, rather than adopting whatever the slot it lands in
 * used to have.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { withLock, sleep } = require("./lock.js");
const { activeThread } = require("./nowfile.js");
const { readState, writeStateAtomic, roadmapLockPath } = require("./state.js");
const roadmapIds = require("./roadmapids.js");
const { splitPreservingEol, joinLines } = roadmapIds;

// Byte-identical to idea.js's pre-phase-6 header - moved here, not changed,
// so an existing IDEAS.md's first line never drifts across the refactor.
const HEADER =
`# IDEAS (capture, do not chase)

When an idea comes up mid-task, it is recorded here in one line. Do NOT open a new chat for it; the current thread survives. Triage regularly: each idea is promoted to the NOW.md Queue, kept parked, or dropped.

Capture: \`/claudhd:idea <your idea>\` in any chat.
Harvest: \`/claudhd:harvest\` to backfill ideas from past sessions you never recorded.
Triage: \`/claudhd:triage\` to review this list.

Legend: \`[ ]\` new, \`[~]\` promoted to NOW.md Queue, \`[x]\` done or dropped.

## Inbox

(empty)
`;

const ITEM_SECTIONS = ["Next", "Later"];
const IDEA_STATES = { dropped: "x", promoted: "~" };
const ROADMAP_STATES = { open: " ", done: "x" };

// A captured idea line's prefix: "- [<marker>] YYYY-MM-DD HH:MM", byte-
// identical to idea.js's pre-phase-6 display. Only the checkbox + timestamp
// are matched by regex; everything after is handed to parseIdeaLine()'s
// balanced-paren scan below, since a regex "(while: (.*?))" cannot tell a
// thread name's OWN closing paren from the wrapper's (sol round-two fix 1 -
// the shipped default thread name, "(name your current focus here)", is
// itself parenthesized, so a non-greedy regex stops at the wrong `)` and
// both truncates the thread and corrupts the idea text with a stray
// leading `)`).
const IDEA_LINE_PREFIX_RE = /^(\s*-\s*)\[([ x~])\](\s*)(\d{4}-\d{2}-\d{2}\s\d{2}:\d{2})(.*)$/;

// Structural anchor on the exact "(while: " prefix idea.js's writer emits,
// then a balanced-paren scan (not a regex) for its matching close: depth
// starts at 1 for the wrapper's own already-consumed "(", increments on
// every further "(", decrements on every ")", and the wrapper closes at the
// first point depth returns to 0. This finds the wrapper's OWN close no
// matter how many balanced parens the thread name itself contains.
const WHILE_TAG_RE = /^\s+\(while:\s/;

// Parses one IDEAS.md line into { marker, date, thread, text }, or null if
// the line is not a captured idea line at all (wrong checkbox/timestamp
// shape). `thread` is null when the line carries no "(while: ...)" tag (a
// hand-written or pre-1.0 line). Exported so callers (and tests) never
// re-implement this parse with a second, potentially-drifting regex.
function parseIdeaLine(line) {
  const m = IDEA_LINE_PREFIX_RE.exec(line);
  if (!m) return null;
  const marker = m[2];
  const date = m[4];
  const rest = m[5];

  const tagMatch = WHILE_TAG_RE.exec(rest);
  if (!tagMatch) {
    return { marker, date, thread: null, text: rest.replace(/^\s+/, "") };
  }

  let depth = 1; // the wrapper's own "(" is already consumed by tagMatch
  let i = tagMatch[0].length;
  for (; i < rest.length; i++) {
    const c = rest[i];
    if (c === "(") depth++;
    else if (c === ")") { depth--; if (depth === 0) break; }
  }
  if (depth !== 0) {
    // Unterminated tag (malformed line) - fail safe: no thread, whole rest
    // as text, rather than guessing.
    return { marker, date, thread: null, text: rest.replace(/^\s+/, "") };
  }

  const thread = rest.slice(tagMatch[0].length, i);
  const text = rest.slice(i + 1).replace(/^\s+/, "");
  return { marker, date, thread, text };
}

function ideasPath(root) { return path.join(root, "IDEAS.md"); }
function ideasLockPath(root) { return path.join(root, ".now", "ideas.lock"); }
function roadmapPath(root) { return path.join(root, "ROADMAP.md"); }
function nowDirOf(root) { return path.join(root, ".now"); }
function nowMdPath(root) { return path.join(root, "NOW.md"); }

function stampNow() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// The document's DOMINANT terminator - used ONLY to pick an eol for
// brand-new content that has no "original" terminator of its own (a freshly
// inserted ROADMAP.md line). Never used to rewrite an EXISTING line's
// terminator - see this file's header comment on line-ending preservation.
function eolOf(text) {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

// Atomic write for IDEAS.md/ROADMAP.md destinations (sol round-two fix 3):
// a temp file in the SAME directory as `destPath`, written in full, then
// renamed over the destination - the exact shape state.js's
// writeStateAtomic uses, including the Windows EPERM/EACCES/EEXIST retry
// (a watcher can transiently hold the destination open at the instant of
// rename). Object Permanence's fs-watcher reads these files without this
// module's locks, so it must never be able to observe a half-written file;
// this is the only function in this file allowed to call fs.writeFileSync
// on a real IDEAS.md/ROADMAP.md destination path.
function writeFileAtomic(destPath, content) {
  const dir = path.dirname(destPath);
  const tmp = path.join(dir, path.basename(destPath) + "." + process.pid + "." + Date.now() + ".tmp");
  fs.writeFileSync(tmp, content);
  const deadline = Date.now() + 2000;
  for (;;) {
    try { fs.renameSync(tmp, destPath); return; }
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

// ---------------------------------------------------------------------------
// append-capture - the one verb that carries free text, and only ever
// appends it verbatim as a new IDEAS.md line. Identical write shape to
// idea.js's pre-phase-6 logic (moved here, not changed).
// ---------------------------------------------------------------------------

function appendCapture(root, text) {
  const t = String(text || "").trim();
  if (!t) return { ok: false, reason: "empty" };

  const IDEAS = ideasPath(root);
  let entry;
  withLock(ideasLockPath(root), () => {
    if (!fs.existsSync(IDEAS)) writeFileAtomic(IDEAS, HEADER);
    let body = fs.readFileSync(IDEAS, "utf8");
    let nowTxt = "";
    try { nowTxt = fs.existsSync(nowMdPath(root)) ? fs.readFileSync(nowMdPath(root), "utf8") : ""; }
    catch { /* ignore */ }
    const thread = activeThread(nowTxt) || "?";
    entry = `- [ ] ${stampNow()} (while: ${thread}) ${t}`;
    body = body.replace("\n(empty)\n", "\n");

    const inbox = "## Inbox\n";
    const idx = body.indexOf(inbox);
    if (idx !== -1) {
      const head = body.slice(0, idx + inbox.length);
      const tail = body.slice(idx + inbox.length).replace(/^\n+/, "");
      body = head + "\n" + entry + "\n" + tail;
    } else {
      body = body.replace(/\s+$/, "") + "\n\n## Inbox\n\n" + entry + "\n";
    }
    writeFileAtomic(IDEAS, body);
  });

  return { ok: true, text: t, entry };
}

// ---------------------------------------------------------------------------
// mark - flip an existing line's checkbox marker. A closed enum per file, not
// free text: an unrecognized state throws rather than writing anything.
// ---------------------------------------------------------------------------

// The `position`-th idea line in `lines`, 1-based, top to bottom, counting
// EVERY captured line regardless of its marker ([ ]/[~]/[x]) - the same rank
// a rendered triage card list would carry, and stable for the file's whole
// lifetime since a line is never physically removed (see this file's header
// comment on why that is what makes position race-safe).
function findIdeaLineByPosition(lines, position) {
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    const parsed = parseIdeaLine(lines[i]);
    if (parsed) {
      count++;
      if (count === position) {
        return { idx: i, marker: parsed.marker, date: parsed.date, thread: parsed.thread, text: parsed.text };
      }
    }
  }
  return null;
}

// `expectedLine` is required: the exact line text the caller last rendered
// at `position` (see this file's header comment on optimistic concurrency).
// A mismatch means the list changed underneath the caller - refuse and
// write nothing rather than silently acting on whatever line now sits at
// that position.
function markIdea(root, position, expectedLine, marker) {
  const IDEAS = ideasPath(root);
  let hit = null;
  withLock(ideasLockPath(root), () => {
    if (!fs.existsSync(IDEAS)) throw new Error("mark: no IDEAS.md at " + IDEAS);
    const raw = fs.readFileSync(IDEAS, "utf8");
    const lines = splitPreservingEol(raw);
    const plain = lines.map((l) => l.content);
    hit = findIdeaLineByPosition(plain, position);
    if (!hit) throw new Error("mark: no idea at position " + position);
    if (plain[hit.idx] !== expectedLine) {
      throw new Error("mark: idea at position " + position + " no longer matches the expected line (the list changed underneath this tap - re-render and retry)");
    }
    if (hit.marker !== " ") throw new Error("mark: idea at position " + position + " is not open (already marked '" + hit.marker + "')");
    lines[hit.idx].content = lines[hit.idx].content.replace("[ ]", "[" + marker + "]");
    writeFileAtomic(IDEAS, joinLines(lines));
  });
  return hit;
}

function markRoadmap(root, key, marker) {
  const RM = roadmapPath(root);
  return withLock(roadmapLockPath(nowDirOf(root)), () => {
    if (!fs.existsSync(RM)) throw new Error("mark: no ROADMAP.md at " + RM);
    const raw = fs.readFileSync(RM, "utf8");
    const lines = splitPreservingEol(raw);
    const idRe = new RegExp("`" + escapeRe(key) + "`\\s*$");
    const idx = lines.findIndex((l) => idRe.test(l.content) && /^\s*-\s*\[[ x~]\]/.test(l.content));
    if (idx === -1) throw new Error("mark: no checkbox item carrying id " + key + " in ROADMAP.md");
    lines[idx].content = lines[idx].content.replace(/\[[ x~]\]/, "[" + marker + "]");
    writeFileAtomic(RM, joinLines(lines));
    return true;
  });
}

// `key`'s type depends on `file`: for "ideas" it is a 1-based position among
// ALL Inbox lines (see findIdeaLineByPosition); for "roadmap" it is the
// item's own `r-MMDD-N` id (already stable/unique, so no expectedLine check
// is needed on that side). Both are structured argv, never free text.
// `expectedLine` is required for file: "ideas" - see this file's header
// comment on optimistic concurrency.
function mark(root, { file, key, expectedLine, state } = {}) {
  if (file === "ideas") {
    if (expectedLine == null) throw new Error("mark: expectedLine is required for file: \"ideas\" (optimistic concurrency - the exact line last rendered at this position)");
    const marker = IDEA_STATES[state];
    if (marker == null) throw new Error("mark: unknown ideas state: " + state);
    const hit = markIdea(root, key, expectedLine, marker);
    return { ok: true, file, key, state, text: hit.text };
  }
  if (file === "roadmap") {
    const marker = ROADMAP_STATES[state];
    if (marker == null) throw new Error("mark: unknown roadmap state: " + state);
    markRoadmap(root, key, marker);
    return { ok: true, file, key, state };
  }
  throw new Error("mark: unknown file: " + file + " (expected ideas or roadmap)");
}

// ---------------------------------------------------------------------------
// ROADMAP.md section helpers, shared by move/reorder/park.
// ---------------------------------------------------------------------------

// Line-index boundaries, computed via splitPreservingEol() (not a plain
// `text.split(/\r?\n/)`) so its indices always line up with every other
// caller's own splitPreservingEol() split of the SAME text - required for
// the terminator-preservation guarantee (see this file's header comment).
function sectionBounds(text, section) {
  const lines = splitPreservingEol(text).map((l) => l.content);
  const headingPrefix = "## " + section;
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith(headingPrefix)) { start = i; break; }
  }
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) { end = i; break; }
  }
  return { start, end };
}

// Append `itemLine` as the last item line of `section`, right after the
// section's last non-blank line - never touching any other line's bytes.
// `itemLine` is either a plain string (brand-new content, e.g. move()'s
// promotion - gets the document's DOMINANT eol, since new content has no
// "original" terminator to preserve) or an existing {content, eol} line
// object (a line being relocated, e.g. park() moving an item between
// sections - keeps its OWN original terminator as part of the same unit,
// rather than adopting whatever the slot it lands in used to have).
// Returns the inserted line's physical index too: issueRoadmapIds()'s
// backfill pass only appends id suffixes to existing lines, never
// inserting/removing/reordering any, so that index stays valid for reading
// the id back off THIS exact line afterward - text-matching alone cannot
// disambiguate two lines with byte-identical wording (see move()).
function appendToRoadmapSection(text, section, itemLine) {
  const lines = splitPreservingEol(text);
  const bounds = sectionBounds(text, section);
  if (!bounds) throw new Error(`ROADMAP.md has no "## ${section}" section`);
  const { start, end } = bounds;
  let insertAt = end;
  for (let i = end - 1; i > start; i--) {
    if (lines[i].content.trim() !== "") { insertAt = i + 1; break; }
  }
  const newLine = typeof itemLine === "string"
    ? { content: itemLine, eol: eolOf(text) }
    : itemLine;
  lines.splice(insertAt, 0, newLine);
  return { text: joinLines(lines), index: insertAt };
}

// Removes the line whose CONTENT matches `content` out of `section`, and
// returns the removed line's full {content, eol} object too - so the
// caller (park()) can re-insert it elsewhere via appendToRoadmapSection()
// with its own original terminator intact, rather than a freshly-chosen
// one. `removed` is null (and `text` unchanged) if no match was found.
function removeLineFromSection(text, section, content) {
  const lines = splitPreservingEol(text);
  const bounds = sectionBounds(text, section);
  if (!bounds) return { text, removed: null };
  for (let i = bounds.start + 1; i < bounds.end; i++) {
    if (lines[i].content === content) {
      const [removed] = lines.splice(i, 1);
      return { text: joinLines(lines), removed };
    }
  }
  return { text, removed: null };
}

// ---------------------------------------------------------------------------
// move - promotion, IDEAS.md -> ROADMAP.md. Verbatim: the wording written to
// ROADMAP.md is read back off the captured line, never taken from argv.
// ---------------------------------------------------------------------------

function move(root, { position, expectedLine, section } = {}) {
  if (expectedLine == null) {
    throw new Error("move: expectedLine is required (optimistic concurrency - the exact line last rendered at this position)");
  }
  const targetSection = section || "Next";
  if (!ITEM_SECTIONS.includes(targetSection)) {
    throw new Error("move: section must be Next or Later, got: " + targetSection);
  }

  const IDEAS = ideasPath(root);

  // 1. READ-ONLY validation pass: locate and validate the source line
  //    (position, expectedLine, open, non-empty text) but do NOT mark it
  //    yet. Marking happens only after the ROADMAP.md write below succeeds,
  //    so a ROADMAP-side failure (missing/malformed destination) can never
  //    leave an idea silently marked promoted while its words never
  //    actually landed anywhere - see this file's header comment.
  let picked = null;
  withLock(ideasLockPath(root), () => {
    if (!fs.existsSync(IDEAS)) throw new Error("move: no IDEAS.md at " + IDEAS);
    const raw = fs.readFileSync(IDEAS, "utf8");
    const lines = splitPreservingEol(raw).map((l) => l.content);
    const hit = findIdeaLineByPosition(lines, position);
    if (!hit) throw new Error("move: no idea at position " + position);
    if (lines[hit.idx] !== expectedLine) {
      throw new Error("move: idea at position " + position + " no longer matches the expected line (the list changed underneath this tap - re-render and retry)");
    }
    if (hit.marker !== " ") throw new Error("move: idea at position " + position + " is not open (already marked '" + hit.marker + "')");
    if (!hit.text || !hit.text.trim()) throw new Error("move: idea at position " + position + " has no text to promote");
    picked = hit;
  });

  // 2. ROADMAP.md side: validate the destination, insert, stamp an id, and
  //    read the stamped id back - ALL inside ONE acquisition of
  //    roadmapLockPath, the same lock mark(file: "roadmap")/reorder()/
  //    park() use for their own ROADMAP.md writes. Holding it across the
  //    whole sequence (not just the insert) is what makes the index-based
  //    read-back safe: no other roadmap-mutating verb can reorder or rewrite
  //    the file between this call's insert and its own read-back (sol
  //    round-two fix 2). Any throw here (missing file, missing section)
  //    propagates BEFORE the source line is ever touched - IDEAS.md stays
  //    byte-untouched on a ROADMAP-side failure.
  const nowDir = nowDirOf(root);
  const RM = roadmapPath(root);
  const meta = picked.thread
    ? `(captured: ${picked.date}, while: ${picked.thread})`
    : `(captured: ${picked.date})`;
  const itemLine = `- [ ] ${picked.text} ${meta}`;

  const id = withLock(roadmapLockPath(nowDir), () => {
    if (!fs.existsSync(RM)) throw new Error("move: no ROADMAP.md at " + RM);
    const before = fs.readFileSync(RM, "utf8");
    const { text: withInsert, index: insertedIndex } = appendToRoadmapSection(before, targetSection, itemLine);

    // The SAME transaction state.js's issueRoadmapIds() performs (read the
    // durable ledger, backfill, persist the grown ledger through
    // writeStateAtomic), composed here instead of calling it: issueRoadmapIds()
    // acquires this exact lock itself, and calling it from inside an
    // already-held instance would self-deadlock (a directory-mkdir mutex is
    // not reentrant - see this file's header comment). Every OTHER issuer
    // (init.js, reconcile.js) still goes through issueRoadmapIds() directly.
    const priorState = readState(nowDir);
    const ledger = (priorState && Array.isArray(priorState.roadmapIds)) ? priorState.roadmapIds : [];
    const { text: withIds, issued } = roadmapIds.backfill(withInsert, new Date(), ledger);
    writeFileAtomic(RM, withIds);
    writeStateAtomic(nowDir, { roadmapIds: issued }, ["roadmapIds"]);

    // backfill() only appends a suffix to each id-less line - it never
    // inserts, removes, or reorders lines - so `insertedIndex` still points
    // at exactly the line this call just inserted, and nothing else could
    // have touched that index while this lock was held. Reading the id back
    // by that physical index (not by re-matching itemLine's text) is what
    // keeps the association correct even when two promoted lines end up
    // byte-identical (e.g. two identical captures both promoted): text
    // matching alone cannot tell them apart, but the index can.
    const afterLine = splitPreservingEol(withIds)[insertedIndex];
    const idMatch = afterLine ? /`(r-\d{4}-\d+)`\s*$/.exec(afterLine.content) : null;
    return idMatch ? idMatch[1] : null;
  });

  // 3. Only now mark the source line promoted - the ROADMAP.md write above
  //    already succeeded, so this step can never leave a promoted idea
  //    unrepresented anywhere. Re-validated against the SAME position and
  //    expectedLine: the narrow window where something else touched this
  //    exact line between step 1 and here throws loudly (naming the id
  //    already stamped) rather than silently mismarking a different idea.
  withLock(ideasLockPath(root), () => {
    const raw = fs.readFileSync(IDEAS, "utf8");
    const lines = splitPreservingEol(raw);
    const plain = lines.map((l) => l.content);
    const hit = findIdeaLineByPosition(plain, position);
    if (!hit || plain[hit.idx] !== expectedLine || hit.marker !== " ") {
      throw new Error(
        "move: promoted to ROADMAP.md (" + (id || "id unknown") + ") but could not mark the source IDEAS.md line " +
        "(it changed between validation and marking) - check IDEAS.md for a stale open duplicate before retrying"
      );
    }
    lines[hit.idx].content = lines[hit.idx].content.replace("[ ]", "[~]");
    writeFileAtomic(IDEAS, joinLines(lines));
  });

  return {
    ok: true,
    id,
    text: picked.text,
    section: targetSection,
    capturedAt: picked.date,
    thread: picked.thread,
  };
}

// ---------------------------------------------------------------------------
// reorder - move a roadmap item to a new position within its own section.
// Stable: every line outside the reordered item set is untouched, and the
// relative order of every OTHER item in the section is preserved.
// ---------------------------------------------------------------------------

function reorder(root, { section, id, position } = {}) {
  if (!ITEM_SECTIONS.includes(section)) {
    throw new Error("reorder: section must be Next or Later, got: " + section);
  }
  if (!Number.isInteger(position) || position < 1) {
    throw new Error("reorder: position must be a positive integer, got: " + position);
  }

  const nowDir = nowDirOf(root);
  const RM = roadmapPath(root);
  return withLock(roadmapLockPath(nowDir), () => {
    if (!fs.existsSync(RM)) throw new Error("reorder: no ROADMAP.md at " + RM);
    const raw = fs.readFileSync(RM, "utf8");
    const lines = splitPreservingEol(raw);
    const bounds = sectionBounds(raw, section);
    if (!bounds) throw new Error(`reorder: ROADMAP.md has no "## ${section}" section`);
    const { start, end } = bounds;

    const itemIdxs = [];
    for (let i = start + 1; i < end; i++) {
      if (/^\s*-\s/.test(lines[i].content)) itemIdxs.push(i);
    }

    const idRe = new RegExp("`" + escapeRe(id) + "`\\s*$");
    const fromPos = itemIdxs.findIndex((i) => idRe.test(lines[i].content));
    if (fromPos === -1) throw new Error(`reorder: no item carrying id ${id} in "## ${section}"`);

    const toPos = Math.max(0, Math.min(position - 1, itemIdxs.length - 1));
    if (toPos === fromPos) return { changed: false, text: raw, from: fromPos + 1, to: toPos + 1 };

    const order = itemIdxs.slice();
    const [movedSlot] = order.splice(fromPos, 1);
    order.splice(toPos, 0, movedSlot);

    // Reassign the FULL line object (content AND its own original eol
    // travel together as one unit) at each item line's fixed physical
    // slot, in the new order - the slots themselves (and every
    // non-participant line in the file) never move, so headings/blank
    // lines/other sections stay byte-identical; an item that DOES move
    // carries its own terminator with it rather than adopting whatever the
    // slot it lands in used to have.
    const newObjs = itemIdxs.map((_, k) => lines[order[k]]);
    for (let k = 0; k < itemIdxs.length; k++) lines[itemIdxs[k]] = newObjs[k];

    const text = joinLines(lines);
    writeFileAtomic(RM, text);
    return { changed: true, text, from: fromPos + 1, to: toPos + 1 };
  });
}

// ---------------------------------------------------------------------------
// park - move a roadmap item between Next and Later. Reversible: parking an
// item and then parking it back restores its exact original line text
// (content AND its own original terminator - the whole {content, eol} unit
// travels with the relocated line; see appendToRoadmapSection()).
// ---------------------------------------------------------------------------

function park(root, { id, to } = {}) {
  if (!ITEM_SECTIONS.includes(to)) {
    throw new Error("park: to must be Next or Later, got: " + to);
  }

  const nowDir = nowDirOf(root);
  const RM = roadmapPath(root);
  return withLock(roadmapLockPath(nowDir), () => {
    if (!fs.existsSync(RM)) throw new Error("park: no ROADMAP.md at " + RM);
    const text = fs.readFileSync(RM, "utf8");
    const idRe = new RegExp("`" + escapeRe(id) + "`\\s*$");

    let fromSection = null;
    let content = null;
    for (const sec of ITEM_SECTIONS) {
      const bounds = sectionBounds(text, sec);
      if (!bounds) continue;
      const lines = splitPreservingEol(text);
      for (let i = bounds.start + 1; i < bounds.end; i++) {
        if (/^\s*-\s/.test(lines[i].content) && idRe.test(lines[i].content)) { fromSection = sec; content = lines[i].content; break; }
      }
      if (fromSection) break;
    }
    if (!fromSection) throw new Error(`park: no item carrying id ${id} in Next or Later`);
    if (fromSection === to) return { changed: false, text, from: fromSection, to };

    const { text: afterRemove, removed } = removeLineFromSection(text, fromSection, content);
    const { text: finalText } = appendToRoadmapSection(afterRemove, to, removed);
    writeFileAtomic(RM, finalText);
    return { changed: true, text: finalText, from: fromSection, to };
  });
}

module.exports = {
  appendCapture,
  move,
  mark,
  reorder,
  park,
  appendToRoadmapSection,
  parseIdeaLine,
};

// ---------------------------------------------------------------------------
// CLI - structured argv only. append-capture is the one verb whose trailing
// args are joined as free text; every other verb takes fixed positional
// tokens (paths, ids, positions, dates).
// ---------------------------------------------------------------------------

function runCli() {
  const ROOT = require("./root.js")(process.env);
  const [, , verb, ...rest] = process.argv;

  try {
    switch (verb) {
      case "append-capture": {
        const text = rest.join(" ").trim();
        if (!text) { console.log("Nothing captured. Usage: vocab.js append-capture <text>"); return; }
        const r = appendCapture(ROOT, text);
        console.log(r.ok ? `Captured -> IDEAS.md: ${r.text}` : "Nothing captured.");
        return;
      }
      case "move": {
        const [positionArg, expectedLine, section] = rest;
        const position = parseInt(positionArg, 10);
        if (!positionArg || Number.isNaN(position) || expectedLine == null) {
          console.error("vocab.js move: usage: move <position> <expectedLine> [Next|Later]");
          process.exitCode = 1;
          return;
        }
        const r = move(ROOT, { position, expectedLine, section });
        console.log(`vocab.js: promoted -> ROADMAP.md ${r.section} (${r.id || "no id assigned"})`);
        return;
      }
      case "mark": {
        const [file, ...args] = rest;
        if (file === "ideas") {
          const [positionArg, expectedLine, state] = args;
          const position = parseInt(positionArg, 10);
          if (!positionArg || Number.isNaN(position) || expectedLine == null || !state) {
            console.error("vocab.js mark: usage: mark ideas <position> <expectedLine> <state>");
            process.exitCode = 1;
            return;
          }
          mark(ROOT, { file, key: position, expectedLine, state });
          console.log(`vocab.js: marked ideas ${position} -> ${state}`);
          return;
        }
        if (file === "roadmap") {
          const [id, state] = args;
          if (!id || !state) { console.error("vocab.js mark: usage: mark roadmap <id> <state>"); process.exitCode = 1; return; }
          mark(ROOT, { file, key: id, state });
          console.log(`vocab.js: marked roadmap ${id} -> ${state}`);
          return;
        }
        console.error("vocab.js mark: usage: mark ideas <position> <expectedLine> <state> | mark roadmap <id> <state>");
        process.exitCode = 1;
        return;
      }
      case "reorder": {
        const [section, id, positionArg] = rest;
        const position = parseInt(positionArg, 10);
        if (!section || !id || Number.isNaN(position)) { console.error("vocab.js reorder: usage: reorder <Next|Later> <id> <position>"); process.exitCode = 1; return; }
        const r = reorder(ROOT, { section, id, position });
        console.log(r.changed ? `vocab.js: reordered ${id} to position ${r.to}` : `vocab.js: ${id} already at position ${r.to}`);
        return;
      }
      case "park": {
        const [id, to] = rest;
        if (!id || !to) { console.error("vocab.js park: usage: park <id> <Next|Later>"); process.exitCode = 1; return; }
        const r = park(ROOT, { id, to });
        console.log(r.changed ? `vocab.js: parked ${id} -> ${to}` : `vocab.js: ${id} already in ${to}`);
        return;
      }
      default:
        console.error(
          "vocab.js: unknown verb: " + verb + "\n" +
          "Usage:\n" +
          "  vocab.js append-capture <text>\n" +
          "  vocab.js move <position> <expectedLine> [Next|Later]\n" +
          "  vocab.js mark ideas <position> <expectedLine> <state> | mark roadmap <id> <state>\n" +
          "  vocab.js reorder <Next|Later> <id> <position>\n" +
          "  vocab.js park <id> <Next|Later>\n"
        );
        process.exitCode = 1;
    }
  } catch (e) {
    console.error("vocab.js: " + e.message);
    process.exitCode = 1;
  }
}

if (require.main === module) runCli();
