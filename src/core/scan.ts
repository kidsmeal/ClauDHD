// The core's public entry: discover projects under the roots, read every
// source, choose precedence, compute flags, return one FleetSnapshot.

import type { Config } from "./config.js";
import { computeFleetFlags, computeProjectFlags, type CardFacts } from "./flags.js";
import { countCommitsSince, readGitFacts, readShelfGit } from "./git.js";
import type { CursorFacts, FleetSnapshot, ProjectCard, UntrackedRepo } from "./model.js";
import { parseCheckpoint, checkpointStampMs } from "./parse/checkpoint.js";
import { parseIdeas, parseRoadmap, parseShipped } from "./parse/counts.js";
import { parseNow } from "./parse/now.js";
import { findPlanFiles, parsePlanProgress, parseSentinel } from "./parse/plan.js";
import { parseStateJson } from "./parse/state.js";
import type { Clock, FileSystem, GitRunner } from "./ports.js";
import { joinPath } from "./ports.js";
import { chooseSource } from "./precedence.js";

export interface ScanDeps {
  fs: FileSystem;
  git: GitRunner;
  clock: Clock;
}

function firstH1(text: string | null): string | null {
  if (text == null) return null;
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^#\s+(.+?)\s*$/);
    if (m && m[1] !== undefined) return m[1];
  }
  return null;
}

async function buildCard(deps: ScanDeps, cfg: Config, path: string, name: string, nowText: string): Promise<ProjectCard> {
  const { fs, git } = deps;
  const nowMs = deps.clock.nowMs();

  const nowParsed = parseNow(nowText);
  const nowMtimeMs = await fs.mtimeMs(joinPath(path, "NOW.md"));

  const statePath = joinPath(path, ".now", "state.json");
  const stateText = await fs.readText(statePath);
  const state = parseStateJson(stateText);
  const stateMtimeMs = stateText != null ? await fs.mtimeMs(statePath) : null;

  const source = chooseSource({
    stateUsable: state != null,
    stateGeneratedAt: state?.meta.generatedAt ?? null,
    stateMtimeMs,
    nowMtimeMs,
    maxLagDays: cfg.stateJsonMaxLagDays,
  });

  // Cursor: the chosen source's facts, plus the reads only NOW.md carries
  // (quick-fix cap, loose ends, grown sections).
  let cursor: CursorFacts | null = null;
  if (source === "state.json" && state?.cursor != null) {
    cursor = {
      ...state.cursor,
      quickFixCap: nowParsed?.cursor.quickFixCap ?? null,
      looseEndsCount: nowParsed?.cursor.looseEndsCount ?? null,
      grownSections: nowParsed?.cursor.grownSections ?? [],
    };
  } else if (nowParsed != null) {
    cursor = nowParsed.cursor;
  }

  const ideas =
    source === "state.json" && state?.ideas != null
      ? state.ideas
      : parseIdeas(await fs.readText(joinPath(path, "IDEAS.md")));
  const shipped =
    source === "state.json" && state?.shipped != null
      ? state.shipped
      : parseShipped(await fs.readText(joinPath(path, "SHIPPED.md")));
  const roadmap =
    source === "state.json" && state?.roadmap != null
      ? state.roadmap
      : parseRoadmap(await fs.readText(joinPath(path, "ROADMAP.md")));

  const gitFacts = await readGitFacts(git, path, cfg.thresholds.shippedDroughtDays);

  const checkpointPath = joinPath(path, ".now", "last-session.md");
  const checkpoint = parseCheckpoint(await fs.readText(checkpointPath), await fs.mtimeMs(checkpointPath));

  const sentinelPath = joinPath(path, ".gantry", "active-phase.json");
  const sentinel = parseSentinel(await fs.readText(sentinelPath), await fs.mtimeMs(sentinelPath));

  const planFiles = await findPlanFiles(fs, path, cfg.planSkipSegments);
  const plans = [];
  for (const rel of planFiles) {
    const text = await fs.readText(joinPath(path, rel));
    if (text == null) continue;
    const mtime = (await fs.mtimeMs(joinPath(path, rel))) ?? 0;
    const progress = parsePlanProgress(rel, text, mtime);
    progress.commitsSinceMtime = mtime > 0 ? await countCommitsSince(git, path, mtime) : null;
    plans.push(progress);
  }

  const auditDocs = joinPath(path, "docs", "CURRENTNESS_AUDIT.md");
  const auditRoot = joinPath(path, "CURRENTNESS_AUDIT.md");
  const auditMtimeMs = (await fs.mtimeMs(auditDocs)) ?? (await fs.mtimeMs(auditRoot));

  const title = firstH1(await fs.readText(joinPath(path, "CLAUDE.md")));

  const checkpointMs = checkpoint ? checkpointStampMs(checkpoint.stoppedAt) ?? checkpoint.mtimeMs ?? 0 : 0;
  const lastCommitMs = gitFacts?.lastCommitAt != null ? Date.parse(gitFacts.lastCommitAt) || 0 : 0;
  const lastActivityMs = Math.max(checkpointMs ?? 0, lastCommitMs);

  const facts: CardFacts = {
    name,
    path,
    title,
    hasMarker: nowParsed?.hasMarker ?? false,
    source,
    parse: nowParsed?.parse ?? { status: "raw-fallback", reason: "NOW.md unreadable", raw: "" },
    cursor,
    ideas,
    shipped,
    roadmap,
    git: gitFacts,
    checkpoint,
    stateJson: state?.meta ?? null,
    plans,
    sentinel,
    auditMtimeMs,
    lastActivityMs,
  };

  return { ...facts, flags: computeProjectFlags(facts, cfg, nowMs) };
}

