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
// gets an id no matter its shape. ## Next / ## Later / ## Shipped /
// ## Non-goals ARE item lists - every bullet there (checkbox or plain prose,
// e.g. a Shipped one-liner) gets one. An unrecognized/other heading gets no
// ids either (conservative default: only a known item section opts in).
// Matched by heading PREFIX so "## Next (candidates, not commitments)" and
// "## Non-goals (decided, not \"later\")" still count; a "### " subheading
// does not end a section (matches nowfile.js's convention).
const ITEM_LINE_RE = /^(\s*-\s*(?:\[[ x~]\]\s*)?)(.*)$/;
const ITEM_SECTION_PREFIXES = ["## Next", "## Later", "## Shipped", "## Non-goals"];

function headingOf(content) {
  const t = content.trim();
  return /^##\s/.test(t) ? t : null;
}

function isItemSectionHeading(heading) {
  return ITEM_SECTION_PREFIXES.some((p) => heading.startsWith(p));
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
  for (const line of lines) {
    const heading = headingOf(line.content);
    if (heading != null) {
      inItemSection = isItemSectionHeading(heading);
      continue;
    }
    if (!inItemSection) continue;

    const m = ITEM_LINE_RE.exec(line.content);
    if (!m || !m[2].trim()) continue;
    if (ownId(line.content)) continue;
    counter += 1;
    const id = `r-${prefix}-${counter}`;
    line.content += " `" + id + "`";
    seen.add(id);
  }

  return { text: joinLines(lines), issued: Array.from(seen) };
}

module.exports = { nextId, backfill, idsInText, usedIds };
