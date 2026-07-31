#!/usr/bin/env node
/*
 * ClauDHD brief - SessionStart hook, and the /claudhd:now command.
 *
 * Prints "where you left off + wins + drift flags".
 *   default : emits SessionStart additionalContext JSON (hook mode).
 *   --plain : prints plain markdown to stdout (command mode).
 *
 * Stays silent (empty) unless NOW.md exists AND carries ClauDHD's opt-in
 * marker, so an unrelated NOW.md in some other repo never triggers it.
 * Never throws; exits 0.
 */
"use strict";
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const {
  QUICK_CAP,
  CURSOR_STALE_HOURS,
  ACTIVE_THREAD_STALE_DAYS,
  BRIEF_SECTION_CAP,
  BRIEF_CONTEXT_CAP,
  BRIEF_LINE_CAP,
  capText,
  fenceData,
} = require("./constants.js");

// Single resolver for every ClauDHD script (see root.js): provider-neutral var
// first, then Gantry's legacy var, then Claude Code's var, then cwd. Lets the
// same scripts run under a different host (or in tests) by setting CLAUDHD_PROJECT_DIR.
const ROOT = require("./root.js")(process.env);
const NOW_MD = path.join(ROOT, "NOW.md");
const NOW_DIR = path.join(ROOT, ".now");
const PLAIN = process.argv.includes("--plain");
// Advancing the "shipped since you were last here" anchor is a side effect that
// must happen only on an actual session visit. SessionStart passes --record-visit;
// /claudhd:now (which also runs this script) reads the wins without consuming
// the anchor, so the next SessionStart still reports what shipped while you
// were away instead of finding it already swallowed by a mid-session /now.
const RECORD_VISIT = process.argv.includes("--record-visit");

