"use strict";
/* Consistency checks: the version lives in three files and the README's
 * command table must match commands/ - nothing keeps them honest except this
 * test. Ported from gantry's test/consistency.test.js and adapted to
 * claudhd's 16-command surface and its 5-FAIL-round escalation valve (which
 * supersedes gantry's 2-cycle cap). */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const REPO = path.join(__dirname, "..");
const PLUGIN = path.join(REPO, "plugins", "claudhd");

function readJson(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }
function frontmatterVersion(p) {
  const m = fs.readFileSync(p, "utf8").match(/^version:\s*(\S+)\s*$/m);
  return m ? m[1] : null;
}

const LOCKED_COMMANDS = [
  "now", "idea", "harvest", "triage", "roadmap", "start", "design", "plan",
  "build", "review", "quick", "override", "audit", "init", "models", "version",
];

test("version matches across plugin.json, marketplace.json, and the pipeline skill's frontmatter", () => {
  const version = readJson(path.join(PLUGIN, ".claude-plugin", "plugin.json")).version;
  assert.ok(version, "plugin.json must declare a version");

  const marketplace = readJson(path.join(REPO, ".claude-plugin", "marketplace.json"));
  assert.equal(marketplace.plugins[0].version, version, "marketplace.json version drifted from plugin.json");

  const skillPath = path.join(PLUGIN, "skills", "pipeline", "SKILL.md");
  assert.equal(frontmatterVersion(skillPath), version, "skills/pipeline/SKILL.md frontmatter version drifted from plugin.json");
});

test("commands/ contains exactly the 16-command surface, no more, no less", () => {
  const shipped = new Set(
    fs.readdirSync(path.join(PLUGIN, "commands"))
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(/\.md$/, ""))
  );
  const locked = new Set(LOCKED_COMMANDS);
  for (const cmd of shipped) {
    assert.ok(locked.has(cmd), "commands/" + cmd + ".md is not part of the locked 16-command surface");
  }
  for (const cmd of locked) {
    assert.ok(shipped.has(cmd), "locked command /claudhd:" + cmd + " has no commands/" + cmd + ".md");
  }
  assert.equal(shipped.size, 16, "commands/ must contain exactly 16 files, found " + shipped.size);
});

