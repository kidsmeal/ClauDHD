/*
 * drift-log.js - the out-of-scope work log (r-0729-1).
 *
 * ClauDHD 1.0 denied edits outside the active scope. That blocked ordinary
 * work and, worse, manufactured the exact drift it meant to prevent: finished
 * changes stranded outside the repo, waiting to be moved by hand. This module
 * is the replacement premise - record, do not deny. The guards allow every
 * edit and drop a line here when it lands outside a live build phase's file
 * list, so drift stays VISIBLE without work ever being BLOCKED.
 *
 * Scope only exists inside a live build sentinel. Idle and design declare no
 * file list, so nothing is "out of scope" there and nothing is logged - the
 * log records the one case that is genuinely drift: editing outside the phase
 * you told ClauDHD you were in.
 *
 * Lives in `.now/` (gitignored), so it never rides a commit - a local record,
 * like review-log.jsonl. Append-only, deduped by (session, path) so it reads
 * as "files touched out of scope this session", not a keystroke stream. Every
 * write is best-effort and swallows its own errors: logging must NEVER change
 * the fate of the edit that triggered it, the same rule the commit guard's
 * reconcile logging already follows.
 */
"use strict";
const fs = require("fs");
const path = require("path");

function driftLogPath(root) {
  return path.join(root, ".now", "out-of-scope.jsonl");
}

// Read the log back as an array of records, newest last. Absent, unreadable,
// or partially-corrupt files yield whatever valid lines parse; a malformed
// line is skipped, never thrown on. Callers (brief, statusline) surface a
// count from this; it never blocks anything.
function readDriftLog(root) {
  const out = [];
  let text;
  try {
    text = fs.readFileSync(driftLogPath(root), "utf8");
  } catch {
    return out; // absent or unreadable -> empty
  }
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line);
      if (rec && typeof rec === "object") out.push(rec);
    } catch {
      // Skip a torn/partial line rather than failing the whole read.
    }
  }
  return out;
}

// True when a (session, path) pair is already recorded, so the log stays a
// set of files touched rather than one line per keystroke. A read failure
// answers false (fail toward recording): a lost dedup check costs one extra
// line, never a dropped record.
function alreadyLogged(root, session, rel) {
  if (!session || !rel) return false;
  for (const rec of readDriftLog(root)) {
    if (rec.session === session && rec.path === rel) return true;
  }
  return false;
}

// Append one out-of-scope record. Best-effort: any failure (unwritable .now/,
// disk full) is swallowed so the edit that triggered this is never affected.
function logDrift(root, record) {
  try {
    if (alreadyLogged(root, record.session, record.path)) return;
    const file = driftLogPath(root);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(record) + "\n");
  } catch {
    // Logging never blocks or fails the edit.
  }
}

// Remove the log. Called when a fresh phase starts (sentinel.js write), so the
// log is bounded to the CURRENT phase's out-of-scope edits and never grows into
// an ever-climbing count that trains the eye to ignore it. Best-effort: an
// absent file or an unlink failure is fine, never thrown.
function clearDriftLog(root) {
  try { fs.rmSync(driftLogPath(root), { force: true }); } catch { /* nothing to clear */ }
}

module.exports = { logDrift, readDriftLog, driftLogPath, clearDriftLog };
