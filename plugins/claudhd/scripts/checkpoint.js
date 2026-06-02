#!/usr/bin/env node
/*
 * ClauDHD checkpoint - Stop hook.
 *
 * Writes <project>/.now/last-session.md after every turn, so an abruptly
 * closed session always leaves a breadcrumb. Silent and never blocks: it
 * exits 0 no matter what, and prints nothing.
 *
 * No-op in projects that have not opted in to ClauDHD (no NOW.md present),
 * so installing the plugin globally does not touch unrelated repos.
 */
"use strict";
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const NOW_MD = path.join(ROOT, "NOW.md");
const NOW_DIR = path.join(ROOT, ".now");

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

function stampNow() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Branch names become file names under .now/branches/, so a feature/foo style
// branch can't escape the dir or collide with path separators. Empty for an
// unknown/missing branch, which tells the caller to skip the per-branch copy.
function safeBranch(b) {
  if (!b || b === "unknown") return "";
  return b.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 200);
}

function activeThread() {
  try {
    const lines = fs.readFileSync(NOW_MD, "utf8").split(/\r?\n/);
    let grabbing = false;
    const out = [];
    for (const line of lines) {
      const s = line.trim();
      if (s.startsWith("## Active thread")) { grabbing = true; continue; }
      if (grabbing && s.startsWith("## ")) break;
      if (grabbing) out.push(line);
    }
    return out.join("\n").trim();
  } catch {
    return "";
  }
}

try {
  if (!fs.existsSync(NOW_MD)) process.exit(0); // not a ClauDHD project
  // Only act on a NOW.md that ClauDHD created/marked, so an unrelated NOW.md
  // in someone else's repo never triggers this hook.
  let nowTxt = "";
  try { nowTxt = fs.readFileSync(NOW_MD, "utf8"); } catch { process.exit(0); }
  if (!nowTxt.includes("<!-- claudhd")) process.exit(0);
  fs.mkdirSync(NOW_DIR, { recursive: true });

  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]) || "unknown";
  const status = git(["status", "--short"]);
  const diffstat = git(["diff", "--stat"]);
  const recent = git(["log", "-5", "--oneline"]);
  const active = activeThread() || "(NOW.md had no Active thread section)";

  const body =
`# Last session checkpoint (auto-written, do not edit by hand)

Stopped: ${stampNow()}
Branch: ${branch}

## Active thread (from NOW.md)

${active}

## Uncommitted at stop

${status ? "```\n" + status + "\n```" : "(clean working tree)"}

## Diff stat

${diffstat ? "```\n" + diffstat + "\n```" : "(no unstaged changes)"}

## Recent commits

\`\`\`
${recent}
\`\`\`
`;
  fs.writeFileSync(path.join(NOW_DIR, "last-session.md"), body);

  // A per-branch copy, so the breadcrumb follows the branch you're on. When you
  // switch branches the brief reads THIS branch's checkpoint, not whichever
  // branch you happened to stop on last. last-session.md stays as the global
  // "where did I stop anywhere" fallback.
  const safe = safeBranch(branch);
  if (safe) {
    const bdir = path.join(NOW_DIR, "branches");
    fs.mkdirSync(bdir, { recursive: true });
    fs.writeFileSync(path.join(bdir, safe + ".md"), body);
  }
} catch {
  // never fail the hook
}
process.exit(0);
