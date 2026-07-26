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
const { activeThread } = require("./nowfile.js");

// Single resolver for every ClauDHD script (see root.js).
const ROOT = require("./root.js")(process.env);
const IDEAS = path.join(ROOT, "IDEAS.md");
const NOW_MD = path.join(ROOT, "NOW.md");
const LOCK = path.join(ROOT, ".now", "ideas.lock");

const HEADER =
`# IDEAS (capture, do not chase)

When an idea comes up mid-task, it is recorded here in one line. Do NOT open a new chat for it; the current thread survives. Triage regularly: each idea is promoted to the NOW.md Queue, kept parked, or dropped.

Capture: \`/claudhd:idea <your idea>\` in any chat.
Harvest: \`/claudhd:harvest\` to backfill ideas from past sessions you never recorded.
Triage: \`/claudhd:triage\` to review this list.

Legend: \`[ ]\` new, \`[~]\` promoted to NOW.md Queue, \`[x]\` done or dropped.

## Inbox

(empty)
`;

function stampNow() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
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
    let nowTxt = ""; try { nowTxt = fs.existsSync(NOW_MD) ? fs.readFileSync(NOW_MD, "utf8") : ""; } catch { /* ignore */ }
    const thread = activeThread(nowTxt) || "?";
    const entry = `- [ ] ${stampNow()} (while: ${thread}) ${text}`;
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