function git(args) {
  try {
    return execFileSync("git", ["-C", ROOT, ...args], {
      encoding: "utf8",
      timeout: 15000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function section(text, heading) {
  const esc = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = text.match(new RegExp(esc + "[\\s\\S]*?(?=\\n## |$)"));
  return m ? m[0].trim() : "";
}

// Drift check: does NOW.md's own rendered Mode:/from: lines still agree with
// what .now/state.json says right now? They can disagree when a hand-edit
// touched NOW.md after it was generated, or (rarer) a write raced the read.
// modeLine()/fromLine() parse the generated shape's own fact lines back out
// of the text (nowfile.js); comparing them against state is a read-only
// sanity check, never a repair - the next commit-boundary reconcile (or a
// fresh /claudhd:build or /claudhd:design call) is what actually fixes it.
function modeDriftFlag(nowText) {
  let state = null;
  try {
    const p = path.join(NOW_DIR, "state.json");
    if (fs.existsSync(p)) state = JSON.parse(fs.readFileSync(p, "utf8"));
  } catch { state = null; }
  if (!state) return null;

  const { modeLine, fromLine } = require("./nowfile.js");
  const renderedMode = modeLine(nowText);
  const renderedFrom = fromLine(nowText);
  const stateMode = state.mode != null ? state.mode : null;
  const stateFrom = state.from != null ? state.from : null;

  if (renderedMode !== stateMode || renderedFrom !== stateFrom) {
    return `NOW.md's Mode/from lines ("${renderedMode || "idle"}"/"${renderedFrom || "unplanned"}") disagree with .now/state.json ("${stateMode || "idle"}"/"${stateFrom || "unplanned"}"). NOW.md may have been hand-edited since it was last generated; the next commit (or /claudhd:build, /claudhd:design) regenerates it.`;
  }
  return null;
}

// Neutralize an externally-authored single token (a branch name on a checked-out
// PR, a checkpoint timestamp) before injecting it into the brief. These sit in
// ClauDHD's own framing, outside the data fence, so strip backticks (git ref
// names are allowed to contain them) to stop a break-out from the inline code
// span, drop any line breaks, and length-cap so it can't pad the brief.
function safeInline(s) {
  return capText(String(s).replace(/[`\r\n]/g, " ").trim(), BRIEF_LINE_CAP);
}

function ageHours(p) {
  try {
    return (Date.now() - fs.statSync(p).mtimeMs) / 3600000;
  } catch {
    return null;
  }
}

// Keep in sync with checkpoint.js: branch -> safe file name under .now/branches/.
function safeBranch(b) {
  if (!b || b === "unknown" || b === "HEAD") return "";
  return b.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 200);
}

// "Shipped since you were last here" is computed per-branch: the anchor lives at
// .now/branches/<branch>.head, so switching branches doesn't make one branch's
// commits show up as wins on another, and two sessions on different branches
// don't clobber each other's baseline. Falls back to a global anchor when the
// branch is unknown (e.g. detached HEAD).
function winsSinceLastVisit(branch) {
  const head = git(["rev-parse", "HEAD"]);
  const safe = safeBranch(branch);
  const anchor = safe
    ? path.join(NOW_DIR, "branches", safe + ".head")
    : path.join(NOW_DIR, "session-start-head");
  let prev = "";
  try {
    if (fs.existsSync(anchor)) prev = fs.readFileSync(anchor, "utf8").trim();
  } catch { /* ignore */ }
  let subjects = [];
  if (prev && head && prev !== head) {
    const log = git(["log", `${prev}..HEAD`, "--pretty=format:%s", "-50"]);
    subjects = log.split(/\r?\n/).filter((l) => l.trim());
  }
  // Only move the anchor on an actual session visit (--record-visit). A read-only
  // /now/regroup/wrap leaves it where it was, so the next SessionStart still sees
  // everything shipped since you last started a session here.
  if (RECORD_VISIT) {
    try {
      fs.mkdirSync(path.dirname(anchor), { recursive: true });
      if (head) fs.writeFileSync(anchor, head);
    } catch { /* ignore */ }
  }
  return subjects;
}

// How many days the current active thread has been THE active thread. The mtime
// freshness check (CURSOR_STALE_HOURS) only sees the file: you can keep a NOW.md
// fresh by editing a running header narrative while the "## Active thread" pointer
// underneath it rots for weeks, so that check never fires on a forgotten thread.
// Track the thread by its own identity instead - the first bold name in the
// section - and stamp when that name FIRST appeared in .now/active-thread.json.
// The clock resets whenever you promote a different thread (the name changes), so
// it measures the life of THIS thread, not the life of the file. A thread already
// stale when this ships starts its clock fresh, so the first flag can take up to
// the threshold to appear; accurate from then on. Writing the stamp on a name
// change is a pure correctness update (unlike the wins anchor, it loses nothing),
// so it is not gated on --record-visit and stays right under /now and /regroup.
function activeThreadAgeDays(activeSection) {
  if (!activeSection) return null;
  const m = activeSection.match(/\*\*(.+?)\*\*/);
  if (!m) return null;
  const key = m[1].replace(/\s+/g, " ").trim();
  if (!key) return null;
  const store = path.join(NOW_DIR, "active-thread.json");
  let prev = null;
  try {
    if (fs.existsSync(store)) prev = JSON.parse(fs.readFileSync(store, "utf8"));
  } catch { prev = null; }
  let since = Date.now();
  if (prev && prev.key === key && Number.isFinite(prev.since)) {
    since = prev.since;
  } else {
    try {
      fs.mkdirSync(NOW_DIR, { recursive: true });
      fs.writeFileSync(store, JSON.stringify({ key, since }));
    } catch { /* ignore */ }
  }
  return { name: key, days: Math.floor((Date.now() - since) / 86400000) };
}

function emit(context) {
  // Make the silent SessionStart injection auditable. In hook (JSON) mode the
  // documented top-level `systemMessage` field surfaces a short visible notice to
  // the user without becoming part of the model's additionalContext, so it does
  // not pollute the context it is reporting on. In --plain (command) mode the
  // user invoked the command and already sees the output on stdout, so the same
  // notice goes to stderr to keep stdout exactly the brief markdown.
  const notice = `ClauDHD: injected brief from NOW.md (${context.length} chars)`;
  if (PLAIN) {
    process.stderr.write(notice + "\n");
    process.stdout.write(context + "\n");
  } else {
    process.stdout.write(JSON.stringify({
      systemMessage: notice,
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: context,
      },
    }));
  }
}

try {
  // Only act on a NOW.md that ClauDHD created/marked, so an unrelated NOW.md
  // in someone else's repo never triggers the brief.
  let txt = "";
  try { txt = fs.existsSync(NOW_MD) ? fs.readFileSync(NOW_MD, "utf8") : ""; } catch { txt = ""; }
  if (!txt || !txt.includes("<!-- claudhd")) {
    if (PLAIN) {
      process.stdout.write("No ClauDHD NOW.md here. Run /claudhd:init to set up ClauDHD in this project.\n");
    }
    process.exit(0); // silent in non-ClauDHD projects
  }

  const lines = [];
  const flags = [];

  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);

  // Echo the active thread, minus the static "Rule:" coaching line. That line
  // is identical every time and just pads /now, /regroup, /wrap and the brief;
  // it still lives in NOW.md for in-file guidance, we just don't repeat it back.
  const active = section(txt, "## Active thread");
  if (active) {
    const trimmed = active
      .split(/\r?\n/)
      .filter((l) => !/^\s*Rule:/i.test(l))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    // This text is copied verbatim from NOW.md, which is committed and may be
    // authored by someone else. Cap it so it can't flood the window, then fence
    // it as untrusted data so embedded text can't steer the model as instructions.
    if (trimmed) lines.push(fenceData(capText(trimmed, BRIEF_SECTION_CAP), "NOW.md"));
  }

  // Surface the top committed roadmap intent, so what is next is visible without
  // opening ROADMAP.md. One cheap file read; an absent roadmap stays silent. The
  // intent text is external (ROADMAP.md is committed), so sanitize it inline the
  // same way as the other externally-authored tokens below.
  try {
    const roadmap = path.join(ROOT, "ROADMAP.md");
    if (fs.existsSync(roadmap)) {
      const rtxt = fs.readFileSync(roadmap, "utf8");
      const nextSection = section(rtxt, "## Next");
      const m = nextSection.match(/^\s*-\s*\[ \]\s*(.+?)\s*$/m);
      if (m) lines.push(`Roadmap next: ${safeInline(m[1])}`);
    }
  } catch { /* ignore */ }
  // Surface the quick-fixes batch: a count line when any are waiting, and a drift
  // flag when it outgrows its cap (a batch quietly becoming a backlog).
  // QUICK_CAP and CURSOR_STALE_HOURS live in constants.js.
  const quickSection = section(txt, "## Quick fixes");
  const quickOpen = quickSection ? (quickSection.match(/^\s*-\s*\[ \]/gm) || []).length : 0;
  if (quickOpen > 0) {
    lines.push(`Quick fixes waiting: ${quickOpen} (clear in one pass with /claudhd:quick).`);
  }
  if (quickOpen > QUICK_CAP) {
    flags.push(`Quick-fixes batch is over its cap (${quickOpen}). Clear it, or promote the important one to the Queue - don't let the batch become a backlog.`);
  }

  const age = ageHours(NOW_MD);
  if (age && age > CURSOR_STALE_HOURS) {
    flags.push(`NOW.md has not been touched in ${Math.floor(age / 24)} days. Is the active thread still right?`);
  }

  const modeDrift = modeDriftFlag(txt);
  if (modeDrift) flags.push(modeDrift);

  // A thread that has quietly overstayed: the file stays fresh but THIS thread has
  // been active too long. Catches the drift the mtime check above cannot see.
  const threadAge = activeThreadAgeDays(active);
  if (threadAge && threadAge.days > ACTIVE_THREAD_STALE_DAYS) {
    flags.push(`Active thread "${safeInline(threadAge.name)}" has been active for ${threadAge.days} days. If its headline criteria are met, close it out and promote the next on purpose; if it is genuinely still in flight, carry on.`);
  }

  // Count only real work as drift. ClauDHD's own bookkeeping files (NOW.md and
  // friends) are meant to stay live and uncommitted, so flagging them would mean
  // a working cursor permanently reads as drift. We read plain paths (not the
  // `status --short` columns) because the shared git() trims its output, which
  // would shift a leading-space status code and corrupt column parsing.
  //
  // Match the exact root-relative path git reports (always forward-slash), NOT
  // the basename - otherwise a real file like docs/NOW.md or notes/IDEAS.md would
  // be silently waved through as ClauDHD bookkeeping and never counted as drift.
  const own = new Set(["NOW.md", "IDEAS.md", "SHIPPED.md", "ROADMAP.md"]);
  const changed = git(["diff", "--name-only", "HEAD"]);              // tracked, staged + unstaged
  const untracked = git(["ls-files", "--others", "--exclude-standard"]); // new files
  const dirty = new Set(
    (changed + "\n" + untracked)
      .split(/\r?\n/)
      .map((p) => p.trim())
      .filter(Boolean)
      .filter((p) => !own.has(p))
  );
  if (dirty.size) {
    flags.push(`${dirty.size} uncommitted path(s) in the working tree. Commit, stash, or discard before drifting further.`);
  }

  // Out-of-scope work log (r-0729-1): the guards no longer block an edit outside
  // a live phase's scope, they record it here. Surface the count so the drift is
  // visible, which is the whole point of logging instead of denying. The log is
  // cleared when a fresh phase starts, so this is the current phase's drift, not
  // a lifetime tally.
  try {
    const drift = require("./drift-log.js").readDriftLog(ROOT);
    if (drift.length) {
      const paths = [...new Set(drift.map((d) => d && d.path).filter(Boolean))];
      const shown = paths.slice(0, 5).map((p) => safeInline(p)).join(", ");
      const more = paths.length > 5 ? `, and ${paths.length - 5} more` : "";
      flags.push(`${paths.length} edit(s) outside the active phase's scope this phase: ${shown}${more}. Either widen the phase (add-files) or note the scope grew; the edits landed, they were only recorded.`);
    }
  } catch { /* never let drift surfacing break the brief */ }

  // Prefer this branch's checkpoint, so after a branch switch you see where you
  // left off HERE, not wherever you last stopped.
  const safe = safeBranch(branch);
  const perBranch = safe ? path.join(NOW_DIR, "branches", safe + ".md") : "";
  const last = (perBranch && fs.existsSync(perBranch)) ? perBranch : path.join(NOW_DIR, "last-session.md");
  if (fs.existsSync(last)) {
    const m = fs.readFileSync(last, "utf8").match(/Stopped:\s*(.+)/);
    if (m) lines.push(`Last session stopped: ${safeInline(m[1])}`);
  }

  const wins = winsSinceLastVisit(branch);

  const onBranch = branch && branch !== "HEAD" ? ` (on \`${safeInline(branch)}\`)` : "";
  let out = `## Where you left off${onBranch}\n\n` + (lines.length ? lines.join("\n\n") : "(no NOW.md cursor found)");
  if (wins.length) {
    // Commit subjects are externally authored too: a cloned or pulled repo
    // carries other people's commit messages, which we'd otherwise inject
    // verbatim. Cap each line and fence the block as untrusted data, same as the
    // NOW.md content. The fixed bullets/guidance stay outside the fence.
    let body = wins.slice(0, 6).map((w) => `- ${capText(w, BRIEF_LINE_CAP)}`).join("\n");
    if (wins.length > 6) body += `\n- ... and ${wins.length - 6} more`;
    out += "\n\n## Shipped since you were last here\n\n"
      + fenceData(capText(body, BRIEF_SECTION_CAP), "git commit messages")
      + "\n\n(Already logged to SHIPPED.md automatically at each commit.)";
  }
  if (flags.length) {
    out += "\n\n## Drift flags\n\n" + flags.map((f) => `- ${f}`).join("\n");
  }
  out += "\n\n(Read NOW.md first. As you work, keep it live: when you finish a step, check it off in NOW.md and write the next tiny action, instead of waiting until you stop. NOW.md regenerates itself at every commit.)";

  // Backstop the total injected size. The data fence sits early in `out`, so a
  // total-cap truncation only trims ClauDHD's own trailing guidance and leaves
  // the fenced untrusted block (already section-capped) intact and closed.
  out = capText(out, BRIEF_CONTEXT_CAP);

  emit(out);
} catch {
  // stay silent on any error
}
process.exit(0);
