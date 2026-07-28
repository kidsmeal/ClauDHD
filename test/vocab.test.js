"use strict";
/*
 * Tests for vocab.js - the five-verb mechanical write vocabulary
 * (design section 9/10, phase 6): append-capture, move, mark, reorder, park.
 *
 * The load-bearing assertion per the plan's Phase 6 Verification: verbatim
 * promotion. An idea line's wording, once captured, must survive a `move`
 * into ROADMAP.md byte-for-byte as a substring, with an id stamped through
 * state.js's one locked issuance path (issueRoadmapIds) and the capture date
 * + while-context carried along (design section 9).
 *
 * move()/mark(file: "ideas") address a line by `position` (the 1-based rank
 * among ALL Inbox lines, top to bottom) PLUS `expectedLine` (the exact line
 * text last rendered at that position - optimistic concurrency, sol
 * round-one fix 1). appendCapture() always inserts the newest line right
 * after the "## Inbox" heading, so the MOST RECENT capture is always
 * position 1 and every earlier capture shifts one position down - which is
 * exactly the scenario expectedLine guards against.
 *
 * Sol round-two fixes covered here: parseIdeaLine()'s balanced-paren scan
 * (a thread name containing parens, e.g. the shipped default "(name your
 * current focus here)", must not truncate the thread or corrupt the idea
 * text); move()'s cross-verb lock (a concurrent reorder()/park() must not
 * invalidate move()'s id association); and every write going through
 * writeFileAtomic (temp-file-plus-rename), verified indirectly by every
 * other test here still passing unchanged.
 *
 * Concurrency reuses the test/state-concurrency.test.js and
 * test/roadmapids.test.js pattern: hold the exact lock the transaction uses
 * via tools/hold-lock.js, fire the real writers while it is held so both
 * queue on it, then release and let them race for real.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { makeRepo, cleanup, run, runAsync, read, write, optIn, scriptPath } = require("../tools/helpers.js");
const vocab = require("../plugins/claudhd/scripts/vocab.js");
const { roadmapLockPath } = require("../plugins/claudhd/scripts/state.js");

const ROADMAP_FIXTURE = [
  "# ROADMAP",
  "",
  "## Now",
  "",
  "- Nothing in flight.",
  "",
  "## Next",
  "",
  "## Later",
  "",
  "## Shipped",
  "",
  "## Non-goals",
  "",
].join("\n");

function dateOf(entry) {
  const m = /-\s*\[ \]\s*(\d{4}-\d{2}-\d{2})/.exec(entry);
  if (!m) throw new Error("could not extract date from: " + entry);
  return m[1];
}

function stateOf(dir) {
  return JSON.parse(read(dir, path.join(".now", "state.json")));
}

// The exact line text at `position` in IDEAS.md's Inbox right now - what a
// consumer's card renderer would have last shown for that position. Test
// helper only; production callers get this from their own prior render.
// Uses vocab.js's own parseIdeaLine() (not a second, potentially-drifting
// regex) so this helper's counting always matches the real implementation.
function ideaLineAt(dir, position) {
  const lines = read(dir, "IDEAS.md").split(/\r?\n/);
  let count = 0;
  for (const l of lines) {
    if (vocab.parseIdeaLine(l)) {
      count++;
      if (count === position) return l;
    }
  }
  throw new Error("no idea line at position " + position + " in " + path.join(dir, "IDEAS.md"));
}

// LOCK (sol round-six sweep): templates/IDEAS.md (what init.js copies into a
// fresh project) and vocab.js's own HEADER constant (what appendCapture()
// scaffolds when IDEAS.md is absent) must read byte-identical - otherwise a
// freshly-init'd project's IDEAS.md would describe the capture/triage flow
// one way, and a project whose first capture happened before init ran would
// get a different description of the exact same file.
test("LOCK: templates/IDEAS.md and vocab.js's HEADER constant are byte-identical", () => {
  const template = fs.readFileSync(path.join(__dirname, "..", "plugins", "claudhd", "templates", "IDEAS.md"), "utf8");
  assert.equal(template, vocab.HEADER,
    "templates/IDEAS.md drifted from vocab.js's HEADER - regenerate the template from HEADER, never hand-edit it out of sync");
});

// --- append-capture ---------------------------------------------------------

test("append-capture writes the exact shape idea.js's IDEAS.md capture has always used", () => {
  const { dir } = makeRepo();
  try {
    const r = vocab.appendCapture(dir, "buy milk");
    assert.equal(r.ok, true);
    const ideas = read(dir, "IDEAS.md");
    assert.match(ideas, /- \[ \] \d{4}-\d{2}-\d{2} \d{2}:\d{2} \(while: \?\) buy milk/);
  } finally { cleanup(dir); }
});

test("append-capture is the one verb that carries free text; empty text captures nothing", () => {
  const { dir } = makeRepo();
  try {
    const r = vocab.appendCapture(dir, "   ");
    assert.equal(r.ok, false);
    assert.equal(fs.existsSync(path.join(dir, "IDEAS.md")), false);
  } finally { cleanup(dir); }
});

// --- fix 1 (sol round two): balanced-paren while-context parsing -----------

test("parses the complete while-context and exact idea text when the active thread name itself contains parentheses (the real shipped default thread name)", () => {
  const { dir } = makeRepo();
  try {
    const realTemplate = fs.readFileSync(
      path.join(__dirname, "..", "plugins", "claudhd", "templates", "NOW.md"),
      "utf8"
    );
    assert.match(realTemplate, /\*\*\(name your current focus here\)\*\*/, "sanity: the real shipped default thread name is itself parenthesized");
    write(dir, "NOW.md", realTemplate);

    const cap = vocab.appendCapture(dir, "an idea captured against the default thread");
    assert.match(cap.entry, /\(while: \(name your current focus here\)\)/, "sanity: the raw captured line carries the full parenthesized thread name, doubly-wrapped");

    const parsed = vocab.parseIdeaLine(cap.entry);
    assert.equal(parsed.thread, "(name your current focus here)", "the full thread name, its own parens included, must survive parsing unmangled");
    assert.equal(parsed.text, "an idea captured against the default thread", "the idea's own text must not be corrupted by the thread's internal parens (e.g. a stray leading ')')");

    write(dir, "ROADMAP.md", ROADMAP_FIXTURE);
    const r = vocab.move(dir, { position: 1, expectedLine: cap.entry });
    assert.equal(r.thread, "(name your current focus here)");
    assert.equal(r.text, "an idea captured against the default thread");

    const roadmap = read(dir, "ROADMAP.md");
    assert.ok(roadmap.includes("an idea captured against the default thread (captured:"), "the promoted line's text is exactly the idea's wording, nothing prepended");
    assert.ok(roadmap.includes("while: (name your current focus here))"), "the full while-context, parens included, survives onto the roadmap line");
  } finally { cleanup(dir); }
});

