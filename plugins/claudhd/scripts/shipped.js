#!/usr/bin/env node
/*
 * ClauDHD shipped - the /claudhd:shipped command.
 *
 * Pulls commits made since the last recorded commit (tracked by a marker in
 * SHIPPED.md) into the trophy case, grouped by date, newest first. Idempotent.
 * Finishing should be visible: it helps to see the pile grow.
 */
"use strict";
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// Provider-neutral first, then Claude Code's var, then cwd.
const ROOT = process.env.CLAUDHD_PROJECT_DIR || process.env.CLAUDE_PROJECT_DIR || process.cwd();
const SHIPPED = path.join(ROOT, "SHIPPED.md");
const MARKER_PREFIX = "<!-- last-sha:";

const HEADER =
`# SHIPPED (trophy case)

Finished work, newest first. Run \`/claudhd:shipped\` to pull in commits since the last entry. This exists so finishing is visible - it helps to see the pile grow.

<!-- last-sha: -->
`;

function git(args) {
  try {
    return execFileSync("git", ["-C", ROOT, ...args], {
      encoding: "utf8",
      timeout: 20000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function readMarker(body) {
  for (const line of body.split(/\r?\n/)) {
    if (line.startsWith(MARKER_PREFIX)) {
      return line.slice(MARKER_PREFIX.length).split("-->")[0].trim();
    }
  }
  return "";
}

const head = git(["rev-parse", "HEAD"]);
if (!head) {
  console.log("Not a git repo or no commits found.");
  process.exit(0);
}
if (!fs.existsSync(SHIPPED)) {
  try {
    fs.writeFileSync(SHIPPED, HEADER);
  } catch (e) {
    console.error("! ClauDHD: could not create SHIPPED.md (" + e.message + ").");
    process.exit(1);
  }
}
let body = fs.readFileSync(SHIPPED, "utf8");
const last = readMarker(body);
const newMarker = `${MARKER_PREFIX} ${head} -->`;

// First run (no recorded marker): start the trophy case from HERE instead of
// backfilling history. "Start tracking from now" is what people expect, and
// backfilling would dump setup/scaffolding commits into a brand-new case.
// Stamp the marker at HEAD and log nothing; the next run picks up whatever
// ships after this point.
if (!last) {
  const out = [];
  let stamped = false;
  for (const line of body.split(/\r?\n/)) {
    if (!stamped && line.startsWith(MARKER_PREFIX)) { out.push(newMarker); stamped = true; }
    else out.push(line);
  }
  if (!stamped) out.push("", newMarker);
  try {
    fs.writeFileSync(SHIPPED, out.join("\n").replace(/\s+$/, "") + "\n");
  } catch (e) {
    console.error("! ClauDHD: could not write SHIPPED.md (" + e.message + "). Nothing logged.");
    process.exit(1);
  }
  console.log("Trophy case started from here. Commits you ship from now on will show up - run /claudhd:shipped again after you finish something.");
  process.exit(0);
}

const fmt = "--pretty=format:%h\t%cd\t%s";
const log = git(["log", `${last}..HEAD`, fmt, "--date=short"]);

if (!log.trim()) {
  console.log("Nothing new to log. SHIPPED.md is up to date.");
  process.exit(0);
}

const byDate = {};
const order = [];
for (const line of log.split(/\r?\n/)) {
  const parts = line.split("\t");
  if (parts.length < 3) continue;
  const sha = parts[0];
  const date = parts[1];
  const subj = parts.slice(2).join("\t");
  if (!byDate[date]) { byDate[date] = []; order.push(date); }
  byDate[date].push(`- ${subj} (\`${sha}\`)`);
}
const block = order.map((d) => `### ${d}\n` + byDate[d].join("\n")).join("\n\n");

const out = [];
let inserted = false;
for (const line of body.split(/\r?\n/)) {
  if (line.startsWith(MARKER_PREFIX)) {
    out.push(newMarker, "", block);
    inserted = true;
  } else {
    out.push(line);
  }
}
if (!inserted) out.push("", newMarker, "", block);

try {
  fs.writeFileSync(SHIPPED, out.join("\n").replace(/\s+$/, "") + "\n");
} catch (e) {
  console.error("! ClauDHD: could not write SHIPPED.md (" + e.message + "). Nothing logged.");
  process.exit(1);
}
console.log(`Logged ${log.split(/\r?\n/).length} shipped item(s) to SHIPPED.md.`);
