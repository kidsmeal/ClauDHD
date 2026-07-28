// config.json schema, defaults, and tolerant merge. A missing or partial file
// fills from defaults; unknown keys are kept (forward-compatible, additive).

export interface Thresholds {
  cursorBloatWarn: number;
  cursorBloatCrit: number;
  cursorStaleWarnDays: number;
  cursorStaleCritDays: number;
  unwrappedMinHours: number;
  queueBudget: number;
  quickFixDefaultCap: number;
  looseEndsBudget: number;
  ideasPressureWarn: number;
  ideasPressureCrit: number;
  shippedDroughtDays: number;
  shippedDroughtMinCommits: number;
  uncommittedWarn: number;
  unpushedWarn: number;
  unpushedCrit: number;
  idleDays: number;
  stalledPlanCommits: number;
  stalledPlanDays: number;
  auditStaleDays: number;
  wipSpreadRepos: number;
  hooksDeadLagDays: number;
  recentCommitDays: number;
}

export interface LauncherTemplates {
  resume: string;
  continueLast: string;
  terminalOnly: string;
  openFolder: string;
}

export interface Config {
  roots: string[];
  scanDepth: number;
  ignore: string[];
  stateJsonMaxLagDays: number;
  hotkey: string;
  launcher: LauncherTemplates;
  thresholds: Thresholds;
  // Path segments the plan glob never descends into.
  planSkipSegments: string[];
  // A commit is docs-only when every touched path starts with one of these
  // prefixes or ends in .md (the shipped-drought crit rule).
  droughtDocsPrefixes: string[];
}

export const DEFAULT_CONFIG: Config = {
  roots: ["C:\\Users\\atk67\\Documents"],
  scanDepth: 1,
  ignore: [],
  stateJsonMaxLagDays: 1,
  hotkey: "Ctrl+Alt+A",
  launcher: {
    resume: 'wt -d "{path}" powershell -NoExit -Command claude',
    continueLast: 'wt -d "{path}" powershell -NoExit -Command "claude -c"',
    terminalOnly: 'wt -d "{path}"',
    openFolder: 'explorer "{path}"',
  },
  thresholds: {
    cursorBloatWarn: 40,
    cursorBloatCrit: 80,
    cursorStaleWarnDays: 2,
    cursorStaleCritDays: 5,
    unwrappedMinHours: 3,
    queueBudget: 5,
    quickFixDefaultCap: 3,
    looseEndsBudget: 5,
    ideasPressureWarn: 20,
    ideasPressureCrit: 40,
    shippedDroughtDays: 10,
    shippedDroughtMinCommits: 5,
    uncommittedWarn: 5,
    unpushedWarn: 3,
    unpushedCrit: 10,
    idleDays: 7,
    stalledPlanCommits: 10,
    stalledPlanDays: 7,
    auditStaleDays: 30,
    wipSpreadRepos: 3,
    hooksDeadLagDays: 2,
    recentCommitDays: 7,
  },
  planSkipSegments: [".git", ".now", ".gantry", "node_modules", "dist", "archive"],
  droughtDocsPrefixes: ["design/", "docs/"],
};

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Deep-fill: every key in `base` exists in the result; matching-type values
// from `partial` win; unknown keys in `partial` are carried through untouched.
function fill<T>(base: T, partial: unknown): T {
  if (!isObject(base) || !isObject(partial)) {
    if (partial === undefined || partial === null) return base;
    if (Array.isArray(base)) return (Array.isArray(partial) ? partial : base) as T;
    return (typeof partial === typeof base ? partial : base) as T;
  }
  const out: Record<string, unknown> = { ...partial };
  for (const key of Object.keys(base)) {
    out[key] = fill((base as Record<string, unknown>)[key], partial[key]);
  }
  return out as T;
}

export function mergeConfig(partial: unknown): Config {
  if (!isObject(partial)) return structuredClone(DEFAULT_CONFIG);
  return fill(structuredClone(DEFAULT_CONFIG), partial);
}

export function parseConfigText(text: string | null): Config {
  if (text == null || text.trim() === "") return structuredClone(DEFAULT_CONFIG);
  try {
    return mergeConfig(JSON.parse(text));
  } catch {
    // A broken config file falls back to defaults; the settings surface
    // reports this rather than the app dying at start (phase 5).
    return structuredClone(DEFAULT_CONFIG);
  }
}