test("parseIdeaLine handles a thread name with unbalanced/no parens the same as before (regression safety net)", () => {
  assert.deepEqual(
    vocab.parseIdeaLine("- [ ] 2026-07-26 10:00 (while: plain thread) buy milk"),
    { marker: " ", date: "2026-07-26 10:00", thread: "plain thread", text: "buy milk" }
  );
  assert.deepEqual(
    vocab.parseIdeaLine("- [ ] 2026-07-26 10:00 no while tag at all"),
    { marker: " ", date: "2026-07-26 10:00", thread: null, text: "no while tag at all" }
  );
  assert.equal(vocab.parseIdeaLine("not an idea line at all"), null);
});

// --- move (promotion) - the load-bearing verbatim assertion -----------------

test("move promotes an idea's exact wording into ROADMAP.md byte-for-byte, stamps an id via the locked issuance path, and carries capture date + while-context", () => {
  const { dir, git } = makeRepo();
  try {
    optIn(dir, git, "sidebar work");
    write(dir, "ROADMAP.md", ROADMAP_FIXTURE);

    const wording = "dont forget the wonky sidebar re-render on resize -- ugly but real, low priority";
    const cap = vocab.appendCapture(dir, wording);
    const date = dateOf(cap.entry);

    const result = vocab.move(dir, { position: 1, expectedLine: cap.entry });
    assert.equal(result.ok, true);
    assert.match(result.id, /^r-\d{4}-\d+$/, "an id was stamped");

    const roadmap = read(dir, "ROADMAP.md");
    assert.ok(roadmap.includes(wording), "the idea's exact wording survives, unchanged, as a substring of the roadmap line");
    assert.match(roadmap, new RegExp("captured: " + date + ".*while: sidebar work"), "capture date and while-context both carried onto the roadmap line");
    assert.ok(roadmap.includes("`" + result.id + "`"), "the stamped id is rendered on the line, roadmapids.js's own suffix shape");

    const state = stateOf(dir);
    assert.ok(Array.isArray(state.roadmapIds) && state.roadmapIds.includes(result.id), "the id was issued through state.js's durable ledger (the one locked issuance path), not invented ad hoc");

    const ideas = read(dir, "IDEAS.md");
    assert.match(ideas, /\[~\]/, "the original IDEAS.md line is marked promoted, not deleted");
    assert.ok(ideas.includes(wording), "IDEAS.md keeps its own copy of the line too - move never deletes history");
  } finally { cleanup(dir); }
});

// --- triage.md's "discuss" flow (sol round-two finding 1) ---
//
// A lost-context fragment cannot be saved by verbatim promotion, so the
// command's contract is: talk it through, REPLACE the original IDEAS.md
// line with the resolved wording (a normal gated edit - free text, never a
// verb), re-read that exact new line, then fire move()/mark() with THAT as
// expectedLine. This exercises the vocab-level tail of that loop: once the
// line has been replaced and re-read, promotion of the REPLACED line must
// carry the resolved wording verbatim into ROADMAP.md, not the original
// fragment.
//
// replaceIdeaLine simulates the discussion's Edit-tool rewrite: same
// checkbox marker, same timestamp, same (while: ...) tag if present, only
// the text after the tag changes - exactly what triage.md instructs.
function replaceIdeaLine(dir, position, newText) {
  const lines = read(dir, "IDEAS.md").split(/\r?\n/);
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!vocab.parseIdeaLine(lines[i])) continue;
    count++;
    if (count !== position) continue;
    const parsed = vocab.parseIdeaLine(lines[i]);
    const tag = parsed.thread ? ` (while: ${parsed.thread})` : "";
    lines[i] = `- [ ] ${parsed.date}${tag} ${newText}`;
    write(dir, "IDEAS.md", lines.join("\n"));
    return lines[i];
  }
  throw new Error("no idea line at position " + position);
}

test("discuss flow: promotion of the line REPLACED through discussion carries the resolved wording verbatim, not the original lost-context fragment", () => {
  const { dir, git } = makeRepo();
  try {
    optIn(dir, git, "cleanup thread");
    write(dir, "ROADMAP.md", ROADMAP_FIXTURE);

    // A lost-context fragment: no verb, trivially short - the case verbatim
    // promotion alone cannot save.
    const cap = vocab.appendCapture(dir, "thing");
    assert.match(cap.entry, /thing$/, "the captured fragment is exactly what verbatim promotion cannot save");

    // The discussion resolves the wording; the session replaces the line.
    const resolvedWording = "clean up the leftover debug logging in the sync path";
    const replacedLine = replaceIdeaLine(dir, 1, resolvedWording);
    assert.match(replacedLine, /\(while: cleanup thread\)/, "the replace step preserves the while-context tag");
    assert.doesNotMatch(replacedLine, /\bthing$/, "the fragment's own wording must not survive the replace");

    // The card re-reads the exact line it just wrote, then fires the verb
    // with THAT as expectedLine (never the pre-discussion line).
    const reRead = ideaLineAt(dir, 1);
    assert.equal(reRead, replacedLine, "re-reading position 1 must yield exactly the replaced line");

    const result = vocab.move(dir, { position: 1, expectedLine: reRead });
    assert.equal(result.ok, true);

    const roadmap = read(dir, "ROADMAP.md");
    const nextBlock = roadmap.slice(roadmap.indexOf("## Next"), roadmap.indexOf("## Later"));
    assert.ok(nextBlock.includes(resolvedWording),
      "the resolved wording must land on the roadmap verbatim, as a substring");
    assert.doesNotMatch(nextBlock, /\[ \]\s*thing\b/,
      "the promoted line must not carry the original lost-context fragment's own wording");
  } finally { cleanup(dir); }
});

