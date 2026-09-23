#!/usr/bin/env node
/*
 * paths.js - the single resolver for where ClauDHD's project files live.
 *
 * Every script gets the location of NOW.md, ROADMAP.md, IDEAS.md, SHIPPED.md,
 * CURRENTNESS_AUDIT.md, RUNTIME_VERIFICATION_QUEUE.md and the design-doc
 * directory from resolvePaths(root), never by joining a file name onto the
 * project root itself (test/no-hardcoded-paths.test.js enforces this).
 *
 * Config: <root>/.claude/claudhd.json, committed with the project:
 *
 *   { "version": 1, "paths": { "state": ".", "audit": "auto", "design": null } }
 *
 *   state  - directory holding NOW.md, ROADMAP.md, IDEAS.md, SHIPPED.md.
 *            Default "." (the project root).
 *   audit  - directory holding CURRENTNESS_AUDIT.md and
 *            RUNTIME_VERIFICATION_QUEUE.md. Default "auto": "docs" when
 *            <root>/docs exists, else ".". init.js and sentinel.js's allow
 *            list both read this one rule from here.
 *   design - directory for design docs, or null (default) for "design/ or the
 *            project's existing design directory", the pre-config wording.
 *
 * Directories only; file names are fixed. No config file means exactly the
 * pre-config behavior. Each directory must be relative, contain no `..`
 * segment, stay inside the root after symlinks are resolved, and not sit
 * under `.git/`, `.now/` or `.gantry/`. A malformed file or any invalid value
 * drops the whole config back to the defaults (one partial config could
 * split the state files across two places) and emits one warning line to
 * stderr and, when `.now/` already exists, to `.now/reconcile.log`.
 *
 * Results are cached per process per root, keyed on the raw config text and
 * on whether docs/ exists (the two inputs "auto" and validation read), so a
 * hook that resolves several times pays for one read and warns once.
 * resolvePaths(root, { fresh: true }) bypasses the cache (relocate.js, after
 * it writes a new config).
 *
 * CLI: node paths.js [--root <dir>] [--json]
 *   Prints one line: NOW=<rel> ROADMAP=<rel> IDEAS=<rel> SHIPPED=<rel>
 *   AUDIT=<rel> RVQ=<rel> DESIGN_DIR=<rel>|(default). Root-relative POSIX
 *   paths; a value containing whitespace is JSON-quoted. Command prompts run
 *   this as a `!` preamble so the model reads the real locations. --json
 *   prints the full resolvePaths() result instead.
 */
"use strict";
const fs = require("fs");
const path = require("path");

const CONFIG_REL = ".claude/claudhd.json";
const STATE_NAMES = { now: "NOW.md", roadmap: "ROADMAP.md", ideas: "IDEAS.md", shipped: "SHIPPED.md" };
const AUDIT_NAMES = { audit: "CURRENTNESS_AUDIT.md", rvq: "RUNTIME_VERIFICATION_QUEUE.md" };
const RESERVED_TOP = new Set([".git", ".now", ".gantry"]);
const DEFAULTS = Object.freeze({ state: ".", audit: "auto", design: null });

const cache = new Map();
const warned = new Set();

function existsSafe(p) {
  try { return fs.existsSync(p); } catch { return false; }
}

function realpathSafe(p) {
  try { return fs.realpathSync.native(p); } catch { return null; }
}

