// .now/last-session.md, the checkpoint ClauDHD's Stop hook writes after every
// turn. Two lines matter here: "Stopped: YYYY-MM-DD HH:MM" and "Branch: x".

import type { CheckpointFacts } from "../model.js";

export function parseCheckpoint(text: string | null, mtimeMs: number | null): CheckpointFacts | null {
  if (text == null) return null;
  let stoppedAt: string | null = null;
  let branch: string | null = null;
  for (const line of text.split(/\r?\n/)) {
    if (stoppedAt == null) {
      const m = line.match(/^Stopped:\s*(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\s*$/);
      if (m && m[1] !== undefined) stoppedAt = m[1];
    }
    if (branch == null) {
      const m = line.match(/^Branch:\s*(\S+)\s*$/);
      if (m && m[1] !== undefined) branch = m[1];
    }
    if (stoppedAt != null && branch != null) break;
  }
  return { stoppedAt, mtimeMs, branch };
}

// "YYYY-MM-DD HH:MM" (local time, as checkpoint.js stamps it) to epoch ms.
export function checkpointStampMs(stoppedAt: string | null): number | null {
  if (stoppedAt == null) return null;
  const iso = stoppedAt.replace(" ", "T") + ":00";
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}
