// Shared view bits: escaping, severity badges, flag blocks with their
// evidence, freshness dots, relative times. Every number a flag shows keeps
// its evidence one click away; that is the trust rule as markup.

import type { Flag, ProjectCard } from "../../core/model.js";

export function esc(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function sevBadge(sev: Flag["severity"]): string {
  if (sev === "crit") return '<span class="badge crit">[!!!]</span>';
  if (sev === "warn") return '<span class="badge warn">[!!]</span>';
  return '<span class="badge info">[!]</span>';
}

// The evidence block toggles on the summary line. data-toggle-flag carries
// the "card/flagId" key the store's expanded set uses.
export function flagBlock(cardName: string, f: Flag, expanded: Set<string>): string {
  const key = `${cardName}/${f.id}`;
  const open = expanded.has(key);
  const evidence = f.evidence.map((e) => `<div class="ev-line">${esc(e)}</div>`).join("");
  const remedy = f.remedy != null ? `<div class="ev-line remedy">run ${esc(f.remedy)}</div>` : "";
  return `
    <div class="flag sev-${f.severity}">
      <button class="flag-summary" data-toggle-flag="${esc(key)}">
        ${sevBadge(f.severity)} <span class="flag-id">${esc(f.id)}</span> ${esc(f.summary)}
        <span class="toggle-hint">${open ? "[hide]" : "[show]"}</span>
      </button>
      <div class="evidence" ${open ? "" : "hidden"}>${evidence}${remedy}</div>
    </div>`;
}

const DAY_MS = 86_400_000;

function localDayNumber(ms: number): number {
  const d = new Date(ms);
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS);
}

// ● active today, ◐ this week, ○ older (calendar days, matching the design).
export function freshnessDot(lastActivityMs: number, nowMs: number): string {
  if (lastActivityMs <= 0) return "○";
  const gap = localDayNumber(nowMs) - localDayNumber(lastActivityMs);
  if (gap <= 0) return "●";
  if (gap < 7) return "◐";
  return "○";
}

export function relTime(ms: number, nowMs: number): string {
  if (ms <= 0) return "never";
  const diff = nowMs - ms;
  if (diff < 3_600_000) return "just now";
  if (diff < DAY_MS) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / DAY_MS)}d ago`;
}

export function debtLabel(card: ProjectCard): string {
  const g = card.git;
  if (g == null) return "no git";
  const dirty = g.uncommitted === 0 ? "clean tree" : `dirty ${g.uncommitted}`;
  const up = g.unpushed == null ? "no upstream" : `↑${g.unpushed}`;
  return `${dirty} · ${up}`;
}

export function sevCounts(card: ProjectCard): { crit: number; warn: number; info: number } {
  return {
    crit: card.flags.filter((f) => f.severity === "crit").length,
    warn: card.flags.filter((f) => f.severity === "warn").length,
    info: card.flags.filter((f) => f.severity === "info").length,
  };
}