test("discuss flow: promotion refuses the STALE pre-discussion line (expectedLine must be the re-read, replaced line)", () => {
  const { dir, git } = makeRepo();
  try {
    optIn(dir, git);
    write(dir, "ROADMAP.md", ROADMAP_FIXTURE);
    const cap = vocab.appendCapture(dir, "thing");
    replaceIdeaLine(dir, 1, "clean up the leftover debug logging in the sync path");

    // Firing the verb with the ORIGINAL (now-stale) captured line, instead
    // of re-reading after the replace, must refuse - the same optimistic-
    // concurrency guarantee any other stale tap gets.
    assert.throws(() => vocab.move(dir, { position: 1, expectedLine: cap.entry }),
      /no longer matches the expected line/);
    const roadmap = read(dir, "ROADMAP.md");
    assert.ok(!roadmap.includes("clean up the leftover debug logging"),
      "a refused move must write nothing");
  } finally { cleanup(dir); }
});

test("move defaults to the Next section and accepts Later explicitly", () => {
  const { dir, git } = makeRepo();
  try {
    optIn(dir, git);
    write(dir, "ROADMAP.md", ROADMAP_FIXTURE);
    const cap = vocab.appendCapture(dir, "someday maybe rewrite the onboarding flow");
    const r = vocab.move(dir, { position: 1, expectedLine: cap.entry, section: "Later" });
    assert.equal(r.section, "Later");
    const roadmap = read(dir, "ROADMAP.md");
    const laterBlock = roadmap.slice(roadmap.indexOf("## Later"), roadmap.indexOf("## Shipped"));
    assert.ok(laterBlock.includes("someday maybe rewrite the onboarding flow"));
  } finally { cleanup(dir); }
});

test("move ignores any caller-supplied text argument - the promoted wording comes only from the stored capture, never from argv", () => {
  const { dir, git } = makeRepo();
  try {
    optIn(dir, git);
    write(dir, "ROADMAP.md", ROADMAP_FIXTURE);
    const cap = vocab.appendCapture(dir, "the real captured wording");
    vocab.move(dir, { position: 1, expectedLine: cap.entry, text: "INJECTED FREE TEXT SHOULD NEVER APPEAR" });
    const roadmap = read(dir, "ROADMAP.md");
    assert.ok(!roadmap.includes("INJECTED FREE TEXT"), "move() has no text parameter it writes - only structured argv (position, expectedLine, section)");
    assert.ok(roadmap.includes("the real captured wording"));
  } finally { cleanup(dir); }
});

test("move requires expectedLine (optimistic concurrency argv, not optional)", () => {
  const { dir, git } = makeRepo();
  try {
    optIn(dir, git);
    write(dir, "ROADMAP.md", ROADMAP_FIXTURE);
    vocab.appendCapture(dir, "an idea");
    assert.throws(() => vocab.move(dir, { position: 1 }), /expectedLine is required/);
  } finally { cleanup(dir); }
});

test("move rejects an out-of-range position and a non-open (already promoted/dropped) idea", () => {
  const { dir, git } = makeRepo();
  try {
    optIn(dir, git);
    write(dir, "ROADMAP.md", ROADMAP_FIXTURE);
    const cap = vocab.appendCapture(dir, "the only idea");
    assert.throws(() => vocab.move(dir, { position: 99, expectedLine: cap.entry }), /no idea at position/);

    vocab.mark(dir, { file: "ideas", key: 1, expectedLine: cap.entry, state: "dropped" });
    const droppedLine = ideaLineAt(dir, 1);
    assert.throws(() => vocab.move(dir, { position: 1, expectedLine: droppedLine }), /not open/);
  } finally { cleanup(dir); }
});

// --- fix 1: stable action keys (optimistic concurrency) ---------------------

test("move refuses a stale tap when a capture landed between rendering positions and firing, and writes nothing; the corrected tap then succeeds", () => {
  const { dir, git } = makeRepo();
  try {
    optIn(dir, git);
    write(dir, "ROADMAP.md", ROADMAP_FIXTURE);

    // 1. Render: idea A is captured and would be rendered as position 1.
    const capA = vocab.appendCapture(dir, "idea A rendered at position 1");
    const renderedLine = capA.entry;

    // 2. A capture lands between the render and the tap firing - shifts A
    //    to position 2 (see this file's header comment).
    vocab.appendCapture(dir, "idea B captured after the render");

    const ideasBeforeTap = read(dir, "IDEAS.md");
    const roadmapBeforeTap = read(dir, "ROADMAP.md");

    // 3. The stale tap still names position 1 (what the render said) - must
    //    refuse rather than silently promoting idea B, and write nothing.
    assert.throws(
      () => vocab.move(dir, { position: 1, expectedLine: renderedLine }),
      /no longer matches the expected line/,
      "a stale tap must refuse, not silently act on whatever now sits at that position"
    );
    assert.equal(read(dir, "IDEAS.md"), ideasBeforeTap, "IDEAS.md must be byte-untouched by a refused tap");
    assert.equal(read(dir, "ROADMAP.md"), roadmapBeforeTap, "ROADMAP.md must be byte-untouched by a refused tap");

    // 4. The corrected tap (re-rendered position 2, same expected line) succeeds.
    const r = vocab.move(dir, { position: 2, expectedLine: renderedLine });
    assert.equal(r.ok, true);
    assert.ok(read(dir, "ROADMAP.md").includes("idea A rendered at position 1"));
  } finally { cleanup(dir); }
});

