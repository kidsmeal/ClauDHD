#!/usr/bin/env node
"use strict";

/* Build a standalone Codex plugin without mutating ClauDHD's Claude source. */
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SHARED = path.join(ROOT, "plugins", "claudhd");
const ADAPTER = path.join(ROOT, "adapters", "codex");
const DEFAULT_OUTPUT = path.join(os.homedir(), "plugins", "claudhd-codex");
const PLUGIN_NAME = "claudhd-codex";

function sharedVersion() {
  const manifestPath = path.join(SHARED, ".claude-plugin", "plugin.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (!manifest || typeof manifest.version !== "string" || !manifest.version) {
    throw new Error("shared plugin manifest has no version: " + manifestPath);
  }
  return manifest.version;
}

function writeManifest(output) {
  const manifest = JSON.parse(fs.readFileSync(path.join(ADAPTER, "plugin.json"), "utf8"));
  manifest.version = sharedVersion();
  const destination = path.join(output, ".codex-plugin", "plugin.json");
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, JSON.stringify(manifest, null, 2) + "\n");
}

function copy(source, destination) {
  if (!fs.existsSync(source)) throw new Error("missing required source: " + source);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, { recursive: true });
}

function isEqualOrDescendant(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith(".." + path.sep) && relative !== "..");
}

function hasSymlinkAncestor(target) {
  let current = target;
  for (;;) {
    try {
      if (fs.lstatSync(current).isSymbolicLink()) return true;
    } catch (error) {
      if (!error || error.code !== "ENOENT") throw error;
    }
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

function existingOutputIsReplaceable(output) {
  if (!fs.existsSync(output)) return true;
  if (!fs.statSync(output).isDirectory()) return false;
  const entries = fs.readdirSync(output);
  if (entries.length === 0) return true;
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(output, ".codex-plugin", "plugin.json"), "utf8"));
    return manifest && manifest.name === PLUGIN_NAME;
  } catch { return false; }
}

function safeOutput(raw) {
  const output = path.resolve(raw || DEFAULT_OUTPUT);
  const root = path.parse(output).root;
  if (output === root || hasSymlinkAncestor(output)) {
    throw new Error("refusing to replace unsafe output directory: " + output);
  }
  for (const source of [ROOT, SHARED, ADAPTER]) {
    if (isEqualOrDescendant(output, source) || isEqualOrDescendant(source, output)) {
      throw new Error("refusing to replace source-related output directory: " + output);
    }
  }
  if (!existingOutputIsReplaceable(output)) {
    throw new Error("refusing to replace a non-plugin or non-empty output directory: " + output);
  }
  return output;
}

function main(argv) {
  const output = safeOutput(argv[2]);
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });

  writeManifest(output);
  for (const name of ["scripts", "agents", "templates", "commands"]) {
    copy(path.join(SHARED, name), path.join(output, name));
  }
  copy(path.join(ADAPTER, "hooks"), path.join(output, "hooks"));
  copy(path.join(ADAPTER, "skills"), path.join(output, "skills"));
  copy(path.join(ADAPTER, "README.md"), path.join(output, "README.md"));

  process.stdout.write("built claudhd-codex: " + output + "\n");
  return output;
}

if (require.main === module) {
  try { main(process.argv); } catch (error) {
    process.stderr.write("build-codex-plugin: " + error.message + "\n");
    process.exitCode = 1;
  }
}

module.exports = { ROOT, SHARED, ADAPTER, DEFAULT_OUTPUT, safeOutput, sharedVersion, main };
