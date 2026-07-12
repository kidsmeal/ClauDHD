// Live-fleet acceptance scan: drives the core over the real roots with the
// node adapter and prints the fleet, then checks the assassinrpg oracle.
// Manual hand-check surface; deliberately not part of `npm test`.

import { DEFAULT_CONFIG } from "../src/core/config.js";
import { scanFleet } from "../src/core/scan.js";
import { nodeClock, nodeFs, nodeGit } from "../src/adapters/node.js";
import { oracle } from "../test/oracle/assassinrpg.expected.js";

const snapshot = await scanFleet({ fs: nodeFs, git: nodeGit, clock: nodeClock }, DEFAULT_CONFIG);

console.log(`scanned ${new Date(snapshot.scannedAtMs).toISOString()}  roots: ${snapshot.roots.join(", ")}`);
console.log("");

for (const f of snapshot.fleetFlags) {
  console.log(`[fleet ${f.severity}] ${f.summary}  (${f.evidence.join(" · ")})`);
}

for (const c of snapshot.cards) {
  const sev = (s: string) => c.flags.filter((f) => f.severity === s).length;
  console.log(
    `\n${c.name}  [${c.source}]  parse:${c.parse.status}  crit:${sev("crit")} warn:${sev("warn")} info:${sev("info")}`
  );
  console.log(`  title:  ${c.title ?? "(no CLAUDE.md h1)"}`);
  console.log(`  thread: ${c.cursor?.activeThread ?? "(none)"}`);
  console.log(`  next:   ${c.cursor?.nextAction ?? "(no unchecked step)"}`);
  console.log(
    `  cursor: ${c.cursor?.activeThreadLineCount ?? "?"} lines, touched ${c.cursor?.lastTouched ?? "?"}  queue:${c.cursor?.queueCount ?? "?"} quick:${c.cursor?.quickFixCount ?? "?"}/${c.cursor?.quickFixCap ?? "cfg"} loose:${c.cursor?.looseEndsCount ?? "?"}`
  );
  console.log(
    `  ideas:  ${c.ideas?.untriaged ?? "?"} untriaged of ${c.ideas?.total ?? "?"} (oldest ${c.ideas?.oldestUntriagedDate ?? "none"})  shipped: ${c.shipped?.total ?? "?"} (last ${c.shipped?.lastEntryDate ?? "none"})  roadmap: ${c.roadmap?.count ?? "?"}`
  );
  console.log(
    `  git:    ${c.git?.branch ?? "?"} dirty:${c.git?.uncommitted ?? "?"} unpushed:${c.git?.unpushed ?? "no upstream"}  last: ${c.git?.lastCommitAt?.slice(0, 10) ?? "?"} ${c.git?.lastCommitMsg ?? ""}`
  );
  console.log(`  plans:  ${c.plans.length}  sentinel: ${c.sentinel != null ? c.sentinel.plan : "none"}`);
  for (const f of c.flags) {
    console.log(`  [${f.severity}] ${f.id}: ${f.summary}`);
    for (const ev of f.evidence) console.log(`        ${ev}`);
  }
}

console.log(`\nuntracked shelf (${snapshot.untracked.length}):`);
for (const u of snapshot.untracked) {
  console.log(`  ${u.name}  dirty:${u.uncommitted} unpushed:${u.unpushed ?? "no upstream"}`);
}

// ---- the assassinrpg oracle ----
console.log("\n--- oracle: assassinrpg ---");
const card = snapshot.cards.find((c) => c.name === "assassinrpg");
const failures = oracle(card);
if (failures.length === 0) {
  console.log("ORACLE PASS");
} else {
  console.log("ORACLE FAIL");
  for (const f of failures) console.log("  " + f);
  process.exitCode = 1;
}
