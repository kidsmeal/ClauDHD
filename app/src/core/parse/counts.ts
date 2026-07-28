// Fallback counts for IDEAS.md, SHIPPED.md, ROADMAP.md when a project has no
// usable state.json. Ports the exact regexes of ClauDHD 0.9 state.js
// (ideasFacts, shippedFacts, roadmapFacts) so both paths count identically.

import type { IdeasFacts, RoadmapFacts, ShippedFacts } from "../model.js";

function lines(text: string): string[] {
  return text.split(/\r?\n/);
}

export function parseIdeas(text: string | null): IdeasFacts | null {
  if (text == null) return null;
  let total = 0;
  let untriaged = 0;
  let oldest: string | null = null;
  for (const line of lines(text)) {
    if (/^\s*-\s*\[[ x~]\]/.test(line)) total++;
    if (/^\s*-\s*\[ \]/.test(line)) {
      untriaged++;
      const m = line.match(/^\s*-\s*\[ \]\s*(\d{4}-\d{2}-\d{2})/);
      // YYYY-MM-DD sorts lexically, plain string compare finds the oldest.
      if (m && m[1] !== undefined && (oldest == null || m[1] < oldest)) oldest = m[1];
    }
  }
  return { total, untriaged, oldestUntriagedDate: oldest };
}

export function parseShipped(text: string | null): ShippedFacts | null {
  if (text == null) return null;
  let total = 0;
  let lastEntryDate: string | null = null;
  for (const line of lines(text)) {
    if (/^\s*-\s+\S/.test(line)) total++;
    const m = line.match(/^###\s+(\d{4}-\d{2}-\d{2})/);
    if (m && m[1] !== undefined && lastEntryDate == null) lastEntryDate = m[1];
  }
  return { total, lastEntryDate };
}

// The newest entries with their ### date headers, for the detail feed.
// SHIPPED.md is newest-first (state.js takes the FIRST date header as the
// last entry), so reading top-down collects newest-first too.
export function parseShippedRecent(text: string | null, limit = 5): { date: string | null; text: string }[] {
  if (text == null) return [];
  const out: { date: string | null; text: string }[] = [];
  let currentDate: string | null = null;
  for (const line of lines(text)) {
    const h = line.match(/^###\s+(\d{4}-\d{2}-\d{2})/);
    if (h && h[1] !== undefined) {
      currentDate = h[1];
      continue;
    }
    const m = line.match(/^\s*-\s+(\S.*?)\s*$/);
    if (m && m[1] !== undefined) {
      out.push({ date: currentDate, text: m[1] });
      if (out.length >= limit) break;
    }
  }
  return out;
}

// Body lines of a "## <name>" section, heading excluded, to the next "## ".
function sectionBody(text: string, headingStartsWith: string): string[] {
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
  return ls.slice(start + 1, end);
}

export function parseRoadmap(text: string | null): RoadmapFacts | null {
  if (text == null) return null;
  const next = sectionBody(text, "## Next");
  const later = sectionBody(text, "## Later");
  const open = (l: string) => /^\s*-\s*\[ \]/.test(l);
  const count = next.filter(open).length + later.filter(open).length;
  let topItem: string | null = null;
  for (const l of next) {
    const m = l.match(/^\s*-\s*\[ \]\s*(.+?)\s*$/);
    if (m && m[1]) {
      topItem = m[1];
      break;
    }
  }
  return { count, topItem };
}
