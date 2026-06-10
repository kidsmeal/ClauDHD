"use strict";
/*
 * Shared NOW.md helpers used by checkpoint.js and idea.js.
 *
 * activeThread(text) - extract the active thread name from NOW.md content.
 *   1. Finds the "## Active thread" section.
 *   2. Returns the text of the first **bold** span found there.
 *   3. Falls back to the first non-empty line that is not a "Rule:" line.
 *   4. Returns "" if the section is absent or empty.
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

module.exports = { activeThread };