test("every command in the README table exists in commands/, and vice versa", () => {
  const readme = fs.readFileSync(path.join(REPO, "README.md"), "utf8");
  const tableRows = readme.split("\n").filter((l) => /^\|\s*`\/claudhd:/.test(l));
  const documented = new Set(
    tableRows.map((l) => l.match(/\/claudhd:([a-z-]+)/)[1])
  );
  const shipped = new Set(
    fs.readdirSync(path.join(PLUGIN, "commands"))
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(/\.md$/, ""))
  );

  for (const cmd of shipped) {
    assert.ok(documented.has(cmd), "commands/" + cmd + ".md is not in the README command table");
  }
  for (const cmd of documented) {
    assert.ok(shipped.has(cmd), "README documents /claudhd:" + cmd + " but commands/" + cmd + ".md does not exist");
  }
});

test("README.md's own prose command count matches the locked 16-command surface (sol round-six sweep)", () => {
  const readme = fs.readFileSync(path.join(REPO, "README.md"), "utf8");
  assert.doesNotMatch(readme, /fifteen commands/i,
    "README.md must not undercount the surface as fifteen - /claudhd:version is one of the 16, not an addition to 15");
  assert.match(readme, /sixteen commands/i,
    "README.md must state the surface as sixteen commands");
});

test("no deleted command survives anywhere under plugins/claudhd/commands/", () => {
  const shipped = fs.readdirSync(path.join(PLUGIN, "commands")).map((f) => f.replace(/\.md$/, ""));
  for (const dead of ["wrap", "shipped", "regroup", "statusline"]) {
    assert.ok(!shipped.includes(dead), "/claudhd:" + dead + " should have been deleted in phase 7");
  }
});

test("nothing under plugins/claudhd/ references /gantry:", () => {
  const offenders = [];
  function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) { walk(p); continue; }
      if (!/\.(md|js|json)$/.test(ent.name)) continue;
      const text = fs.readFileSync(p, "utf8");
      if (/\/gantry:/.test(text)) offenders.push(path.relative(REPO, p));
    }
  }
  walk(PLUGIN);
  assert.deepEqual(offenders, [], "these files still reference /gantry: " + offenders.join(", "));
});

test("phase-reviewer.md carries a Reachability check under Code discipline", () => {
  const text = fs.readFileSync(path.join(PLUGIN, "agents", "phase-reviewer.md"), "utf8");
  assert.ok(text.includes("Reachability"), "phase-reviewer.md must include a Reachability check");
  assert.ok(text.includes("Wired-by"), "phase-reviewer.md Reachability section must reference Wired-by declarations");
  assert.ok(/dead\s+code/i.test(text), "phase-reviewer.md must describe reachability as targeting silent dead code");
});

test("phase-reviewer.md carries the severity scale", () => {
  const text = fs.readFileSync(path.join(PLUGIN, "agents", "phase-reviewer.md"), "utf8");
  assert.ok(/Severity scale/i.test(text), "phase-reviewer.md must carry a severity scale");
  assert.ok(text.includes("S1"), "phase-reviewer.md severity scale must define S1");
  assert.ok(text.includes("S2"), "phase-reviewer.md severity scale must define S2");
  assert.ok(text.includes("S3"), "phase-reviewer.md severity scale must define S3");
  assert.ok(text.includes("S4"), "phase-reviewer.md severity scale must define S4");
});

test("phase-reviewer.md carries a real-input check under Test discipline", () => {
  const text = fs.readFileSync(path.join(PLUGIN, "agents", "phase-reviewer.md"), "utf8");
  assert.ok(text.includes("real-input"), "phase-reviewer.md must include a real-input check");
  assert.ok(/fixture.only/i.test(text) || text.includes("fixture-only"), "phase-reviewer.md must state that fixture-only is insufficient for real-input code");
});

test("phase-reviewer.md documents the optional prior-rounds input and the settled rule", () => {
  const text = fs.readFileSync(path.join(PLUGIN, "agents", "phase-reviewer.md"), "utf8");
  assert.ok(text.includes("Prior review rounds"), "phase-reviewer.md must name the optional re-review context block");
  assert.ok(/settled/i.test(text), "phase-reviewer.md must state that applied prior fixes are settled");
  assert.ok(/NEW defect/.test(text), "phase-reviewer.md must state the NEW-defect reopening ground");
});

test("phase-planner.md per-phase block includes the optional Wires/Wired-by field", () => {
  const text = fs.readFileSync(path.join(PLUGIN, "agents", "phase-planner.md"), "utf8");
  assert.ok(text.includes("Wires:"), "phase-planner.md must document the Wires: field form");
  assert.ok(text.includes("Wired-by:"), "phase-planner.md must document the Wired-by: field form");
});

test("implementer.md verification step carries the real-input rule", () => {
  const text = fs.readFileSync(path.join(PLUGIN, "agents", "implementer.md"), "utf8");
  assert.ok(text.includes("real-input") || text.includes("real input"), "implementer.md must include a real-input rule");
  assert.ok(/fixture.only/i.test(text) || text.includes("fixture-only"), "implementer.md must state fixture-only is insufficient for real-input code");
});

// --- Re-review context: the orchestrator docs must carry the mechanism, with
// the 5-FAIL-round valve, not gantry's 2-cycle cap. ---

test("review.md documents the re-review context mechanism", () => {
  const text = fs.readFileSync(path.join(PLUGIN, "commands", "review.md"), "utf8");
  assert.ok(text.includes("record-round"), "review.md must instruct recording the round before each fix relay");
  assert.ok(text.includes("--context .gantry/review-round.json"), "review.md must pass the context flag on external re-reviews");
  assert.ok(text.includes("show-round"), "review.md must use role.js show-round for native re-reviews");
  assert.ok(/settled/i.test(text), "review.md must state that applied prior fixes are settled");
  assert.ok(/NEW defect/.test(text), "review.md must state the NEW-defect reopening ground");
  assert.ok(/round one|first review/i.test(text), "review.md must keep context out of first-round reviews");
});

test("review.md carries the 5-FAIL-round escalation valve, not a 2-cycle cap", () => {
  const text = fs.readFileSync(path.join(PLUGIN, "commands", "review.md"), "utf8");
  assert.ok(/5 FAIL round/i.test(text), "review.md must state the 5-FAIL-round valve");
  assert.doesNotMatch(text, /up to 2 cycles/i, "review.md must not carry gantry's superseded 2-cycle wording");
  assert.match(text, /keep iterating/i);
  assert.match(text, /amend/i);
  assert.match(text, /overrule/i);
  assert.match(text, /round history/i, "review.md must present the round history at the cap, not just the latest findings");
});

test("review.md and SKILL.md instruct the compound single-Bash commit shape (clear preceding commit, one invocation), and hand-edit no post-commit plan-status (sol round-five ruling)", () => {
  const reviewText = fs.readFileSync(path.join(PLUGIN, "commands", "review.md"), "utf8");
  const skillText = fs.readFileSync(path.join(PLUGIN, "skills", "pipeline", "SKILL.md"), "utf8");

  // The compound shape: `sentinel.js clear` precedes `git commit`, joined by
  // && in the SAME command string - never a separate clear step ahead of a
  // separate commit step, since the commit-boundary reconcile must still see
  // the pre-clear sentinel when the whole compound command's PreToolUse hook
  // fires (before any of it has executed).
  const COMPOUND_RE = /sentinel\.js clear[^\n`]*&&[^\n`]*git commit/;
  assert.match(reviewText, COMPOUND_RE, "review.md must instruct the compound clear-then-commit shape as one Bash invocation");
  assert.match(skillText, COMPOUND_RE, "SKILL.md must instruct the compound clear-then-commit shape as one Bash invocation");

  // No post-commit plan-status-edit instruction: the reconcile owns the
  // `committed` transition automatically now (as part of that same compound
  // commit), so neither file may tell the orchestrator to hand-write it
  // after the user confirms the commit - the exact phrasing this replaces.
  assert.doesNotMatch(reviewText, /committed`?\s*once i confirm the commit/i,
    "review.md must not instruct a hand-written post-commit Status edit");
  assert.doesNotMatch(skillText, /after the user confirms the commit,?\s*set the phase'?s status to `?committed`?/i,
    "SKILL.md must not instruct a hand-written post-commit Status edit");
});

