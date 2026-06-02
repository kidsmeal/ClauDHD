"use strict";
/*
 * Cross-process mutual exclusion for ClauDHD's file writes.
 *
 * The lock is a directory: mkdir either creates it (lock acquired) or throws
 * EEXIST (held elsewhere). There is no gap between check and create, so it is a
 * true mutex across processes - unlike a read-then-write on a flag file. A lock
 * left behind by a crashed holder is broken after staleMs, so a dead process
 * can never wedge captures forever. Zero dependencies; used by idea.js.
 */
const fs = require("node:fs");
const path = require("node:path");

// Synchronous sleep that yields the CPU (no busy-spin) while waiting on a lock.
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function withLock(lockDir, fn, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 5000;
  const staleMs = opts.staleMs ?? 10000;
  const pollMs = opts.pollMs ?? 50;
  fs.mkdirSync(path.dirname(lockDir), { recursive: true });
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try { fs.mkdirSync(lockDir); break; } // atomic acquire
    catch (e) {
      if (e.code !== "EEXIST") throw e;
      let age = Infinity;
      try { age = Date.now() - fs.statSync(lockDir).mtimeMs; } catch { /* ignore */ }
      if (age > staleMs) { try { fs.rmdirSync(lockDir); } catch { /* ignore */ } continue; }
      if (Date.now() > deadline) throw new Error("timed out acquiring lock: " + lockDir);
      sleep(pollMs);
    }
  }
  try { return fn(); }
  finally { try { fs.rmdirSync(lockDir); } catch { /* ignore */ } }
}

module.exports = { withLock, sleep };
