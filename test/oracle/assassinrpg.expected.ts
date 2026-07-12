// The hand-checked expectations for assassinrpg, the phase-1 acceptance
// oracle. Kept intentionally narrow: facts that are stable while the repo
// lives its life. The non-negotiable anchor is cursor-bloat crit (the
// motivating exhibit: active-thread section ~170 lines against budget 40,
// over the 80 crit line; the file is 251 lines and that number must NOT be
// what the flag reports).

import type { ProjectCard } from "../../src/core/model.js";

export function oracle(card: ProjectCard | undefined): string[] {
  const failures: string[] = [];
  if (card == null) return ["assassinrpg card missing from the scan"];

  if (card.parse.status !== "ok") failures.push(`parse expected ok, got ${card.parse.status}`);
  if (!card.hasMarker) failures.push("claudhd marker not detected");

  const lc = card.cursor?.activeThreadLineCount ?? -1;
  if (lc < 140 || lc > 200) {
    failures.push(`activeThreadLineCount expected ~170 (140..200), got ${lc}`);
  }
  if (lc >= 240) {
    failures.push(`activeThreadLineCount ${lc} looks like the whole file, the 251-conflation bug`);
  }

  const bloat = card.flags.find((f) => f.id === "cursor-bloat");
  if (bloat == null) failures.push("cursor-bloat flag missing");
  else if (bloat.severity !== "crit") failures.push(`cursor-bloat expected crit, got ${bloat.severity}`);
  else if (!bloat.evidence.some((e) => e.includes(String(lc)))) {
    failures.push("cursor-bloat evidence does not cite the measured line count");
  }

  if (card.cursor?.activeThread == null || !/loom/i.test(card.cursor.activeThread)) {
    failures.push(`active thread expected to name the Loom, got: ${card.cursor?.activeThread ?? "(none)"}`);
  }

  if (card.title == null || !/unwoven/i.test(card.title)) {
    failures.push(`title expected from CLAUDE.md h1 (the unwoven), got: ${card.title ?? "(none)"}`);
  }

  return failures;
}