// Validate one configured directory. Returns { rel } (normalized POSIX, "."
// for the root) or { error }.
function validateDir(root, key, value) {
  if (typeof value !== "string" || value.trim() === "") {
    return { error: "paths." + key + " must be a non-empty string" };
  }
  const raw = value.trim();
  if (path.isAbsolute(raw) || path.posix.isAbsolute(raw) || path.win32.isAbsolute(raw) || /^[A-Za-z]:/.test(raw)) {
    return { error: "paths." + key + " must be relative, got " + JSON.stringify(value) };
  }
  const parts = raw.replace(/\\/g, "/").split("/").filter((s) => s !== "" && s !== ".");
  if (parts.includes("..")) {
    return { error: "paths." + key + " must not contain '..', got " + JSON.stringify(value) };
  }
  if (parts.length && RESERVED_TOP.has(parts[0].toLowerCase())) {
    return { error: "paths." + key + " must not be under " + parts[0] + "/, got " + JSON.stringify(value) };
  }
  const rel = parts.length ? parts.join("/") : ".";
  if (rel !== ".") {
    // Symlink escape: resolve the deepest existing ancestor of the target and
    // require it to stay inside the real root. The target itself may not
    // exist yet (init creates it).
    const realRoot = realpathSafe(root);
    if (realRoot) {
      let probe = path.join(root, ...parts);
      while (!existsSafe(probe) && path.dirname(probe) !== probe) probe = path.dirname(probe);
      const realProbe = realpathSafe(probe);
      if (realProbe) {
        const inside = path.relative(realRoot, realProbe);
        if (inside.startsWith("..") || path.isAbsolute(inside)) {
          return { error: "paths." + key + " resolves outside the project root through a symlink" };
        }
        const top = inside.split(path.sep)[0].toLowerCase();
        if (inside && RESERVED_TOP.has(top)) {
          return { error: "paths." + key + " resolves under " + top + "/ through a symlink" };
        }
      }
    }
  }
  return { rel };
}

// Parse and validate the config text. Returns { dirs, error }; dirs is null
// on error.
function parseConfig(root, raw) {
  let obj;
  try { obj = JSON.parse(raw); } catch (e) { return { dirs: null, error: "malformed JSON (" + e.message + ")" }; }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return { dirs: null, error: "top level must be a JSON object" };
  if (obj.version !== 1) return { dirs: null, error: "version must be 1, got " + JSON.stringify(obj.version) };
  const p = obj.paths == null ? {} : obj.paths;
  if (typeof p !== "object" || Array.isArray(p)) return { dirs: null, error: "paths must be an object" };

  const dirs = {};
  const state = p.state == null ? DEFAULTS.state : p.state;
  const s = validateDir(root, "state", state);
  if (s.error) return { dirs: null, error: s.error };
  dirs.state = s.rel;

  const audit = p.audit == null ? DEFAULTS.audit : p.audit;
  if (audit === "auto") {
    dirs.audit = "auto";
  } else {
    const a = validateDir(root, "audit", audit);
    if (a.error) return { dirs: null, error: a.error };
    dirs.audit = a.rel;
  }

  if (p.design == null) {
    dirs.design = null;
  } else {
    const d = validateDir(root, "design", p.design);
    if (d.error) return { dirs: null, error: d.error };
    dirs.design = d.rel;
  }
  return { dirs, error: null };
}

function joinRel(dir, name) {
  return dir === "." ? name : dir + "/" + name;
}

function entry(root, rel) {
  return { abs: path.join(root, ...rel.split("/")), rel };
}

function autoAuditDir(docsExists) {
  return docsExists ? "docs" : ".";
}

// The "auto" audit dir for a root, independent of any config: relocate.js
// uses it as a default-location source.
function defaultAuditDir(root) {
  return autoAuditDir(existsSafe(path.join(path.resolve(root), "docs")));
}

function warn(root, text) {
  const key = root + "\0" + text;
  if (warned.has(key)) return;
  warned.add(key);
  try { process.stderr.write(text + "\n"); } catch { /* ignore */ }
  // Only log into an existing .now/: resolving paths in a project that never
  // ran /claudhd:init must not create ClauDHD's local state directory.
  try {
    const nowDir = path.join(root, ".now");
    if (fs.statSync(nowDir).isDirectory()) {
      fs.appendFileSync(path.join(nowDir, "reconcile.log"), new Date().toISOString() + " " + text + "\n");
    }
  } catch { /* best-effort */ }
}

