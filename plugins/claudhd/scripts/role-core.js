/*
 * role-core.js - pure logic for routing a Gantry role to a model backend.
 *
 * Gantry's four roles (implementer, phase-planner, design-reviewer,
 * phase-reviewer) each run on a "backend": a native in-session Claude Code
 * subagent, a headless `claude -p` subprocess (optionally pointed at an
 * Anthropic-compatible third-party brain), or an external agent CLI such as
 * codex. The config lives in .gantry/models.json. This module turns that config
 * into a validated routing decision plus the argv/env needed to run it.
 *
 * Two invariants this module enforces:
 *
 *   1. Fail SAFE to native. A missing or malformed models.json resolves every
 *      role to its native subagent, so an unconfigured or corrupted project
 *      behaves exactly like Gantry did before this feature existed.
 *
 *   2. The implementer never leaves the Claude Code harness. The phase
 *      enforcement hooks (file-list guard, commit guard) are Claude Code
 *      PreToolUse hooks; they fire only for tool calls the Claude Code harness
 *      makes - an in-session subagent OR a headless `claude -p`. An external
 *      CLI's writes are invisible to them. So resolveRole() REFUSES to route the
 *      implementer to any backend whose edits the hooks cannot see. This is the
 *      one place the module fails CLOSED: a deliberate off-harness implementer
 *      assignment is an error, not a silently honored choice. (Validated: hooks
 *      do fire inside a nested headless `claude -p`.)
 *
 * Pure module: no fs, no spawn, no process.env. All IO lives in role.js so the
 * routing decisions and command construction stay unit-testable in isolation.
 */
"use strict";

// Backend types whose tool calls run inside the Claude Code harness, so the
// PreToolUse enforcement hooks fire. ONLY these may run the implementer.
const HARNESS_SAFE_TYPES = ["native", "claude-headless"];

// The roles Gantry knows how to dispatch. An assignment for any other name is
// a config error, not a silently-ignored key.
const VALID_ROLES = [
  "implementer",
  "phase-planner",
  "design-reviewer",
  "phase-reviewer",
];

// The two review-gate roles. scaffoldConfig() routes both to codex by
// default when the codex CLI is available (a second model's eyes on the
// two gates that read a Claude role's own output - the design doc and the
// diff).
const REVIEWER_ROLES = ["design-reviewer", "phase-reviewer"];

// The backend types resolveRole knows how to dispatch and buildInvocation knows
// how to run. An unknown type is an ordinary config error (caught at resolve,
// fail-safe to native), never an external dispatch that throws later at run.
const KNOWN_BACKEND_TYPES = ["native", "claude-headless", "cli", "openai-compat"];

// The shipped fallback: every role native, behaviour unchanged until a project
// flips a role to an external backend. This is the value parseConfig degrades to
// when models.json is absent or unreadable, so it must never depend on an
// external CLI being installed (invariant #1). The config init SCAFFOLDS is a
// different thing - see scaffoldConfig below, which prefers codex for the phase
// reviewer when the codex CLI is actually present. Only verified backends are
// shipped here
// (native, headless claude, codex). gemini / openai-compat / brain-swap claude
// backends are documented in /claudhd:models for users to add as config rows.
const DEFAULT_CONFIG = {
  roles: {
    "implementer": { backend: "native", model: "sonnet" },
    "phase-planner": { backend: "native", model: "opus" },
    "design-reviewer": { backend: "native", model: "opus" },
    "phase-reviewer": { backend: "native", model: "opus" },
  },
  backends: {
    // In-session Claude Code subagent (spawned via the Task tool by the
    // orchestrator, never by role.js). Hooks fire.
    "native": { type: "native" },
    // Headless `claude -p`. Hooks fire (same harness). Add base_url + env_key to
    // swap the brain for any Anthropic-compatible model and keep the hooks.
    "claude": { type: "claude-headless" },
    // OpenAI's Codex CLI. sandbox defaults to workspace-write because reviewers
    // run the project's test command and the design-reviewer writes its
    // _reviewed doc; the agent prompt is what keeps it read-only on source.
    "codex": {
      type: "cli",
      cmd: "codex exec --model {model} --sandbox {sandbox} --skip-git-repo-check -c model_reasoning_effort=high",
      promptVia: "stdin",
      sandbox: "workspace-write",
    },
  },
};

// Both gates read work a Claude role just produced - the design doc and the
// diff - so both are where a second model earns its cost. This is the default
// routing init writes for a new project, but only when the codex CLI is on
// PATH, since scaffolding a gate that cannot run is worse than no gate.
const CODEX_REVIEWER = { backend: "codex", model: "gpt-5.6-sol" };

