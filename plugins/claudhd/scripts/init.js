#!/usr/bin/env node
/*
 * ClauDHD init - the /claudhd:init command.
 *
 * Scaffolds NOW.md, IDEAS.md, SHIPPED.md, and ROADMAP.md into the current
 * project from the bundled templates (never overwriting an existing file),
 * ensures NOW.md carries the opt-in marker the hooks gate on, and adds .now/
 * to the project's .gitignore. This is how a project opts in to ClauDHD.
 *
 * Also scaffolds the two living audit docs (CURRENTNESS_AUDIT.md and
 * RUNTIME_VERIFICATION_QUEUE.md, folded in from Gantry) into docs/ or the
 * project root, and the model-backend config (.gantry/models.json), gitignoring
 * the four local/transient .gantry/* files next to .now/. .gantry/models.json
 * deliberately keeps its path (it is not tidied into .now/ - see the design's
 * cross-cutting concern 9).
 *
 * Unlike the silent Stop/SessionStart hooks, init is an explicit command: if it
 * cannot write a file it says so clearly and exits non-zero, rather than
 * shrugging.
 *
 * After scaffolding it prints a few read-only repo signals (branch, recent
 * commits, uncommitted files) so the /claudhd:init command can propose a first
 * active thread for you to confirm, instead of asking you to name it cold.
 *
 * Plugin-native hook opt-in (folded in from Gantry): PreToolUse enforcement is
 * available but inert until --enable-hooks writes .now/enabled - the plan's
 * B1 activation gate, honored by both guards AND by the commit-boundary
 * reconcile (see reconcile.js's header comment). Handled UNCONDITIONALLY
 * (1.0.1 fix round): everything this needs (NOW_DIR, __filename) is derived
 * from __dirname/ROOT, never from CLAUDE_PLUGIN_ROOT. Gating the whole block
 * on that env var (pre-1.0.1) was a real bug - a Bash invocation of this
 * script does not inherit it the way the plugin host's own invocation does,
 * so --enable-hooks parsed by nothing and silently no-opped. CLAUDE_PLUGIN_ROOT
 * now only tailors the detection-only message's wording. The legacy
 * .gantry/enabled marker (pre-1.0) is still honored by the guards' own
 * enforcement gating for projects that already have it on disk, but this
 * script never writes it any more.
 */
