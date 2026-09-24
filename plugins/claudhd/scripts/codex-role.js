#!/usr/bin/env node
"use strict";
/*
 * Resolve a ClauDHD role to explicit collaboration.spawn_agent settings.
 *
 * Usage: node codex-role.js resolve <chat|orchestrator|role>
 *
 * Reads the optional project override at .gantry/models.codex.json. It does
 * not read .gantry/models.json, Codex's global config, or the parent chat's
 * model, so every emitted profile is explicit and reviewable.
 */
const fs = require("fs");
const path = require("path");
const core = require("./codex-role-core.js");
const resolveRoot = require("./root.js");

const ROOT = resolveRoot(process.env);
const CONFIG_PATH = path.join(ROOT, ".gantry", "models.codex.json");
const AGENTS_DIR = path.join(__dirname, "..", "agents");

function fail(message) {
  process.stderr.write("codex-role.js: " + message + "\n");
  process.exit(1);
}

function loadOverrides() {
  let text;
  try {
    text = fs.readFileSync(CONFIG_PATH, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") return {};
    fail("could not read " + CONFIG_PATH + ": " + error.message);
  }
  try {
    return core.parseOverride(text, CONFIG_PATH);
  } catch (error) {
    fail(error.message);
  }
}

function instructionPath(role) {
  if (role === "orchestrator") return null;
  const agentPath = path.join(AGENTS_DIR, role + ".md");
  if (!fs.existsSync(agentPath)) {
    fail("agent instructions for '" + role + "' are missing: " + agentPath);
  }
  return agentPath;
}

function cmdResolve(args) {
  if (args.length !== 1) fail("usage: resolve <chat|orchestrator|role>");
  const requestedRole = args[0];
  let profile;
  try {
    profile = core.resolveProfile(requestedRole, loadOverrides());
  } catch (error) {
    fail(error.message);
  }
  profile.instruction_path = instructionPath(profile.role);
  process.stdout.write(JSON.stringify(profile) + "\n");
}

const [, , subcommand, ...args] = process.argv;
if (subcommand === "resolve") cmdResolve(args);
else fail("usage: codex-role.js resolve <chat|orchestrator|role>");