test("mark(file: ideas) refuses a stale tap the same way, and writes nothing", () => {
  const { dir, git } = makeRepo();
  try {
    optIn(dir, git);
    const capA = vocab.appendCapture(dir, "idea A");
    const renderedLine = capA.entry;
    vocab.appendCapture(dir, "idea B captured after the render"); // shifts A to position 2

    const before = read(dir, "IDEAS.md");
    assert.throws(
      () => vocab.mark(dir, { file: "ideas", key: 1, expectedLine: renderedLine, state: "dropped" }),
      /no longer matches the expected line/
    );
    assert.equal(read(dir, "IDEAS.md"), before, "IDEAS.md must be byte-untouched by a refused tap");

    vocab.mark(dir, { file: "ideas", key: 2, expectedLine: renderedLine, state: "dropped" });
    assert.match(read(dir, "IDEAS.md"), /- \[x\] .*idea A(?! B)/);
  } finally { cleanup(dir); }
});

// --- fix 2: promotion ordering (ROADMAP side before marking the source) ----

test("move fails loudly and leaves IDEAS.md byte-untouched when ROADMAP.md is missing", () => {
  const { dir, git } = makeRepo();
  try {
    optIn(dir, git);
    // No ROADMAP.md written at all.
    const cap = vocab.appendCapture(dir, "an idea with nowhere to land");
    const before = read(dir, "IDEAS.md");
    assert.throws(() => vocab.move(dir, { position: 1, expectedLine: cap.entry }), /no ROADMAP\.md/);
    assert.equal(read(dir, "IDEAS.md"), before, "IDEAS.md must be byte-untouched when the ROADMAP.md side fails - the source stays open, not silently marked promoted");
  } finally { cleanup(dir); }
});

test("move fails loudly and leaves IDEAS.md byte-untouched when ROADMAP.md is malformed (missing the target section)", () => {
  const { dir, git } = makeRepo();
  try {
    optIn(dir, git);
    write(dir, "ROADMAP.md", "# ROADMAP\n\nNo Next or Later section here.\n");
    const cap = vocab.appendCapture(dir, "an idea whose destination section does not exist");
    const before = read(dir, "IDEAS.md");
    assert.throws(() => vocab.move(dir, { position: 1, expectedLine: cap.entry }), /has no "## Next" section/);
    assert.equal(read(dir, "IDEAS.md"), before, "IDEAS.md must be byte-untouched when the ROADMAP.md side fails");
  } finally { cleanup(dir); }
});

// --- mark --------------------------------------------------------------

test("mark drops an idea (ideas file) by flipping its checkbox to [x], the triage 'drop' action", () => {
  const { dir, git } = makeRepo();
  try {
    optIn(dir, git);
    const cap = vocab.appendCapture(dir, "a chore nobody wants");
    vocab.mark(dir, { file: "ideas", key: 1, expectedLine: cap.entry, state: "dropped" });
    const ideas = read(dir, "IDEAS.md");
    assert.match(ideas, /- \[x\] .*a chore nobody wants/);
  } finally { cleanup(dir); }
});

test("mark(file: ideas) requires expectedLine (optimistic concurrency argv, not optional)", () => {
  const { dir, git } = makeRepo();
  try {
    optIn(dir, git);
    vocab.appendCapture(dir, "a chore");
    assert.throws(() => vocab.mark(dir, { file: "ideas", key: 1, state: "dropped" }), /expectedLine is required/);
  } finally { cleanup(dir); }
});

test("mark on the roadmap file flips a checkbox item's marker by id (no expectedLine needed - the id is already stable)", () => {
  const { dir, git } = makeRepo();
  try {
    optIn(dir, git);
    write(dir, "ROADMAP.md", ["## Next", "- [ ] a committed intent `r-0101-1`", "## Later"].join("\n"));
    vocab.mark(dir, { file: "roadmap", key: "r-0101-1", state: "done" });
    const roadmap = read(dir, "ROADMAP.md");
    assert.match(roadmap, /- \[x\] a committed intent `r-0101-1`/);
  } finally { cleanup(dir); }
});

test("mark rejects a state outside its closed enum - no verb accepts free text as new content", () => {
  const { dir, git } = makeRepo();
  try {
    optIn(dir, git);
    const cap = vocab.appendCapture(dir, "whatever");
    assert.throws(
      () => vocab.mark(dir, { file: "ideas", key: 1, expectedLine: cap.entry, state: "please rewrite this idea entirely" }),
      /unknown ideas state/
    );
  } finally { cleanup(dir); }
});

// --- reorder -------------------------------------------------------------

const THREE_ITEM_ROADMAP = [
  "# ROADMAP",
  "",
  "## Next",
  "",
  "- [ ] alpha `r-0101-1`",
  "- [ ] beta `r-0101-2`",
  "- [ ] gamma `r-0101-3`",
  "",
  "## Later",
  "",
].join("\n");

test("reorder moves an item to a new position within its section, stable: every other line untouched", () => {
  const { dir, git } = makeRepo();
  try {
    optIn(dir, git);
    write(dir, "ROADMAP.md", THREE_ITEM_ROADMAP);
    const r = vocab.reorder(dir, { section: "Next", id: "r-0101-3", position: 1 });
    assert.equal(r.changed, true);
    const roadmap = read(dir, "ROADMAP.md");
    const nextBlock = roadmap.slice(roadmap.indexOf("## Next"), roadmap.indexOf("## Later"));
    const order = [...nextBlock.matchAll(/`(r-0101-\d)`/g)].map((m) => m[1]);
    assert.deepEqual(order, ["r-0101-3", "r-0101-1", "r-0101-2"], "gamma moved to first, alpha/beta keep their relative order");
    assert.ok(roadmap.startsWith("# ROADMAP\n\n## Next\n\n"), "headings and blank lines outside the reordered set are untouched");
  } finally { cleanup(dir); }
});

test("reorder to the item's current position is a stable no-op", () => {
  const { dir, git } = makeRepo();
  try {
    optIn(dir, git);
    write(dir, "ROADMAP.md", THREE_ITEM_ROADMAP);
    const r = vocab.reorder(dir, { section: "Next", id: "r-0101-2", position: 2 });
    assert.equal(r.changed, false);
    assert.equal(read(dir, "ROADMAP.md"), THREE_ITEM_ROADMAP);
  } finally { cleanup(dir); }
});