export async function scanFleet(deps: ScanDeps, cfg: Config): Promise<FleetSnapshot> {
  const { fs, git, clock } = deps;
  const cards: ProjectCard[] = [];
  const untracked: UntrackedRepo[] = [];
  const ignore = new Set(cfg.ignore.map((s) => s.toLowerCase()));

  // A dir that qualifies (marked or git) is a project and is never descended
  // into; only unqualified dirs are walked further, to cfg.scanDepth levels.
  // Nested projects display their root-relative path so names stay unambiguous.
  const maxDepth = Math.max(1, cfg.scanDepth);
  async function walk(dir: string, relPrefix: string, depth: number): Promise<void> {
    const entries = (await fs.listDir(dir)) ?? [];
    for (const e of entries) {
      if (!e.isDir) continue;
      if (ignore.has(e.name.toLowerCase())) continue;
      const p = joinPath(dir, e.name);
      const displayName = relPrefix === "" ? e.name : relPrefix + "/" + e.name;
      const nowText = await fs.readText(joinPath(p, "NOW.md"));
      const marked = nowText != null && nowText.includes("<!-- claudhd");
      if (marked && nowText != null) {
        cards.push(await buildCard(deps, cfg, p, displayName, nowText));
        continue;
      }
      if (await fs.exists(joinPath(p, ".git"))) {
        const shelf = await readShelfGit(git, p);
        untracked.push({ name: displayName, path: p, uncommitted: shelf.uncommitted, unpushed: shelf.unpushed });
        continue;
      }
      // NOW.md without the marker and no .git: discovered, shown nowhere.
      if (depth < maxDepth) await walk(p, displayName, depth + 1);
    }
  }
  for (const root of cfg.roots) {
    await walk(root, "", 1);
  }

  cards.sort((a, b) => b.lastActivityMs - a.lastActivityMs);
  untracked.sort((a, b) => a.name.localeCompare(b.name));

  return {
    scannedAtMs: clock.nowMs(),
    roots: cfg.roots,
    cards,
    untracked,
    fleetFlags: computeFleetFlags(cards, untracked, cfg),
  };
}
