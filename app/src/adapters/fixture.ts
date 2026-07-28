// Dev fixture adapter: loads a frozen scan (public/dev-fleet.json, written by
// `npm run snapshot`) so the UI runs in a plain browser without the shell.
// Provenance says "frozen scan" out loud; this mode never pretends to be live.

import type { FleetSnapshot } from "../core/model.js";

export async function loadFixtureSnapshot(): Promise<FleetSnapshot | null> {
  try {
    const res = await fetch("/dev-fleet.json");
    if (!res.ok) return null;
    const snap = (await res.json()) as FleetSnapshot;
    // Sets do not survive JSON; nothing in FleetSnapshot uses them. Basic
    // shape check so a stale/foreign file fails loud, not weird.
    if (!Array.isArray(snap.cards) || !Array.isArray(snap.untracked)) return null;
    return snap;
  } catch {
    return null;
  }
}
