#!/usr/bin/env node
/*
 * relocate.js - move a project's ClauDHD files to new directories and write
 * .claude/claudhd.json to match. Reached through `/claudhd:init --relocate`
 * (init.js hands off here before scaffolding anything) or run directly:
 *
 *   node relocate.js --state <dir> [--audit <dir>] [--design <dir>]
 *                    [--also <path>...] [--dry-run]
 *
 *   --state   new directory for NOW.md, ROADMAP.md, IDEAS.md, SHIPPED.md.
 *   --audit   new directory for CURRENTNESS_AUDIT.md and
 *             RUNTIME_VERIFICATION_QUEUE.md. Omitted: the existing config's
 *             value, else "auto".
 *   --design  design-doc directory written to the config. Omitted: the
 *             existing config's value, else null. Nothing is moved for it.
 *   --also    extra root-relative files moved into the state directory
 *             (design docs, plans), with the same rules and cross-ref
 *             rewrites as the state files.
 *   --dry-run print the full plan and every refusal; write nothing.
 *
 * Plan first, then write. Each file's sources are its current location (per
 * the existing config) and its default location, minus the target:
 *   source only       -> git mv (plain rename when untracked)
 *   target only       -> skip
 *   both, identical   -> git rm the source (plain unlink when untracked)
 *   both, different   -> conflict; the whole run aborts and lists them
 *
 * Refusals (nothing written): a conflict; an invalid target directory; a
 * non-stale plan-backed build sentinel (a phase in flight has stored paths
 * this run would move out from under it); .claude/claudhd.json ignored by
 * git (the config must be committed to reach other clones).
 *
 * On a real run it also rewrites stored paths in .now/state.json
 * (build.plan, build.allow, build.files, build.originalFiles, design.doc,
 * commitPolicy.plan), writes and `git add`s .claude/claudhd.json, and
 * rewrites references in tracked *.md files: markdown link targets (relative
 * or root-absolute, re-derived for the containing file's new location),
 * backticked paths, and bare paths that contain a `/`. A bare file name
 * with no `/` in prose is left alone. SHIPPED.md is never rewritten: its
 * lines are history. Every rewrite prints as `file:line old -> new`.
 * Never commits.
 */
