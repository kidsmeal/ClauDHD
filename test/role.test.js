"use strict";
/* CLI-level tests for role.js resolve / run --adversary / show: the
 * fail-safe-to-native behavior for ordinary config errors, the one hard stop
 * (off-harness implementer), and the adversary surfaces. */
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
function show(dir) {
  return spawnSync(process.execPath, [ROLE, "show"], {
    encoding: "utf8",
    env: { ...process.env, GANTRY_PROJECT_DIR: dir },
  });
}
function runAdversary(dir, role, inputs) {
  const args = [ROLE, "run", role, "--adversary"];
  if (inputs && inputs.length) args.push("--", ...inputs);
  return spawnSync(process.execPath, args, {
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

// --- adversary surfaces ---

const CODEX_BACKEND = {
  type: "cli",
  cmd: "codex exec --model {model} --sandbox {sandbox} --skip-git-repo-check",
  promptVia: "stdin",
  sandbox: "workspace-write",
};
const CLAUDE_BACKEND = { type: "claude-headless" };

// A realistic config mirroring the repo .gantry/models.json shape, with an
// adversary (headless claude-opus) on the codex phase-reviewer.
const REALISTIC_WITH_ADVERSARY = {
  roles: {
    "implementer": { backend: "native", model: "sonnet" },
    "phase-planner": { backend: "native", model: "opus" },
    "design-reviewer": { backend: "native", model: "opus" },
    "phase-reviewer": {
      backend: "codex",
      model: "gpt-5.5",
      adversary: { backend: "claude", model: "claude-opus-4-5" },
    },
  },
  backends: {
    "native": { type: "native" },
    "claude": CLAUDE_BACKEND,
    "codex": CODEX_BACKEND,
  },
};

test("resolve: reviewer with adversary prints ADVERSARY: line with descriptor after the primary block", () => {
  const dir = mk();
  try {
    writeConfig(dir, REALISTIC_WITH_ADVERSARY);
    const r = resolve(dir, "phase-reviewer");
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /DISPATCH: external/);
    assert.match(r.stdout, /ADVERSARY:/, "must print an ADVERSARY: line");
    assert.match(r.stdout, /claude/, "adversary backend name must appear");
    assert.match(r.stdout, /claude-opus-4-5/, "adversary model must appear");
    assert.match(r.stdout, /external/, "adversary dispatch type must appear");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("resolve: reviewer with no adversary prints ADVERSARY: none", () => {
  const dir = mk();
  try {
    writeConfig(dir, {
      roles: { "phase-reviewer": { backend: "codex", model: "gpt-5.5" } },
      backends: { native: { type: "native" }, codex: CODEX_BACKEND },
    });
    const r = resolve(dir, "phase-reviewer");
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /ADVERSARY: none/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("resolve: native reviewer with no adversary prints ADVERSARY: none", () => {
  const dir = mk();
  try {
    // No models.json: falls back to native default
    const r = resolve(dir, "phase-reviewer");
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /ADVERSARY: none/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("resolve: non-reviewer role with an adversary key warns about ignored adversary to stderr", () => {
  const dir = mk();
  try {
    writeConfig(dir, {
      roles: {
        "implementer": {
          backend: "native",
          model: "sonnet",
          adversary: { backend: "codex", model: "gpt-5.5" },
        },
      },
      backends: { native: { type: "native" }, codex: CODEX_BACKEND },
    });
    const r = resolve(dir, "implementer");
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /DISPATCH: native/);
    assert.match(r.stderr, /adversary.*ignored|ignored.*adversary/i,
      "must warn that the adversary key was ignored for a non-reviewer role");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("resolve: adversary identical to primary warns and skips the adversary", () => {
  const dir = mk();
  try {
    writeConfig(dir, {
      roles: {
        "phase-reviewer": {
          backend: "codex",
          model: "gpt-5.5",
          adversary: { backend: "codex", model: "gpt-5.5" },
        },
      },
      backends: { native: { type: "native" }, codex: CODEX_BACKEND },
    });
    const r = resolve(dir, "phase-reviewer");
    assert.equal(r.status, 0, r.stderr);
    // Should warn about identical adversary
    assert.match(r.stderr, /identical|same as primary/i,
      "must warn when adversary is identical to primary");
    // The adversary line should say none or warn - the adversary is skipped
    assert.match(r.stdout, /ADVERSARY:/, "ADVERSARY: line must still appear");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("show: reviewer with adversary displays adversary line in output", () => {
  const dir = mk();
  try {
    writeConfig(dir, REALISTIC_WITH_ADVERSARY);
    const r = show(dir);
    assert.equal(r.status, 0, r.stderr);
    // The show output should include adversary info for phase-reviewer
    assert.match(r.stdout, /phase-reviewer/);
    assert.match(r.stdout, /adversary|ADVERSARY/i,
      "show must include adversary information for reviewer with one configured");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("show: dormant design-reviewer adversary is parsed and shown", () => {
  const dir = mk();
  try {
    writeConfig(dir, {
      roles: {
        "implementer": { backend: "native", model: "sonnet" },
        "phase-planner": { backend: "native", model: "opus" },
        "design-reviewer": {
          backend: "native",
          model: "opus",
          adversary: { backend: "codex", model: "o3" },
        },
        "phase-reviewer": { backend: "codex", model: "gpt-5.5" },
      },
      backends: {
        "native": { type: "native" },
        "codex": CODEX_BACKEND,
      },
    });
    const r = show(dir);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /design-reviewer/);
    assert.match(r.stdout, /adversary|ADVERSARY/i,
      "show must display the design-reviewer adversary even though it is dormant (v2)");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("run --adversary: native adversary is refused (native must be Task-spawned)", () => {
  const dir = mk();
  try {
    writeConfig(dir, {
      roles: {
        "phase-reviewer": {
          backend: "codex",
          model: "gpt-5.5",
          adversary: { backend: "native", model: "opus" },
        },
      },
      backends: { native: { type: "native" }, codex: CODEX_BACKEND },
    });
    const r = runAdversary(dir, "phase-reviewer", []);
    assert.notEqual(r.status, 0, "native adversary must be refused by run --adversary");
    assert.match(r.stderr, /native|Task tool/i,
      "error must mention that native roles run via the Task tool");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("run --adversary: warns and exits non-zero when adversary is identical to primary", () => {
  const dir = mk();
  try {
    writeConfig(dir, {
      roles: {
        "phase-reviewer": {
          backend: "codex",
          model: "gpt-5.5",
          adversary: { backend: "codex", model: "gpt-5.5" },
        },
      },
      backends: { native: { type: "native" }, codex: CODEX_BACKEND },
    });
    const r = runAdversary(dir, "phase-reviewer", []);
    assert.notEqual(r.status, 0, "identical adversary must not run");
    assert.match(r.stderr, /identical|same as primary/i,
      "must warn that the adversary is identical to the primary");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("run --adversary: no adversary configured exits non-zero with a useful message", () => {
  const dir = mk();
  try {
    writeConfig(dir, {
      roles: { "phase-reviewer": { backend: "codex", model: "gpt-5.5" } },
      backends: { native: { type: "native" }, codex: CODEX_BACKEND },
    });
    const r = runAdversary(dir, "phase-reviewer", []);
    assert.notEqual(r.status, 0, "run --adversary with no adversary configured must fail");
    assert.match(r.stderr, /no adversary|adversary.*not configured/i);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("run --adversary: non-reviewer role with no adversary exits non-zero", () => {
  const dir = mk();
  try {
    writeConfig(dir, {
      roles: { "implementer": { backend: "native", model: "sonnet" } },
      backends: { native: { type: "native" } },
    });
    const r = runAdversary(dir, "implementer", []);
    assert.notEqual(r.status, 0, "implementer has no adversary - must fail");
    assert.match(r.stderr, /no adversary|adversary.*not configured|adversary.*ignored/i);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("run --adversary: dispatches to the adversary backend, not the primary", () => {
  // Uses two real on-PATH CLIs as distinguishable stand-ins: the primary backend
  // runs `node --version` (outputs "vX.Y.Z"), the adversary runs `git --version`
  // (outputs "git version X.Y.Z"). Both ignore stdin and exit 0. The test proves
  // --adversary selected the adversary descriptor and spawned it.
  const dir = mk();
  try {
    writeConfig(dir, {
      roles: {
        "phase-reviewer": {
          backend: "node-ver",
          model: "any",
          adversary: { backend: "git-ver", model: "any" },
        },
      },
      backends: {
        native:    { type: "native" },
        "node-ver": { type: "cli", cmd: "node --version", promptVia: "stdin" },
        "git-ver":  { type: "cli", cmd: "git --version",  promptVia: "stdin" },
      },
    });
    const r = runAdversary(dir, "phase-reviewer", []);
    // The adversary (git --version) must have run. Exit 0 means it spawned fine.
    assert.equal(r.status, 0, "adversary cli exited non-zero: " + r.stderr);
    // git --version outputs "git version ..." - must appear in stdout
    assert.match(r.stdout, /git version/i,
      "stdout must contain the adversary (git) output, got: " + r.stdout);
    // The primary (node --version) must NOT have run
    assert.doesNotMatch(r.stdout, /^v\d+\.\d+\.\d+/m,
      "primary (node --version) output must not appear in stdout");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// A stdin-echo backend: pipes stdin straight to stdout so the composed prompt
// appears in the process stdout. Used to assert prompt note wording.
const ECHO_BACKEND = {
  type: "cli",
  cmd: "node -e \"process.stdin.pipe(process.stdout)\"",
  promptVia: "stdin",
};

test("run --adversary: phase-reviewer adversary prompt carries diff wording", () => {
  // The phase-reviewer adversary note must mention "diff" (unchanged behavior).
  const dir = mk();
  try {
    writeConfig(dir, {
      roles: {
        "phase-reviewer": {
          backend: "native",
          model: "opus",
          adversary: { backend: "echo", model: "any" },
        },
      },
      backends: { native: { type: "native" }, echo: ECHO_BACKEND },
    });
    const r = runAdversary(dir, "phase-reviewer", []);
    assert.equal(r.status, 0, "echo adversary exited non-zero: " + r.stderr);
    assert.match(r.stdout, /diff/i,
      "phase-reviewer adversary prompt must contain 'diff'");
    assert.doesNotMatch(r.stdout, /design doc/i,
      "phase-reviewer adversary prompt must not contain 'design doc'");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("run --adversary: design-reviewer adversary prompt carries design-doc wording, not diff", () => {
  // The design-reviewer adversary note must not say "diff"; it must reference
  // the design doc and the primary design review.
  const dir = mk();
  try {
    writeConfig(dir, {
      roles: {
        "design-reviewer": {
          backend: "native",
          model: "opus",
          adversary: { backend: "echo", model: "any" },
        },
      },
      backends: { native: { type: "native" }, echo: ECHO_BACKEND },
    });
    const r = runAdversary(dir, "design-reviewer", []);
    assert.equal(r.status, 0, "echo adversary exited non-zero: " + r.stderr);
    assert.match(r.stdout, /design doc/i,
      "design-reviewer adversary prompt must contain 'design doc'");
    assert.doesNotMatch(r.stdout, /the diff above/i,
      "design-reviewer adversary prompt must not contain 'the diff above'");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
