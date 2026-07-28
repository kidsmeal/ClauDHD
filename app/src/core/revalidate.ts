// Focus revalidation. Windows file watchers drop events; on every window
// focus the app rescans and reconciles, and the provenance line reports the
// result honestly: "revalidated clean" or what it found.

import { sinceLastOpen, type DiffLine } from "./diff.js";
import type { FleetSnapshot } from "./model.js";

export interface RevalidationResult {
  atMs: number;
  clean: boolean;
  changes: DiffLine[];
}

export function revalidate(current: FleetSnapshot, fresh: FleetSnapshot, atMs: number): RevalidationResult {
  const changes = sinceLastOpen(current, fresh);
  return { atMs, clean: changes.length === 0, changes };
}

export function revalidationLabel(r: RevalidationResult | null): string {
  if (r == null) return "not yet revalidated";
  const t = new Date(r.atMs).toLocaleTimeString();
  return r.clean ? `revalidated clean ${t}` : `revalidated ${t}: reconciled ${r.changes.length} change${r.changes.length === 1 ? "" : "s"}`;
}
