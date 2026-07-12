// One plain store object (the unwoven discipline). Mutate through update(),
// which repaints. No framework, no reactivity, just mutate-then-paint.

import type { DiffLine } from "../core/diff.js";
import type { FleetSnapshot } from "../core/model.js";
import type { RevalidationResult } from "../core/revalidate.js";

export type Route =
  | { view: "fleet" }
  | { view: "detail"; name: string }
  | { view: "settings" };

export interface UiState {
  route: Route;
  snapshot: FleetSnapshot | null;
  scanning: boolean;
  scanError: string | null;
  // Which flag evidence blocks are open, keyed "cardName/flagId". Crit flags
  // are seeded open when a snapshot lands.
  expanded: Set<string>;
  // Where the data came from: "live scan (tauri)" or "frozen scan (dev
  // fixture)". Shown on the provenance line; the dev view never masquerades.
  dataMode: string;
  // Phase 3 residency facts, all shown on the provenance line.
  watcherStartedMs: number | null;
  watching: boolean;
  lastEventMs: number | null;
  lastRevalidation: RevalidationResult | null;
  // The since-last-open diff, computed once per focus gain against the
  // persisted snapshot. Null before the first computation or with no baseline.
  sinceLastOpen: { gap: string; savedAtMs: number; lines: DiffLine[] } | null;
}

export const store: UiState = {
  route: { view: "fleet" },
  snapshot: null,
  scanning: false,
  scanError: null,
  expanded: new Set(),
  dataMode: "no data yet",
  watcherStartedMs: null,
  watching: false,
  lastEventMs: null,
  lastRevalidation: null,
  sinceLastOpen: null,
};

let painter: (() => void) | null = null;

export function onPaint(fn: () => void): void {
  painter = fn;
}

export function update(mutate: (s: UiState) => void): void {
  mutate(store);
  painter?.();
}

export function seedExpandedCrit(snapshot: FleetSnapshot): void {
  for (const card of snapshot.cards) {
    for (const f of card.flags) {
      if (f.severity === "crit") store.expanded.add(`${card.name}/${f.id}`);
    }
  }
}
