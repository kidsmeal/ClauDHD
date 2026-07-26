"use strict";
/*
 * reconcile.js - the commit boundary reconcile (design section 5, phase 4).
 *
 * reconcile(root, message, sessionId, willClearBuild) is called from
 * commit-guard.js's PreToolUse hook, synchronously, BEFORE the intercepted
 * `git commit` Bash call executes. At that instant the commit message is
 * available in the command string but the commit itself has not landed yet,
 * so every artifact here reflects "about to ship" facts, never a commit hash
 * (design section 5: SHIPPED.md entries carry message and date, never a
 * hash).
 *
 * `willClearBuild` (commit-guard.js's commandClearsSentinelBeforeCommit()):
 * true when the SAME command string also carries a sentinel-clear invocation
 * BEFORE the commit (the real pipeline's shape: `node .../sentinel.js clear
 * && git add -A && git commit ...`). At hook time state.json's `build`
 * section is still pre-clear, but the clear is about to become real within
 * this same Bash call - rendering NOW.md from the still-active build would
 * commit a NOW.md that immediately disagrees with the post-clear
 * state.json. So `willClearBuild` nulls `build` for THE RENDER ONLY; the
 * phase-status line flip and the roadmap item's move still use the real,
 * pre-clear `build` unconditionally - the phase IS completing in this
 * commit, independent of how NOW.md is rendered.
 *
 * Adoption gate: a claudhd-marked NOW.md is necessary but NOT sufficient.
 * Every pre-1.0 project on a fleet that has run an older /claudhd:init has
 * that same marker, so marker-only activation would regenerate (overwrite)
 * their hand-written cursors on their very next commit. The gate additionally
 * requires the plan's B1 activation signal specifically: `.now/enabled`,
 * written by /claudhd:init's explicit 1.0 opt-in step. The legacy
 * `.gantry/enabled` is NOT a reconcile signal - B1's own text says legacy
 * projects "stay enforced", not "get reconciled": that marker is honored ONLY
 * by the guards' enforcement gating (commit-guard.js's computeGate() and
 * file-list-guard.js), never here. A project carrying the NOW.md marker plus
 * `.gantry/enabled` alone (no `.now/enabled`) may still be denied commits by
 * an enforcing guard, but is NOT adopted for reconcile and is left
 * byte-untouched by this function - enforcement and reconciliation are two
 * independent gates that happen to share one of their two possible signals.
 *
 * A STALE build sentinel (readSentinel/isStale's own definition: a different
 * session, abandoned 6+ hours) is never used to mark a plan phase committed
 * or move a roadmap item to Shipped - the guard fails open on a stale
 * sentinel (allows the commit through), but an unrelated commit made after a
 * phase was abandoned must not be misattributed as finishing it. NOW.md/
 * SHIPPED.md/state.json still regenerate normally either way.
 *
 * Caller contract: the caller (commit-guard.js) must invoke this only when
 * the intercepted commit is NOT about to be denied - a denied (mid-build,
 * never-actually-committed) attempt must never be recorded as shipped. The
 * caller must also wrap the call and swallow any throw: this function does
 * not catch its own errors, so a partial failure surfaces to the caller's
 * error log rather than silently vanishing (the reconcile-failure contract
 * lives in commit-guard.js, not here).
 *
 * `message === null` means the subject was genuinely unavailable at hook
 * time (commit-guard.js's extractCommitMessage(): an interactive editor
 * commit, `-F -` piping the message via stdin, or any other unparsed form) -
 * never guessed. Every OTHER artifact still regenerates normally; only the
 * SHIPPED.md entry is skipped, and the skip is logged to .now/reconcile.log
 * (the same file commit-guard.js's own failure log uses) so it is visible
 * rather than silently missing.
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const { buildState, writeStateAtomic, readState, cursorFacts, ideasFacts, issueRoadmapIds } = require("./state.js");
const { render } = require("./nowrender.js");
const { appendEntry } = require("./shipped.js");
const { isStale } = require("./sentinel-core.js");

// The facts-only keys buildState() ever produces - mirrors checkpoint.js's
// STOP_HOOK_OWNED_KEYS exactly, named explicitly (not read off buildState's
// shape) so a future field added there can't silently start clobbering
// another writer's section (mode/build/design/intent/roadmapIds) through
// this call site.
const RECONCILE_FACTS_KEYS = [
  "schemaVersion", "generatedAt", "branch", "cursor", "ideas", "shipped", "roadmap", "git",
];

const PHASE_HEADING_RE = /^##\s+Phase\s+(\d+)\b/;
const ITEM_SECTIONS = ["## Next", "## Later"];
const SHIPPED_HEADING = "## Shipped";

function readOrNull(p) {
  try { return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null; } catch { return null; }
}

// The plan's B1 activation signal for RECONCILE specifically - see this
// file's header comment. `.gantry/enabled` is deliberately NOT checked here:
// it stays the guards' own enforcement marker only, never a reconcile signal.
function hasActivationMarker(root) {
  try { return fs.existsSync(path.join(root, ".now", "enabled")); } catch { return false; }
}

function todayDate() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// A note that is NOT a failure - logged to the same file commit-guard.js's
// own reconcile-failure log uses, so both are visible in one place. Never
// throws: logging itself must not become a new failure mode.
function logReconcileNote(root, text) {
  try {
    const nowDir = path.join(root, ".now");
    fs.mkdirSync(nowDir, { recursive: true });
    fs.appendFileSync(path.join(nowDir, "reconcile.log"), new Date().toISOString() + " " + text + "\n");
  } catch {
    // Best-effort; never throw out of a logging call.
  }
}

function git(root, args) {
  try {
    return execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      timeout: 20000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function planPhaseInfo(planText) {
  const lines = planText.split(/\r?\n/);
  const phases = [];
  for (let i = 0; i < lines.length; i++) {
    const m = PHASE_HEADING_RE.exec(lines[i]);
    if (m) phases.push({ number: Number(m[1]), headingIdx: i });
  }
  return { lines, phases };
}

function maxPhaseNumber(planText) {
  const { phases } = planPhaseInfo(planText);
  return phases.reduce((max, p) => Math.max(max, p.number), 0);
}

// Any of templates/PLAN.md's pre-commit statuses - the ones a phase actually
// carries by the time a real commit reaches this interception point. The
// relay sets `built` after implementation and `ready to commit` after review
// PASS (this repo's own plan uses `built`; the pipeline template's phrasing
// is `ready to commit`) - `pending` alone would never fire in real use, since
// a phase is never still `pending` once work on it has shipped.
const PRECOMMIT_STATUS_RE = /^(\*\*Status:\*\*\s*)(pending|built|ready to commit)\b/i;

// Flip phase `phaseNumber`'s **Status:** line from any pre-commit status (see
// PRECOMMIT_STATUS_RE) to "committed (<date>)" - the one transition
// templates/PLAN.md documents as mechanical ("Updated by the relay at each
// transition, never by the implementer"). Only the matched status word is
// replaced (the regex is not end-anchored), so any trailing parenthetical the
// line already carries survives untouched after the new one. Idempotent: a
// Status line that is already "committed" (or "in review"/"review failed",
// neither of which this function's caller should ever see at a real commit)
// matches nothing and is left alone.
function markPhaseCommitted(planText, phaseNumber, date) {
  const { lines, phases } = planPhaseInfo(planText);
  const idx = phases.findIndex((p) => p.number === phaseNumber);
  if (idx === -1) return { text: planText, changed: false };

  const start = phases[idx].headingIdx + 1;
  const end = idx + 1 < phases.length ? phases[idx + 1].headingIdx : lines.length;

  for (let i = start; i < end; i++) {
    const m = PRECOMMIT_STATUS_RE.exec(lines[i]);
    if (m) {
      lines[i] = lines[i].replace(PRECOMMIT_STATUS_RE, "$1committed (" + date + ")");
      return { text: lines.join("\n"), changed: true };
    }
  }
  return { text: planText, changed: false };
}

function findRoadmapItemLine(lines, id) {
  const idRe = new RegExp("`" + id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "`\\s*$");
  let section = null;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (/^##\s/.test(trimmed)) { section = trimmed; continue; }
    if (section && ITEM_SECTIONS.some((h) => section.startsWith(h)) && idRe.test(lines[i])) {
      return i;
    }
  }
  return -1;
}

function findShippedHeadingLine(lines) {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith(SHIPPED_HEADING)) return i;
  }
  return -1;
}

// Move the roadmap item carrying `id` out of Next/Later and into Shipped
// (templates/ROADMAP.md: "Move an intent here when its work lands"), "newest
// first" - inserted as the first bullet after the heading. Strips only the
// leading checkbox marker; the rest of the line, including the trailing
// backtick-id roadmapids.js's ownId() requires at line-end, is untouched. A
// no-op (unchanged text) when the id or a Shipped heading is not found.
function moveRoadmapItemToShipped(roadmapText, id) {
  const lines = roadmapText.split(/\r?\n/);
  const itemIdx = findRoadmapItemLine(lines, id);
  const shippedIdx = findShippedHeadingLine(lines);
  if (itemIdx === -1 || shippedIdx === -1) return { text: roadmapText, changed: false };

  const plain = lines[itemIdx].replace(/^(\s*-\s*)\[[ x~]\]\s*/, "$1");
  lines.splice(itemIdx, 1);

  const headingIdx = itemIdx < shippedIdx ? shippedIdx - 1 : shippedIdx;
  let insertAt = headingIdx + 1;
  while (insertAt < lines.length && lines[insertAt].trim() === "") insertAt++;
  lines.splice(insertAt, 0, plain);

  return { text: lines.join("\n"), changed: true };
}

