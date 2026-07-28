// Which source feeds the card: state.json when present and fresh, the lenient
// NOW.md parse otherwise. The card labels its source either way (trust rule).

import type { CardSource } from "./model.js";

const DAY_MS = 86_400_000;

export function chooseSource(args: {
  stateUsable: boolean;
  stateGeneratedAt: string | null;
  stateMtimeMs: number | null;
  nowMtimeMs: number | null;
  maxLagDays: number;
}): CardSource {
  if (!args.stateUsable) return "now.md";
  const stateMs =
    (args.stateGeneratedAt != null ? Date.parse(args.stateGeneratedAt) : NaN) ||
    (args.stateMtimeMs ?? NaN);
  if (Number.isNaN(stateMs)) return "now.md";
  if (args.nowMtimeMs == null) return "state.json";
  // state.json older than NOW.md's last edit by more than the lag window means
  // the snapshot predates human edits; the parse is the fresher truth.
  if (stateMs < args.nowMtimeMs - args.maxLagDays * DAY_MS) return "now.md";
  return "state.json";
}
