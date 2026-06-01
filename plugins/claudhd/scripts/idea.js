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

const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const IDEAS = path.join(ROOT, "IDEAS.md");
const NOW_MD = path.join(ROOT, "NOW.md");

const HEADER =
`# IDEAS (capture, do not chase)

When an idea hits mid-task it lands here in one line. Do NOT open a new chat for it; the current thread survives. Triage regularly: each idea is promoted to the NOW.md Queue, kept parked, or killed.

Capture: \`/claudhd:idea <your idea>\` in any chat.
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

if (!fs.existsSync(IDEAS)) fs.writeFileSync(IDEAS, HEADER);
let body = fs.readFileSync(IDEAS, "utf8");
const entry = `- [ ] ${stampNow()} (while: ${activeThread()}) ${text}`;
body = body.replace("\n(empty)\n", "\n");

const marker = "## Inbox\n";
const idx = body.indexOf(marker);
if (idx !== -1) {
  const head = body.slice(0, idx + marker.length);
  const tail = body.slice(idx + marker.length).replace(/^\n+/, "");
  body = head + "\n" + entry + "\n" + tail;
} else {
  body = body.replace(/\s+$/, "") + "\n\n## Inbox\n\n" + entry + "\n";
}
fs.writeFileSync(IDEAS, body);
console.log(`Captured -> IDEAS.md: ${text}`);
