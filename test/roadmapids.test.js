"use strict";
/*
 * Tests for roadmapids.js - r-MMDD-N id generation and backfill.
 *
 * Load-bearing per the plan's Phase 3 Verification: next-unused counter, no
 * reuse after a delete, same-day collision, backfill preserves wording
 * byte-for-byte, non-date-prefixed legacy ids ignored safely. Plus (fix
 * round): the durable ledger backfill() returns, and exact byte preservation
 * on CRLF / mixed-line-ending input (this repo's CI runs on Windows with
 * autocrlf off).
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { nextId, backfill, idsInText } = require("../plugins/claudhd/scripts/roadmapids.js");
const { issueRoadmapIds, roadmapLockPath } = require("../plugins/claudhd/scripts/state.js");
const { makeRepo, cleanup, write, read } = require("../tools/helpers.js");

const DATE = new Date("2026-07-25T12:00:00Z");

test("nextId returns the next unused counter for today's date prefix", () => {
  const text = "- [ ] a `r-0725-1`\n- [ ] b `r-0725-2`\n";
  assert.equal(nextId(text, DATE), "r-0725-3");
});

test("nextId starts at 1 when no ids exist yet for the date", () => {
  assert.equal(nextId("", DATE), "r-0725-1");
});

test("nextId never reuses an id once the caller names it as already used, even if its line was deleted", () => {
  const afterDeletingTheHighestId = "- [ ] a `r-0725-1`\n"; // r-0725-2's line was removed
  const naive = nextId(afterDeletingTheHighestId, DATE);
  assert.equal(naive, "r-0725-2", "sanity: scanning current text alone would reuse the gap");
  const safe = nextId(afterDeletingTheHighestId, DATE, ["r-0725-1", "r-0725-2"]);
  assert.equal(safe, "r-0725-3", "a caller-supplied ledger prevents reissuing a deleted id");
});

test("same-day collision: sequential calls, feeding each id back into the text, never collide", () => {
  let text = "";
  const id1 = nextId(text, DATE);
  text += `- [ ] x \`${id1}\`\n`;
  const id2 = nextId(text, DATE);
  assert.notEqual(id1, id2);
  assert.equal(id2, "r-0725-2");
});

test("a different date prefix does not collide with today's counter", () => {
  const text = "- [ ] a `r-0724-9`\n";
  assert.equal(nextId(text, DATE), "r-0725-1", "yesterday's ids don't affect today's counter");
});

test("non-date-prefixed legacy ids are scanned safely and ignored for counter purposes", () => {
  const text = "- [ ] legacy item [legacy-42]\n- [ ] b `r-0725-1`\n";
  assert.equal(nextId(text, DATE), "r-0725-2", "a legacy id shape never confuses the r-MMDD-N counter");
  assert.doesNotThrow(() => idsInText("garbage r-abcd-x r-12-3 not an id"));
});

test("backfill stamps an id on every id-less item, preserving wording byte-for-byte", () => {
  const text = [
    "## Next",
    "- [ ] first intent - done: x",
    "- [ ] second intent - done: y `r-0725-5`",
    "## Later",
    "- [ ] third intent - done: z",
  ].join("\n");
  const { text: out, issued } = backfill(text, DATE);
  assert.ok(out.includes("first intent - done: x"), "original wording of the first id-less line survives verbatim");
  assert.ok(out.includes("second intent - done: y"), "original wording of the already-tagged line survives verbatim");
  assert.ok(out.includes("third intent - done: z"), "original wording of the second id-less line survives verbatim");

  const count5 = (out.match(/r-0725-5/g) || []).length;
  assert.equal(count5, 1, "the already-tagged line keeps its one existing id, not duplicated");

  assert.match(out, /first intent - done: x\s*`r-0725-6`/, "first id-less line gets the next free counter, skipping the used 5");
  assert.match(out, /third intent - done: z\s*`r-0725-7`/, "second id-less line gets the counter after that");
  assert.deepEqual(new Set(issued), new Set(["r-0725-5", "r-0725-6", "r-0725-7"]), "issued ledger reflects every id now in the text");
});

test("backfill is a no-op on text whose items already all carry ids", () => {
  const text = "- [ ] done already `r-0725-1`\n";
  const { text: out, issued } = backfill(text, DATE);
  assert.equal(out, text);
  assert.deepEqual(issued, ["r-0725-1"]);
});

test("backfill ignores heading/prose lines and only tags items inside a recognized item section", () => {
  const text = "# ROADMAP\n\nSome prose.\n\n## Next\n\n- [ ] real item\n";
  const { text: out } = backfill(text, DATE);
  assert.match(out, /# ROADMAP/);
  assert.match(out, /Some prose\./);
  assert.match(out, /real item\s*`r-0725-1`/);
});

test("backfill: ## Now's bullet never gets an id (it is the cursor pointer, not an item list), even in the real legacy shape ('- Nothing in flight.'); Shipped/Non-goals entries DO get ids, checkbox or plain-bullet wording alike", () => {
  const text = [
    "# ROADMAP",
    "",
    "## Now",
    "",
    "- Nothing in flight.",
    "",
    "## Next (candidates, not commitments)",
    "",
    "- [ ] Worktree fleet view (`/claudhd:fleet`) - list each worktree's active thread + checkpoint age.",
    "",
    "## Shipped",
    "",
    "- **Machine-readable state, cursor budget, statusline drift (v0.9.0).** Three changes so a NOW.md cursor stays lean.",
    "",
    "## Non-goals (decided, not \"later\" - see README)",
    "",
    "- **No cross-repo / multi-repo \"workspace\" cursor.** A feature that spans repos gets one cursor per repo.",
  ].join("\n");

  const { text: out, issued } = backfill(text, DATE);

  assert.ok(out.includes("- Nothing in flight."), "the Now pointer's bullet survives verbatim");
  assert.doesNotMatch(out, /Nothing in flight\.\s*`r-/, "the Now pointer must NOT get an id - ## Now is not an item list");

  assert.match(out, /checkpoint age\.\s*`r-0725-1`/, "the Next checkbox item gets an id");
  assert.match(out, /cursor stays lean\.\s*`r-0725-2`/, "the Shipped prose entry gets an id too - wording untouched, id appended");
  assert.match(out, /one cursor per repo\.\s*`r-0725-3`/, "the Non-goals prose entry gets an id too");

  // Wording itself survives byte-exact - only the trailing id is new.
  assert.ok(out.includes("- **Machine-readable state, cursor budget, statusline drift (v0.9.0).** Three changes so a NOW.md cursor stays lean."));
  assert.ok(out.includes("- **No cross-repo / multi-repo \"workspace\" cursor.** A feature that spans repos gets one cursor per repo."));

  assert.deepEqual(new Set(issued), new Set(["r-0725-1", "r-0725-2", "r-0725-3"]), "the Now pointer never contributes an id; the three real items do");
});

// Real input: this repo's own committed ROADMAP.md, not a synthetic fixture -
// the exact shape sol's finding was raised against.
test("real input: this repo's own ROADMAP.md - the ## Now pointer ('- Nothing in flight.') survives byte-identical; every Shipped/Non-goals/Next entry gets an id, wording untouched", () => {
  const real = fs.readFileSync(path.join(__dirname, "..", "ROADMAP.md"), "utf8");
  const { text: out } = backfill(real, DATE);

  assert.ok(real.includes("- Nothing in flight."), "sanity: the real file has the Now pointer this test is about");
  assert.ok(out.includes("- Nothing in flight."), "the Now pointer survives byte-identical");
  assert.doesNotMatch(out, /Nothing in flight\.\s*`r-/, "the Now pointer must never get an id");

  // Every other bullet line's WORDING survives (backfill only ever appends,
  // never rewrites), and every one of them - Next's checkbox item, Shipped's
  // and Non-goals' plain-bullet entries - ends up carrying an id.
  const realLines = real.split(/\r?\n/);
  const outLines = out.split(/\r?\n/);
  assert.equal(outLines.length, realLines.length, "backfill must not add or remove lines");
  let itemBulletsSeen = 0;
  for (let i = 0; i < realLines.length; i++) {
    const before = realLines[i];
    const after = outLines[i];
    if (!/^\s*-\s/.test(before) || before.includes("Nothing in flight.")) {
      assert.equal(after, before, `line ${i + 1} (a heading, prose, or the Now pointer) must be byte-identical`);
      continue;
    }
    itemBulletsSeen++;
    assert.ok(after.startsWith(before), `line ${i + 1}'s original wording must survive as a prefix`);
    assert.match(after, /\s`r-\d{4}-\d+`$/, `line ${i + 1} must gain an id`);
  }
  assert.ok(itemBulletsSeen >= 3, "sanity: the real file has at least the Next/Shipped/Non-goals bullets this test is about");
});

test("backfill never assigns an id already present elsewhere in the same text (e.g. in Shipped)", () => {
  const text = [
    "## Shipped",
    "- shipped thing `r-0725-1`",
    "## Next",
    "- [ ] new item",
  ].join("\n");
  const { text: out } = backfill(text, DATE);
  assert.match(out, /new item\s*`r-0725-2`/, "the new item must not collide with an id already used elsewhere in the file");
});

test("backfill treats an id merely referenced in an item's wording as id-less: it still gets its own id, and the reference is untouched", () => {
  const text = "## Next\n- [ ] follow r-0725-1\n";
  const { text: out } = backfill(text, DATE);
  assert.match(out, /^- \[ \] follow r-0725-1 `r-0725-2`$/m, "the wording (including the referenced id) survives verbatim; a new id is appended as THIS item's own rendered suffix");
});

// --- Durable ledger (fix round 2): backfill folds a caller-supplied ledger --

test("backfill's counter and returned ledger both account for ids in the ledger that are no longer visible in the text", () => {
  const text = "## Next\n- [ ] a\n"; // r-0725-1 and r-0725-2 are already spent, but neither line survives in text
  const { text: out, issued } = backfill(text, DATE, ["r-0725-1", "r-0725-2"]);
  assert.match(out, /a\s*`r-0725-3`/, "the counter continues past the ledger, not just what's visible in text");
  assert.ok(issued.includes("r-0725-1") && issued.includes("r-0725-2") && issued.includes("r-0725-3"), "the ledger is carried forward and grown, never shrunk");
});

// --- Byte-for-byte line-ending preservation (fix round 2) ------------------

test("backfill preserves a CRLF file's line endings exactly, changing only the tagged line's content", () => {
  const text = "## Next\r\n- [ ] first item\r\n- [ ] second item\r\n";
  const { text: out } = backfill(text, DATE);
  const expected = "## Next\r\n- [ ] first item `r-0725-1`\r\n- [ ] second item `r-0725-2`\r\n";
  assert.equal(out, expected, "every terminator must stay CRLF; only the two item lines' content changes");
});

test("backfill preserves a mixed-line-ending file exactly, line by line", () => {
  const text = "## Next\r\n- [ ] crlf item\n- [ ] lf item\r- [ ] cr item";
  const { text: out } = backfill(text, DATE);
  const expected =
    "## Next\r\n" +
    "- [ ] crlf item `r-0725-1`\n" +
    "- [ ] lf item `r-0725-2`\r" +
    "- [ ] cr item `r-0725-3`";
  assert.equal(out, expected, "each line's own terminator (or lack of one, on the final line) must survive untouched");
});

test("backfill preserves the presence or absence of a final trailing newline", () => {
  const withTrailingNewline = "## Next\n- [ ] a\n";
  const withoutTrailingNewline = "## Next\n- [ ] a";
  assert.equal(backfill(withTrailingNewline, DATE).text, "## Next\n- [ ] a `r-0725-1`\n");
  assert.equal(backfill(withoutTrailingNewline, DATE).text, "## Next\n- [ ] a `r-0725-1`");
});

// --- Concurrency: state.js's issueRoadmapIds() is the one locked transaction --
//
// Reuses the test/state-concurrency.test.js pattern: hold the exact lock the
// transaction uses (via tools/hold-lock.js) for a fixed window, fire two real
// issuers while it is held so both queue on it, then release and let them
// race for real. Each issuer runs in its own process (a `node -e` child, not
// an in-process call) since Node is single-threaded - two in-process calls
// would never actually overlap.

const HOLD_LOCK = path.join(__dirname, "..", "tools", "hold-lock.js");
const STATE_JS = JSON.stringify(path.join(__dirname, "..", "plugins", "claudhd", "scripts", "state.js"));

function holdLock(lockDir, id, holdMs, logFile) {
  return new Promise((resolve, reject) => {
    const c = spawn(process.execPath, [HOLD_LOCK, lockDir, id, String(holdMs), logFile]);
    let stderr = "";
    c.stderr.on("data", (d) => (stderr += d));
    c.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`hold-lock failed: ${stderr}`))));
  });
}

function issueRoadmapIdsInProcess(root, dateISO) {
  const script =
    `const { issueRoadmapIds } = require(${STATE_JS});` +
    `const path = require("path");` +
    `const root = ${JSON.stringify(root)};` +
    `const nowDir = path.join(root, ".now");` +
    `const roadmapPath = path.join(root, "ROADMAP.md");` +
    `process.stdout.write(JSON.stringify(issueRoadmapIds(nowDir, roadmapPath, new Date(${JSON.stringify(dateISO)}))));`;
  return new Promise((resolve, reject) => {
    const c = spawn(process.execPath, ["-e", script]);
    let stdout = "", stderr = "";
    c.stdout.on("data", (d) => (stdout += d));
    c.stderr.on("data", (d) => (stderr += d));
    c.on("close", (code) => (code === 0 ? resolve(JSON.parse(stdout)) : reject(new Error(`issuer failed: ${stderr}`))));
  });
}

test("two concurrent id issuers racing on the same ROADMAP.md never duplicate an id, never lose an item, and the ledger never shrinks", async () => {
  const { dir } = makeRepo();
  try {
    write(dir, "ROADMAP.md", ["## Next", "- [ ] item alpha", "- [ ] item beta"].join("\n"));

    const nowDir = path.join(dir, ".now");
    const lockDir = roadmapLockPath(nowDir);
    const logFile = path.join(dir, "lock-events.log");
    fs.writeFileSync(logFile, "");

    // Hold the exact lock issueRoadmapIds() uses for a fixed window, then fire
    // the two real issuers while it is held - both must queue on this lock.
    const holdMs = 300;
    const holdPromise = holdLock(lockDir, "HOLDER", holdMs, logFile);
    await new Promise((r) => setTimeout(r, 50));

    const dateISO = "2026-07-25T12:00:00.000Z";
    const [, resultA, resultB] = await Promise.all([
      holdPromise,
      issueRoadmapIdsInProcess(dir, dateISO),
      issueRoadmapIdsInProcess(dir, dateISO),
    ]);

    // Whichever issuer's turn came second, after acquiring the now-released
    // lock, must find the file already fully tagged by the first and make no
    // further change - that is the serialization guarantee under test.
    const changedCount = [resultA.changed, resultB.changed].filter(Boolean).length;
    assert.equal(changedCount, 1, "exactly one racing issuer performs the write; the other sees it already done");

    const roadmap = read(dir, "ROADMAP.md");
    assert.match(roadmap, /item alpha/, "no item lost");
    assert.match(roadmap, /item beta/, "no item lost");

    const ids = [...roadmap.matchAll(/`(r-\d{4}-\d+)`/g)].map((m) => m[1]);
    assert.equal(ids.length, 2, "both items got exactly one id each");
    assert.equal(new Set(ids).size, ids.length, "no id duplicated in the file");

    const state = JSON.parse(read(dir, path.join(".now", "state.json")));
    assert.equal(state.roadmapIds.length, 2, "the ledger records both ids - it never shrinks");
    assert.deepEqual(new Set(state.roadmapIds), new Set(ids), "the ledger matches exactly what ended up in the file");
  } finally { cleanup(dir); }
});
