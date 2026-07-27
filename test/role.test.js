"use strict";
/* CLI-level tests for role.js resolve / run / show: the fail-safe-to-native
 * behavior for ordinary config errors, the one hard stop (off-harness
 * implementer), and the re-review context surfaces (--context / show-round).
 *
 * Adversary support (resolve's ADVERSARY: line, run --adversary, show's
 * adversary display) was removed: claudhd 1.0 ships primary-reviewer-only
 * (sol round-one ruling, finding 4). It rode in from gantry's port but was
 * never in 1.0's scope and its native-dispatch path was broken. See
 * role-core.js/role.js for what was stripped.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROLE = path.join(__dirname, "..", "plugins", "claudhd", "scripts", "role.js");

function mk() { return fs.mkdtempSync(path.join(os.tmpdir(), "claudhd-role-")); }
function writeConfig(dir, config) {
  fs.mkdirSync(path.join(dir, ".gantry"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".gantry", "models.json"), JSON.stringify(config));
}
function resolve(dir, role) {
  return spawnSync(process.execPath, [ROLE, "resolve", role], {
    encoding: "utf8",
    env: { ...process.env, GANTRY_PROJECT_DIR: dir },
  });
}

const CODEX = {
  type: "cli",
  cmd: "codex exec --model {model} --sandbox {sandbox} --skip-git-repo-check",
  promptVia: "stdin",
  sandbox: "workspace-write",
};

test("resolve: no models.json -> native, exit 0", () => {
  const dir = mk();
  try {
    const r = resolve(dir, "phase-reviewer");
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /DISPATCH: native/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("resolve: valid external backend -> external, exit 0", () => {
  const dir = mk();
  try {
    writeConfig(dir, {
      roles: { "phase-reviewer": { backend: "codex", model: "gpt-5.5" } },
      backends: { native: { type: "native" }, codex: CODEX },
    });
    const r = resolve(dir, "phase-reviewer");
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /DISPATCH: external/);
    assert.match(r.stdout, /gpt-5\.5/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("resolve: ordinary config error (unknown backend) FAILS SAFE to native, exit 0 with a warning", () => {
  const dir = mk();
  try {
    writeConfig(dir, {
      roles: { "phase-reviewer": { backend: "ghost", model: "x" } },
      backends: { native: { type: "native" } },
    });
    const r = resolve(dir, "phase-reviewer");
    assert.equal(r.status, 0, "ordinary config errors must not be fatal");
    assert.match(r.stdout, /DISPATCH: native/);
    assert.match(r.stderr, /config issue/i); // warned, not silent
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("resolve: off-harness implementer is the one HARD STOP, exit non-zero", () => {
  const dir = mk();
  try {
    writeConfig(dir, {
      roles: { implementer: { backend: "codex", model: "gpt-5.5" } },
      backends: { native: { type: "native" }, codex: CODEX },
    });
    const r = resolve(dir, "implementer");
    assert.notEqual(r.status, 0, "off-harness implementer must fail, not fall back silently");
    assert.match(r.stderr, /off-harness|harness/i);
    assert.doesNotMatch(r.stdout, /DISPATCH: native/); // must NOT silently downgrade
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("resolve: implementer with an unknown backend (a typo) fails safe to native, exit 0", () => {
  const dir = mk();
  try {
    writeConfig(dir, {
      roles: { implementer: { backend: "typo", model: "x" } },
      backends: { native: { type: "native" } },
    });
    const r = resolve(dir, "implementer");
    assert.equal(r.status, 0, "a typo is an accident, fail-safe to native (native is harness-safe)");
    assert.match(r.stdout, /DISPATCH: native/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// --- run --context / show-round: re-review context ---

function runRole(dir, args) {
  return spawnSync(process.execPath, [ROLE, ...args], {
    encoding: "utf8",
    env: { ...process.env, GANTRY_PROJECT_DIR: dir },
  });
}

// Write a .gantry/review-round.json as sentinel.js record-round would.
function writeRounds(dir, state) {
  fs.mkdirSync(path.join(dir, ".gantry"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".gantry", "review-round.json"),
    JSON.stringify(state, null, 2)
  );
}

const ROUNDS = {
  plan: "docs/p_plan.md",
  phase: 3,
  rounds: [
    { round: 1, verdict: "FAIL", fixes: "1. init.js must render NOW.md via the renderer", recorded: "2026-07-26T00:00:00Z" },
  ],
};

// A stdin-echo backend: pipes stdin straight to stdout so the composed prompt
// appears in the process stdout. Used to assert prompt/context wording.
const ECHO_BACKEND = {
  type: "cli",
  cmd: "node -e \"process.stdin.pipe(process.stdout)\"",
  promptVia: "stdin",
};

const ECHO_REVIEWER_CONFIG = {
  roles: { "phase-reviewer": { backend: "echo", model: "any" } },
  backends: { native: { type: "native" }, echo: ECHO_BACKEND },
};

test("run --context: appends the prior-rounds block with the settled contract", () => {
  const dir = mk();
  try {
    writeConfig(dir, ECHO_REVIEWER_CONFIG);
    writeRounds(dir, ROUNDS);
    const r = runRole(dir, ["run", "phase-reviewer", "--context", ".gantry/review-round.json", "--", "docs/p_plan.md", "3"]);
    assert.equal(r.status, 0, "echo backend exited non-zero: " + r.stderr);
    assert.match(r.stdout, /^## Prior review rounds/m, "prompt must carry the context block");
    assert.match(r.stdout, /Round 1 - FAIL/);
    assert.match(r.stdout, /init\.js must render NOW\.md via the renderer/);
    assert.match(r.stdout, /SETTLED/, "prompt must carry the settled rule");
    assert.match(r.stdout, /NEW defect/, "prompt must carry the NEW-defect reopening ground");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("run without --context: first-round prompt carries no prior-rounds block", () => {
  const dir = mk();
  try {
    writeConfig(dir, ECHO_REVIEWER_CONFIG);
    writeRounds(dir, ROUNDS); // present on disk, but not passed - must not leak in
    const r = runRole(dir, ["run", "phase-reviewer", "--", "docs/p_plan.md", "3"]);
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stdout, /^## Prior review rounds/m,
      "context must only enter the prompt via the explicit --context flag");
    assert.doesNotMatch(r.stdout, /init\.js must render NOW\.md/,
      "the recorded fixes must not leak into a no-context prompt");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("run --context: absent context file warns and still runs the review", () => {
  const dir = mk();
  try {
    writeConfig(dir, ECHO_REVIEWER_CONFIG);
    const r = runRole(dir, ["run", "phase-reviewer", "--context", ".gantry/review-round.json", "--", "docs/p_plan.md", "3"]);
    assert.equal(r.status, 0, "a missing context file must never block the review: " + r.stderr);
    assert.match(r.stderr, /absent or malformed/i, "must warn about the missing context");
    assert.doesNotMatch(r.stdout, /^## Prior review rounds/m);
    assert.match(r.stdout, /Runtime inputs/, "the review prompt itself must still be composed");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("run --context: malformed context file warns and still runs the review", () => {
  const dir = mk();
  try {
    writeConfig(dir, ECHO_REVIEWER_CONFIG);
    fs.mkdirSync(path.join(dir, ".gantry"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".gantry", "review-round.json"), "not json {");
    const r = runRole(dir, ["run", "phase-reviewer", "--context", ".gantry/review-round.json", "--", "docs/p_plan.md", "3"]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /absent or malformed/i);
    assert.doesNotMatch(r.stdout, /^## Prior review rounds/m);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("run --context: --context requires a file path", () => {
  const dir = mk();
  try {
    writeConfig(dir, ECHO_REVIEWER_CONFIG);
    const r = runRole(dir, ["run", "phase-reviewer", "--context", "--", "docs/p_plan.md", "3"]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /--context requires a file path/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("show-round: prints the same block run --context appends", () => {
  const dir = mk();
  try {
    writeRounds(dir, ROUNDS);
    const r = runRole(dir, ["show-round"]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Prior review rounds/);
    assert.match(r.stdout, /Round 1 - FAIL/);
    assert.match(r.stdout, /SETTLED/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("show-round: no recorded rounds prints nothing to stdout, exit 0", () => {
  const dir = mk();
  try {
    const r = runRole(dir, ["show-round"]);
    assert.equal(r.status, 0, "show-round with no rounds must exit 0: " + r.stderr);
    assert.equal(r.stdout, "", "stdout must be empty so nothing gets pasted into a prompt");
    assert.match(r.stderr, /no recorded review rounds/i);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
