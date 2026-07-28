"use strict";
/*
 * ROADMAP.md item ids - r-MMDD-N.
 *
 * Pure functions only: the date is always an explicit argument, never read
 * from the system clock inside these functions, so a caller (init.js today)
 * controls the clock and these stay trivially testable.
 *
 * "Never reuse", even after a line is deleted: scanning `text` alone cannot
 * prove that, since a deleted line's id is gone from the text. Callers pass
 * `ledger` (ids issued before, whether or not their line still exists) into
 * nextId()/backfill(); backfill() returns the updated ledger so the caller
 * can persist it (init.js: .now/state.json's `roadmapIds` field - see
 * state.js). Nothing in this module persists anything itself.
 *
 * Line endings: this file is read/written on CI that runs Windows with
 * autocrlf off, so a ROADMAP.md may be CRLF, LF, or mixed. backfill() must
 * change only the bytes of a line it actually tags - splitting on a single
 * `\n` or `\r\n` and rejoining with one fixed separator would silently
 * rewrite every other line's terminator. splitPreservingEol()/joinLines()
 * exist for exactly that reason: each line keeps its own original
 * terminator (or lack of one, for a file with no trailing newline).
 */

const ID_RE = /\br-(\d{4})-(\d+)\b/g;

// CONSTRAINT: the SECTION decides what counts as an item, not the bullet
// shape. design section 4's "every item carries an id" holds; ## Now is
// defined as not an item list - it is the live cursor's pointer (design
// section 4: "the roadmap's pointer at what is live"), not a roster of
// discrete commitments, so its bullet (e.g. "- Nothing in flight.") never
// gets an id no matter its shape.
//
// BLOCKLIST, not allowlist (1.0.1 fix round): every OTHER `## ` section IS an
// item list, whatever a real project happens to name it (a hardcoded
// allowlist of the template's four names - Next/Later/Shipped/Non-goals -
// silently gave zero ids to a kept roadmap using its own section names, e.g.
// "## In Progress" / "## Committed next work (in order)" / "## Up Next" /
// "## Planned Implementation" / "## Existing Backlog"). A "### " subheading
// does not end a section (matches nowfile.js's convention).
//
// `## Now`'s exclusion is matched EXACTLY (heading text only, after
// headingOf()'s own trim - so trailing whitespace is already tolerated, but
// nothing else is), never by prefix: a prefix match against "## Now" also
// swallowed an unrelated real heading like "## Now Playing", wrongly
// excluding it from ids. Every heading other than the literal "## Now" -
// including one that merely starts with those characters, and including
// "## Next (candidates, not commitments)"-style parentheticals on OTHER
// headings - is an item section.
const ITEM_LINE_RE = /^(\s*-\s*(?:\[[ x~]\]\s*)?)(.*)$/;
const NOW_SECTION_HEADING = "## Now";

// A thematic break (---, ***, ___, three or more of the same character, no
// interior spaces) must never be mistaken for a dash bullet: ITEM_LINE_RE's
// bullet-marker capture is greedy enough that a bare `---` parses as a
// zero-space dash bullet with `--` content, so a rule separating two real
// commitments got tagged as the run's only id. Excluded before ITEM_LINE_RE
// ever sees the line.
const THEMATIC_BREAK_RE = /^\s*([-*_])\1{2,}\s*$/;

function headingOf(content) {
  const t = content.trim();
  return /^##\s/.test(t) ? t : null;
}

function isItemSectionHeading(heading) {
  return heading !== NOW_SECTION_HEADING;
}

// The exact shape backfill() itself appends: a space, then the id in
// backticks, at the END of the line. Positional, not "contains an id-shaped
// string" - an item whose wording merely MENTIONS another id (e.g. "follow
// r-0725-1") is not this item's own id and must still get one of its own.
const OWN_ID_SUFFIX_RE = /\s`(r-\d{4}-\d+)`\s*$/;

