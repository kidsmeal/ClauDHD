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

const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const NOW_MD = path.join(ROOT, "NOW.md");
const NOW_DIR = path.join(ROOT, ".now");
const PLAIN = process.argv.includes("--plain");

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

function ageHours(p) {
  try {
    return (Date.now() - fs.statSync(p).mtimeMs) / 3600000;
  } catch {
    return null;
  }
}

function winsSinceLastVisit() {
  const head = git(["rev-parse", "HEAD"]);
  const anchor = path.join(NOW_DIR, "session-start-head");
  let prev = "";
  try {
    if (fs.existsSync(anchor)) prev = fs.readFileSync(anchor, "utf8").trim();
  } catch { /* ignore */ }
  let subjects = [];
  if (prev && head && prev !== head) {
    const log = git(["log", `${prev}..HEAD`, "--pretty=format:%s", "-50"]);
    subjects = log.split(/\r?\n/).filter((l) => l.trim());
  }
  try {
    fs.mkdirSync(NOW_DIR, { recursive: true });
    if (head) fs.writeFileSync(anchor, head);
  } catch { /* ignore */ }
  return subjects;
}

function emit(context) {
  if (PLAIN) {
    process.stdout.write(context + "\n");
  } else {
    process.stdout.write(JSON.stringify({
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

  const active = section(txt, "## Active thread");
  if (active) lines.push(active);

  const age = ageHours(NOW_MD);
  if (age && age > 72) {
    flags.push(`NOW.md has not been touched in ${Math.floor(age / 24)} days. Is the active thread still right?`);
  }

  const status = git(["status", "--short"]);
  if (status) {
    flags.push(`${status.split(/\r?\n/).length} uncommitted path(s) in the working tree. Commit, stash, or discard before drifting further.`);
  }

  const last = path.join(NOW_DIR, "last-session.md");
  if (fs.existsSync(last)) {
    const m = fs.readFileSync(last, "utf8").match(/Stopped:\s*(.+)/);
    if (m) lines.push(`Last session stopped: ${m[1].trim()}`);
  }

  const wins = winsSinceLastVisit();

  let out = "## Where you left off\n\n" + (lines.length ? lines.join("\n\n") : "(no NOW.md cursor found)");
  if (wins.length) {
    out += "\n\n## Shipped since you were last here\n\n" + wins.slice(0, 6).map((w) => `- ${w}`).join("\n");
    if (wins.length > 6) out += `\n- ... and ${wins.length - 6} more`;
    out += "\n\n(Run /claudhd:shipped to log these to your trophy case.)";
  }
  if (flags.length) {
    out += "\n\n## Drift flags\n\n" + flags.map((f) => `- ${f}`).join("\n");
  }
  out += "\n\n(Read NOW.md first. As you work, keep it live: when you finish a step, check it off in NOW.md and write the next tiny action, instead of waiting until you stop. Run /claudhd:wrap to reconcile NOW.md at the end of a chunk.)";

  emit(out);
} catch {
  // stay silent on any error
}
process.exit(0);