test("reorder rejects an id not present in the named section", () => {
  const { dir, git } = makeRepo();
  try {
    optIn(dir, git);
    write(dir, "ROADMAP.md", THREE_ITEM_ROADMAP);
    assert.throws(() => vocab.reorder(dir, { section: "Later", id: "r-0101-1", position: 1 }), /no item carrying id/);
  } finally { cleanup(dir); }
});

// --- heading-anchored refusal (1.0.2 fix round) -----------------------------
//
// roadmapids.js's subsection anchoring can stamp an id onto a "### " heading
// line (the item's whole body is absorbed as its children). mark(file:
// "roadmap")/reorder()/park() each move or edit ONE line by id, so applying
// that to a heading-anchored id would tear the heading from its children -
// all three must refuse (throw, write nothing) instead.

const HEADING_ANCHORED_ROADMAP = [
  "# ROADMAP",
  "",
  "## Next",
  "",
  "### Ship the widget `r-0101-1`",
  "",
  "1. Step one",
  "2. Step two",
  "",
  "- [ ] a normal single-line item `r-0101-2`",
  "",
  "## Later",
  "",
].join("\n");

test("mark(file: roadmap) refuses a heading-anchored id, naming the block-operation limitation, and writes nothing", () => {
  const { dir, git } = makeRepo();
  try {
    optIn(dir, git);
    write(dir, "ROADMAP.md", HEADING_ANCHORED_ROADMAP);
    assert.throws(
      () => vocab.mark(dir, { file: "roadmap", key: "r-0101-1", state: "done" }),
      /heading-anchored items move as blocks; block operations are not yet supported, edit ROADMAP\.md directly in a session/
    );
    assert.equal(read(dir, "ROADMAP.md"), HEADING_ANCHORED_ROADMAP, "a refused mark must write nothing");
  } finally { cleanup(dir); }
});

test("reorder refuses a heading-anchored id, naming the block-operation limitation, and writes nothing", () => {
  const { dir, git } = makeRepo();
  try {
    optIn(dir, git);
    write(dir, "ROADMAP.md", HEADING_ANCHORED_ROADMAP);
    assert.throws(
      () => vocab.reorder(dir, { section: "Next", id: "r-0101-1", position: 1 }),
      /heading-anchored items move as blocks; block operations are not yet supported, edit ROADMAP\.md directly in a session/
    );
    assert.equal(read(dir, "ROADMAP.md"), HEADING_ANCHORED_ROADMAP, "a refused reorder must write nothing");
  } finally { cleanup(dir); }
});

test("park refuses a heading-anchored id, naming the block-operation limitation, and writes nothing", () => {
  const { dir, git } = makeRepo();
  try {
    optIn(dir, git);
    write(dir, "ROADMAP.md", HEADING_ANCHORED_ROADMAP);
    assert.throws(
      () => vocab.park(dir, { id: "r-0101-1", to: "Later" }),
      /heading-anchored items move as blocks; block operations are not yet supported, edit ROADMAP\.md directly in a session/
    );
    assert.equal(read(dir, "ROADMAP.md"), HEADING_ANCHORED_ROADMAP, "a refused park must write nothing");
  } finally { cleanup(dir); }
});

test("a normal single-line id in the SAME file (not heading-anchored) is unaffected by the refusal - mark/reorder/park still work", () => {
  const { dir, git } = makeRepo();
  try {
    optIn(dir, git);
    write(dir, "ROADMAP.md", HEADING_ANCHORED_ROADMAP);
    vocab.mark(dir, { file: "roadmap", key: "r-0101-2", state: "done" });
    assert.match(read(dir, "ROADMAP.md"), /- \[x\] a normal single-line item `r-0101-2`/);
  } finally { cleanup(dir); }
});

// --- park ------------------------------------------------------------------

test("park moves an item between Next and Later, and is reversible", () => {
  const { dir, git } = makeRepo();
  try {
    optIn(dir, git);
    write(dir, "ROADMAP.md", THREE_ITEM_ROADMAP);

    const parked = vocab.park(dir, { id: "r-0101-2", to: "Later" });
    assert.equal(parked.changed, true);
    let roadmap = read(dir, "ROADMAP.md");
    let nextBlock = roadmap.slice(roadmap.indexOf("## Next"), roadmap.indexOf("## Later"));
    let laterBlock = roadmap.slice(roadmap.indexOf("## Later"));
    assert.ok(!nextBlock.includes("r-0101-2"), "beta left Next");
    assert.ok(laterBlock.includes("r-0101-2"), "beta landed in Later");

    const unparked = vocab.park(dir, { id: "r-0101-2", to: "Next" });
    assert.equal(unparked.changed, true);
    roadmap = read(dir, "ROADMAP.md");
    nextBlock = roadmap.slice(roadmap.indexOf("## Next"), roadmap.indexOf("## Later"));
    laterBlock = roadmap.slice(roadmap.indexOf("## Later"));
    assert.ok(nextBlock.includes("- [ ] beta `r-0101-2`"), "parking back to Next restores the exact original line text");
    assert.ok(!laterBlock.includes("r-0101-2"), "beta left Later");
  } finally { cleanup(dir); }
});

test("park to the item's current section is a no-op", () => {
  const { dir, git } = makeRepo();
  try {
    optIn(dir, git);
    write(dir, "ROADMAP.md", THREE_ITEM_ROADMAP);
    const r = vocab.park(dir, { id: "r-0101-1", to: "Next" });
    assert.equal(r.changed, false);
  } finally { cleanup(dir); }
});

// --- fix (sol round three): mixed CRLF/LF terminator preservation ----------
//
// A single document-wide eol choice (the pre-fix `eolOf()` + `.join(nl)`
// pattern) would silently rewrite EVERY line's terminator, even ones a call
// never touched. Built by hand (not `.join("\n")`) so every line's own
// terminator is exact and under test control: "# ROADMAP"/blank lines and
// the "## Next" heading are CRLF, alpha is LF, beta is CRLF, gamma is LF,
// the blank line before "## Later" is CRLF, the "## Later" heading and its
// one item (delta) and trailing blank are their own mix too.
const MIXED_EOL_ROADMAP =
  "# ROADMAP\r\n" +
  "\n" +
  "## Next\r\n" +
  "\n" +
  "- [ ] alpha `r-0301-1`\n" +
  "- [ ] beta `r-0301-2`\r\n" +
  "- [ ] gamma `r-0301-3`\n" +
  "\r\n" +
  "## Later\r\n" +
  "\n" +
  "- [ ] delta `r-0301-4`\r\n" +
  "\n";

