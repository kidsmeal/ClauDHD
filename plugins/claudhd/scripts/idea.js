#!/usr/bin/env node
/*
 * ClauDHD idea capture - the /claudhd:idea command.
 *
 * Appends a one-line, timestamped idea to <project>/IDEAS.md, tagged with the
 * thread that was active when it struck. Pure local append, zero model tokens.
 * The whole point: capturing is cheaper than chasing, so the current thread
 * survives instead of getting abandoned for a new chat.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { withLock } = require("./lock.js");

// Provider-neutral first, then Claude Code's var, then cwd.
const ROOT = process.env.CLAUDHD_PROJECT_DIR || process.env.CLAUDE_PROJECT_DIR || process.cwd();
const IDEAS = path.join(ROOT, "IDEAS.md");
const NOW_MD = path.join(ROOT, "NOW.md");
const LOCK = path.join(ROOT, ".now", "ideas.lock");

const HEADER =
`# IDEAS (capture, do not chase)

When an idea hits mid-task it lands here in one line. Do NOT open a new chat for it; the current thread survives. Triage regularly: each idea is promoted to the NOW.md Queue, kept parked, or killed.

Capture: \`/claudhd:idea <your idea>\` in any chat.
Harvest: \`/claudhd:harvest\` to backfill ideas from past chats you never parked.
Triage: \`/claudhd:triage\` to walk this list.

Legend: \`[ ]\` new, \`[~]\` promoted to NOW.md Queue, \`[x]\` done or killed.

## Inbox

(empty)
`;

function stampNow() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function activeThread() {
  try {
    const lines = fs.readFileSync(NOW_MD, "utf8").split(/\r?\n/);
    let grabbing = false;
    for (const line of lines) {
      const s = line.trim();
      if (s.startsWith("## Active thread")) { grabbing = true; continue; }
      if (grabbing && s.startsWith("## ")) break;
      if (grabbing && s.includes("**")) {
        const m = s.match(/\*\*(.+?)\*\*/);
        if (m) return m[1].trim();
      }
    }
  } catch { /* ignore */ }
  return "?";
}

const text = process.argv.slice(2).join(" ").trim();
if (!text) {
  console.log("Nothing captured. Usage: /claudhd:idea <your idea>");
  process.exit(0);
}

try {
  // Serialize the read-modify-write: without the lock, two captures racing (e.g.
  // /claudhd:idea fired from two open sessions) each read the same body and the
  // second write clobbers the first, silently dropping a parked idea - the one
  // failure a capture tool must never have.
  withLock(LOCK, () => {
    if (!fs.existsSync(IDEAS)) fs.writeFileSync(IDEAS, HEADER);
    let body = fs.readFileSync(IDEAS, "utf8");
    const entry = `- [ ] ${stampNow()} (while: ${activeThread()}) ${text}`;
    body = body.replace("\n(empty)\n", "\n");

    const inbox = "## Inbox\n";
    const idx = body.indexOf(inbox);
    if (idx !== -1) {
      const head = body.slice(0, idx + inbox.length);
      const tail = body.slice(idx + inbox.length).replace(/^\n+/, "");
      body = head + "\n" + entry + "\n" + tail;
    } else {
      body = body.replace(/\s+$/, "") + "\n\n## Inbox\n\n" + entry + "\n";
    }
    fs.writeFileSync(IDEAS, body);
  });
  console.log(`Captured -> IDEAS.md: ${text}`);
} catch (e) {
  console.error("! ClauDHD: could not write IDEAS.md (" + e.message + "). Idea not captured.");
  process.exit(1);
}
