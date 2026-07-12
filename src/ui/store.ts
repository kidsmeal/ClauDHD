// One plain store object (the unwoven discipline). Mutate through update(),
// which repaints. No framework, no reactivity, just mutate-then-paint.

import type { Config } from "../core/config.js";
import type { DiffLine } from "../core/diff.js";
import type { Transition } from "../core/history.js";
import type { FleetSnapshot } from "../core/model.js";
import type { RevalidationResult } from "../core/revalidate.js";

export type Route =
  | { view: "fleet" }
  | { view: "detail"; name: string }
  | { view: "settings" }
  | { view: "history"; project: string | null };

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
  // The fire-rate log for the history view. Null until loaded; loading is
  // lazy (first navigation) and refreshed by new appends.
  history: Transition[] | null;
  // Phase 5: capture hotkey armed state (null = unknown/browser), the open
  // launch menu, and the last launcher failure (reported, never swallowed).
  hotkeyArmed: { armed: boolean; combo: string; reason: string | null } | null;
  launchMenuFor: string | null;
  launchError: string | null;
  // The loaded config, for the settings surface. Null until boot loads it.
  config: Config | null;
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
  history: null,
  hotkeyArmed: null,
  launchMenuFor: null,
  launchError: null,
  config: null,
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