test("reorder on a mixed CRLF/LF ROADMAP.md leaves every untouched line byte-identical, including its own terminator", () => {
  const { dir, git } = makeRepo();
  try {
    optIn(dir, git);
    write(dir, "ROADMAP.md", MIXED_EOL_ROADMAP);

    const r = vocab.reorder(dir, { section: "Next", id: "r-0301-3", position: 1 });
    assert.equal(r.changed, true);
    const roadmap = read(dir, "ROADMAP.md");

    // Everything from "## Later" onward is untouched by a reorder scoped to
    // "## Next" - must be byte-for-byte identical, terminators included.
    const laterOnwardBefore = MIXED_EOL_ROADMAP.slice(MIXED_EOL_ROADMAP.indexOf("## Later"));
    const laterOnwardAfter = roadmap.slice(roadmap.indexOf("## Later"));
    assert.equal(laterOnwardAfter, laterOnwardBefore, "## Later section and everything after it must be byte-identical");

    // The heading and the blank line before it, inside "## Next", are also
    // untouched (only the three item lines' physical slots are rewritten).
    assert.ok(roadmap.startsWith("# ROADMAP\r\n\n## Next\r\n\n"), "the prefix up to the first item line must be byte-identical, CRLF/LF terminators included");

    // Each relocated item carries its OWN original terminator with it,
    // wherever it lands - not a document-wide default.
    assert.ok(roadmap.includes("- [ ] gamma `r-0301-3`\n"), "gamma (originally LF) keeps its own LF terminator after moving to position 1");
    assert.ok(roadmap.includes("- [ ] beta `r-0301-2`\r\n"), "beta (originally CRLF) keeps its own CRLF terminator");
    assert.ok(roadmap.includes("- [ ] alpha `r-0301-1`\n"), "alpha (originally LF) keeps its own LF terminator");
  } finally { cleanup(dir); }
});

test("park on a mixed CRLF/LF ROADMAP.md leaves every untouched line byte-identical, and the parked item's own terminator survives the round trip", () => {
  const { dir, git } = makeRepo();
  try {
    optIn(dir, git);
    write(dir, "ROADMAP.md", MIXED_EOL_ROADMAP);

    const parked = vocab.park(dir, { id: "r-0301-4", to: "Next" });
    assert.equal(parked.changed, true);
    const afterPark = read(dir, "ROADMAP.md");

    // Everything before "## Next" (the file's prefix) is untouched.
    const prefixBefore = MIXED_EOL_ROADMAP.slice(0, MIXED_EOL_ROADMAP.indexOf("## Next"));
    assert.equal(afterPark.slice(0, prefixBefore.length), prefixBefore, "the file's prefix before ## Next must be byte-identical");

    // delta's own line, content AND its original CRLF terminator, survives
    // the move as one unit - not a freshly-chosen eol for its new section.
    assert.ok(afterPark.includes("- [ ] delta `r-0301-4`\r\n"), "delta keeps its own CRLF terminator after being parked into Next");

    const unparked = vocab.park(dir, { id: "r-0301-4", to: "Later" });
    assert.equal(unparked.changed, true);
    const afterUnpark = read(dir, "ROADMAP.md");
    assert.ok(afterUnpark.includes("- [ ] delta `r-0301-4`\r\n"), "delta's own terminator survives the round trip back to Later");

    // The three items originally in "## Next" (alpha/beta/gamma, never
    // targeted by either park() call) are untouched throughout, including
    // their individual terminators.
    assert.ok(afterUnpark.includes("- [ ] alpha `r-0301-1`\n"));
    assert.ok(afterUnpark.includes("- [ ] beta `r-0301-2`\r\n"));
    assert.ok(afterUnpark.includes("- [ ] gamma `r-0301-3`\n"));
  } finally { cleanup(dir); }
});

// --- CLI wiring --------------------------------------------------------

test("vocab.js CLI: append-capture", () => {
  const { dir } = makeRepo();
  try {
    const r = run(dir, "vocab.js", ["append-capture", "buy", "milk"]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Captured -> IDEAS\.md: buy milk/);
    assert.match(read(dir, "IDEAS.md"), /buy milk/);
  } finally { cleanup(dir); }
});

test("vocab.js CLI: unknown verb exits non-zero with usage", () => {
  const { dir } = makeRepo();
  try {
    const r = run(dir, "vocab.js", ["not-a-real-verb"]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /unknown verb/);
  } finally { cleanup(dir); }
});