function ownId(content) {
  const m = OWN_ID_SUFFIX_RE.exec(content);
  return m ? m[1] : null;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function mmdd(date) {
  const d = date instanceof Date ? date : new Date(date);
  return pad2(d.getMonth() + 1) + pad2(d.getDate());
}

// Ids not matching this exact shape (any other id scheme) are never matched
// by ID_RE, so a legacy id can never be mistaken for one of ours.
function idsInText(text) {
  const ids = new Set();
  const re = new RegExp(ID_RE.source, "g");
  let m;
  const s = String(text || "");
  while ((m = re.exec(s))) ids.add(m[0]);
  return ids;
}

function maxCounterFor(usedIds, prefix) {
  let max = 0;
  for (const id of usedIds) {
    const m = /^r-(\d{4})-(\d+)$/.exec(id);
    if (m && m[1] === prefix) max = Math.max(max, Number(m[2]));
  }
  return max;
}

// `ledger` may contain ids no longer present anywhere in `text` (their line
// was deleted) - they still count as used.
function usedIds(text, ledger) {
  const used = idsInText(text);
  if (ledger) for (const id of ledger) used.add(id);
  return used;
}

function nextId(text, date, ledger) {
  const prefix = mmdd(date);
  const used = usedIds(text, ledger);
  return `r-${prefix}-${maxCounterFor(used, prefix) + 1}`;
}

// `eol` is the exact terminator that followed the line in the source ("\r\n",
// "\r", "\n", or "" for a final line with none) - required so joinLines()
// reproduces the original bytes of an unmodified line even when terminators
// are mixed within the same file.
function splitPreservingEol(text) {
  const s = String(text || "");
  const out = [];
  let start = 0;
  const re = /\r\n|\r|\n/g;
  let m;
  while ((m = re.exec(s))) {
    out.push({ content: s.slice(start, m.index), eol: m[0] });
    start = m.index + m[0].length;
  }
  if (start < s.length || out.length === 0) out.push({ content: s.slice(start), eol: "" });
  return out;
}

function joinLines(lines) {
  return lines.map((l) => l.content + l.eol).join("");
}

// Only ever appends to a line's content (never otherwise touches it), so the
// byte-for-byte preservation guarantee holds. `issued` in the return value is
// the caller's next `ledger` argument.
function backfill(text, date, ledger) {
  const prefix = mmdd(date);
  const lines = splitPreservingEol(text);
  const seen = usedIds(text, ledger);
  let counter = maxCounterFor(seen, prefix);

  let inItemSection = false; // before any heading, or under a non-item one: no ids
  // Every heading classified as an item section, in encounter order - so a
  // caller (init.js) can report exactly what it recognized, and warn loudly
  // when a file has bullets but zero of them landed inside a recognized
  // section (the allowlist-vs-blocklist failure mode this fix round closes).
  const itemSections = [];
  for (const line of lines) {
    const heading = headingOf(line.content);
    if (heading != null) {
      inItemSection = isItemSectionHeading(heading);
      if (inItemSection) itemSections.push(heading);
      continue;
    }
    if (!inItemSection) continue;
    // A thematic break (---, ***, ___) is a rule, never a dash bullet.
    if (THEMATIC_BREAK_RE.test(line.content)) continue;

    const m = ITEM_LINE_RE.exec(line.content);
    if (!m || !m[2].trim()) continue;
    // The captured content must hold at least one non-dash/non-space
    // character - a bullet whose "content" is itself only dashes/spaces
    // (e.g. a mis-typed rule) is not a real item either.
    if (!/[^-\s]/.test(m[2])) continue;
    if (ownId(line.content)) continue;
    counter += 1;
    const id = `r-${prefix}-${counter}`;
    line.content += " `" + id + "`";
    seen.add(id);
  }

  return { text: joinLines(lines), issued: Array.from(seen), itemSections };
}

module.exports = { nextId, backfill, idsInText, usedIds, splitPreservingEol, joinLines };
