#!/usr/bin/env node
/*
 * role.js - resolve and run a role on its configured model backend.
 *
 * The thin IO shell around role-core.js: it reads .gantry/models.json and the
 * agent .md files, spawns external backends, and prints results. All routing
 * decisions and command construction live in role-core.js (pure, tested).
 *
 * Subcommands:
 *   resolve <role>
 *       Print the dispatch decision for a role. First line is a stable token
 *       the orchestrator branches on:
 *         DISPATCH: native    -> spawn the <role> subagent via the Task tool
 *         DISPATCH: external  -> run `role.js run <role> -- <inputs>` and relay
 *       Exits non-zero (with the reason) on an invalid assignment - notably an
 *       implementer routed off the Claude Code harness.
 *
 *   run <role> [--context <file>] [-- <inputs...>]
 *       Run a NON-native backend: compose the prompt from the agent .md body
 *       plus <inputs>, spawn the backend, stream its stderr (progress) through,
 *       and print its stdout (the agent's final output) for the orchestrator to
 *       relay. Errors for a native role (those are Task-spawned, not run here).
 *       With --context <file>, reads the named review-round file (written by
 *       `sentinel.js record-round`) and appends the prior rounds' verdicts and
 *       required fixes to the prompt as re-review context, with the rule that
 *       a prior required fix applied as ordered is settled unless it introduced
 *       a NEW defect. An absent or malformed context file warns and runs the
 *       review without context - the gate is never blocked by missing context.
 *       First-round reviews are invoked without the flag and are unchanged.
 *
 *   show-round
 *       Print the same re-review context block run --context would append,
 *       rendered from .gantry/review-round.json, for the orchestrator to paste
 *       into a NATIVE reviewer's Task prompt. Prints nothing (exit 0) when no
 *       rounds are recorded, so native and external re-reviews carry identical
 *       wording from one formatter.
 *
 *   detect
 *       Report which external agent CLIs (codex, claude, gemini) are on PATH.
 *       Used by /claudhd:init to tailor its setup guidance.
 *
 *   show
 *       Print the resolved backend for every role. Used by /claudhd:models.
 *
 *   write-default
 *       Write .gantry/models.json with the all-native default if it is absent.
 *       No-op when the file already exists. Used by /claudhd:init.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const core = require("./role-core.js");
const { resolveRoot } = require("./sentinel-core.js");

const ROOT = resolveRoot(process.env);
const CONFIG_PATH = path.join(ROOT, ".gantry", "models.json");
const AGENTS_DIR = path.join(__dirname, "..", "agents");

// Load and parse models.json, failing safe to the all-native default.
function loadConfig() {
  let text = "";
  try {
    text = fs.readFileSync(CONFIG_PATH, "utf8");
  } catch {
    /* absent -> default */
  }
  return core.parseConfig(text);
}

// Read an agent definition file for a role. Returns "" if absent.
function readAgent(role) {
  try {
    return fs.readFileSync(path.join(AGENTS_DIR, role + ".md"), "utf8");
  } catch {
    return "";
  }
}

function fail(msg) {
  process.stderr.write("role.js: " + msg + "\n");
  process.exit(1);
}

// --- resolve ---

function cmdResolve(args) {
  const role = args[0];
  if (!role) fail("resolve: usage: resolve <role>");

  const r = core.resolveRole(loadConfig(), role);
  if (r.error) {
    // The one hard stop: a deliberate off-harness implementer assignment.
    if (r.harnessGuard) fail(r.error);
    // Any other config problem is fail-safe: warn and fall back to native, so a
    // typo or stale backend never silently swaps a model or breaks the pipeline.
    process.stderr.write(
      "role.js: config issue for '" + role + "': " + r.error +
      "\n  Falling back to the native subagent.\n"
    );
    console.log("DISPATCH: native");
    console.log("Spawn the " + role + " subagent via the Task tool (config fell back to native).");
    return;
  }

  if (r.dispatch === "native") {
    console.log("DISPATCH: native");
    console.log(
      "Spawn the " + role + " subagent via the Task tool" +
      (r.model ? " (model: " + r.model + ")." : ".")
    );
  } else {
    console.log("DISPATCH: external");
    console.log(
      "Backend '" + r.backendName + "' (type " + r.type + ", model " +
      r.model + "). Run:"
    );
    console.log(
      "  node \"" + __filename + "\" run " + role + " -- <inputs>"
    );
    console.log("Relay its stdout verbatim as the " + role + "'s output.");
  }
}