"use strict";
const { execFileSync, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const pathsLib = require("./paths.js");
const { readState, writeStateAtomic } = require("./state.js");
const { isStale } = require("./sentinel-core.js");

const STATE_KEYS = ["now", "roadmap", "ideas", "shipped"];
const AUDIT_KEYS = ["audit", "rvq"];

function parseArgs(argv) {
  const opts = { state: null, audit: null, design: null, also: [], dryRun: false, errors: [] };
  const valueFlags = { "--state": "state", "--audit": "audit", "--design": "design" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--relocate") continue;
    if (a === "--dry-run") { opts.dryRun = true; continue; }
    if (valueFlags[a]) {
      const v = argv[i + 1];
      if (v == null || v.startsWith("--")) { opts.errors.push(a + " needs a directory"); continue; }
      opts[valueFlags[a]] = v;
      i++;
      continue;
    }
    if (a === "--also") {
      while (argv[i + 1] != null && !argv[i + 1].startsWith("--")) opts.also.push(argv[++i]);
      continue;
    }
    opts.errors.push("unknown argument " + a);
  }
  if (!opts.state) opts.errors.push("--state <dir> is required");
  return opts;
}

function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function isTracked(root, rel) {
  const r = spawnSync("git", ["-C", root, "ls-files", "--error-unmatch", "--", rel], { stdio: "ignore" });
  return r.status === 0;
}

function isIgnored(root, rel) {
  const r = spawnSync("git", ["-C", root, "check-ignore", "-q", "--no-index", "--", rel], { stdio: "ignore" });
  return r.status === 0;
}

function readConfig(root) {
  try {
    const obj = JSON.parse(fs.readFileSync(path.join(root, ".claude", "claudhd.json"), "utf8"));
    return obj && obj.paths && typeof obj.paths === "object" ? obj.paths : {};
  } catch {
    return {};
  }
}

function sameBytes(a, b) {
  try { return fs.readFileSync(a).equals(fs.readFileSync(b)); } catch { return false; }
}

function joinRel(dir, name) {
  return dir === "." ? name : dir + "/" + name;
}

// Build the full plan. Pure reads; never writes.
function buildPlan(root, opts) {
  const refusals = [];
  const conflicts = [];
  const moves = [];     // { from, to, tracked }
  const removes = [];   // { from, keep, tracked }
  const skips = [];     // { rel, why }

  const existing = readConfig(root);
  const dirs = {};
  for (const key of ["state", "audit", "design"]) {
    const given = opts[key];
    if (given == null) continue;
    if (key === "audit" && given === "auto") { dirs.audit = "auto"; continue; }
    const v = pathsLib.validateDir(root, key, given);
    if (v.error) refusals.push("invalid --" + key + ": " + v.error);
    else dirs[key] = v.rel;
  }
  const newPaths = {
    state: dirs.state || ".",
    audit: dirs.audit || (existing.audit != null ? existing.audit : "auto"),
    design: dirs.design !== undefined ? dirs.design : (existing.design != null ? existing.design : null),
  };
  const config = { version: 1, paths: newPaths };
  if (refusals.length) return { config, moves, removes, skips, conflicts, refusals, map: new Map() };

  // Current and default locations of every file, then the target.
  const cur = pathsLib.resolvePaths(root, { fresh: true });
  const defAudit = pathsLib.defaultAuditDir(root);
  const tgtAudit = newPaths.audit === "auto" ? defAudit : newPaths.audit;

  const items = [];
  for (const key of STATE_KEYS) {
    const name = path.posix.basename(cur[key].rel);
    items.push({ name, sources: [cur[key].rel, name], target: joinRel(newPaths.state, name) });
  }
  for (const key of AUDIT_KEYS) {
    const name = path.posix.basename(cur[key].rel);
    items.push({ name, sources: [cur[key].rel, joinRel(defAudit, name), name], target: joinRel(tgtAudit, name) });
  }
  for (const raw of opts.also) {
    const v = pathsLib.validateDir(root, "also", path.posix.dirname(raw.replace(/\\/g, "/")));
    const rel = v.error ? null : joinRel(v.rel, path.posix.basename(raw.replace(/\\/g, "/")));
    if (!rel) { refusals.push("invalid --also " + raw + ": " + v.error); continue; }
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) { skips.push({ rel, why: "--also path does not exist" }); continue; }
    if (fs.statSync(abs).isDirectory()) { refusals.push("--also " + rel + " is a directory; name files"); continue; }
    items.push({ name: path.posix.basename(rel), sources: [rel], target: joinRel(newPaths.state, path.posix.basename(rel)) });
  }

  // old rel -> new rel, for every file that moves or is removed as a duplicate.
  const map = new Map();
  for (const it of items) {
    const tAbs = path.join(root, it.target);
    const srcs = [...new Set(it.sources)].filter((s) => s !== it.target && fs.existsSync(path.join(root, s)));
    const targetExists = fs.existsSync(tAbs);
    if (srcs.length === 0) {
      if (targetExists) skips.push({ rel: it.target, why: "already at the target" });
      continue;
    }
    if (targetExists) {
      for (const s of srcs) {
        if (sameBytes(path.join(root, s), tAbs)) removes.push({ from: s, keep: it.target, tracked: isTracked(root, s) });
        else conflicts.push(s + " and " + it.target + " both exist and differ");
        map.set(s, it.target);
      }
      continue;
    }
    const [first, ...rest] = srcs;
    const differing = rest.filter((s) => !sameBytes(path.join(root, s), path.join(root, first)));
    if (differing.length) {
      conflicts.push([first, ...differing].join(" and ") + " are two copies of " + it.name + " that differ; target " + it.target + " is free");
      continue;
    }
    moves.push({ from: first, to: it.target, tracked: isTracked(root, first) });
    map.set(first, it.target);
    for (const s of rest) { removes.push({ from: s, keep: it.target, tracked: isTracked(root, s) }); map.set(s, it.target); }
  }

  // A phase in flight holds stored paths this run would move.
  const state = readState(path.join(root, ".now"));
  const build = state && state.build;
  if (build && build.plan != null && !isStale(build, process.env.CLAUDE_SESSION_ID || process.env.CLAUDE_CODE_SESSION_ID)) {
    refusals.push("build phase " + build.phase + " of " + build.plan + " is in flight; finish or clear it (sentinel.js clear) first");
  }
  if (isIgnored(root, pathsLib.CONFIG_REL)) {
    refusals.push(pathsLib.CONFIG_REL + " is ignored by git; un-ignore it so the config is committed with the project");
  }

  return { config, moves, removes, skips, conflicts, refusals, map, state };
}

// --- state.json stored paths -------------------------------------------

