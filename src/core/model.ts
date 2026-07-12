// The core's data shapes. Everything the app shows lives in a FleetSnapshot;
// everything in a FleetSnapshot was read from disk or git at a stated moment.

export type Severity = "crit" | "warn" | "info";

export type FlagId =
  | "cursor-bloat"
  | "cursor-stale"
  | "dead-cursor"
  | "section-budgets"
  | "ideas-pressure"
  | "shipped-drought"
  | "debt"
  | "idle"
  | "stalled-plan"
  | "audit-stale"
  | "hooks-not-firing"
  | "wip-spread";

export interface Flag {
  id: FlagId;
  severity: Severity;
  // One-line statement of the fact, vocabulary rules apply.
  summary: string;
  // The lines/dates/commits the number was computed from. Never empty:
  // a flag without evidence is a review FAIL.
  evidence: string[];
  // The ClauDHD/Gantry command that remedies it, when one exists.
  remedy: string | null;
}

// Cursor facts merged from state.json (fast path) and the NOW.md parse
// (loose ends, quick-fix cap, and grown sections are never in state.json).
export interface CursorFacts {
  activeThread: string | null;
  activeThreadLineCount: number | null;
  nextAction: string | null;
  lastTouched: string | null; // YYYY-MM-DD
  queueCount: number | null;
  quickFixCount: number | null;
  quickFixCap: number | null; // the cap the file itself declares, null if undeclared
  looseEndsCount: number | null;
  // ## headings that are not in the ClauDHD template, plus ### subheads
  // inside the active thread: the bloat evidence.
  grownSections: string[];
}

export interface IdeasFacts {
  total: number;
  untriaged: number;
  oldestUntriagedDate: string | null;
}

export interface ShippedFacts {
  total: number;
  lastEntryDate: string | null;
}

export interface RoadmapFacts {
  count: number;
  topItem: string | null;
}

export interface CommitInfo {
  hash: string;
  dateIso: string; // committer date, ISO 8601
  subject: string;
  paths: string[];
}

export interface GitFacts {
  branch: string | null;
  uncommitted: number;
  unpushed: number | null; // null = no upstream
  lastCommitAt: string | null; // ISO 8601
  lastCommitMsg: string | null;
  // Commits inside the shipped-drought window, with touched paths.
  windowCommits: CommitInfo[];
}

// .now/last-session.md, written by ClauDHD's Stop hook after every turn.
export interface CheckpointFacts {
  stoppedAt: string | null; // "YYYY-MM-DD HH:MM" from the "Stopped:" line
  mtimeMs: number | null;
  branch: string | null;
}

export interface PlanPhase {
  title: string;
  done: boolean;
  basis: string; // "status: committed", "no status line", "checkbox", ...
}

export interface PlanFacts {
  file: string; // path relative to the project root
  phasesTotal: number;
  phasesDone: number;
  basis: "status" | "checkbox" | "none";
  mtimeMs: number;
  commitsSinceMtime: number | null;
  phases: PlanPhase[];
}

// .gantry/active-phase.json: written by gantry:build before a phase's first
// edit, cleared when the phase completes. Old sentinel = abandoned phase.
export interface SentinelFacts {
  plan: string;
  phase: string;
  started: string | null;
  mtimeMs: number;
}

export type ParseStatus =
  | { status: "ok" }
  | { status: "raw-fallback"; reason: string; raw: string };

export type CardSource = "state.json" | "now.md";

export interface StateJsonMeta {
  generatedAt: string | null;
  branch: string | null;
}

export interface ProjectCard {
  name: string; // folder name
  path: string;
  title: string | null; // first H1 of CLAUDE.md, null when absent
  hasMarker: boolean;
  source: CardSource;
  parse: ParseStatus;
  cursor: CursorFacts | null;
  ideas: IdeasFacts | null;
  shipped: ShippedFacts | null;
  roadmap: RoadmapFacts | null;
  git: GitFacts | null;
  checkpoint: CheckpointFacts | null;
  stateJson: StateJsonMeta | null; // null when no state.json on disk
  plans: PlanFacts[];
  sentinel: SentinelFacts | null;
  auditMtimeMs: number | null; // docs/CURRENTNESS_AUDIT.md or root fallback
  flags: Flag[];
  // max(checkpoint mtime, last commit time): drives sort order and the
  // freshness dot. 0 when nothing is known.
  lastActivityMs: number;
}

export interface UntrackedRepo {
  name: string;
  path: string;
  uncommitted: number;
  unpushed: number | null;
}

export interface FleetSnapshot {
  scannedAtMs: number;
  roots: string[];
  cards: ProjectCard[];
  untracked: UntrackedRepo[];
  fleetFlags: Flag[];
}