test("build.md fix-relay text records the round and re-reviews with context", () => {
  const text = fs.readFileSync(path.join(PLUGIN, "commands", "build.md"), "utf8");
  assert.ok(text.includes("record-round"), "build.md must mention recording the round on the fix-relay path");
  assert.ok(text.includes("--context .gantry/review-round.json"), "build.md must mention the re-review context flag");
});

test("build.md, review.md, and SKILL.md instruct the recorded fixes to be passed VERBATIM into the implementer prompt, native and external alike (sol round-six)", () => {
  const buildText = fs.readFileSync(path.join(PLUGIN, "commands", "build.md"), "utf8");
  const reviewText = fs.readFileSync(path.join(PLUGIN, "commands", "review.md"), "utf8");
  const skillText = fs.readFileSync(path.join(PLUGIN, "skills", "pipeline", "SKILL.md"), "utf8");

  assert.match(buildText, /fixes.{0,20}verbatim|verbatim.{0,20}(implementer|input|prompt)/i,
    "build.md must instruct the fixes be passed verbatim into the implementer's input");
  assert.match(buildText, /DISPATCH: native/, "build.md's verbatim instruction must cover the native dispatch form");
  assert.match(buildText, /DISPATCH: external/, "build.md's verbatim instruction must cover the external dispatch form");
  assert.match(reviewText, /verbatim/i, "review.md must instruct the fix relay to carry the fixes verbatim");
  assert.match(skillText, /verbatim/i, "SKILL.md's own fix-relay steps must also instruct the fixes carry verbatim");
});

test("skills/pipeline/SKILL.md re-review loop records rounds, passes context, and carries the 5-FAIL valve", () => {
  const text = fs.readFileSync(path.join(PLUGIN, "skills", "pipeline", "SKILL.md"), "utf8");
  assert.ok(text.includes("record-round"), "SKILL.md must record the round before each fix relay");
  assert.ok(text.includes("--context .gantry/review-round.json"), "SKILL.md must pass the context flag on external re-reviews");
  assert.ok(text.includes("show-round"), "SKILL.md must use role.js show-round for native re-reviews");
  assert.ok(/5 FAIL round/i.test(text), "SKILL.md must carry the 5-FAIL-round valve");
  assert.doesNotMatch(text, /2 fix-and-re-review cycles/i, "SKILL.md must not carry gantry's superseded 2-cycle cap wording");
});

test("SKILL.md's design audit step records every NEEDS USER DECISION marker as open BEFORE resolving it, mirroring design.md's lifecycle (sol round-six)", () => {
  const text = fs.readFileSync(path.join(PLUGIN, "skills", "pipeline", "SKILL.md"), "utf8");
  assert.match(text, /decision open/, "SKILL.md must record NEEDS USER DECISION markers as open");
  const openIdx = text.indexOf("decision open");
  const resolveIdx = text.indexOf("resolve-decision");
  assert.ok(openIdx !== -1 && resolveIdx !== -1 && openIdx < resolveIdx,
    "SKILL.md must record the marker open BEFORE resolving it, never the reverse");
  assert.match(text, /resolve-decision "<the exact marker text>" -- "<the real resolution>"/,
    "SKILL.md must use the two-argument resolve-decision form so the resolution text is the real answer, not the marker");
});

