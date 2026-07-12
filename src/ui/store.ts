// One plain store object (the unwoven discipline). Mutate through update(),
// which repaints. No framework, no reactivity, just mutate-then-paint.

import type { FleetSnapshot } from "../core/model.js";

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
}

export const store: UiState = {
  route: { view: "fleet" },
  snapshot: null,
  scanning: false,
  scanError: null,
  expanded: new Set(),
  dataMode: "no data yet",
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
