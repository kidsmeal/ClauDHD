"use strict";
/*
 * Shared NOW.md helpers used by checkpoint.js, idea.js, state.js, and budget.js.
 *
 * activeThread(text)          - the active thread's name (first **bold** span).
 * activeThreadSection(text)   - the lines of the "## Active thread" section.
 * activeThreadLineCount(text) - how many lines that section runs. The wrap budget
 *                               and the statusline [over] flag both key off this.
 * nextAction(text)            - the first unchecked "- [ ]" step in that section.
 * lastTouchedDate(text)       - the first YYYY-MM-DD on the "Last touched:" line.
 * queueCount(text)            - list items in "## Queue".
 * quickFixCount(text)         - open "- [ ]" items in "## Quick fixes".
 *
 * Pure string in, plain value out; no I/O, so they stay trivially testable and
 * every consumer counts the same way.
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

module.exports = {
  activeThread,
  activeThreadSection,
  activeThreadLineCount,
  nextAction,
  lastTouchedDate,
  queueCount,
  quickFixCount,
};
