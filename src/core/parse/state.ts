// .now/state.json reader, the ClauDHD 0.9 contract (schemaVersion 1).
// Null sections are legal (checkpoint.js writes null when a source file is
// absent). Unknown fields are ignored: the schema is additive.

import type { CursorFacts, IdeasFacts, RoadmapFacts, ShippedFacts, StateJsonMeta } from "../model.js";

export interface StateJsonParse {
  meta: StateJsonMeta;
  // Cursor facts as state.json carries them; loose ends, quick-fix cap, and
  // grown sections are not in the contract and stay null/[] here.
  cursor: CursorFacts | null;
  ideas: IdeasFacts | null;
  shipped: ShippedFacts | null;
  roadmap: RoadmapFacts | null;
  git: {
    uncommitted: number | null;
    unpushed: number | null;
    lastCommitAt: string | null;
    lastCommitMsg: string | null;
  } | null;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

// null result = unusable (missing, unparseable, or a breaking schema bump);
// the caller falls back to the lenient NOW.md path.
export function parseStateJson(text: string | null): StateJsonParse | null {
  if (text == null) return null;
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(root)) return null;
  if (root["schemaVersion"] !== 1) return null;

  const cursorRaw = root["cursor"];
  const cursor: CursorFacts | null = isObject(cursorRaw)
    ? {
        activeThread: str(cursorRaw["activeThread"]),
        activeThreadLineCount: num(cursorRaw["activeThreadLineCount"]),
        nextAction: str(cursorRaw["nextAction"]),
        lastTouched: str(cursorRaw["lastTouched"]),
        queueCount: num(cursorRaw["queueCount"]),
        quickFixCount: num(cursorRaw["quickFixCount"]),
        quickFixCap: null,
        looseEndsCount: null,
        grownSections: [],
      }
    : null;

  const ideasRaw = root["ideas"];
  const ideas: IdeasFacts | null = isObject(ideasRaw)
    ? {
        total: num(ideasRaw["total"]) ?? 0,
        untriaged: num(ideasRaw["untriaged"]) ?? 0,
        oldestUntriagedDate: str(ideasRaw["oldestUntriagedDate"]),
      }
    : null;

  const shippedRaw = root["shipped"];
  const shipped: ShippedFacts | null = isObject(shippedRaw)
    ? {
        total: num(shippedRaw["total"]) ?? 0,
        lastEntryDate: str(shippedRaw["lastEntryDate"]),
      }
    : null;

  const roadmapRaw = root["roadmap"];
  const roadmap: RoadmapFacts | null = isObject(roadmapRaw)
    ? {
        count: num(roadmapRaw["count"]) ?? 0,
        topItem: str(roadmapRaw["topItem"]),
      }
    : null;

  const gitRaw = root["git"];
  const git = isObject(gitRaw)
    ? {
        uncommitted: num(gitRaw["uncommitted"]),
        unpushed: num(gitRaw["unpushed"]),
        lastCommitAt: str(gitRaw["lastCommitAt"]),
        lastCommitMsg: str(gitRaw["lastCommitMsg"]),
      }
    : null;

  return {
    meta: { generatedAt: str(root["generatedAt"]), branch: str(root["branch"]) },
    cursor,
    ideas,
    shipped,
    roadmap,
    git,
  };
}
