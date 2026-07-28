// The since-last-open diff: what changed between the persisted snapshot and a
// fresh scan. Facts only, each line traceable to the two snapshots it was
// computed from. The gap is stated out loud when the watcher was down.

import type { FleetSnapshot, ProjectCard } from "./model.js";

export interface DiffLine {
  kind: "+" | "~";
  project: string;
  text: string;
}

function flagKeySet(card: ProjectCard): Map<string, string> {
  const m = new Map<string, string>();
  for (const f of card.flags) m.set(f.id, f.severity);
  return m;
}

export function sinceLastOpen(prev: FleetSnapshot, next: FleetSnapshot): DiffLine[] {
  const lines: DiffLine[] = [];
  const prevByName = new Map(prev.cards.map((c) => [c.name, c]));
  const nextNames = new Set(next.cards.map((c) => c.name));

  for (const card of next.cards) {
    const old = prevByName.get(card.name);
    if (old == null) {
      lines.push({ kind: "+", project: card.name, text: "new project appeared" });
      continue;
    }

    const oldThread = old.cursor?.activeThread ?? null;
    const newThread = card.cursor?.activeThread ?? null;
    if (oldThread !== newThread && newThread != null) {
      lines.push({ kind: "~", project: card.name, text: `cursor moved: ${newThread}` });
    }

    const shippedDelta = (card.shipped?.total ?? 0) - (old.shipped?.total ?? 0);
    if (shippedDelta > 0) {
      lines.push({
        kind: "+",
        project: card.name,
        text: `shipped ${shippedDelta} ${shippedDelta === 1 ? "entry" : "entries"}${card.shipped?.lastEntryDate != null ? ` (last ${card.shipped.lastEntryDate})` : ""}`,
      });
    }

    const ideasDelta = (card.ideas?.untriaged ?? 0) - (old.ideas?.untriaged ?? 0);
    if (ideasDelta > 0) {
      lines.push({ kind: "~", project: card.name, text: `+${ideasDelta} ideas (now ${card.ideas?.untriaged ?? "?"} untriaged)` });
    }

    const oldFlags = flagKeySet(old);
    const newFlags = flagKeySet(card);
    for (const [id, sev] of newFlags) {
      const was = oldFlags.get(id);
      if (was == null) lines.push({ kind: "~", project: card.name, text: `${id} raised (${sev})` });
      else if (was !== sev) lines.push({ kind: "~", project: card.name, text: `${id} ${was} -> ${sev}` });
    }
    for (const id of oldFlags.keys()) {
      if (!newFlags.has(id)) lines.push({ kind: "+", project: card.name, text: `${id} cleared` });
    }
  }

  for (const old of prev.cards) {
    if (!nextNames.has(old.name)) {
      lines.push({ kind: "~", project: old.name, text: "project no longer found under the roots" });
    }
  }

  return lines;
}

// "2 days" / "3h" for the header's SINCE LAST OPEN label.
export function gapLabel(savedAtMs: number, nowMs: number): string {
  const diff = Math.max(0, nowMs - savedAtMs);
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 1) return "under an hour";
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)} days`;
}
