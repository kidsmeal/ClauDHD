"use strict";
/*
 * Shared NOW.md helpers used by checkpoint.js, idea.js, state.js, budget.js,
 * and (as of phase 3) nowrender.js.
 *
 * activeThread(text)          - the active thread's name (first **bold** span).
 * activeThreadSection(text)   - the lines of the "## Active thread" section.
 * activeThreadLineCount(text) - how many lines that section runs. The wrap budget
 *                               and the statusline [over] flag both key off this.
 * nextAction(text)            - the first unchecked "- [ ]" step in that section.
 * lastTouchedDate(text)       - the first YYYY-MM-DD on the "Last touched:" line.
 * queueCount(text)            - list items in "## Queue".
 * quickFixCount(text)         - open "- [ ]" items in "## Quick fixes".
 * section(text, headingPrefix)- generic: the raw lines of any "## <name>"
 *                               section (heading through its last non-blank
 *                               line), joined back to text. nowrender.js uses
 *                               this to carry the Queue/Quick fixes/Loose ends
 *                               sections forward verbatim across a
 *                               regeneration, since state.json only carries
 *                               their counts, never their item text.
 * modeLine(text) / fromLine(text) - parse the generated shape's own
 *                               "Mode: <x>" / "from: <id>" fact lines back out
 *                               of NOW.md text. These lines exist only in the
 *                               generated shape (a hand-written pre-1.0
 *                               NOW.md never has them), so both return null
 *                               when absent rather than throwing.
 *
 * These all stay pure string in, plain value out - no I/O - so every consumer
 * (including nowrender.js, which parses its OWN previous output back for the
 * sections it cannot regenerate from state alone) counts and parses the same
 * way, whether the NOW.md in front of it is hand-written or generated.
 */

function activeThread(text) {
  if (!text) return "";
  const lines = String(text).split(/\r?\n/);
  let grabbing = false;
  let fallback = "";
  for (const line of lines) {
    const s = line.trim();
    if (s.startsWith("## Active thread")) { grabbing = true; continue; }
    if (grabbing && s.startsWith("## ")) break;
    if (!grabbing) continue;
    // Bold tag: **thread name**
    const m = s.match(/\*\*(.+?)\*\*/);
    if (m) return m[1].trim();
    // Fallback: first non-empty line that is not a Rule: coaching line
    if (!fallback && s && !/^Rule:/i.test(s)) fallback = s;
  }
  return fallback;
}

// Lines of a "## <name>" section: from the heading through the last non-blank line
// before the next "## " heading. A "### " subheading does NOT end the section, so a
// thread full of "### bundle" subsections still reads as one section. [] if absent.
function sectionLines(text, headingStartsWith) {
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
  const seg = lines.slice(start, end);
  while (seg.length && seg[seg.length - 1].trim() === "") seg.pop();
  return seg;
}

// The "## Active thread" section, heading line included. The budget measures THIS.
function activeThreadSection(text) {
  return sectionLines(text, "## Active thread");
}

function activeThreadLineCount(text) {
  return activeThreadSection(text).length;
}

// First unchecked step inside the active thread, so the machine snapshot carries a
// crisp next action. null when the section has no "- [ ]" (e.g. a drifted cursor
// whose next step lives in prose) - itself a useful signal to consumers.
function nextAction(text) {
  for (const line of activeThreadSection(text)) {
    const m = line.match(/^\s*-\s*\[ \]\s*(.+?)\s*$/);
    if (m && m[1]) return m[1];
  }
  return null;
}

// The date on the "Last touched:" line, ignoring whatever prose follows it. We take
// a machine-clean date rather than the raw value, which is often a long paragraph.
function lastTouchedDate(text) {
  for (const line of String(text || "").split(/\r?\n/)) {
    if (/^\s*Last touched:/i.test(line)) {
      const m = line.match(/(\d{4}-\d{2}-\d{2})/);
      return m ? m[1] : null;
    }
  }
  return null;
}

// Top-level list items (bulleted or numbered) in the Queue, excluding wrapped
// continuation lines and the "(nothing queued yet)" placeholder (neither starts
// with a list marker).
function queueCount(text) {
  return sectionLines(text, "## Queue")
    .filter((l) => /^\s{0,3}(?:[-*]|\d+\.)\s+\S/.test(l)).length;
}

// Open (unchecked) items in the quick-fixes batch, counted the same way brief.js
// and statusline.js already count them.
function quickFixCount(text) {
  return sectionLines(text, "## Quick fixes")
    .filter((l) => /^\s*-\s*\[ \]/.test(l)).length;
}

// Exported alias of sectionLines(), so callers outside this file (nowrender.js)
// don't duplicate the heading-scan.
function section(text, headingStartsWith) {
  return sectionLines(text, headingStartsWith);
}

// The generated shape's "Mode: <x>" fact line. null when absent (a
// hand-written pre-1.0 NOW.md), or when the line is present but says idle
// (see nowrender.js's modeDisplay() placeholder) - both read as "no mode" to
// a consumer, same convention as fromLine()'s "(unplanned work)".
function modeLine(text) {
  for (const line of String(text || "").split(/\r?\n/)) {
    const m = line.match(/^\s*Mode:\s*(.+?)\s*$/);
    if (m) {
      const v = m[1];
      return /^\(.*\)$/.test(v) ? null : v; // "(none - idle)" reads as null
    }
  }
  return null;
}

// The generated shape's "from: <roadmap-id>" fact line. null when absent, or
// when the line is present but says the thread has no parent (see
// nowrender.js's UNPLANNED_LABEL) - both read as "no parent" to a consumer.
function fromLine(text) {
  for (const line of String(text || "").split(/\r?\n/)) {
    const m = line.match(/^\s*from:\s*(.+?)\s*$/i);
    if (m) {
      const v = m[1];
      return /^\(.*\)$/.test(v) ? null : v; // "(unplanned work)" reads as null
    }
  }
  return null;
}

module.exports = {
  activeThread,
  activeThreadSection,
  activeThreadLineCount,
  nextAction,
  lastTouchedDate,
  queueCount,
  quickFixCount,
  section,
  modeLine,
  fromLine,
};