// Build the config to scaffold into a fresh project. `codexAvailable` comes from
// a probe at the call site (init.js), never from a guess here. `codexBin`
// (optional) is the full path of the codex binary that actually passed that
// probe, for when the bare `codex` on PATH is a stale shim that cannot start;
// it replaces the leading `codex` token of the backend cmd so the scaffolded
// reviewers invoke the binary that works. buildInvocation tokenizes the cmd
// template on whitespace, so a whitespace-containing path cannot be
// represented; such an override is ignored (default cmd kept) rather than
// scaffolded broken. Returns a deep-enough copy so callers cannot mutate
// DEFAULT_CONFIG through it.
function scaffoldConfig(codexAvailable, codexBin) {
  const config = {
    roles: { ...DEFAULT_CONFIG.roles },
    backends: { ...DEFAULT_CONFIG.backends },
  };
  if (codexAvailable) {
    for (const role of REVIEWER_ROLES) config.roles[role] = { ...CODEX_REVIEWER };
    if (codexBin && !/\s/.test(codexBin)) {
      config.backends.codex = {
        ...DEFAULT_CONFIG.backends.codex,
        cmd: DEFAULT_CONFIG.backends.codex.cmd.replace(/^codex(?=\s)/, () => codexBin),
      };
    }
  }
  return config;
}

// Parse models.json text into a config object, falling back to DEFAULT_CONFIG on
// any error (absent file, malformed JSON, wrong shape). Never throws. This is
// invariant #1: an unreadable config behaves like stock Gantry.
function parseConfig(text) {
  if (text == null || text === "") return DEFAULT_CONFIG;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return DEFAULT_CONFIG;
  }
  if (!parsed || typeof parsed !== "object") return DEFAULT_CONFIG;
  if (!parsed.roles || !parsed.backends) return DEFAULT_CONFIG;
  return parsed;
}

// Resolve a role name against a config into a concrete routing decision.
//
// Returns an object with:
//   role        - the role name
//   error       - a string when the assignment is invalid, else null
//   dispatch    - "native" (spawn a subagent) or "external" (run via role.js)
//   type        - backend type (native | claude-headless | cli | openai-compat)
//   backendName - the backend key chosen
//   model       - resolved model id (role.model || backend.model || null)
//   backend     - the backend definition object (for buildInvocation)
//
// On error, dispatch/type are still filled where known so callers can report
// context, but callers MUST check error first and refuse to proceed.
function resolveRole(config, role) {
  const cfg = config || DEFAULT_CONFIG;

  if (!VALID_ROLES.includes(role)) {
    return {
      role,
      error:
        "unknown role '" + role + "'. Valid roles: " + VALID_ROLES.join(", "),
    };
  }

  // Role assignment: from config, else the shipped default for this role.
  const assignment =
    (cfg.roles && cfg.roles[role]) || DEFAULT_CONFIG.roles[role];
  const backendName = assignment.backend;

  // Backend definition: from config, else the shipped default backend.
  const backend =
    (cfg.backends && cfg.backends[backendName]) ||
    DEFAULT_CONFIG.backends[backendName];

  if (!backend) {
    return {
      role,
      backendName,
      error:
        "role '" + role + "' names backend '" + backendName +
        "', which is not defined in backends. Define it in .gantry/models.json.",
    };
  }

  const type = backend.type;
  const model = assignment.model || backend.model || null;

  // Unknown backend type: an ordinary config error (typo / unsupported type),
  // tagged plain (no harnessGuard) so the CLI warns and falls back to native
  // rather than dispatching external and throwing later in buildInvocation.
  if (!KNOWN_BACKEND_TYPES.includes(type)) {
    return {
      role,
      backendName,
      type,
      error:
        "backend '" + backendName + "' has unknown type '" + type +
        "'. Known types: " + KNOWN_BACKEND_TYPES.join(", ") + ".",
    };
  }

  // Invariant #2: the implementer must stay on a harness the hooks can see.
  // This error is tagged harnessGuard:true so the CLI treats it as the one hard
  // stop. It is distinct from an ordinary config error (typo, unknown backend),
  // which is fail-safe (the caller falls back to native). A well-formed but
  // off-harness implementer assignment is a deliberate choice we refuse, not an
  // accident we paper over by silently downgrading the model.
  if (role === "implementer" && !HARNESS_SAFE_TYPES.includes(type)) {
    return {
      role,
      backendName,
      type,
      harnessGuard: true,
      error:
        "implementer cannot run on backend '" + backendName + "' (type '" +
        type + "'). The phase-enforcement hooks only fire inside the Claude " +
        "Code harness, so the implementer must use a 'native' or " +
        "'claude-headless' backend. Refusing to delegate the implementer " +
        "off-harness - it would void the file-list and commit guards.",
    };
  }

  // A headless claude (and any external backend) needs an explicit model: a
  // nested `claude -p` with no --model inherits an unusable default and dies,
  // and an external CLI needs a model id to call. Native is exempt: the
  // subagent's own frontmatter pins its tier.
  if (type !== "native" && !model) {
    return {
      role,
      backendName,
      type,
      error:
        "backend '" + backendName + "' (type '" + type +
        "') requires a model. Set \"model\" on the role or the backend in " +
        ".gantry/models.json.",
    };
  }

  return {
    role,
    error: null,
    dispatch: type === "native" ? "native" : "external",
    type,
    backendName,
    model,
    backend,
  };
}