test("vocab.js CLI: move end to end (capture, then promote by position + expected line)", () => {
  const { dir, git } = makeRepo();
  try {
    optIn(dir, git);
    write(dir, "ROADMAP.md", ROADMAP_FIXTURE);
    run(dir, "vocab.js", ["append-capture", "cli-promoted-idea"]);
    const line = ideaLineAt(dir, 1);
    const r = run(dir, "vocab.js", ["move", "1", line]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(read(dir, "ROADMAP.md"), /cli-promoted-idea/);
  } finally { cleanup(dir); }
});

test("vocab.js CLI: move refuses a stale position/expectedLine pair", () => {
  const { dir, git } = makeRepo();
  try {
    optIn(dir, git);
    write(dir, "ROADMAP.md", ROADMAP_FIXTURE);
    run(dir, "vocab.js", ["append-capture", "cli-idea"]);
    const r = run(dir, "vocab.js", ["move", "1", "- [ ] 2020-01-01 00:00 (while: nobody) not the real line"]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /no longer matches the expected line/);
    assert.doesNotMatch(read(dir, "ROADMAP.md"), /cli-idea/);
  } finally { cleanup(dir); }
});

test("vocab.js CLI: mark ideas end to end (drop by position + expected line)", () => {
  const { dir } = makeRepo();
  try {
    run(dir, "vocab.js", ["append-capture", "cli-dropped-idea"]);
    const line = ideaLineAt(dir, 1);
    const r = run(dir, "vocab.js", ["mark", "ideas", "1", line, "dropped"]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(read(dir, "IDEAS.md"), /- \[x\] .*cli-dropped-idea/);
  } finally { cleanup(dir); }
});

// --- idea.js routes capture through vocab.js (one write path) --------------

test("idea.js's own source requires vocab.js and calls its append-capture verb - one write path, not a parallel one", () => {
  const src = fs.readFileSync(scriptPath("idea.js"), "utf8");
  assert.match(src, /require\(["']\.\/vocab\.js["']\)/, "idea.js must require vocab.js");
  assert.match(src, /vocab\.appendCapture\(/, "idea.js must delegate its write to vocab.appendCapture");
});

// --- fix 3: exact id association, even with byte-identical promoted lines --

test("two identical captures, promoted concurrently, each get their own correct id even though their ROADMAP.md lines are byte-identical before the id is stamped (no double-match)", async () => {
  const { dir, git } = makeRepo();
  try {
    optIn(dir, git, "same thread");
    write(dir, "ROADMAP.md", ROADMAP_FIXTURE);

    vocab.appendCapture(dir, "identical wording");
    vocab.appendCapture(dir, "identical wording"); // inserted above the first
    const lineNewer = ideaLineAt(dir, 1); // second capture, now on top
    const lineOlder = ideaLineAt(dir, 2); // first capture, shifted down
    // The two source lines may themselves be byte-identical (minute-precision
    // timestamps can collide on a fast run) - irrelevant here: each move()
    // below is targeted by POSITION first, expectedLine only confirms it,
    // so there is no ambiguity either way.

    const jobNewer = runAsync(dir, "vocab.js", ["move", "1", lineNewer]);
    const jobOlder = runAsync(dir, "vocab.js", ["move", "2", lineOlder]);
    const [resultNewer, resultOlder] = await Promise.all([jobNewer, jobOlder]);
    assert.equal(resultNewer.status, 0, resultNewer.stderr);
    assert.equal(resultOlder.status, 0, resultOlder.stderr);

    const roadmap = read(dir, "ROADMAP.md");
    // Both promoted lines are byte-identical up to the id suffix (same
    // wording, same capture date, same thread) - this is exactly the
    // scenario where text-matching the id back would be ambiguous.
    const occurrences = [...roadmap.matchAll(/- \[ \] identical wording \(captured: [^)]+\) `(r-\d{4}-\d+)`/g)].map((m) => m[1]);
    assert.equal(occurrences.length, 2, "both promoted lines present");
    assert.equal(new Set(occurrences).size, 2, "two distinct ids in the file, no id duplicated");

    const state = stateOf(dir);
    assert.equal(state.roadmapIds.length, 2, "the ledger records both ids");
  } finally { cleanup(dir); }
});

test("move()'s returned id is always the exact id stamped on the line it inserted, verified in-process against multiple identical promotions run sequentially", () => {
  const { dir, git } = makeRepo();
  try {
    optIn(dir, git, "same thread");
    write(dir, "ROADMAP.md", ROADMAP_FIXTURE);

    const cap1 = vocab.appendCapture(dir, "dup wording");
    const cap2 = vocab.appendCapture(dir, "dup wording"); // inserted above cap1, cap1 shifts to position 2

    // Marking position 1 (cap2) in place never renumbers cap1, which stays
    // at position 2 the whole time (see this file's header comment).
    const r2 = vocab.move(dir, { position: 1, expectedLine: cap2.entry });
    const r1 = vocab.move(dir, { position: 2, expectedLine: cap1.entry });

    assert.notEqual(r1.id, r2.id, "two distinct ids for two distinct promotions of identical wording");

    const roadmap = read(dir, "ROADMAP.md");
    // Each returned id must be findable on ITS OWN full line in the file -
    // proves the association is correct, not just "some id was returned".
    assert.match(roadmap, new RegExp("- \\[ \\] dup wording \\(captured: [^)]+\\) `" + r1.id + "`"));
    assert.match(roadmap, new RegExp("- \\[ \\] dup wording \\(captured: [^)]+\\) `" + r2.id + "`"));
  } finally { cleanup(dir); }
});

// --- concurrency: two concurrent verbs do not clobber -----------------------
//
// Reuses the test/roadmapids.test.js / test/state-concurrency.test.js
// pattern: hold the exact lock the roadmap transaction uses, fire both real
// writers (as separate processes, since Node is single-threaded and two
// in-process calls would never actually overlap) while it is held, then
// release and let them race for real. alpha is captured first, so beta (the
// later capture) lands at position 1 and alpha shifts to position 2 - both
// positions (and their expected lines) stay fixed regardless of which
// move() lands first, since marking one idea's line in place never
// renumbers the other (see this file's header comment).

const HOLD_LOCK = path.join(__dirname, "..", "tools", "hold-lock.js");

function holdLock(lockDir, id, holdMs, logFile) {
  return new Promise((resolve, reject) => {
    const c = spawn(process.execPath, [HOLD_LOCK, lockDir, id, String(holdMs), logFile]);
    let stderr = "";
    c.stderr.on("data", (d) => (stderr += d));
    c.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`hold-lock failed: ${stderr}`))));
  });
}

test("two concurrent move()s racing on the same ROADMAP.md never duplicate an id, never lose an item, and neither clobbers the other's insert", async () => {
  const { dir, git } = makeRepo();
  try {
    optIn(dir, git);
    write(dir, "ROADMAP.md", ROADMAP_FIXTURE);

    vocab.appendCapture(dir, "concurrent idea alpha");
    vocab.appendCapture(dir, "concurrent idea beta"); // inserted above alpha
    const lineBeta = ideaLineAt(dir, 1);
    const lineAlpha = ideaLineAt(dir, 2);

    const nowDir = path.join(dir, ".now");
    const lockDir = roadmapLockPath(nowDir);
    const logFile = path.join(dir, "lock-events.log");
    fs.writeFileSync(logFile, "");

    const holdMs = 300;
    const holdPromise = holdLock(lockDir, "HOLDER", holdMs, logFile);
    await new Promise((r) => setTimeout(r, 50));

    const jobBeta = runAsync(dir, "vocab.js", ["move", "1", lineBeta]);
    const jobAlpha = runAsync(dir, "vocab.js", ["move", "2", lineAlpha]);

    const [, resultBeta, resultAlpha] = await Promise.all([holdPromise, jobBeta, jobAlpha]);
    assert.equal(resultBeta.status, 0, "move beta should exit 0\n" + resultBeta.stderr);
    assert.equal(resultAlpha.status, 0, "move alpha should exit 0\n" + resultAlpha.stderr);

    const roadmap = read(dir, "ROADMAP.md");
    assert.ok(roadmap.includes("concurrent idea alpha"), "alpha not lost");
    assert.ok(roadmap.includes("concurrent idea beta"), "beta not lost");

    const ids = [...roadmap.matchAll(/`(r-\d{4}-\d+)`/g)].map((m) => m[1]);
    assert.equal(ids.length, 2, "both promoted items got exactly one id each");
    assert.equal(new Set(ids).size, 2, "no id duplicated across the two racing promotions");

    const state = stateOf(dir);
    assert.equal(state.roadmapIds.length, 2, "the ledger records both ids");
  } finally { cleanup(dir); }
});

// --- fix 2 (sol round two): cross-verb stability ----------------------------
//
// move()'s insert + id-issuance + index read-back now happen inside ONE
// acquisition of roadmapLockPath - the SAME lock reorder()/park() use for
// their own ROADMAP.md writes - so an interleaved reorder/park can never
// land between move()'s insert and its own read-back. These tests hold that
// lock externally, fire a real move() alongside a real reorder()/park() so
// both queue on it, then assert the invariant that must hold NO MATTER which
// one the scheduler lets through first: the id move() reports is the id
// actually stamped on move()'s own inserted line.

test("move interleaved with a concurrent reorder cannot invalidate the inserted line's id association", async () => {
  const { dir, git } = makeRepo();
  try {
    optIn(dir, git);
    write(dir, "ROADMAP.md", [
      "# ROADMAP", "",
      "## Next", "",
      "- [ ] existing alpha `r-0101-1`",
      "- [ ] existing beta `r-0101-2`",
      "",
      "## Later", "",
    ].join("\n"));
    const cap = vocab.appendCapture(dir, "promoted while a reorder races");

    const nowDir = path.join(dir, ".now");
    const lockDir = roadmapLockPath(nowDir);
    const logFile = path.join(dir, "lock-events.log");
    fs.writeFileSync(logFile, "");

    const holdMs = 300;
    const holdPromise = holdLock(lockDir, "HOLDER", holdMs, logFile);
    await new Promise((r) => setTimeout(r, 50));

    const jobMove = runAsync(dir, "vocab.js", ["move", "1", cap.entry]);
    const jobReorder = runAsync(dir, "vocab.js", ["reorder", "Next", "r-0101-2", "1"]);

    const [, moveResult, reorderResult] = await Promise.all([holdPromise, jobMove, jobReorder]);
    assert.equal(moveResult.status, 0, "move should exit 0\n" + moveResult.stderr);
    assert.equal(reorderResult.status, 0, "reorder should exit 0\n" + reorderResult.stderr);

    const idMatch = /\((r-\d{4}-\d+)\)/.exec(moveResult.stdout);
    assert.ok(idMatch, "move's stdout must report the id it stamped: " + moveResult.stdout);
    const id = idMatch[1];

    const roadmap = read(dir, "ROADMAP.md");
    assert.match(
      roadmap,
      new RegExp("- \\[ \\] promoted while a reorder races \\(captured: [^)]+\\) `" + id + "`"),
      "the id move() reported must be the id actually stamped on ITS OWN line, even with a reorder racing alongside"
    );
    assert.ok(roadmap.includes("`r-0101-1`") && roadmap.includes("`r-0101-2`"), "both pre-existing items survive the interleave");
  } finally { cleanup(dir); }
});

test("move interleaved with a concurrent park cannot invalidate the inserted line's id association", async () => {
  const { dir, git } = makeRepo();
  try {
    optIn(dir, git);
    write(dir, "ROADMAP.md", [
      "# ROADMAP", "",
      "## Next", "",
      "- [ ] parkable item `r-0202-1`",
      "",
      "## Later", "",
    ].join("\n"));
    const cap = vocab.appendCapture(dir, "promoted while a park races");

    const nowDir = path.join(dir, ".now");
    const lockDir = roadmapLockPath(nowDir);
    const logFile = path.join(dir, "lock-events.log");
    fs.writeFileSync(logFile, "");

    const holdMs = 300;
    const holdPromise = holdLock(lockDir, "HOLDER", holdMs, logFile);
    await new Promise((r) => setTimeout(r, 50));

    const jobMove = runAsync(dir, "vocab.js", ["move", "1", cap.entry]);
    const jobPark = runAsync(dir, "vocab.js", ["park", "r-0202-1", "Later"]);

    const [, moveResult, parkResult] = await Promise.all([holdPromise, jobMove, jobPark]);
    assert.equal(moveResult.status, 0, "move should exit 0\n" + moveResult.stderr);
    assert.equal(parkResult.status, 0, "park should exit 0\n" + parkResult.stderr);

    const idMatch = /\((r-\d{4}-\d+)\)/.exec(moveResult.stdout);
    assert.ok(idMatch, "move's stdout must report the id it stamped: " + moveResult.stdout);
    const id = idMatch[1];

    const roadmap = read(dir, "ROADMAP.md");
    assert.match(
      roadmap,
      new RegExp("- \\[ \\] promoted while a park races \\(captured: [^)]+\\) `" + id + "`"),
      "the id move() reported must be the id actually stamped on ITS OWN line, even with a park racing alongside"
    );
    const laterBlock = roadmap.slice(roadmap.indexOf("## Later"));
    assert.ok(laterBlock.includes("`r-0202-1`"), "the parked item landed in Later");
  } finally { cleanup(dir); }
});
