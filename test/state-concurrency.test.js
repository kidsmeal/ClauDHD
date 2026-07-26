"use strict";
/*
 * Concurrency test for the shared state.json writer: a sentinel.js `write`
 * racing a checkpoint.js Stop must leave both the build section and the
 * cursor/ideas/shipped/roadmap/git facts intact - neither writer may clobber
 * the other's section, and both must go through the same lock.
 *
 * Reuses the pattern from test/lock.test.js and tools/hold-lock.js: rather than
 * hoping two independently-scheduled processes happen to overlap, this test
 * holds state.json's own lock (state.stateLockPath) for a fixed window via the
 * real hold-lock.js fixture, fires both writers while it is held (so both are
 * queued on the exact lock writeStateAtomic uses), then releases and lets them
 * race for real. Regardless of which one wins the race, the merge-preserving
 * writer means neither can erase the other's section.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { makeRepo, cleanup, run, runAsync, write, optIn, scriptPath } = require("../tools/helpers.js");
const { stateLockPath } = require("../plugins/claudhd/scripts/state.js");

const HOLD_LOCK = path.join(__dirname, "..", "tools", "hold-lock.js");

const FIXTURE_PLAN = `# Test Plan
Source design: docs/design.md
Conventions read: none
Verification command(s): node --test

## Summary
Fixture plan for state-concurrency.test.js.

## Phase 2: test phase two
**Goal:** Test phase two goal.
**Files:**
- create \`src/foo.js\`
- modify \`src/bar.js\`
**Verification:** node --test
**Exit criteria:** tests pass.
**Blockers:** None.

## Cross-cutting concerns
None.
`;

function holdLock(lockDir, id, holdMs, logFile) {
  return new Promise((resolve, reject) => {
    const c = spawn(process.execPath, [HOLD_LOCK, lockDir, id, String(holdMs), logFile]);
    let stderr = "";
    c.stderr.on("data", (d) => (stderr += d));
    c.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`hold-lock failed: ${stderr}`))));
  });
}

test("a sentinel.js write racing a checkpoint.js Stop leaves both the build section and the cursor/ideas/shipped/roadmap/git facts intact", async () => {
  const { dir, git } = makeRepo();
  try {
    optIn(dir, git, "racing thread");
    write(dir, "IDEAS.md", "# IDEAS\n## Inbox\n\n- [ ] 2026-07-01 (while: t) an idea\n");
    write(dir, "SHIPPED.md", "# SHIPPED\n\n### 2026-07-08\n- shipped a thing (`1234567`)\n");
    write(dir, "ROADMAP.md", "# ROADMAP\n## Next\n- [ ] a committed intent - done: y\n");
    write(dir, "plan.md", FIXTURE_PLAN);

    // Seed state.json with the facts a prior Stop already wrote, so the race
    // below is "does the build write survive alongside pre-existing facts",
    // not "does the very first write of each section work" (already covered
    // elsewhere).
    const first = run(dir, "checkpoint.js");
    assert.equal(first.status, 0, first.stderr);
    const statePath = path.join(dir, ".now", "state.json");
    const before = JSON.parse(fs.readFileSync(statePath, "utf8"));
    assert.equal(before.build, undefined, "sanity: no build section yet");
    assert.ok(before.cursor, "sanity: cursor facts present before the race");

    const nowDir = path.join(dir, ".now");
    const lockDir = stateLockPath(nowDir);
    const logFile = path.join(dir, "lock-events.log");
    fs.writeFileSync(logFile, "");

    // Hold state.json's own lock for a fixed window, then fire the two real
    // writers while it is held - both must queue on this exact lock.
    const holdMs = 300;
    const holdPromise = holdLock(lockDir, "HOLDER", holdMs, logFile);
    // Give the holder a moment to actually acquire (mkdir) before racing.
    await new Promise((r) => setTimeout(r, 50));

    const sentinelJob = runAsync(dir, "sentinel.js", ["write", "plan.md", "2"]);
    const checkpointJob = runAsync(dir, "checkpoint.js");

    const [, sentinelResult, checkpointResult] = await Promise.all([holdPromise, sentinelJob, checkpointJob]);

    assert.equal(sentinelResult.status, 0, "sentinel.js write should exit 0\n" + sentinelResult.stderr);
    assert.equal(checkpointResult.status, 0, "checkpoint.js should exit 0\n" + checkpointResult.stderr);

    const after = JSON.parse(fs.readFileSync(statePath, "utf8"));

    // The build section from sentinel.js's write must be present...
    assert.ok(after.build, "build section must be present after the race");
    assert.equal(after.build.phase, 2);
    assert.deepEqual(after.build.files, ["src/foo.js", "src/bar.js"]);

    // ...and checkpoint.js's facts must be present too - the race must not
    // have let one writer clobber the other's section.
    assert.equal(after.cursor.activeThread, "racing thread", "cursor facts survive the race");
    assert.equal(after.ideas.untriaged, 1, "ideas facts survive the race");
    assert.equal(after.shipped.total, 1, "shipped facts survive the race");
    assert.equal(after.roadmap.count, 1, "roadmap facts survive the race");
    assert.equal(after.schemaVersion, 2);
  } finally { cleanup(dir); }
});