function stateRewrites(state, map) {
  const out = [];
  if (!state) return { out, patch: null, keys: [] };
  const m = (p) => (typeof p === "string" && map.has(p) ? map.get(p) : p);
  const patch = {};
  const keys = [];
  if (state.build && typeof state.build === "object") {
    const b = Object.assign({}, state.build);
    let changed = false;
    if (m(b.plan) !== b.plan) { out.push(["build.plan", b.plan, m(b.plan)]); b.plan = m(b.plan); changed = true; }
    for (const f of ["allow", "files", "originalFiles"]) {
      if (!Array.isArray(b[f])) continue;
      const next = b[f].map(m);
      next.forEach((v, i) => { if (v !== b[f][i]) { out.push(["build." + f, b[f][i], v]); changed = true; } });
      b[f] = next;
    }
    if (changed) { patch.build = b; keys.push("build"); }
  }
  if (state.design && typeof state.design === "object" && m(state.design.doc) !== state.design.doc) {
    out.push(["design.doc", state.design.doc, m(state.design.doc)]);
    patch.design = Object.assign({}, state.design, { doc: m(state.design.doc) });
    keys.push("design");
  }
  if (state.commitPolicy && typeof state.commitPolicy === "object" && m(state.commitPolicy.plan) !== state.commitPolicy.plan) {
    out.push(["commitPolicy.plan", state.commitPolicy.plan, m(state.commitPolicy.plan)]);
    patch.commitPolicy = Object.assign({}, state.commitPolicy, { plan: m(state.commitPolicy.plan) });
    keys.push("commitPolicy");
  }
  return { out, patch: keys.length ? patch : null, keys };
}

// --- cross-reference rewrites in tracked *.md --------------------------

const LINK_RE = /(\]\()(<?)([^)\s>]+)(>?)((?:\s+"[^"]*")?\))/g;
const BOUND_BEFORE = /[\w./\\-]/;
const BOUND_AFTER = /[\w/\\-]/;

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Rewrite one markdown link target seen in a file that moves fileOld ->
// fileNew. Returns the new target or null when nothing changes.
function rewriteLink(target, fileOld, fileNew, map) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#") || target.startsWith("//")) return null;
  const hashAt = target.indexOf("#");
  const bare = hashAt === -1 ? target : target.slice(0, hashAt);
  const frag = hashAt === -1 ? "" : target.slice(hashAt);
  if (!bare) return null;
  if (bare.startsWith("/")) {
    const rel = path.posix.normalize(bare.slice(1));
    return map.has(rel) ? "/" + map.get(rel) + frag : null;
  }
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(fileOld), bare));
  if (resolved.startsWith("../") || resolved === "..") return null;
  const newTarget = map.has(resolved) ? map.get(resolved) : resolved;
  if (newTarget === resolved && fileOld === fileNew) return null;
  let rel = path.posix.relative(path.posix.dirname(fileNew), newTarget) || path.posix.basename(newTarget);
  if (bare.startsWith("./") && !rel.startsWith("../")) rel = "./" + rel;
  const out = rel + frag;
  return out === target ? null : out;
}

// Replace root-relative path tokens outside link targets in one pass (so a
// rewritten path is never rewritten again): a path containing `/` wherever
// it stands alone, a bare file name only inside backticks. Returns the new
// text and one { from, to } per replacement.
function rewriteTokens(segment, map) {
  const hits = [];
  if (!map.size) return { text: segment, hits };
  const keys = [...map.keys()].sort((a, b) => b.length - a.length);
  const re = new RegExp(keys.map(escapeRe).join("|"), "g");
  const text = segment.replace(re, (match, offset, whole) => {
    const before = offset > 0 ? whole[offset - 1] : "";
    const after = whole[offset + match.length] || "";
    const afterNext = whole[offset + match.length + 1] || "";
    // A trailing "." ends a sentence; ".bak" extends the path.
    const extends_ = (after && BOUND_AFTER.test(after)) || (after === "." && /\w/.test(afterNext));
    const standalone = !(before && BOUND_BEFORE.test(before)) && !extends_;
    const ticked = before === "`" && after === "`";
    if (!(match.includes("/") ? standalone : ticked)) return match;
    hits.push({ from: match, to: map.get(match) });
    return map.get(match);
  });
  return { text, hits };
}

function refRewrites(root, plan, shippedTargets) {
  let tracked = [];
  try {
    tracked = git(root, ["ls-files", "-z", "--", "*.md"]).split("\0").filter(Boolean);
  } catch { tracked = []; }
  const removed = new Set(plan.removes.map((r) => r.from));
  const moveOf = new Map(plan.moves.map((m) => [m.from, m.to]));
  const edits = [];  // { file, readFrom, text, lines: [{ n, from, to }] }
  for (const fileOld of tracked) {
    if (removed.has(fileOld)) continue;
    const fileNew = moveOf.get(fileOld) || fileOld;
    if (shippedTargets.has(fileNew) || path.posix.basename(fileNew) === pathsLib.STATE_NAMES.shipped) continue;
    let text;
    try { text = fs.readFileSync(path.join(root, fileOld), "utf8"); } catch { continue; }
    const lines = text.split("\n");
    const changes = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let rebuilt = "";
      let last = 0;
      const tokens = (seg) => {
        const r = rewriteTokens(seg, plan.map);
        for (const h of r.hits) changes.push({ n: i + 1, from: h.from, to: h.to });
        return r.text;
      };
      LINK_RE.lastIndex = 0;
      let m;
      while ((m = LINK_RE.exec(line)) !== null) {
        rebuilt += tokens(line.slice(last, m.index));
        const nt = rewriteLink(m[3], fileOld, fileNew, plan.map);
        if (nt != null) changes.push({ n: i + 1, from: m[3], to: nt });
        rebuilt += m[1] + m[2] + (nt != null ? nt : m[3]) + m[4] + m[5];
        last = m.index + m[0].length;
      }
      rebuilt += tokens(line.slice(last));
      lines[i] = rebuilt;
    }
    if (changes.length) edits.push({ file: fileNew, text: lines.join("\n"), changes });
  }
  return edits;
}