// --- run ---

function cmdRun(args) {
  const role = args[0];
  if (!role) fail("run: usage: run <role> [--context <file>] [-- <inputs...>]");

  // Parse flags (any order, between the role name and the -- separator).
  let rest = args.slice(1);
  let contextPath = null;
  while (rest.length > 0) {
    if (rest[0] === "--context") {
      if (!rest[1] || rest[1] === "--") fail("run: --context requires a file path");
      contextPath = rest[1];
      rest = rest.slice(2);
      continue;
    }
    break;
  }

  // Inputs: everything after the role and flags, dropping an optional `--`
  // separator.
  if (rest[0] === "--") rest = rest.slice(1);
  const inputs = rest.join(" ");

  const r = core.resolveRole(loadConfig(), role);
  if (r.error) fail(r.error);

  const descriptor = r;
  if (r.dispatch === "native") {
    fail(
      "role '" + role + "' is native; spawn it via the Task tool, not role.js run."
    );
  }

  const agentMd = readAgent(role);
  if (!agentMd) fail("could not read agent definition for role '" + role + "'.");

  const promptBody = core.stripFrontmatter(agentMd);

  // Re-review context: an absent or malformed context file is a warning, never
  // a failure - the review gate must run regardless, just without the context.
  let rereviewBlock = null;
  if (contextPath) {
    const contextAbs = path.isAbsolute(contextPath)
      ? contextPath
      : path.join(ROOT, contextPath);
    let contextText = null;
    try {
      contextText = fs.readFileSync(contextAbs, "utf8");
    } catch {
      /* absent -> warn below */
    }
    const state = core.parseReviewRound(contextText);
    if (state) {
      rereviewBlock = core.formatRereviewBlock(state);
    } else {
      process.stderr.write(
        "role.js: context file '" + contextPath + "' is absent or malformed;" +
        " running the review without re-review context.\n"
      );
    }
  }

  const prompt = core.composePrompt(promptBody, inputs, rereviewBlock);
  const allowedTools = core.parseTools(agentMd);

  // Secret: read the backend's declared env var here (kept out of role-core).
  let authToken;
  if (descriptor.backend && descriptor.backend.env_key) {
    authToken = process.env[descriptor.backend.env_key];
  }

  // Harness-safe implementer guard injection: a headless `claude -p` implementer
  // gets the two phase-enforcement guards wired in via a settings file, so
  // the file-list and commit guards apply exactly as for the native implementer
  // (no dependence on plugin hook auto-load in a nested session). Only for the
  // implementer - a headless reviewer must NOT inherit the file-list guard, or
  // its _reviewed.md write would be blocked.
  let settingsPath;
  if (role === "implementer" && descriptor.type === "claude-headless") {
    const hooksDir = path.join(__dirname, "hooks");
    const settings = core.buildGuardSettings(
      path.join(hooksDir, "file-list-guard.js"),
      path.join(hooksDir, "commit-guard.js")
    );
    try {
      fs.mkdirSync(path.join(ROOT, ".gantry"), { recursive: true });
      fs.writeFileSync(
        path.join(ROOT, ".gantry", "headless-implementer-settings.json"),
        JSON.stringify(settings, null, 2) + "\n", "utf8"
      );
    } catch (e) {
      fail("could not write headless guard settings: " + e.message);
    }
    // Relative to ROOT (the spawn cwd) so the argv element is space-free even
    // when the project path contains spaces.
    settingsPath = ".gantry/headless-implementer-settings.json";
  }

  let inv;
  try {
    inv = core.buildInvocation(descriptor, { prompt, allowedTools, authToken, settingsPath });
  } catch (e) {
    fail("could not build invocation: " + e.message);
  }

  // shell:true resolves .cmd shims on Windows (codex.cmd, claude.cmd). We pass
  // the whole command as ONE string (not an args array) so Node does not warn
  // about unescaped args (DEP0190); every argv element is space-free by
  // construction, so a plain space-join is unambiguous. The prompt never enters
  // the command line - it is delivered on stdin.
  const file = inv.argv[0];
  const res = spawnSync(inv.argv.join(" "), {
    cwd: ROOT,
    // Pin GANTRY_PROJECT_DIR so the injected guards resolve the same project
    // root the orchestrator used, regardless of the nested process's cwd.
    env: Object.assign({}, process.env, { GANTRY_PROJECT_DIR: ROOT }, inv.env),
    input: inv.stdin == null ? undefined : inv.stdin,
    stdio: ["pipe", "pipe", "inherit"], // capture stdout, pass progress through
    encoding: "utf8",
    shell: true,
  });

  if (res.error) {
    fail(
      "failed to spawn '" + file + "': " + res.error.message +
      (res.error.code === "ENOENT"
        ? "\n  Is '" + file + "' installed and on PATH?"
        : "")
    );
  }
  if (res.stdout) process.stdout.write(res.stdout);
  process.exit(res.status == null ? 1 : res.status);
}