"use strict";
const { execFileSync, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const roleCore = require("./role-core.js");
const nowrender = require("./nowrender.js");
const { issueRoadmapIds } = require("./state.js");

const ROOT = require("./root.js")(process.env);
const TEMPLATES = path.join(__dirname, "..", "templates");
const NOW_DIR = path.join(ROOT, ".now");
const MARKER = "<!-- claudhd: opt-in marker (do not remove) -->";

function git(args) {
  try {
    return execFileSync("git", ["-C", ROOT, ...args], {
      encoding: "utf8",
      timeout: 15000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}
function exists(rel) {
  try { return fs.existsSync(path.join(ROOT, rel)); } catch { return false; }
}

// NOW.md goes through render({}) rather than a template copy, so a fresh
// cursor can never diverge from the generated shape.
const created = [];
const kept = [];
const failed = [];
for (const name of ["NOW.md", "IDEAS.md", "SHIPPED.md", "ROADMAP.md"]) {
  const dest = path.join(ROOT, name);
  if (fs.existsSync(dest)) { kept.push(name); continue; }
  try {
    if (name === "NOW.md") fs.writeFileSync(dest, nowrender.render({}));
    else fs.copyFileSync(path.join(TEMPLATES, name), dest);
    created.push(name);
  } catch (e) {
    failed.push(name + " (" + e.message + ")");
  }
}

// Backfill r-MMDD-N ids onto any ROADMAP.md item that does not have one yet
// (design section 4), through state.js's issueRoadmapIds() - the one locked
// transaction every id issuer (init.js today; the write vocabulary later)
// must share, so two concurrent issuers can never duplicate an id, lose an
// item, or shrink the ledger. `new Date()` is read exactly once, here, and
// passed in explicitly - roadmapids.js itself never reads the clock.
let roadmapIdNote = "no ROADMAP.md to backfill";
let roadmapSectionsNote = null;
let roadmapWarning = null;
const roadmapPath = path.join(ROOT, "ROADMAP.md");
try {
  if (fs.existsSync(roadmapPath)) {
    const { changed, itemSections, text: backfilledText } = issueRoadmapIds(NOW_DIR, roadmapPath, new Date());
    roadmapIdNote = changed
      ? "backfilled ids onto existing ROADMAP.md items"
      : "every ROADMAP.md item already has an id";

    // Every "## " section is an item section except "## Now" (see
    // roadmapids.js's blocklist rule) - name exactly which headings this run
    // recognized, so a real project's own section names (not the template's
    // four) are visibly counted rather than silently skipped.
    const distinctSections = Array.from(new Set(itemSections || []));
    roadmapSectionsNote = distinctSections.length
      ? distinctSections.join(", ")
      : "(none found - no '## ' section other than '## Now')";

    // A file with bullet lines that nonetheless carries zero ids, or found
    // zero recognized item sections, almost certainly means the section-
    // detection logic missed real commitments - warn loudly rather than
    // silently reporting a false "backfilled ids" success (the exact failure
    // mode this fix round closes: twelve real commitments got no ids while
    // init printed "backfilled ids" and roadmap.count read 0).
    //
    // Checked against the CURRENT backfilled file's own content (`backfilledText`,
    // i.e. issueRoadmapIds()'s returned `text`), never the durable `roadmapIds`
    // ledger: the ledger accumulates every id ever issued across every past
    // run, so a project with a healthy prior run's ids already persisted would
    // have a non-empty ledger even if THIS run's file carries none at all -
    // masking exactly the failure this warning exists to catch.
    const hasBulletLines = /^\s*-\s*\S/m.test(fs.readFileSync(roadmapPath, "utf8"));
    const idsInCurrentFile = ((backfilledText || "").match(/`r-\d{4}-\d+`/g) || []).length;
    if (hasBulletLines && (distinctSections.length === 0 || idsInCurrentFile === 0)) {
      roadmapWarning =
        "! ClauDHD WARNING: ROADMAP.md has bullet lines but " +
        (distinctSections.length === 0 ? "no recognized item sections were found" : "the file carries zero ids") +
        " - every '## ' section is an item section except '## Now'; check ROADMAP.md's headings.";
    }
  }
} catch (e) {
  roadmapIdNote = "could not backfill ROADMAP.md ids (" + e.message + ")";
  failed.push("ROADMAP.md id backfill (" + e.message + ")");
}

// Ensure NOW.md carries the opt-in marker the hooks gate on, even if it
// pre-existed without one. Without this, an already-present NOW.md would go
// dormant under the marker gate.
let markerNote = "present";
const nowPath = path.join(ROOT, "NOW.md");
try {
  if (fs.existsSync(nowPath)) {
    const c = fs.readFileSync(nowPath, "utf8");
    if (!c.includes("<!-- claudhd")) {
      fs.writeFileSync(nowPath, MARKER + "\n\n" + c);
      markerNote = "added to existing NOW.md";
    }
  }
} catch (e) {
  failed.push("NOW.md marker (" + e.message + ")");
}

// The two living audit docs (folded in from Gantry). Docs land in docs/ if the
// project keeps one, else at the repo root - the same rule sentinel.js's
// allow-list computation uses, so the sentinel and the scaffold never disagree
// about where these live.
const docDir = exists("docs") ? "docs" : ".";
const auditCreated = [];
const auditKept = [];
for (const name of ["CURRENTNESS_AUDIT.md", "RUNTIME_VERIFICATION_QUEUE.md"]) {
  const relDest = path.join(docDir, name);
  const dest = path.join(ROOT, relDest);
  if (fs.existsSync(dest)) { auditKept.push(relDest); continue; }
  try {
    fs.copyFileSync(path.join(TEMPLATES, name), dest);
    auditCreated.push(relDest);
  } catch (e) {
    failed.push(relDest + " (" + e.message + ")");
  }
}

// Which external agent CLIs are available, so the model-backend scaffold below
// knows whether the codex reviewers it wants to write can actually run.
// Best-effort; an absent CLI just means the scaffold stays all-native.
function onPath(cmd) {
  try {
    const r = spawnSync(cmd + " --version", { stdio: "ignore", shell: true, timeout: 8000 });
    return !r.error && r.status === 0;
  } catch { return false; }
}

// For codex, `--version` alone is not proof it can run: a stale shim on PATH
// prints its version fine yet dies at startup when the shared
// ~/.codex/config.toml uses a newer schema than the shim understands (the
// app keeps its real, current binary in a versioned subdirectory of the same
// bin dir). `codex login status` forces a config load, so exit 0 means this
// binary can actually start. Called with no argument it probes the PATH
// `codex` (via shell, like onPath); with a full path it probes that binary.
function codexConfigLoads(bin) {
  try {
    const r = bin
      ? spawnSync(bin, ["login", "status"], { stdio: "ignore", timeout: 8000 })
      : spawnSync("codex login status", { stdio: "ignore", shell: true, timeout: 8000 });
    return !r.error && r.status === 0;
  } catch { return false; }
}

// Resolve which file `codex` on PATH actually is, so the probe can look for
// versioned sibling installs next to it.
function whichCodex() {
  try {
    const r = process.platform === "win32"
      ? spawnSync("where", ["codex"], { encoding: "utf8", timeout: 8000 })
      : spawnSync("command -v codex", { encoding: "utf8", shell: true, timeout: 8000 });
    if (r.error || r.status !== 0) return null;
    return (r.stdout || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean)[0] || null;
  } catch { return null; }
}

// When the PATH codex cannot load the config, the install that CAN is usually
// sitting right next to it: the codex app keeps versioned installs in
// hash-named subdirectories of the same bin directory its PATH shim lives in.
// Return the full path of the first sibling codex that passes the config-load
// probe, or null.
function findWorkingCodexSibling(pathBin) {
  const binDir = path.dirname(pathBin);
  const exe = process.platform === "win32" ? "codex.exe" : "codex";
  let entries;
  try { entries = fs.readdirSync(binDir, { withFileTypes: true }); } catch { return null; }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const candidate = path.join(binDir, ent.name, exe);
    if (!fs.existsSync(candidate)) continue;
    if (codexConfigLoads(candidate)) return candidate;
  }
  return null;
}

// The full codex probe. `codexBin` is null when the plain PATH `codex` works
// (or nothing works); it carries the sibling's full path when only the sibling
// works, and scaffoldConfig then writes that path into the backend cmd. A
// sibling path containing whitespace cannot be represented in the cmd template
// (it tokenizes on whitespace), so it counts as not found rather than being
// scaffolded broken.
function probeCodex() {
  if (!onPath("codex")) {
    return { available: false, codexBin: null, reason: "codex CLI not on PATH", status: "codex [missing]" };
  }
  if (codexConfigLoads()) {
    return { available: true, codexBin: null, reason: null, status: "codex [found]" };
  }
  const pathBin = whichCodex();
  const sibling = pathBin ? findWorkingCodexSibling(pathBin) : null;
  if (sibling && !/\s/.test(sibling)) {
    return {
      available: true,
      codexBin: sibling,
      reason: null,
      status: "codex [found - PATH binary cannot load ~/.codex/config.toml; using " + sibling + "]",
    };
  }
  return {
    available: false,
    codexBin: null,
    reason: "codex on PATH but it cannot load ~/.codex/config.toml and no working sibling install was found",
    status: "codex [broken - cannot load ~/.codex/config.toml]",
  };
}
const codex = probeCodex();

// Scaffold the model-backend config (.gantry/models.json, folded in from
// Gantry). Both reviewers route to codex when the codex CLI is on PATH - the
// two gates are worth a second model's eyes - and fall back to native when it
// is not, since a gate that cannot run is worse than no gate. Every other role
// is native, so the pipeline behaves exactly as before until flipped via
// /claudhd:models. This is per-machine config (its backends depend on which
// CLIs and API keys exist locally), so it is gitignored below rather than
// shared. Never overwrites an existing file.
let modelsStatus;
if (exists(path.join(".gantry", "models.json"))) {
  modelsStatus = "kept existing .gantry/models.json";
} else {
  try {
    fs.mkdirSync(path.join(ROOT, ".gantry"), { recursive: true });
    fs.writeFileSync(
      path.join(ROOT, ".gantry", "models.json"),
      JSON.stringify(roleCore.scaffoldConfig(codex.available, codex.codexBin), null, 2) + "\n"
    );
    modelsStatus = codex.available
      ? "created .gantry/models.json (both reviewers -> codex" +
        (codex.codexBin ? " via " + codex.codexBin : "") + ", rest native)"
      : "created .gantry/models.json (all roles native - " + codex.reason + ")";
  } catch (e) {
    modelsStatus = "could not write .gantry/models.json (" + e.message + ")";
  }
}

// .gitignore: .now/ (ClauDHD's own local session state) plus the three
// local/transient .gantry/* entries (folded in from Gantry: the sentinel, the
// per-machine model config, and the transient headless-guard settings) -
// additive and idempotent, one entry at a time. The .gantry/* entries are
// unconditional because models.json is scaffolded on every init, so it must
// stay ignored on every init too.
const GITIGNORE_ENTRIES = [
  ".now/",
  ".gantry/active-phase.json",
  ".gantry/models.json",
  ".gantry/headless-implementer-settings.json",
  ".gantry/review-round.json",
];
const gi = path.join(ROOT, ".gitignore");
let giTxt = "";
try { giTxt = fs.existsSync(gi) ? fs.readFileSync(gi, "utf8") : ""; } catch { /* ignore */ }
const giLines = giTxt.split(/\r?\n/).map((l) => l.trim());
const giMissing = GITIGNORE_ENTRIES.filter((e) => !giLines.includes(e));
let giNote;
if (giMissing.length === 0) {
  giNote = "already ignores .now/ and .gantry/*";
} else {
  try {
    fs.writeFileSync(
      gi,
      giTxt.replace(/\s*$/, "") + (giTxt.trim() ? "\n\n" : "") +
      "# ClauDHD local session state\n" + giMissing.join("\n") + "\n"
    );
    giNote = "added " + giMissing.join(", ");
  } catch (e) {
    giNote = "FAILED to update (" + e.message + ")";
  }
}

console.log(
  "ClauDHD init complete.\n" +
  "  Created: " + (created.length ? created.join(", ") : "none (all already present)") + "\n" +
  "  Kept existing: " + (kept.length ? kept.join(", ") : "none") + "\n" +
  "  NOW.md marker: " + markerNote + "\n" +
  "  ROADMAP.md ids: " + roadmapIdNote +
  (roadmapSectionsNote != null ? "\n  roadmap sections recognized: " + roadmapSectionsNote : "") + "\n" +
  "  .gitignore: " + giNote
);

if (roadmapWarning) console.error(roadmapWarning);

if (failed.length) {
  console.error("! ClauDHD: could not write " + failed.join("; ") + ".\n" +
    "  Fix the cause (permissions / disk) and re-run /claudhd:init.");
  process.exit(1);
}

console.log(
  "\n--- Runtime pipeline ---\n" +
  "  Audit docs (" + (docDir === "." ? "project root" : docDir + "/") + "): created " +
  (auditCreated.length ? auditCreated.join(", ") : "none (all already present)") +
  (auditKept.length ? "; kept existing " + auditKept.join(", ") : "") + "\n" +
  "  Model backends: " + modelsStatus
);

// Plugin-native hook opt-in: handled UNCONDITIONALLY - everything this needs
// (NOW_DIR, __filename) is derived from __dirname/ROOT already, never from
// CLAUDE_PLUGIN_ROOT. Gating the whole block on that env var (pre-1.0.1) was
// a real bug: a Bash invocation of this script (as opposed to the plugin
// host's own invocation) does not inherit CLAUDE_PLUGIN_ROOT, so
// `--enable-hooks` parsed by nothing, wrote no marker, and printed output
// byte-identical to a plain detection-only run - a silent no-op. The env var
// now only tailors the wording of the detection-only message below.
//
// Default run (no --enable-hooks flag): report that enforcement is available
// but NOT enabled, and print how to enable it. Do NOT write .now/enabled.
//
// With --enable-hooks flag: write the .now/enabled marker (B1) so the
// PreToolUse guards AND the commit-boundary reconcile become active. Lives
// inside .now/, which init.js's .gitignore step already covers wholesale, so
// no separate gitignore entry is needed - this is deliberately a per-machine
// opt-in, not a checked-in team setting. This must never silently no-op:
// either the marker ends up on disk (created or already present) or the run
// fails loudly with a non-zero exit.
const enableHooks = process.argv.includes("--enable-hooks");

if (!enableHooks) {
  // Detection-only report: inform that enforcement is available but inert.
  console.log(
    "\n--- Phase enforcement hooks ---\n" +
    "  " + (process.env.CLAUDE_PLUGIN_ROOT ? "This is a plugin install. " : "") +
    "PreToolUse enforcement is available but NOT enabled.\n" +
    "  The hooks are inert until you opt in. To enable them, re-run the opt-in step\n" +
    "  in /claudhd:init (it will run: node \"" + __filename + "\" --enable-hooks)."
  );
} else {
  // Explicit opt-in: write the .now/enabled marker (empty file).
  const markerPath = path.join(NOW_DIR, "enabled");
  try {
    fs.mkdirSync(NOW_DIR, { recursive: true });
    if (!fs.existsSync(markerPath)) {
      fs.writeFileSync(markerPath, "");
      console.log("\n--- Phase enforcement hooks ---\n  Created .now/enabled (hook opt-in marker).");
    } else {
      console.log("\n--- Phase enforcement hooks ---\n  .now/enabled already present.");
    }
  } catch (e) {
    console.error("! ClauDHD: could not write .now/enabled: " + e.message + "\n" +
      "  --enable-hooks must never silently no-op; fix the cause and re-run.");
    process.exit(1);
  }
}

// Read-only repo signals, so the command can PROPOSE a first active thread
// instead of asking you to name it cold. Pure reads; nothing is modified.
const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
const recent = git(["log", "-8", "--oneline"]);

// Real uncommitted work only - filter out ClauDHD's own footprint (the
// NOW.md/IDEAS.md/SHIPPED.md/ROADMAP.md/audit docs we just scaffolded, plus the
// .gitignore we just touched, all already reported above), so init doesn't echo
// its own changes back as drift. Use plain paths (diff --name-only + ls-files),
// not `status --short` columns: git() trims its output, which would shift the
// first line's status code and corrupt column parsing (same reason brief.js
// avoids it). Match the exact root-relative path git reports, NOT the basename -
// else a real file like docs/NOW.md would be wrongly swallowed as our own
// scaffolding. .gantry/models.json and friends never show up here anyway - they
// are gitignored above before this scan runs.
const own = new Set([
  "NOW.md", "IDEAS.md", "SHIPPED.md", "ROADMAP.md", ".gitignore",
  ...[...auditCreated, ...auditKept].map((p) => p.replace(/\\/g, "/")),
]);
const tracked = git(["diff", "--name-only", "HEAD"]);
const untracked = git(["ls-files", "--others", "--exclude-standard"]);
const dirty = [...new Set(
  (tracked + "\n" + untracked)
    .split(/\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((p) => !own.has(p))
)];

if (branch || recent || dirty.length) {
  console.log("\n--- Repo signals (to propose your first active thread) ---");
  if (branch) console.log("Branch: " + branch);
  if (recent) console.log("\nRecent commits:\n" + recent);
  if (dirty.length) console.log("\nUncommitted paths:\n" + dirty.map((p) => "  " + p).join("\n"));
} else {
  console.log("\n--- Repo signals: none (fresh or non-git project; just ask me what I'm working on) ---");
}