// --- apply -------------------------------------------------------------

function apply(root, plan, sr, edits) {
  for (const mv of plan.moves) {
    fs.mkdirSync(path.dirname(path.join(root, mv.to)), { recursive: true });
    if (mv.tracked) git(root, ["mv", "--", mv.from, mv.to]);
    else fs.renameSync(path.join(root, mv.from), path.join(root, mv.to));
  }
  for (const rm of plan.removes) {
    if (rm.tracked) git(root, ["rm", "-q", "--", rm.from]);
    else fs.unlinkSync(path.join(root, rm.from));
  }
  const cfgAbs = path.join(root, ".claude", "claudhd.json");
  fs.mkdirSync(path.dirname(cfgAbs), { recursive: true });
  fs.writeFileSync(cfgAbs, JSON.stringify(plan.config, null, 2) + "\n");
  git(root, ["add", "--", pathsLib.CONFIG_REL]);
  if (sr.patch) writeStateAtomic(path.join(root, ".now"), sr.patch, sr.keys);
  for (const e of edits) fs.writeFileSync(path.join(root, e.file), e.text);
  pathsLib.clearCache();
}

function relocate(root, argv) {
  const opts = parseArgs(argv);
  const tag = opts.dryRun ? " (dry run)" : "";
  const out = [];
  if (opts.errors.length) {
    return { code: 2, out: ["ClauDHD relocate: " + opts.errors.join("; "),
      "usage: /claudhd:init --relocate --state <dir> [--audit <dir>] [--design <dir>] [--also <path>...] [--dry-run]"] };
  }
  const plan = buildPlan(root, opts);
  out.push("ClauDHD relocate" + tag);
  out.push("  config: " + pathsLib.CONFIG_REL + " -> " + JSON.stringify(plan.config));
  for (const mv of plan.moves) out.push("  move: " + mv.from + " -> " + mv.to + (mv.tracked ? "" : " (untracked)"));
  for (const rm of plan.removes) out.push("  remove duplicate: " + rm.from + " (identical to " + rm.keep + ")");
  for (const sk of plan.skips) out.push("  skip: " + sk.rel + " (" + sk.why + ")");
  if (!plan.moves.length && !plan.removes.length) out.push("  nothing to move");

  const blocked = plan.refusals.length || plan.conflicts.length;
  if (blocked) {
    for (const c of plan.conflicts) out.push("  CONFLICT: " + c);
    for (const r of plan.refusals) out.push("  REFUSED: " + r);
    out.push(opts.dryRun ? "Dry run: a real run would refuse. Nothing written." : "Refused. Nothing written.");
    return { code: 1, out };
  }

  const sr = stateRewrites(plan.state, plan.map);
  for (const [field, from, to] of sr.out) out.push("  state.json " + field + ": " + from + " -> " + to);
  const shippedTargets = new Set([pathsLib.resolvePaths(root).shipped.rel, joinRel(plan.config.paths.state, pathsLib.STATE_NAMES.shipped)]);
  const edits = refRewrites(root, plan, shippedTargets);
  for (const e of edits) for (const c of e.changes) out.push("  rewrite: " + e.file + ":" + c.n + " " + c.from + " -> " + c.to);

  if (opts.dryRun) {
    out.push("Dry run. Nothing written.");
    return { code: 0, out };
  }
  apply(root, plan, sr, edits);
  out.push("Done. Staged the moves and " + pathsLib.CONFIG_REL + "; reference rewrites are unstaged. Review with `git status` and `git diff`, then commit. Nothing was committed.");
  return { code: 0, out };
}

module.exports = { relocate, parseArgs, buildPlan, rewriteLink, rewriteTokens };

if (require.main === module) {
  const root = require("./root.js")(process.env);
  const r = relocate(root, process.argv.slice(2));
  const stream = r.code === 0 ? process.stdout : process.stderr;
  stream.write(r.out.join("\n") + "\n");
  process.exitCode = r.code;
}
