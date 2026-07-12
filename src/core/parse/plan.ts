// Gantry plan discovery and phase progress.
//
// .gantry/active-phase.json is authoritative when present: gantry:build writes
// it before a phase's first edit and completing the phase clears it, so a
// sentinel that has gone old IS an abandoned phase. It carries extra fields
// (files, allow, session); read plan/phase/started, ignore the rest.
//
// Plan files are found by recursive glob (*-plan.md, *.plan.md) skipping the
// configured path segments (archive is in the default set: a stall flag on a
// deliberately retired plan is the wrong-flag case the kill criteria weight
// double). Phase progress reads the **Status:** line vocabulary; checkboxes
// are the fallback unit for plans with no Phase headings.

import type { PlanFacts, PlanPhase, SentinelFacts } from "../model.js";
import type { FileSystem } from "../ports.js";
import { joinPath } from "../ports.js";

const DONE_WORDS = new Set(["committed", "done", "shipped", "complete", "completed"]);

export function parseSentinel(text: string | null, mtimeMs: number | null): SentinelFacts | null {
  if (text == null) return null;
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof root !== "object" || root === null || Array.isArray(root)) return null;
  const rec = root as Record<string, unknown>;
  const plan = typeof rec["plan"] === "string" ? rec["plan"] : null;
  const phase = rec["phase"];
  if (plan == null) return null;
  return {
    plan,
    phase: typeof phase === "string" || typeof phase === "number" ? String(phase) : "?",
    started: typeof rec["started"] === "string" ? rec["started"] : null,
    mtimeMs: mtimeMs ?? 0,
  };
}

function isPlanFileName(name: string): boolean {
  const n = name.toLowerCase();
  return n.endsWith("-plan.md") || n.endsWith(".plan.md");
}

export async function findPlanFiles(
  fs: FileSystem,
  root: string,
  skipSegments: string[],
  maxDepth = 6
): Promise<string[]> {
  const skip = new Set(skipSegments.map((s) => s.toLowerCase()));
  const found: string[] = [];
  async function walk(dir: string, rel: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    const entries = await fs.listDir(dir);
    if (entries == null) return;
    for (const e of entries) {
      if (e.isDir) {
        if (skip.has(e.name.toLowerCase())) continue;
        await walk(joinPath(dir, e.name), rel === "" ? e.name : rel + "/" + e.name, depth + 1);
      } else if (isPlanFileName(e.name)) {
        found.push(rel === "" ? e.name : rel + "/" + e.name);
      }
    }
  }
  await walk(root, "", 0);
  return found.sort();
}

// Phase units are ## Phase headings. A phase is done when its **Status:** line's
// first word is in the done vocabulary; a missing Status line counts not done
// (an unmarked plan is a plan document lying about state, which is what the
// stalled-plan flag polices). Plans with no Phase headings fall back to
// checkbox counting.
export function parsePlanProgress(relFile: string, text: string, mtimeMs: number): PlanFacts {
  const lines = text.split(/\r?\n/);
  interface Block {
    title: string;
    start: number;
  }
  const blocks: Block[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    const m = line.match(/^##\s+(Phase\b.*?)\s*$/i);
    if (m && m[1] !== undefined) blocks.push({ title: m[1], start: i });
  }

  if (blocks.length === 0) {
    const checked = lines.filter((l) => /^\s*-\s*\[x\]/i.test(l)).length;
    const unchecked = lines.filter((l) => /^\s*-\s*\[ \]/.test(l)).length;
    const total = checked + unchecked;
    const phases: PlanPhase[] = [];
    return {
      file: relFile,
      phasesTotal: total,
      phasesDone: checked,
      basis: total > 0 ? "checkbox" : "none",
      mtimeMs,
      commitsSinceMtime: null,
      phases,
    };
  }

  const phases: PlanPhase[] = blocks.map((b, idx) => {
    const end = idx + 1 < blocks.length ? blocks[idx + 1]!.start : lines.length;
    let statusWord: string | null = null;
    for (let i = b.start + 1; i < end; i++) {
      const line = lines[i];
      if (line === undefined) continue;
      if (/^##\s/.test(line)) break;
      const m = line.match(/^\s*\*\*Status:?\*\*:?\s*(.+?)\s*$/i);
      if (m && m[1] !== undefined) {
        const first = m[1].split(/[\s,.;:!-]+/)[0];
        statusWord = first === undefined || first === "" ? null : first.toLowerCase();
        break;
      }
    }
    const done = statusWord != null && DONE_WORDS.has(statusWord);
    return {
      title: b.title,
      done,
      basis: statusWord == null ? "no status line" : `status: ${statusWord}`,
    };
  });

  return {
    file: relFile,
    phasesTotal: phases.length,
    phasesDone: phases.filter((p) => p.done).length,
    basis: "status",
    mtimeMs,
    commitsSinceMtime: null,
    phases,
  };
}