// --- detect ---

function isOnPath(cmd) {
  try {
    const res = spawnSync(cmd + " --version", {
      stdio: "ignore", shell: true, timeout: 8000,
    });
    return !res.error && res.status === 0;
  } catch {
    return false;
  }
}

function cmdDetect() {
  const tools = ["codex", "claude", "gemini"];
  console.log("External agent CLIs on PATH:");
  for (const t of tools) {
    console.log("  " + (isOnPath(t) ? "[found]   " : "[missing] ") + t);
  }
}

// --- show ---

function cmdShow() {
  const cfg = loadConfig();
  const usingDefault = !fs.existsSync(CONFIG_PATH);
  console.log(
    "Role -> backend assignments" +
    (usingDefault ? " (no .gantry/models.json; showing built-in defaults)" : "") +
    ":"
  );
  for (const role of core.VALID_ROLES) {
    const r = core.resolveRole(cfg, role);
    if (r.error) {
      console.log("  " + role.padEnd(16) + " ERROR: " + r.error);
    } else {
      console.log(
        "  " + role.padEnd(16) + r.backendName +
        " (" + r.type + (r.model ? ", " + r.model : "") + ")"
      );
    }
  }
}

// --- show-round ---

// Print the re-review context block for the recorded rounds, or nothing when
// no rounds are recorded. The orchestrator pastes this into a NATIVE
// reviewer's Task prompt; the external path gets the identical block via
// `run --context`, so both dispatches carry one formatter's wording.
function cmdShowRound() {
  let text = null;
  try {
    text = fs.readFileSync(path.join(ROOT, ".gantry", "review-round.json"), "utf8");
  } catch {
    /* absent -> nothing to show */
  }
  const state = core.parseReviewRound(text);
  if (!state) {
    process.stderr.write("role.js: no recorded review rounds; nothing to show.\n");
    return;
  }
  console.log(core.formatRereviewBlock(state));
}

// --- write-default ---

function cmdWriteDefault() {
  if (fs.existsSync(CONFIG_PATH)) {
    console.log("role.js: .gantry/models.json already present; left untouched.");
    return;
  }
  try {
    fs.mkdirSync(path.join(ROOT, ".gantry"), { recursive: true });
    fs.writeFileSync(
      CONFIG_PATH, JSON.stringify(core.DEFAULT_CONFIG, null, 2) + "\n", "utf8"
    );
    console.log("role.js: wrote default .gantry/models.json (all roles native).");
  } catch (e) {
    fail("could not write .gantry/models.json: " + e.message);
  }
}

// --- dispatch ---

const [, , subcommand, ...rest] = process.argv;
switch (subcommand) {
  case "resolve": cmdResolve(rest); break;
  case "run": cmdRun(rest); break;
  case "detect": cmdDetect(); break;
  case "show": cmdShow(); break;
  case "show-round": cmdShowRound(); break;
  case "write-default": cmdWriteDefault(); break;
  default:
    fail(
      "unknown subcommand: " + subcommand + "\n" +
      "Usage:\n" +
      "  role.js resolve <role>\n" +
      "  role.js run <role> [--context <file>] [-- <inputs...>]\n" +
      "  role.js detect\n" +
      "  role.js show\n" +
      "  role.js show-round\n" +
      "  role.js write-default"
    );
}
