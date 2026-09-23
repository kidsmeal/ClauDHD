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
