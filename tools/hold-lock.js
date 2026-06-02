"use strict";
/*
 * Test fixture (not a test). Acquires a shared lock via the real lock.js, then
 * records ENTER/EXIT around a held critical section so a test can assert two
 * holders never overlap. Writes happen while holding the lock, so the log lines
 * cannot interleave either.
 *
 * Usage: node tools/hold-lock.js <lockDir> <id> <holdMs> <logFile>
 */
const fs = require("node:fs");
const { withLock, sleep } = require("../plugins/claudhd/scripts/lock.js");

const [, , lockDir, id, holdMs, logFile] = process.argv;

withLock(lockDir, () => {
  fs.appendFileSync(logFile, `${id} ENTER ${Date.now()}\n`);
  sleep(Number(holdMs));
  fs.appendFileSync(logFile, `${id} EXIT ${Date.now()}\n`);
}, { timeoutMs: 10000 });