// Substitute {placeholder} tokens in a command template. Only used for values
// known to contain no whitespace (model ids, sandbox modes), so the result can
// be tokenized on whitespace safely by the caller.
function expandCmd(template, vars) {
  return String(template).replace(/\{(\w+)\}/g, (whole, key) => {
    return Object.prototype.hasOwnProperty.call(vars, key)
      ? String(vars[key])
      : whole;
  });
}

// Strip a leading YAML frontmatter block (--- ... ---) from a markdown string,
// returning the body. The agent .md files lead with frontmatter (name, tools,
// model); the external backends want only the instruction body as the prompt.
function stripFrontmatter(md) {
  const text = String(md);
  const m = text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return m ? text.slice(m[0].length) : text;
}

// Extract the comma/space-separated tool list from an agent .md `tools:` line so
// a headless run can mirror the subagent's tool surface via --allowedTools.
// Returns an array of tool names, or [] if no tools line is present.
function parseTools(md) {
  const m = String(md).match(/^tools:\s*(.+)$/m);
  if (!m) return [];
  return m[1]
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

// Compose the prompt fed to an external backend: the role's instruction body
// (frontmatter already stripped) plus a runtime block carrying the caller's
// inputs and a reminder that the tool must gather the diff/files itself.
//
// rereviewBlock (optional) is the prior-rounds context from formatRereviewBlock,
// appended after the inputs so a re-review carries the earlier verdicts. Absent
// on a first-round review, which keeps the first-round prompt byte-identical to
// what it was before re-review context existed.
function composePrompt(body, inputs, rereviewBlock) {
  const inputBlock = (inputs && inputs.trim()) || "(no extra inputs)";
  return (
    String(body).trim() +
    "\n\n---\n## Runtime inputs\n" +
    inputBlock +
    (rereviewBlock ? "\n\n" + String(rereviewBlock).trim() : "") +
    "\n\nGather the diff and any files you need yourself using the tools " +
    "available to you, then produce exactly the output described above. " +
    "Return only that output."
  );
}

// Parse .gantry/review-round.json text into a prior-rounds state object, or
// null when the text is absent, malformed, or holds no usable round. Fail-safe
// like parseConfig: a broken round file must never block a review - the caller
// simply reviews without context, exactly as before the feature existed.
function parseReviewRound(text) {
  if (text == null || text === "") return null;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  if (typeof parsed.phase !== "number" || !Array.isArray(parsed.rounds)) {
    return null;
  }
  const rounds = parsed.rounds.filter(
    (r) =>
      r && typeof r === "object" &&
      typeof r.verdict === "string" && r.verdict.trim() !== "" &&
      typeof r.fixes === "string" && r.fixes.trim() !== ""
  );
  if (rounds.length === 0) return null;
  return {
    plan: typeof parsed.plan === "string" ? parsed.plan : "",
    phase: parsed.phase,
    rounds,
  };
}

// Render the prior-rounds state into the context block a re-review carries.
// The wording IS the contract: a required fix a prior round ordered and the
// implementer applied as ordered is settled, and only a NEW defect the fix
// itself introduced may reopen it. This is what stops a stateless round-N
// reviewer from failing the exact change round N-1 required.
function formatRereviewBlock(state) {
  const lines = [
    "## Prior review rounds (re-review context)",
    "This diff has already been reviewed for phase " + state.phase + ". Each " +
      "round below issued required fixes that were relayed to the implementer " +
      "and applied as ordered.",
    "",
  ];
  state.rounds.forEach((r, i) => {
    lines.push("### Round " + (r.round || i + 1) + " - " + r.verdict.trim());
    lines.push(r.fixes.trim());
    lines.push("");
  });
  lines.push(
    "A fix a prior round ordered and the implementer applied as ordered is " +
      "SETTLED: do not reverse it, order it undone, or fail the diff for " +
      "containing it, even if you would not have ordered it yourself. The " +
      "only ground to flag settled work is a NEW defect the fix itself " +
      "introduced - name that defect specifically. Everything else in the " +
      "diff gets the normal checklist, fresh."
  );
  return lines.join("\n");
}

// Build the concrete subprocess invocation for a NON-native resolved role.
//
// descriptor: a successful resolveRole() result (error === null, dispatch
//             "external").
// opts: { prompt, allowedTools, authToken }
//   prompt       - the composed prompt string
//   allowedTools - array of tool names (claude-headless only)
//   authToken    - value of the backend's env_key, read by role.js from the
//                  environment (kept out of this pure module)
//
// Returns { argv, env, stdin } where:
//   argv  - array of executable + args (no shell metacharacters in any element)
//   env   - extra environment variables to merge over process.env
//   stdin - the prompt string if delivered via stdin, else null (then the
//           prompt is already present as an argv element)
//
// Throws for a native descriptor: native backends are spawned via the Task
// tool, not run as a subprocess.
function buildInvocation(descriptor, opts) {
  const o = opts || {};
  const b = descriptor.backend || {};
  const model = descriptor.model;
  const env = {};
  let argv;
  let stdin = null;

  switch (descriptor.type) {
    case "native":
      throw new Error(
        "buildInvocation: native backends are spawned via the Task tool, not run"
      );

    case "claude-headless": {
      // Same harness as in-session, so the enforcement hooks fire. Pin --model
      // (a nested claude inherits an unusable default otherwise). Prompt goes
      // via stdin to avoid argv quoting of a multi-KB, multi-line prompt.
      argv = ["claude", "-p", "--model", model];
      // For a headless implementer, role.js injects the phase-enforcement guards
      // via a settings file (relative path, so it is space-free) so the
      // file-list and commit guards apply without relying on plugin auto-load.
      if (o.settingsPath) argv.push("--settings", o.settingsPath);
      const tools = o.allowedTools || [];
      if (tools.length) argv.push("--allowedTools", tools.join(","));
      // Brain-swap: point the Claude Code harness at an Anthropic-compatible
      // endpoint. The model changes; the harness (and its hooks) do not.
      if (b.base_url) {
        env.ANTHROPIC_BASE_URL = b.base_url;
        if (o.authToken) env.ANTHROPIC_AUTH_TOKEN = o.authToken;
      }
      stdin = o.prompt || "";
      break;
    }

    case "cli": {
      const sandbox = b.sandbox || "workspace-write";
      const expanded = expandCmd(b.cmd, { model, sandbox });
      argv = expanded.split(/\s+/).filter(Boolean);
      if ((b.promptVia || "stdin") === "stdin") {
        stdin = o.prompt || "";
      } else {
        argv.push(o.prompt || "");
      }
      break;
    }

    case "openai-compat": {
      // Reach any OpenAI-compatible model through Codex, which lends it tools.
      // The provider (base_url + env_key) is defined once in ~/.codex/config.toml
      // under [model_providers.<provider>]; here we just select it by name, so
      // no argv element carries spaces or quotes.
      const sandbox = b.sandbox || "workspace-write";
      argv = [
        "codex", "exec",
        "--model", model,
        "--sandbox", sandbox,
        "--skip-git-repo-check",
        "-c", "model_provider=" + b.provider,
      ];
      stdin = o.prompt || "";
      break;
    }

    default:
      throw new Error(
        "buildInvocation: unknown backend type '" + descriptor.type + "'"
      );
  }

  return { argv, env, stdin };
}

// Build a Claude Code settings object that wires Gantry's two phase-enforcement
// guards as PreToolUse hooks, for injection into a headless implementer via
// --settings. This makes a headless `claude -p` implementer enforce the
// file-list and commit guards explicitly, without depending on plugin hook
// auto-load in a nested session. The guards themselves fail open unless
// .gantry/enabled is set and a fresh sentinel is present in the `build`
// section of .now/state.json (schema v2; a legacy .gantry/active-phase.json
// is imported into it once, on first read - see sentinel-core.js), so
// injecting them is inert when enforcement is not opted in.
function buildGuardSettings(fileListGuardPath, commitGuardPath) {
  return {
    hooks: {
      PreToolUse: [
        {
          matcher: "Edit|Write|MultiEdit",
          hooks: [{ type: "command", command: 'node "' + fileListGuardPath + '"' }],
        },
        {
          matcher: "Bash",
          hooks: [{ type: "command", command: 'node "' + commitGuardPath + '"' }],
        },
      ],
    },
  };
}

module.exports = {
  HARNESS_SAFE_TYPES,
  VALID_ROLES,
  REVIEWER_ROLES,
  DEFAULT_CONFIG,
  CODEX_REVIEWER,
  scaffoldConfig,
  parseConfig,
  resolveRole,
  expandCmd,
  stripFrontmatter,
  parseTools,
  composePrompt,
  parseReviewRound,
  formatRereviewBlock,
  buildInvocation,
  buildGuardSettings,
};
