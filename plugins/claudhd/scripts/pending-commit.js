"use strict";
/*
 * pending-commit.js - the handshake between the PreToolUse commit guard and
 * the PostToolUse commit verify (1.0.11).
 *
 * The guard runs BEFORE a `git commit` executes, so it can stage the
 * reconcile's doc updates onto the same commit but can never know the hash
 * or whether the commit landed. It writes one pending record here (root,
 * HEAD before, the parsed message or null, the live sentinel's plan/phase).
 * The verify hook runs AFTER the same Bash call, reads the record by session,
 * and compares HEAD. Records live in the OS temp dir, keyed by session id,
 * so nothing is written into the project for a commit that may not happen.
 *
 * Pure helpers plus two git reads; every failure returns null so both hooks
 * keep their always-exit-0 invariant.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const MAX_AGE_MS = 10 * 60 * 1000;

function key(sessionId) {
  return String(sessionId || "nosession").replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 80);
}

function pendingPath(sessionId) {
  return path.join(os.tmpdir(), "claudhd-pending-commit-" + key(sessionId) + ".json");
}

function gitOut(root, args) {
  try {
    return execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function gitHead(root) {
  const out = gitOut(root, ["rev-parse", "HEAD"]);
  return out || null; // an unborn branch has no HEAD: null, and any commit then counts as landed
}

function writePending(root, sessionId, extra) {
  const rec = Object.assign(
    { root, sessionId: sessionId || null, headBefore: gitHead(root), at: new Date().toISOString() },
    extra || {}
  );
  fs.writeFileSync(pendingPath(sessionId), JSON.stringify(rec));
  return rec;
}

function readPending(sessionId) {
  try {
    const rec = JSON.parse(fs.readFileSync(pendingPath(sessionId), "utf8"));
    return rec && typeof rec === "object" ? rec : null;
  } catch {
    return null;
  }
}

function clearPending(sessionId) {
  try { fs.unlinkSync(pendingPath(sessionId)); } catch { /* absent already */ }
}

module.exports = { MAX_AGE_MS, pendingPath, gitOut, gitHead, writePending, readPending, clearPending };
