"use strict";
/*
 * ClauDHD NOW.md renderer - the generated shape (design section 4, phase 3).
 *
 * render(state) is pure: state in, NOW.md text out. `state.now` (the previous
 * NOW.md text, optional) is NOT part of the persisted state.json schema -
 * it exists only so the Queue/Quick-fixes/Loose-ends sections can carry
 * forward verbatim, since state.json stores only their COUNTS
 * (cursor.queueCount/quickFixCount), never their item text (quick.js still
 * writes that text directly, outside this renderer - B2).
 *
 * B3 (hard constraint): state.intent is the ONLY source for the Active
 * thread's two lines, on every render including the first. `now` is never
 * consulted for them, even as a fallback - a second source of truth for the
 * one piece of human prose in this file is exactly what B3 forbids.
 *
 * init.js scaffolds a fresh NOW.md by calling render({}) directly - it never
 * reads templates/NOW.md. That template file is kept only as a reference copy
 * for a human skimming templates/, welded to render({})'s actual output by
 * the byte-exact LOCK test in test/nowrender.test.js: if this file's
 * constants ever change, regenerate templates/NOW.md by writing out
 * render({}) again - never hand-edit it out of sync.
 */
const { section } = require("./nowfile.js");

const MARKER = "<!-- claudhd: opt-in marker (do not remove) - ClauDHD's hooks only act on a NOW.md that has this line -->";
const UNPLANNED_LABEL = "(unplanned work)";

const INTRO =
  "One active thread at a time. This file is the cursor: what is live, the next physical action, and what is queued behind it. Read it first, update it as you go.";
const COMMITTED_NOTE =
  "_Committed, so it follows your branch: `git checkout` swaps this cursor to that branch's thread._";
const GENERATED_NOTE =
  "This file is generated (design section 4): the facts below (Mode, Position, from, Counts, Last touched) render from `.now/state.json`, never hand-typed. The Active thread's two lines are the one piece of human prose, prompted at boundaries and persisted as state fields too - so it survives a regeneration without ever being parsed back out of this file.";
const RULE_LINE =
  "Rule: when you finish a step, check it off and write the next single tiny step. Do not start another thread until this one ships or you consciously commit the next one to the roadmap (`/claudhd:roadmap <intent>`) and activate it in its turn (`/claudhd:start <id>`).";
const WRAP_NOTE =
  "Keep this section lean (about 40 lines): a summary, the live state, and the next action, not a running shipped log. Move settled material out as you go: shipped work to SHIPPED.md, parked or future material to ROADMAP.md or IDEAS.md.";
const QUEUE_INTRO =
  "What is eligible to become active next, in order. The readiness gate lives at activation, not before: `/claudhd:start <id>` is what turns a committed ROADMAP.md intent into something concrete (restated, done + first action) and enters it into design. Nothing here queues as a bare one-liner.";
const QUICK_INTRO =
  "Small, self-contained chores that need no plan and aren't worth their own thread. Capped at 3 - overflow means clear some or promote one out, so this stays a batch and never a second backlog. Add with `/claudhd:quick <text>`, clear them in one focused pass with `/claudhd:quick`. The active thread has right of way: clear these between threads, not mid-thread. A fix that turns out to need real thinking gets kicked back to IDEAS.md.";
const IDEA_FLOW =
  "New idea mid-task: `/claudhd:idea <text>` records it in IDEAS.md so you can keep working. `/claudhd:harvest` backfills ideas from past sessions you never recorded. `/claudhd:triage` clears the inbox. Finished work lands in SHIPPED.md automatically at the commit boundary.";
const LEAVING =
  "Before you walk away, or whenever you switch context, make the \"Next physical action\" line true and tiny. That one line is what lets you stop mid-thought and lose nothing. The rest of this file regenerates itself at every commit; only the Active thread's two lines are yours to keep current.";

function positionLine(mode, build, design) {
  if (mode === "build") {
    const plan = (build && build.plan) || "(no plan yet)";
    const phase = build && Number.isFinite(build.phase) ? build.phase : null;
    return "Position: " + (phase != null ? "phase " + phase + " of " : "") + plan;
  }
  if (mode === "design") {
    const doc = (design && design.doc) || "(no doc yet)";
    return "Position: designing " + doc;
  }
  return "Position: idle - pick a mode with /claudhd:start or /claudhd:design";
}

function modeDisplay(mode) {
  return mode || "(none - idle)";
}

function countsLine(cursor, ideas) {
  const queue = cursor && Number.isFinite(cursor.queueCount) ? cursor.queueCount : 0;
  const quick = cursor && Number.isFinite(cursor.quickFixCount) ? cursor.quickFixCount : 0;
  const untriaged = ideas && Number.isFinite(ideas.untriaged) ? ideas.untriaged : 0;
  return "Counts: queue " + queue + " · quick fixes " + quick + " · ideas untriaged " + untriaged;
}

// `fallback` (matches templates/NOW.md) only applies when `now` has never had
// this heading - never touched otherwise, so the carried text is byte-exact.
function carried(now, heading, fallback) {
  const lines = section(now || "", heading);
  if (lines.length) return lines.join("\n");
  return fallback.join("\n");
}

function render(state) {
  const s = state || {};
  const mode = s.mode != null ? s.mode : null;
  const from = s.from != null ? s.from : null;
  const build = s.build || null;
  const design = s.design || null;
  const cursor = s.cursor || null;
  const ideas = s.ideas || null;
  const intent = s.intent || null;
  const now = s.now || "";

  const threadName = (intent && intent.thread) || "(name your current focus here)";
  const nextStep = (intent && intent.next) || "(one tiny step you can start in under a minute)";
  const lastTouched = (cursor && cursor.lastTouched) || "(set this when you edit the file)";

  const fromDisplay = from == null ? UNPLANNED_LABEL : from;

  const queueSection = carried(now, "## Queue", [
    "## Queue (in order, not now)",
    "",
    QUEUE_INTRO,
    "",
    "(nothing queued yet)",
  ]);
  const quickSection = carried(now, "## Quick fixes", [
    "## Quick fixes (clear in one pass)",
    "",
    QUICK_INTRO,
    "",
    "(nothing queued yet)",
  ]);
  const looseSection = carried(now, "## Loose ends", [
    "## Loose ends",
    "",
    "(none yet)",
  ]);

  const lines = [
    "# NOW (read me first)",
    "",
    MARKER,
    "",
    INTRO,
    "",
    COMMITTED_NOTE,
    "",
    GENERATED_NOTE,
    "",
    "Mode: " + modeDisplay(mode),
    positionLine(mode, build, design),
    "from: " + fromDisplay,
    countsLine(cursor, ideas),
    "",
    "Last touched: " + lastTouched,
    "",
    "## Active thread (only one)",
    "",
    "**" + threadName + "**",
    "",
    "Next physical action:",
    "",
    "- [ ] " + nextStep,
    "",
    RULE_LINE,
    "",
    WRAP_NOTE,
    "",
    queueSection,
    "",
    quickSection,
    "",
    "## Idea flow (do not open a new chat)",
    "",
    IDEA_FLOW,
    "",
    looseSection,
    "",
    "## Leaving this file when you stop",
    "",
    LEAVING,
    "",
  ];

  return lines.join("\n");
}

module.exports = { render };
