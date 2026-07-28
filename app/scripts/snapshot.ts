// Freezes a real fleet scan to public/dev-fleet.json so the UI can be
// developed and eyeballed in a plain browser (vite dev, no tauri shell).
// The fixture adapter labels the provenance line "frozen scan" so the dev
// view never masquerades as live truth. Gitignored; regenerate at will.

import { mkdirSync, writeFileSync } from "node:fs";
import { DEFAULT_CONFIG } from "../src/core/config.js";
import { scanFleet } from "../src/core/scan.js";
import { nodeClock, nodeFs, nodeGit } from "../src/adapters/node.js";

const snapshot = await scanFleet({ fs: nodeFs, git: nodeGit, clock: nodeClock }, DEFAULT_CONFIG);
mkdirSync("public", { recursive: true });
writeFileSync("public/dev-fleet.json", JSON.stringify(snapshot, null, 1));
console.log(
  `froze ${snapshot.cards.length} cards + ${snapshot.untracked.length} shelf repos to public/dev-fleet.json`
);