function build(root, raw, docsExists) {
  const warnings = [];
  let configSource = "default";
  let dirs = Object.assign({}, DEFAULTS);
  if (raw != null) {
    const parsed = parseConfig(root, raw);
    if (parsed.error) {
      configSource = "invalid";
      warnings.push("ClauDHD: " + CONFIG_REL + " ignored (" + parsed.error + "); using default paths");
    } else {
      configSource = "config";
      dirs = parsed.dirs;
    }
  }

  const stateDir = dirs.state;
  const auditDir = dirs.audit === "auto" ? autoAuditDir(docsExists) : dirs.audit;
  const result = {
    root,
    configPath: path.join(root, ".claude", "claudhd.json"),
    configSource,
    stateDir,
    auditDir,
    auditMode: dirs.audit === "auto" ? "auto" : "config",
    now: entry(root, joinRel(stateDir, STATE_NAMES.now)),
    roadmap: entry(root, joinRel(stateDir, STATE_NAMES.roadmap)),
    ideas: entry(root, joinRel(stateDir, STATE_NAMES.ideas)),
    shipped: entry(root, joinRel(stateDir, STATE_NAMES.shipped)),
    audit: entry(root, joinRel(auditDir, AUDIT_NAMES.audit)),
    rvq: entry(root, joinRel(auditDir, AUDIT_NAMES.rvq)),
    designDir: dirs.design == null ? null : entry(root, dirs.design),
    warnings,
    strays: [],
  };
  result.ownRel = new Set([result.now.rel, result.roadmap.rel, result.ideas.rel, result.shipped.rel]);

  // Strays: files still at the default location when the config points
  // elsewhere. Reported only; nothing reads or writes them.
  if (configSource === "config") {
    if (stateDir !== ".") {
      for (const name of Object.values(STATE_NAMES)) {
        if (existsSafe(path.join(root, name))) result.strays.push(name);
      }
    }
    if (dirs.audit !== "auto") {
      for (const dir of [".", "docs"]) {
        if (dir === auditDir) continue;
        for (const name of Object.values(AUDIT_NAMES)) {
          const rel = joinRel(dir, name);
          if (existsSafe(path.join(root, rel))) result.strays.push(rel);
        }
      }
    }
  }
  return result;
}

function resolvePaths(root, opts) {
  const r = path.resolve(root);
  let raw = null;
  try { raw = fs.readFileSync(path.join(r, ".claude", "claudhd.json"), "utf8"); } catch { raw = null; }
  const docsExists = existsSafe(path.join(r, "docs"));
  const fresh = !!(opts && opts.fresh);
  const hit = cache.get(r);
  let result;
  if (!fresh && hit && hit.raw === raw && hit.docsExists === docsExists) {
    result = hit.result;
  } else {
    result = build(r, raw, docsExists);
    cache.set(r, { raw, docsExists, result });
  }
  for (const w of result.warnings) warn(r, w);
  return result;
}

function clearCache() {
  cache.clear();
  warned.clear();
}

// One-line summary used by the CLI and by brief.js's SessionStart line.
function summaryLine(p) {
  const q = (s) => (/\s/.test(s) ? JSON.stringify(s) : s);
  return [
    "NOW=" + q(p.now.rel),
    "ROADMAP=" + q(p.roadmap.rel),
    "IDEAS=" + q(p.ideas.rel),
    "SHIPPED=" + q(p.shipped.rel),
    "AUDIT=" + q(p.audit.rel),
    "RVQ=" + q(p.rvq.rel),
    "DESIGN_DIR=" + (p.designDir ? q(p.designDir.rel) : "(default)"),
  ].join(" ");
}

function toJson(p) {
  return Object.assign({}, p, { ownRel: [...p.ownRel] });
}

module.exports = {
  resolvePaths,
  clearCache,
  defaultAuditDir,
  summaryLine,
  toJson,
  validateDir,
  parseConfig,
  CONFIG_REL,
  STATE_NAMES,
  AUDIT_NAMES,
  DEFAULTS,
};

if (require.main === module) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf("--root");
  const root = i !== -1 && argv[i + 1] ? argv[i + 1] : require("./root.js")(process.env);
  const p = resolvePaths(root);
  if (argv.includes("--json")) {
    process.stdout.write(JSON.stringify(toJson(p), null, 2) + "\n");
  } else {
    process.stdout.write(summaryLine(p) + "\n");
  }
}
