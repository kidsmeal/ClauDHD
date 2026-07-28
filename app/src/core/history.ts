// Flag transitions and the fire-rate log. Every raise, clear, and severity
// move is appended to history.jsonl with the evidence it fired on, so the
// week-two threshold tuning argues from real fire rates, never vibes.

import type { FleetSnapshot, Flag, Severity } from "./model.js";
import { appendHistoryLine, readHistoryLines } from "./persistence.js";
import type { AppStore } from "./ports.js";

export interface Transition {
  atMs: number;
  project: string;
  flagId: string;
  kind: "raised" | "cleared" | "severity";
  from: Severity | null;
  to: Severity | null;
  summary: string;
  evidence: string[];
}

function flagMap(flags: Flag[]): Map<string, Flag> {
  const m = new Map<string, Flag>();
  for (const f of flags) m.set(f.id, f);
  return m;
}

// Transitions between two snapshots, fleet flags included under the project
// name "fleet". Projects absent from either side contribute nothing: a
// vanished project's standing flags are not "cleared", they are unobserved.
export function computeTransitions(prev: FleetSnapshot, next: FleetSnapshot, atMs: number): Transition[] {
  const out: Transition[] = [];

  function compare(project: string, prevFlags: Flag[], nextFlags: Flag[]): void {
    const was = flagMap(prevFlags);
    const now = flagMap(nextFlags);
    for (const [id, f] of now) {
      const old = was.get(id);
      if (old == null) {
        out.push({
          atMs,
          project,
          flagId: id,
          kind: "raised",
          from: null,
          to: f.severity,
          summary: f.summary,
          evidence: f.evidence,
        });
      } else if (old.severity !== f.severity) {
        out.push({
          atMs,
          project,
          flagId: id,
          kind: "severity",
          from: old.severity,
          to: f.severity,
          summary: f.summary,
          evidence: f.evidence,
        });
      }
    }
    for (const [id, old] of was) {
      if (!now.has(id)) {
        out.push({
          atMs,
          project,
          flagId: id,
          kind: "cleared",
          from: old.severity,
          to: null,
          summary: old.summary,
          evidence: old.evidence,
        });
      }
    }
  }

  const prevByName = new Map(prev.cards.map((c) => [c.name, c]));
  for (const card of next.cards) {
    const old = prevByName.get(card.name);
    if (old != null) compare(card.name, old.flags, card.flags);
  }
  compare("fleet", prev.fleetFlags, next.fleetFlags);

  return out;
}

export async function appendTransitions(store: AppStore, transitions: Transition[]): Promise<void> {
  for (const t of transitions) {
    await appendHistoryLine(store, t);
  }
}

function isTransition(v: unknown): v is Transition {
  if (typeof v !== "object" || v == null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r["atMs"] === "number" &&
    typeof r["project"] === "string" &&
    typeof r["flagId"] === "string" &&
    typeof r["kind"] === "string"
  );
}

export async function readTransitions(store: AppStore): Promise<Transition[]> {
  const lines = await readHistoryLines(store);
  return lines.filter(isTransition);
}

// Fire counts per project/flag pair, the tuning pass's raw material.
export interface FireRate {
  project: string;
  flagId: string;
  raised: number;
  cleared: number;
  severityMoves: number;
  lastAtMs: number;
}

export function fireRates(transitions: Transition[]): FireRate[] {
  const rates = new Map<string, FireRate>();
  for (const t of transitions) {
    const key = `${t.project}/${t.flagId}`;
    let r = rates.get(key);
    if (r == null) {
      r = { project: t.project, flagId: t.flagId, raised: 0, cleared: 0, severityMoves: 0, lastAtMs: 0 };
      rates.set(key, r);
    }
    if (t.kind === "raised") r.raised++;
    else if (t.kind === "cleared") r.cleared++;
    else r.severityMoves++;
    if (t.atMs > r.lastAtMs) r.lastAtMs = t.atMs;
  }
  return [...rates.values()].sort((a, b) => b.raised + b.severityMoves - (a.raised + a.severityMoves));
}
