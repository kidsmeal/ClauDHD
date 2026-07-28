// The flag engine. Facts in, flags out, evidence always attached. Thresholds
// come from config; severities: crit and warn badge the card, info is a dim
// dot. Every summary follows the vocabulary rule (mechanism words only).

import type { Config } from "./config.js";
import type { Flag, ProjectCard, Severity, UntrackedRepo } from "./model.js";
import { checkpointStampMs } from "./parse/checkpoint.js";
import { isPlaceholderThread } from "./parse/now.js";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

export type CardFacts = Omit<ProjectCard, "flags">;

// Calendar-day arithmetic in local time. Epoch division would drift a day
// across timezones; "2+ days of newer activity" means calendar days as a
// human reads the two dates.
function localDayNumber(ms: number): number {
  const d = new Date(ms);
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS);
}

function dateStrDayNumber(date: string): number | null {
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m || m[1] === undefined || m[2] === undefined || m[3] === undefined) return null;
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS);
}

function parseDateMs(date: string | null): number | null {
  if (date == null) return null;
  const ms = Date.parse(date.length === 10 ? date + "T00:00:00" : date);
  return Number.isNaN(ms) ? null : ms;
}

function endOfDayMs(date: string): number | null {
  const ms = Date.parse(date + "T23:59:59");
  return Number.isNaN(ms) ? null : ms;
}

function flag(id: Flag["id"], severity: Severity, summary: string, evidence: string[], remedy: string | null): Flag {
  return { id, severity, summary, evidence, remedy };
}