test("no command md, skill, or README carries adversary surface (sol round-one ruling: primary-reviewer-only)", () => {
  const offenders = [];
  const commandsDir = path.join(PLUGIN, "commands");
  for (const f of fs.readdirSync(commandsDir)) {
    const text = fs.readFileSync(path.join(commandsDir, f), "utf8");
    if (/adversary/i.test(text)) offenders.push("commands/" + f);
  }
  const skillPath = path.join(PLUGIN, "skills", "pipeline", "SKILL.md");
  if (/adversary/i.test(fs.readFileSync(skillPath, "utf8"))) offenders.push("skills/pipeline/SKILL.md");
  const readmeText = fs.readFileSync(path.join(REPO, "README.md"), "utf8");
  if (/adversary|second.reviewer/i.test(readmeText)) offenders.push("README.md");
  const pluginDesc = readJson(path.join(PLUGIN, ".claude-plugin", "plugin.json")).description;
  if (/adversary|second.reviewer/i.test(pluginDesc)) offenders.push("plugin.json description");
  const marketEntryDesc = readJson(path.join(REPO, ".claude-plugin", "marketplace.json")).plugins[0].description;
  if (/adversary|second.reviewer/i.test(marketEntryDesc)) offenders.push("marketplace.json plugin description");
  assert.deepEqual(offenders, [], "adversary surface found in: " + offenders.join(", "));
});

// --- command tool-surface: allowed-tools must cover what the body requires ---
//
// Pragmatic, not a general instruction parser: a table of (command, required
// tool pattern) pairs found by inspection (sol round-three finding). When a
// command's body grows a new tool requirement (an Edit step, a new Bash
// prefix, ...), ADD A ROW HERE - this test only catches drift for entries it
// already knows about, it does not derive requirements from the prose.
const REQUIRED_TOOL_SURFACE = [
  { command: "triage", tool: "Edit", reason: "the discuss flow replaces an IDEAS.md line via a normal gated edit" },
  { command: "audit", tool: "Bash(git log:*)", reason: "Part 1/Part 2 both run `git log --oneline ...`" },
];

test("command tool-surface: known command bodies carry every tool their instructions require in allowed-tools", () => {
  for (const { command, tool, reason } of REQUIRED_TOOL_SURFACE) {
    const cmdPath = path.join(PLUGIN, "commands", command + ".md");
    const text = fs.readFileSync(cmdPath, "utf8");
    const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    assert.ok(frontmatter, command + ".md must have a frontmatter block");
    const allowedLine = frontmatter[1].match(/^allowed-tools:\s*(.+)$/m);
    assert.ok(allowedLine, command + ".md frontmatter must declare allowed-tools");
    assert.ok(
      allowedLine[1].includes(tool),
      command + ".md's allowed-tools must include " + tool + " (" + reason + "); got: " + allowedLine[1]
    );
  }
});

test("no command md, README, or plugin description uses an em dash", () => {
  const offenders = [];
  const commandsDir = path.join(PLUGIN, "commands");
  for (const f of fs.readdirSync(commandsDir)) {
    const text = fs.readFileSync(path.join(commandsDir, f), "utf8");
    if (text.includes("—")) offenders.push("commands/" + f);
  }
  const readme = fs.readFileSync(path.join(REPO, "README.md"), "utf8");
  if (readme.includes("—")) offenders.push("README.md");
  const pluginDesc = readJson(path.join(PLUGIN, ".claude-plugin", "plugin.json")).description;
  if (pluginDesc.includes("—")) offenders.push("plugin.json description");
  const marketDesc = readJson(path.join(REPO, ".claude-plugin", "marketplace.json")).plugins[0].description;
  if (marketDesc.includes("—")) offenders.push("marketplace.json plugin description");
  assert.deepEqual(offenders, [], "em dash found in: " + offenders.join(", "));
});

test("start.md and roadmap.md name /claudhd:init (or a commit) as the id-less-item remedy, never /claudhd:audit (sol round-seven finding 2)", () => {
  const startText = fs.readFileSync(path.join(PLUGIN, "commands", "start.md"), "utf8");
  const roadmapText = fs.readFileSync(path.join(PLUGIN, "commands", "roadmap.md"), "utf8");

  assert.match(startText, /claudhd:init/,
    "start.md's id-less-item remedy must name /claudhd:init - the reconcile that backfills ids, not /claudhd:audit");
  assert.doesNotMatch(startText, /run `?\/claudhd:audit`?\s+or make a commit/i,
    "start.md must not tell the user to run /claudhd:audit to backfill a missing roadmap id");

  assert.match(roadmapText, /claudhd:init/,
    "roadmap.md's id-less-item remedy must name /claudhd:init - the reconcile that backfills ids, not /claudhd:audit");
  assert.doesNotMatch(roadmapText, /ids are stamped by[^.]*\/claudhd:audit/i,
    "roadmap.md must not credit /claudhd:audit with stamping roadmap ids - that is the commit-boundary reconcile or /claudhd:init");
});
