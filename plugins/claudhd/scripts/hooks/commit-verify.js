#!/usr/bin/env node
/*
 * ClauDHD commit verify - PostToolUse hook on Bash (1.0.11).
 *
 * The PreToolUse commit guard reconciles BEFORE the commit executes, so its
 * doc updates ride the same commit, but it can never know the hash or whether
 * the commit landed. This hook closes both gaps after the same Bash call:
 *
 *   - reads the pending record the guard wrote (pending-commit.js, keyed by
 *     session id, in the OS temp dir) and removes it;
 *   - compares HEAD. Unchanged: the commit did not land; a note goes to
 *     .now/reconcile.log and the guard's staged doc updates ride the next
 *     commit, which is the pre-1.0.11 behavior made visible;
 *   - changed: records the real hash, subject, plan and phase under
 *     state.json's `lastCommit` key (its own key, so the Stop checkpoint's
 *     `git` rewrite never drops it), and, when the guard could not parse the
 *     message at hook time, appends the SHIPPED.md entry now with the hash
 *     (SHIPPED.md is then left modified for the next commit; logged).
 *
 * Hard invariants, same as the guard: always exits 0; fails open on any
 * error; a missing or stale pending record is a no-op; never blocks a tool.
 * Node startup is the whole cost on the common path (no pending record).
 */
"use strict";
const fs = require("fs");
const path = require("path");

function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function note(root, text) {
  try {
    const nowDir = path.join(root, ".now");
    fs.mkdirSync(nowDir, { recursive: true });
    fs.appendFileSync(path.join(nowDir, "reconcile.log"), new Date().toISOString() + " " + text + "\n");
  } catch { /* best-effort */ }
}

function firstLine(s) {
  return String(s || "").split(/\r?\n/)[0].slice(0, 120);
}

function main() {
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(0, "utf8"));
  } catch {
    return; // malformed stdin -> fail open
  }
  if (!payload || typeof payload !== "object") return;

  const pc = require("../pending-commit.js");
  const sessionId = payload.session_id;
  const pending = pc.readPending(sessionId);
  if (!pending) return;
  pc.clearPending(sessionId);

  const root = pending.root;
  if (!root || !fs.existsSync(path.join(root, ".now"))) return;

  const age = Date.now() - Date.parse(pending.at || 0);
  if (!Number.isFinite(age) || age > pc.MAX_AGE_MS) {
    note(root, "commit verify: stale pending record dropped (" + firstLine(pending.command) + ")");
    return;
  }

  const head = pc.gitHead(root);
  if (!head || head === pending.headBefore) {
    note(root, "commit did not land: HEAD unchanged after `" + firstLine(pending.command) +
      "`; the pre-commit reconcile's staged doc updates ride the next commit");
    return;
  }

  const subject = pc.gitOut(root, ["log", "-1", "--format=%s"]) || "";
  const short = head.slice(0, 7);
  const nowDir = path.join(root, ".now");

  try {
    const { writeStateAtomic } = require("../state.js");
    writeStateAtomic(nowDir, {
      lastCommit: {
        sha: head,
        short,
        subject,
        at: new Date().toISOString(),
        plan: pending.plan != null ? pending.plan : null,
        phase: Number.isFinite(pending.phase) ? pending.phase : null,
        sessionId: pending.sessionId || null,
      },
    }, ["lastCommit"]);
  } catch (e) {
    note(root, "commit verify: could not record lastCommit " + short + ": " + (e && e.message));
  }

  if (pending.message == null) {
    try {
      const { appendEntry } = require("../shipped.js");
      appendEntry(root, subject + " `" + short + "`", today());
      note(root, "SHIPPED entry written post-commit with hash " + short +
        " (message was unavailable at hook time); SHIPPED.md is left modified for the next commit");
    } catch (e) {
      note(root, "commit verify: could not append SHIPPED entry for " + short + ": " + (e && e.message));
    }
  }
}

try {
  main();
} catch {
  // fail open
}
process.exit(0);