export function computeProjectFlags(card: CardFacts, cfg: Config, nowMs: number): Flag[] {
  const t = cfg.thresholds;
  const flags: Flag[] = [];
  const cursor = card.cursor;
  const git = card.git;
  const checkpointMs = card.checkpoint
    ? checkpointStampMs(card.checkpoint.stoppedAt) ?? card.checkpoint.mtimeMs
    : null;
  const lastCommitMs = parseDateMs(git?.lastCommitAt ?? null);

  // cursor bloat
  const lc = cursor?.activeThreadLineCount ?? null;
  if (lc != null && lc > t.cursorBloatWarn) {
    const sev: Severity = lc > t.cursorBloatCrit ? "crit" : "warn";
    const grown = cursor?.grownSections ?? [];
    const evidence = [
      `active thread section: ${lc} lines, budget ${t.cursorBloatWarn}`,
      ...(grown.length > 0 ? [`grown sections: ${grown.slice(0, 6).join(", ")}${grown.length > 6 ? ` (+${grown.length - 6} more)` : ""}`] : []),
    ];
    flags.push(flag("cursor-bloat", sev, `cursor bloat: active thread ${lc} lines`, evidence, "/claudhd:wrap"));
  }

  // cursor stale (with the unwrapped info tier)
  const touched = cursor?.lastTouched ?? null;
  const touchedEnd = touched != null ? endOfDayMs(touched) : null;
  if (touchedEnd != null) {
    const newer: { label: string; ms: number }[] = [];
    if (checkpointMs != null && checkpointMs > touchedEnd) {
      newer.push({ label: `last checkpoint ${card.checkpoint?.stoppedAt ?? "(mtime)"}`, ms: checkpointMs });
    }
    if (lastCommitMs != null && lastCommitMs > touchedEnd) {
      newer.push({ label: `last commit ${git?.lastCommitAt ?? ""}`, ms: lastCommitMs });
    }
    if (newer.length > 0) {
      const newest = newer.reduce((a, b) => (a.ms >= b.ms ? a : b));
      const touchedDay = dateStrDayNumber(touched ?? "") ?? localDayNumber(touchedEnd);
      const gapDays = localDayNumber(newest.ms) - touchedDay;
      const evidence = [`cursor touched ${touched}`, ...newer.map((n) => n.label)];
      if (gapDays >= t.cursorStaleCritDays) {
        flags.push(flag("cursor-stale", "crit", `cursor stale: ${gapDays}d of newer activity`, evidence, "/claudhd:wrap"));
      } else if (gapDays >= t.cursorStaleWarnDays) {
        flags.push(flag("cursor-stale", "warn", `cursor stale: ${gapDays}d of newer activity`, evidence, "/claudhd:wrap"));
      } else if (
        checkpointMs != null &&
        checkpointMs > touchedEnd &&
        nowMs - checkpointMs >= t.unwrappedMinHours * HOUR_MS
      ) {
        flags.push(flag("cursor-stale", "info", "unwrapped: session ended past the cursor date", evidence, "/claudhd:wrap"));
      }
    }
  }

  // dead cursor: activity exists, the thread is the template placeholder
  if (card.parse.status === "ok" && isPlaceholderThread(cursor?.activeThread ?? null)) {
    const hasActivity = checkpointMs != null || lastCommitMs != null;
    if (hasActivity) {
      flags.push(
        flag(
          "dead-cursor",
          "warn",
          "dead cursor: activity without an active thread",
          [
            cursor?.activeThread == null ? "active thread is empty" : "active thread is the template placeholder",
            ...(lastCommitMs != null ? [`last commit ${git?.lastCommitAt ?? ""}`] : []),
            ...(checkpointMs != null ? [`last checkpoint ${card.checkpoint?.stoppedAt ?? "(mtime)"}`] : []),
          ],
          "/claudhd:now"
        )
      );
    }
  }

  // section budgets
  {
    const over: string[] = [];
    const q = cursor?.queueCount ?? null;
    if (q != null && q > t.queueBudget) over.push(`queue ${q}, budget ${t.queueBudget}`);
    const cap = cursor?.quickFixCap ?? t.quickFixDefaultCap;
    const qf = cursor?.quickFixCount ?? null;
    if (qf != null && qf > cap) {
      over.push(`quick fixes ${qf}, cap ${cap}${cursor?.quickFixCap != null ? " (the file's own cap)" : ""}`);
    }
    const le = cursor?.looseEndsCount ?? null;
    if (le != null && le > t.looseEndsBudget) over.push(`loose ends ${le}, budget ${t.looseEndsBudget}`);
    if (over.length > 0) {
      flags.push(flag("section-budgets", "warn", "section budgets exceeded", over, "/claudhd:triage"));
    }
  }

  // ideas pressure
  const untriaged = card.ideas?.untriaged ?? null;
  if (untriaged != null && untriaged > t.ideasPressureWarn) {
    const sev: Severity = untriaged > t.ideasPressureCrit ? "crit" : "warn";
    const evidence = [
      `${untriaged} untriaged of ${card.ideas?.total ?? untriaged} in the inbox`,
      ...(card.ideas?.oldestUntriagedDate != null ? [`oldest untriaged ${card.ideas.oldestUntriagedDate}`] : []),
    ];
    flags.push(flag("ideas-pressure", sev, `ideas pressure: ${untriaged} untriaged`, evidence, "/claudhd:triage"));
  }

  // shipped drought
  if (git != null && git.windowCommits.length >= t.shippedDroughtMinCommits) {
    const lastShipped = card.shipped?.lastEntryDate ?? null;
    const lastShippedMs = lastShipped != null ? endOfDayMs(lastShipped) : null;
    const droughtMs = t.shippedDroughtDays * DAY_MS;
    const inDrought = lastShippedMs == null ? true : nowMs - lastShippedMs > droughtMs;
    if (inDrought) {
      const withPaths = git.windowCommits.filter((c) => c.paths.length > 0);
      const docsOnly =
        withPaths.length > 0 &&
        withPaths.every((c) =>
          c.paths.every(
            (p) => cfg.droughtDocsPrefixes.some((pre) => p.startsWith(pre)) || p.toLowerCase().endsWith(".md")
          )
        );
      const sinceLabel =
        lastShipped != null
          ? `last SHIPPED.md entry ${lastShipped}`
          : card.shipped == null
            ? "no SHIPPED.md found"
            : `no dated entry in SHIPPED.md (${card.shipped.total} entries carry no ### date header)`;
      const evidence = [
        sinceLabel,
        `${git.windowCommits.length} commits in the last ${t.shippedDroughtDays}d`,
        ...git.windowCommits.slice(0, 3).map((c) => `${c.dateIso.slice(0, 10)} ${c.subject}`),
        ...(docsOnly ? ["every commit in the window touches only design/docs paths"] : []),
      ];
      flags.push(
        flag(
          "shipped-drought",
          docsOnly ? "crit" : "warn",
          docsOnly ? "shipped drought: docs-only commits" : "shipped drought",
          evidence,
          "/claudhd:shipped"
        )
      );
    }
  }

  // debt
  if (git != null) {
    const parts: string[] = [];
    let sev: Severity | null = null;
    if (git.uncommitted > t.uncommittedWarn) {
      parts.push(`${git.uncommitted} uncommitted files`);
      sev = "warn";
    }
    if (git.unpushed != null && git.unpushed > t.unpushedWarn) {
      parts.push(`${git.unpushed} unpushed commits`);
      sev = git.unpushed > t.unpushedCrit ? "crit" : sev ?? "warn";
    }
    if (sev != null) {
      flags.push(flag("debt", sev, `debt: ${parts.join(", ")}`, parts, null));
    }
  }

  // idle (info only)
  if (card.lastActivityMs > 0 && nowMs - card.lastActivityMs > t.idleDays * DAY_MS) {
    const days = Math.floor((nowMs - card.lastActivityMs) / DAY_MS);
    flags.push(
      flag("idle", "info", `idle ${days}d`, [`no checkpoint and no commit since ${new Date(card.lastActivityMs).toISOString().slice(0, 10)}`], null)
    );
  }

  // stalled plan
  {
    const offenders: string[] = [];
    if (card.sentinel != null) {
      const startMs = parseDateMs(card.sentinel.started) ?? card.sentinel.mtimeMs;
      if (startMs > 0 && nowMs - startMs > t.stalledPlanDays * DAY_MS) {
        const days = Math.floor((nowMs - startMs) / DAY_MS);
        offenders.push(
          `.gantry/active-phase.json: phase ${card.sentinel.phase} of ${card.sentinel.plan} open ${days}d (gantry:build started it and nothing finished it)`
        );
      }
    }
    for (const p of card.plans) {
      if (p.phasesTotal === 0 || p.phasesDone >= p.phasesTotal) continue;
      const oldByTime = nowMs - p.mtimeMs > t.stalledPlanDays * DAY_MS;
      const movedOn = (p.commitsSinceMtime ?? 0) >= t.stalledPlanCommits;
      if (oldByTime || movedOn) {
        const undone = p.phases.filter((ph) => !ph.done).slice(0, 4);
        const basis =
          p.basis === "checkbox"
            ? `${p.phasesTotal - p.phasesDone} unchecked boxes`
            : undone.map((ph) => `${ph.title} (${ph.basis})`).join("; ");
        offenders.push(
          `${p.file}: ${p.phasesDone}/${p.phasesTotal} phases done, untouched ${Math.floor((nowMs - p.mtimeMs) / DAY_MS)}d${
            p.commitsSinceMtime != null ? `, ${p.commitsSinceMtime} commits since` : ""
          } [${basis}]`
        );
      }
    }
    if (offenders.length > 0) {
      flags.push(
        flag("stalled-plan", "warn", `stalled plan${offenders.length > 1 ? "s" : ""}`, offenders, "/gantry:build to finish the phase, or archive the plan")
      );
    }
  }

  // audit stale (info, only on an otherwise active repo)
  if (
    card.auditMtimeMs != null &&
    nowMs - card.auditMtimeMs > t.auditStaleDays * DAY_MS &&
    card.lastActivityMs > 0 &&
    nowMs - card.lastActivityMs <= t.idleDays * DAY_MS
  ) {
    const days = Math.floor((nowMs - card.auditMtimeMs) / DAY_MS);
    flags.push(flag("audit-stale", "info", `audit ${days}d old`, [`CURRENTNESS_AUDIT.md untouched ${days}d in an active repo`], "/gantry:audit"));
  }

  // hooks not firing: marker present, commits recent, checkpoint absent or old
  if (card.hasMarker && lastCommitMs != null && nowMs - lastCommitMs <= t.recentCommitDays * DAY_MS) {
    const checkpointDead =
      card.checkpoint == null ||
      card.checkpoint.mtimeMs == null ||
      card.checkpoint.mtimeMs < lastCommitMs - t.hooksDeadLagDays * DAY_MS;
    if (checkpointDead) {
      flags.push(
        flag(
          "hooks-not-firing",
          "warn",
          "hooks not firing: no fresh checkpoint despite recent commits",
          [
            `last commit ${git?.lastCommitAt ?? ""}`,
            card.checkpoint == null
              ? ".now/last-session.md missing"
              : `checkpoint mtime ${card.checkpoint.mtimeMs != null ? new Date(card.checkpoint.mtimeMs).toISOString() : "unknown"}`,
            "every other flag on this project is suspect until the checkpoint returns",
          ],
          null
        )
      );
    }
  }

  return flags;
}

export function computeFleetFlags(
  cards: CardFacts[],
  untracked: UntrackedRepo[],
  cfg: Config
): Flag[] {
  const dirty: string[] = [];
  for (const c of cards) if ((c.git?.uncommitted ?? 0) > 0) dirty.push(c.name);
  for (const u of untracked) if (u.uncommitted > 0) dirty.push(u.name);
  if (dirty.length >= cfg.thresholds.wipSpreadRepos) {
    return [
      flag(
        "wip-spread",
        "warn",
        `wip spread: ${dirty.length} repos dirty at once`,
        dirty.map((n) => `${n}: dirty`),
        null
      ),
    ];
  }
  return [];
}
