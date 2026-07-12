// The lenient NOW.md parser. Ports nowfile.js semantics exactly (ClauDHD 0.9,
// plugins/claudhd/scripts/nowfile.js) and adds the reads state.json does not
// carry: loose ends, the file's self-declared quick-fix cap, and the grown
// sections that are the bloat evidence.

import type { CursorFacts, ParseStatus } from "../model.js";

export interface NowParse {
  parse: ParseStatus;
  hasMarker: boolean;
  cursor: CursorFacts;
}

function lines(text: string): string[] {
  return text.split(/\r?\n/);
}

// nowfile.js: section runs from its heading through the last non-blank line
// before the next "## " heading; "### " does not close it; heading included.
function sectionLines(text: string, headingStartsWith: string): string[] {
  const ls = lines(text);
  let start = -1;
  for (let i = 0; i < ls.length; i++) {
    const line = ls[i];
    if (line !== undefined && line.trim().startsWith(headingStartsWith)) {
      start = i;
      break;
    }
  }
  if (start === -1) return [];
  let end = ls.length;
  for (let i = start + 1; i < ls.length; i++) {
    const line = ls[i];
    if (line !== undefined && /^##\s/.test(line.trim())) {
      end = i;
      break;
    }
  }
  const seg = ls.slice(start, end);
  while (seg.length > 0) {
    const last = seg[seg.length - 1];
    if (last !== undefined && last.trim() === "") seg.pop();
    else break;
  }
  return seg;
}

function activeThread(text: string): string {
  let grabbing = false;
  let fallback = "";
  for (const raw of lines(text)) {
    const s = raw.trim();
    if (s.startsWith("## Active thread")) {
      grabbing = true;
      continue;
    }
    if (grabbing && s.startsWith("## ")) break;
    if (!grabbing) continue;
    const m = s.match(/\*\*(.+?)\*\*/);
    if (m && m[1] !== undefined) return m[1].trim();
    if (!fallback && s && !/^Rule:/i.test(s)) fallback = s;
  }
  return fallback;
}

function nextAction(section: string[]): string | null {
  for (const line of section) {
    const m = line.match(/^\s*-\s*\[ \]\s*(.+?)\s*$/);
    if (m && m[1]) return m[1];
  }
  return null;
}

function lastTouchedDate(text: string): string | null {
  for (const line of lines(text)) {
    if (/^\s*Last touched:/i.test(line)) {
      const m = line.match(/(\d{4}-\d{2}-\d{2})/);
      return m && m[1] !== undefined ? m[1] : null;
    }
  }
  return null;
}

const LIST_ITEM = /^\s{0,3}(?:[-*]|\d+\.)\s+\S/;

function listItemCount(section: string[]): number {
  return section.filter((l) => LIST_ITEM.test(l)).length;
}

function uncheckedCount(section: string[]): number {
  return section.filter((l) => /^\s*-\s*\[ \]/.test(l)).length;
}

// "Capped at 5" in the Quick fixes prose; the file's own word wins over the
// config default.
function declaredQuickFixCap(section: string[]): number | null {
  for (const line of section) {
    const m = line.match(/capped at (\d+)/i);
    if (m && m[1] !== undefined) return parseInt(m[1], 10);
  }
  return null;
}

// The ClauDHD template's own H2 set; anything else is a grown organ. Matched
// by prefix because headings carry parentheticals ("## Queue (in order, not now)").
const TEMPLATE_H2_PREFIXES = [
  "Active thread",
  "Queue",
  "Quick fixes",
  "Idea flow",
  "Loose ends",
  "Leaving this file",
];

function grownSections(text: string, activeSection: string[]): string[] {
  const grown: string[] = [];
  for (const raw of lines(text)) {
    const m = raw.trim().match(/^##\s+(.+?)\s*$/);
    if (!m || m[1] === undefined) continue;
    const title = m[1];
    if (!TEMPLATE_H2_PREFIXES.some((p) => title.startsWith(p))) grown.push(title);
  }
  // ### subheads inside the active thread are the in-section organs the wrap
  // budget migrates (shipped bundles, doc indexes).
  for (const line of activeSection) {
    const m = line.trim().match(/^###\s+(.+?)\s*$/);
    if (m && m[1] !== undefined) grown.push(m[1]);
  }
  return grown;
}

export function parseNow(text: string | null): NowParse | null {
  if (text == null) return null;
  const hasMarker = text.includes("<!-- claudhd");
  const section = sectionLines(text, "## Active thread");
  const parse: ParseStatus =
    section.length > 0
      ? { status: "ok" }
      : {
          status: "raw-fallback",
          reason: "no '## Active thread' section found",
          raw: text,
        };
  const thread = activeThread(text);
  const cursor: CursorFacts = {
    activeThread: thread === "" ? null : thread,
    activeThreadLineCount: section.length > 0 ? section.length : null,
    nextAction: nextAction(section),
    lastTouched: lastTouchedDate(text),
    queueCount: sectionLines(text, "## Queue").length > 0 ? listItemCount(sectionLines(text, "## Queue")) : null,
    quickFixCount:
      sectionLines(text, "## Quick fixes").length > 0
        ? uncheckedCount(sectionLines(text, "## Quick fixes"))
        : null,
    quickFixCap: declaredQuickFixCap(sectionLines(text, "## Quick fixes")),
    looseEndsCount:
      sectionLines(text, "## Loose ends").length > 0
        ? listItemCount(sectionLines(text, "## Loose ends"))
        : null,
    grownSections: grownSections(text, section),
  };
  return { parse, hasMarker, cursor };
}

// The template placeholder thread, used by the dead-cursor flag.
export function isPlaceholderThread(thread: string | null): boolean {
  if (thread == null || thread.trim() === "") return true;
  return /^\(name your current focus here\)$/i.test(thread.trim());
}
