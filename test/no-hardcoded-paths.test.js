"use strict";
/*
 * Every script gets the location of a ClauDHD state or audit file from
 * paths.js (.claude/claudhd.json), never by joining the file name onto the
 * project root itself. This test fails on any scripts/**\/*.js other than
 * paths.js that:
 *   - joins or resolves a state/audit file name (path.join(root, "NOW.md")),
 *   - carries a state/audit file name as an exact string literal ("NOW.md"),
 *   - checks for a docs/ directory itself (exists("docs"), the audit "auto"
 *     rule belongs to paths.js alone).
 * Comments are stripped first, so prose that names the files is fine.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SCRIPTS = path.join(__dirname, "..", "plugins", "claudhd", "scripts");
const NAMES = ["NOW", "ROADMAP", "IDEAS", "SHIPPED", "CURRENTNESS_AUDIT", "RUNTIME_VERIFICATION_QUEUE"];
const NAME_ALT = "(?:" + NAMES.join("|") + ")\\.md";

const RULES = [
  { why: "joins a state/audit file name", re: new RegExp("path\\.(?:join|resolve)\\([^)]*[\"'`]" + NAME_ALT + "[\"'`]") },
  { why: "exact state/audit file name literal", re: new RegExp("[\"'`]" + NAME_ALT + "[\"'`]") },
  { why: "checks for docs/ itself", re: /exists\w*\(\s*(?:path\.join\([^)]*)?["'`]docs["'`]/ },
  { why: "joins docs/ onto a root", re: /path\.(?:join|resolve)\([^)]*["'`]docs["'`]\s*\)/ },
];

function listJs(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...listJs(full));
    else if (ent.name.endsWith(".js")) out.push(full);
  }
  return out;
}

// Blank out /* */ blocks and // line comments, keeping line numbers. A `//`
// only starts a comment at line start or after whitespace, so "https://"
// inside a string survives.
function stripComments(src) {
  const noBlocks = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  return noBlocks.split("\n").map((line) => line.replace(/(^|\s)\/\/.*$/, "$1")).join("\n");
}

function scan(file) {
  const hits = [];
  const lines = stripComments(fs.readFileSync(file, "utf8")).split("\n");
  lines.forEach((line, i) => {
    for (const rule of RULES) {
      if (rule.re.test(line)) hits.push(path.relative(SCRIPTS, file).replace(/\\/g, "/") + ":" + (i + 1) + " " + rule.why + ": " + line.trim());
    }
  });
  return hits;
}

test("no script other than paths.js hardcodes a state/audit file location", () => {
  const offenders = [];
  for (const file of listJs(SCRIPTS)) {
    if (path.basename(file) === "paths.js" && path.dirname(file) === SCRIPTS) continue;
    offenders.push(...scan(file));
  }
  assert.deepEqual(offenders, [], "hardcoded paths:\n" + offenders.join("\n"));
});

test("the scan itself catches each rule (guards against a regex that matches nothing)", () => {
  const tmp = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "claudhd-scan-"));
  try {
    const f = path.join(tmp, "bad.js");
    fs.writeFileSync(f, [
      "const a = path.join(ROOT, \"NOW.md\");",
      "const b = new Set([\"SHIPPED.md\"]);",
      "const c = exists(\"docs\") ? \"docs\" : \".\";",
      "const d = fs.existsSync(path.join(ROOT, \"docs\"));",
      "// path.join(ROOT, \"IDEAS.md\") in a comment is fine",
      "console.log(\"Captured -> IDEAS.md: \" + text);",
    ].join("\n"));
    const hits = scan(f);
    const lines = new Set(hits.map((h) => h.split(" ")[0].split(":")[1]));
    assert.deepEqual([...lines].sort(), ["1", "2", "3", "4"]);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

// --- commands/*.md ---
//
// A command body (frontmatter excluded) that names a state or audit file, or
// the design/ directory, must run the paths.js preamble so the model reads the
// real locations. Exempt: bodies that only name a file as a label in text the
// model relays, never one it reads or writes.
const COMMANDS = path.join(__dirname, "..", "plugins", "claudhd", "commands");
const PREAMBLE = '!`node "${CLAUDE_PLUGIN_ROOT}/scripts/paths.js"`';
const PREAMBLE_EXEMPT = {
  override: "NOW.md appears only in the one line the model relays; override.js does the write",
};
const NAMES_IN_PROSE = new RegExp("\\b" + NAME_ALT + "|`design/");

function commandBody(text) {
  const m = text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
  return { frontmatter: m ? m[0] : "", body: m ? text.slice(m[0].length) : text };
}

test("every command that names a state/audit file or design/ runs the paths.js preamble", () => {
  const missing = [];
  for (const f of fs.readdirSync(COMMANDS).filter((n) => n.endsWith(".md"))) {
    const name = f.replace(/\.md$/, "");
    const { body } = commandBody(fs.readFileSync(path.join(COMMANDS, f), "utf8"));
    if (!NAMES_IN_PROSE.test(body) || PREAMBLE_EXEMPT[name]) continue;
    if (!body.includes(PREAMBLE)) missing.push("commands/" + f);
  }
  assert.deepEqual(missing, [], "missing the paths.js preamble: " + missing.join(", "));
});

test("a command with the paths.js preamble and an allowed-tools line allows Bash(node:*)", () => {
  const bad = [];
  for (const f of fs.readdirSync(COMMANDS).filter((n) => n.endsWith(".md"))) {
    const { frontmatter, body } = commandBody(fs.readFileSync(path.join(COMMANDS, f), "utf8"));
    if (!body.includes(PREAMBLE)) continue;
    const allowed = frontmatter.match(/^allowed-tools:\s*(.+)$/m);
    if (allowed && !allowed[1].includes("Bash(node:*)")) bad.push("commands/" + f);
  }
  assert.deepEqual(bad, [], "paths.js preamble cannot run under: " + bad.join(", "));
});

test("no command places a state file at the project root by name", () => {
  const bad = [];
  for (const f of fs.readdirSync(COMMANDS).filter((n) => n.endsWith(".md"))) {
    const { body } = commandBody(fs.readFileSync(path.join(COMMANDS, f), "utf8"));
    const re = new RegExp(NAME_ALT + "`?\\s+(?:at|in) the project root", "g");
    if (re.test(body)) bad.push("commands/" + f);
  }
  assert.deepEqual(bad, [], "state file pinned to the project root in: " + bad.join(", "));
});
