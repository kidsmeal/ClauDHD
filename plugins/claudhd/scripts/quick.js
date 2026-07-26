#!/usr/bin/env node
/*
 * ClauDHD quick fixes - the /claudhd:quick command.
 *
 * Two modes, mirroring how the command is used:
 *   /claudhd:quick <text>  -> append a small chore to the "## Quick fixes" batch
 *                             in NOW.md. Pure local append, zero model tokens,
 *                             like /claudhd:idea: capturing stays cheap, so the
 *                             active thread is never abandoned to record a chore.
 *   /claudhd:quick         -> print the batch so the command can clear it in one
 *                             focused pass (read-only here; the model does the work).
 *
 * The batch is the not-a-thread lane: small, self-contained work that would be
 * more overhead as its own active thread than as a quick fix. It is capped so it
 * can't quietly become a second backlog.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { withLock } = require("./lock.js");
const { QUICK_CAP } = require("./constants.js");

// Single resolver for every ClauDHD script (see root.js).
const ROOT = require("./root.js")(process.env);
const NOW_MD = path.join(ROOT, "NOW.md");
const LOCK = path.join(ROOT, ".now", "quick.lock");

// CAP is a signal, not a hard stop: adds past it still land, but loudly, so
// the batch gets cleared instead of growing into a backlog.
const CAP = QUICK_CAP;
const HEADING_RE = /^##\s+Quick fixes\b/i;
const PLACEHOLDER = "(nothing queued yet)";
const INTRO =
  "Small, self-contained chores that need no plan and aren't worth their own thread. " +
  "Capped at 3 - overflow means clear some or promote one out, so this stays a batch and never a second backlog. " +
  "Add with `/claudhd:quick <text>`, clear them in one focused pass with `/claudhd:quick`. " +
  "The active thread has right of way: clear these between threads, not mid-thread.";

// Find [start, end) line indices of the Quick fixes section, or null if absent.
function findSection(lines) {
  const start = lines.findIndex((l) => HEADING_RE.test(l));
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) { end = i; break; }
  }
  return { start, end };
}

function openCount(sectionLines) {
  return sectionLines.filter((l) => /^\s*-\s*\[ \]/.test(l)).length;
}

function listMode() {
  let txt = "";
  try { txt = fs.existsSync(NOW_MD) ? fs.readFileSync(NOW_MD, "utf8") : ""; } catch { txt = ""; }
  if (!txt) {
    console.log("No NOW.md here. Run /claudhd:init to set up ClauDHD in this project.");
    return;
  }
  const lines = txt.split(/\r?\n/);
  const sec = findSection(lines);
  const open = sec
    ? lines.slice(sec.start + 1, sec.end).filter((l) => /^\s*-\s*\[ \]/.test(l))
    : [];
  if (open.length === 0) {
    console.log("BATCH empty (0/" + CAP + "). No open quick fixes - add one with /claudhd:quick <text>.");
    return;
  }
  console.log("BATCH (" + open.length + "/" + CAP + "):");
  open.forEach((l, i) => console.log("  " + (i + 1) + ". " + l.replace(/^\s*-\s*\[ \]\s*/, "")));
  if (open.length > CAP) console.log("(over cap - clear it now, or promote the important one to the Queue.)");
}

function addMode(text) {
  try {
    let result;
    withLock(LOCK, () => {
      if (!fs.existsSync(NOW_MD)) {
        result = { ok: false, msg: "No NOW.md here. Run /claudhd:init first - quick fixes live in the NOW cursor." };
        return;
      }
      const raw = fs.readFileSync(NOW_MD, "utf8");
      const nl = raw.includes("\r\n") ? "\r\n" : "\n";
      let lines = raw.split(/\r?\n/);
      const item = "- [ ] " + text;
      const sec = findSection(lines);

      if (!sec) {
        // Self-heal: create the section for a NOW.md that predates this feature.
        // Slot it in before Idea flow / Loose ends / Leaving, else append.
        const block = ["## Quick fixes (clear in one pass)", "", INTRO, "", item, ""];
        const at = lines.findIndex((l) => /^##\s+(Idea flow|Loose ends|Leaving this file)/i.test(l));
        if (at === -1) {
          while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
          lines = lines.concat(["", ...block]);
        } else {
          lines.splice(at, 0, ...block);
        }
      } else {
        const secLines = lines.slice(sec.start + 1, sec.end);
        let phIdx = -1, lastItem = -1, lastNonBlank = -1;
        for (let i = 0; i < secLines.length; i++) {
          if (secLines[i].trim() === PLACEHOLDER) phIdx = i;
          if (/^\s*-\s*\[[ x~]\]/.test(secLines[i])) lastItem = i;
          if (secLines[i].trim() !== "") lastNonBlank = i;
        }
        if (phIdx !== -1) secLines[phIdx] = item;          // empty batch: replace placeholder
        else if (lastItem !== -1) secLines.splice(lastItem + 1, 0, item); // append after last item
        else if (lastNonBlank !== -1) secLines.splice(lastNonBlank + 1, 0, "", item); // after intro
        else secLines.push(item);
        lines = lines.slice(0, sec.start + 1).concat(secLines, lines.slice(sec.end));
      }

      fs.writeFileSync(NOW_MD, lines.join(nl));
      const sec2 = findSection(lines);
      result = { ok: true, open: sec2 ? openCount(lines.slice(sec2.start + 1, sec2.end)) : 1 };
    });

    if (!result || !result.ok) {
      console.log((result && result.msg) || "Quick fix not added.");
      return;
    }
    let out = "Quick fix added -> NOW.md (" + result.open + "/" + CAP + "): " + text;
    if (result.open > CAP) {
      out += "\n! Batch is over its cap (" + result.open + "/" + CAP + "). Clear it with /claudhd:quick, or promote the important one to the Queue - don't let it become a backlog.";
    } else if (result.open === CAP) {
      out += "\n(Batch is full at " + CAP + ". Clear it soon with /claudhd:quick.)";
    }
    console.log(out);
  } catch (e) {
    console.error("! ClauDHD: could not write NOW.md (" + e.message + "). Quick fix not added.");
    process.exit(1);
  }
}

const text = process.argv.slice(2).join(" ").trim();
if (!text) listMode();
else addMode(text);