function reconcile(root, message, sessionId, willClearBuild) {
  const nowMdPath = path.join(root, "NOW.md");
  const nowText = readOrNull(nowMdPath);
  if (nowText == null || !nowText.includes("<!-- claudhd") || !hasActivationMarker(root)) {
    return { skipped: true, reason: "not adopted" };
  }

  const nowDir = path.join(root, ".now");
  const prior = readState(nowDir) || {};
  const build = prior.build || null;
  const from = prior.from != null ? prior.from : null;
  const date = todayDate();
  const writtenPaths = [];

  // 1. SHIPPED.md - message + date, never a hash (the commit has not
  //    happened yet at this interception point). Skipped, not guessed, when
  //    the subject was genuinely unavailable (see this file's header
  //    comment) - every other artifact below still regenerates.
  if (message != null) {
    appendEntry(root, message, date);
    writtenPaths.push("SHIPPED.md");
  } else {
    logReconcileNote(root, "SHIPPED entry skipped: commit message unavailable at hook time (interactive editor commit, -F -, or an unparsed form)");
  }

  // 2a. Backfill ROADMAP.md's ids on EVERY adopted reconcile, whenever the
  //     file exists - independent of whether a build phase is active or at
  //     its final phase. A legacy, pre-1.0 ROADMAP.md carries no ids yet;
  //     waiting for a final-phase commit to backfill it would mean an
  //     ordinary mid-plan commit (or one with no active plan at all) never
  //     trues it up, and `from`'s lookup below is by id and would never
  //     resolve. Goes through the ONE locked issuance path (state.js's
  //     issueRoadmapIds, which also persists the durable ledger and writes
  //     ROADMAP.md itself when changed). No-op (changed: false) once every
  //     item already carries an id.
  const roadmapPath = path.join(root, "ROADMAP.md");
  let roadmapText = readOrNull(roadmapPath);
  if (roadmapText != null) {
    const { text: backfilledText, changed: idsChanged } = issueRoadmapIds(nowDir, roadmapPath, new Date());
    if (idsChanged) {
      roadmapText = backfilledText;
      writtenPaths.push("ROADMAP.md");
    }
  }

  // 2b. The active plan's per-phase Status line, and (only at the plan's
  //     final phase) the roadmap item's state. Both are keyed off the still-
  //     open, non-stale `build` sentinel - null once a phase has already been
  //     cleared by an earlier, separate `sentinel.js clear` Bash call (this
  //     reconcile's header comment); stale rather than null when a phase was
  //     abandoned (see the header comment's stale-sentinel note). A commit
  //     with no usable active plan simply skips this step.
  const buildIsUsable = build != null && !isStale(build, sessionId);
  if (buildIsUsable && build.plan) {
    const planAbsPath = path.isAbsolute(build.plan) ? build.plan : path.join(root, build.plan);
    const planText = readOrNull(planAbsPath);
    if (planText != null) {
      const { text: newPlanText, changed: planChanged } = markPhaseCommitted(planText, build.phase, date);
      if (planChanged) {
        fs.writeFileSync(planAbsPath, newPlanText);
        writtenPaths.push(path.relative(root, planAbsPath).replace(/\\/g, "/"));
      }

      const isFinalPhase = build.phase === maxPhaseNumber(planText);
      if (isFinalPhase && from && roadmapText != null) {
        const { text: movedText, changed: moveChanged } = moveRoadmapItemToShipped(roadmapText, from);
        if (moveChanged) {
          roadmapText = movedText;
          fs.writeFileSync(roadmapPath, roadmapText);
          if (!writtenPaths.includes("ROADMAP.md")) writtenPaths.push("ROADMAP.md");
        }
      }
    }
  }

  // 3. Regenerate NOW.md from state (design section 4 / phase 3's renderer).
  //    cursor facts are parsed from the OLD NOW.md - the Queue/Quick-fixes/
  //    Loose-ends sections carry forward verbatim, so their counts are
  //    unchanged by this regeneration; lastTouched is stamped to today since
  //    this write is literally touching the file now.
  const cursor = Object.assign({}, cursorFacts(nowText) || {}, { lastTouched: date });
  const ideasText = readOrNull(path.join(root, "IDEAS.md"));
  // willClearBuild: render as post-clear (idle build) even though `build`
  // (used above, unconditionally, for the Status line / roadmap move) is
  // still the real pre-clear value - see this file's header comment.
  const renderBuild = willClearBuild ? null : build;
  const renderState = {
    mode: prior.mode != null ? prior.mode : null,
    from,
    build: renderBuild,
    design: prior.design || null,
    intent: prior.intent || null,
    cursor,
    ideas: ideasFacts(ideasText),
    now: nowText,
  };
  const newNowText = render(renderState);
  fs.writeFileSync(nowMdPath, newNowText);
  writtenPaths.push("NOW.md");

  // 4. Regenerate state.json's facts-only sections - never build/mode/design/
  //    intent/roadmapIds, which belong to other writers (state.js).
  const branch = git(root, ["rev-parse", "--abbrev-ref", "HEAD"]) || null;
  const changedFiles = git(root, ["diff", "--name-only", "HEAD"]);
  const untracked = git(root, ["ls-files", "--others", "--exclude-standard"]);
  const own = new Set(["NOW.md", "IDEAS.md", "SHIPPED.md", "ROADMAP.md"]);
  const dirty = new Set(
    (changedFiles + "\n" + untracked)
      .split(/\r?\n/)
      .map((p) => p.trim())
      .filter(Boolean)
      .filter((p) => !own.has(p))
  );
  const unpushedRaw = git(root, ["rev-list", "--count", "@{u}..HEAD"]);
  const unpushed = /^\d+$/.test(unpushedRaw) ? Number(unpushedRaw) : null;

  const snapshot = buildState({
    generatedAt: new Date().toISOString(),
    branch: branch && branch !== "HEAD" ? branch : null,
    now: newNowText,
    ideas: ideasText,
    shipped: readOrNull(path.join(root, "SHIPPED.md")),
    roadmap: readOrNull(path.join(root, "ROADMAP.md")),
    git: {
      uncommitted: dirty.size,
      unpushed,
      lastCommitAt: git(root, ["log", "-1", "--format=%cI"]) || null,
      lastCommitMsg: git(root, ["log", "-1", "--format=%s"]) || null,
    },
  });
  writeStateAtomic(nowDir, snapshot, RECONCILE_FACTS_KEYS);
  // .now/state.json is gitignored (cross-cutting concern 6) - deliberately
  // never added to writtenPaths, so step 5 below never stages it.

  // 5. Stage exactly the files this call wrote, never `-A`. Deliberately NOT
  //    wrapped in its own try/catch: the caller (commit-guard.js) already
  //    wraps the whole reconcile() call and logs any throw to
  //    .now/reconcile.log, which is where a staging failure needs to be
  //    visible - swallowing it here a second time would hide it entirely.
  if (writtenPaths.length) {
    execFileSync("git", ["-C", root, "add", "--", ...writtenPaths], { stdio: "ignore" });
  }

  return { writtenPaths };
}

module.exports = { reconcile, markPhaseCommitted, maxPhaseNumber, moveRoadmapItemToShipped };
