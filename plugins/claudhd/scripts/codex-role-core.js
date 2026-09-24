"use strict";
/*
 * codex-role-core.js - bounded Codex collaboration role profiles.
 *
 * This is intentionally separate from role-core.js. role-core.js preserves
 * Claude's backend dispatch and its hook-safety rules; this module only maps
 * a ClauDHD role to the explicit arguments accepted by collaboration.spawn_agent.
 */

const ROLE_ALIASES = Object.freeze({
  chat: "orchestrator",
  orchestrator: "orchestrator",
  implementer: "implementer",
  "phase-planner": "phase-planner",
  "design-reviewer": "design-reviewer",
  "phase-reviewer": "phase-reviewer",
});

const ROLE_NAMES = Object.freeze([
  "orchestrator",
  "implementer",
  "phase-planner",
  "design-reviewer",
  "phase-reviewer",
]);

// Keep this list finite. A project config may choose only models and efforts
// the Codex collaboration API exposes in this integration; it never inherits
// the parent chat's model or reasoning setting.
const MODEL_REASONING_EFFORTS = Object.freeze({
  "gpt-6-astra": Object.freeze(["low", "medium", "high", "xhigh", "max", "ultra"]),
  "gpt-5.6-sol": Object.freeze(["low", "medium", "high", "xhigh", "max", "ultra"]),
  "gpt-5.6-terra": Object.freeze(["low", "medium", "high", "xhigh", "max", "ultra"]),
});

const DEFAULT_PROFILE = Object.freeze({
  orchestrator: Object.freeze({ model: "gpt-6-astra", reasoning_effort: "medium" }),
  "phase-planner": Object.freeze({ model: "gpt-6-astra", reasoning_effort: "medium" }),
  "design-reviewer": Object.freeze({ model: "gpt-5.6-sol", reasoning_effort: "high" }),
  "phase-reviewer": Object.freeze({ model: "gpt-5.6-sol", reasoning_effort: "high" }),
  implementer: Object.freeze({ model: "gpt-5.6-terra", reasoning_effort: "high" }),
});

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function canonicalRole(role) {
  if (typeof role !== "string" || !Object.prototype.hasOwnProperty.call(ROLE_ALIASES, role)) {
    throw new Error(
      "unknown role '" + String(role) + "'. Expected one of: " +
      Object.keys(ROLE_ALIASES).join(", ") + "."
    );
  }
  return ROLE_ALIASES[role];
}

function validateAssignment(role, assignment, source) {
  if (!isPlainObject(assignment)) {
    throw new Error(source + ".roles." + role + " must be an object.");
  }
  const keys = Object.keys(assignment);
  for (const key of keys) {
    if (key !== "model" && key !== "reasoning_effort") {
      throw new Error(source + ".roles." + role + " has unknown key '" + key + "'.");
    }
  }
  if (typeof assignment.model !== "string" || assignment.model.length === 0) {
    throw new Error(source + ".roles." + role + ".model must be a non-empty string.");
  }
  if (typeof assignment.reasoning_effort !== "string" || assignment.reasoning_effort.length === 0) {
    throw new Error(source + ".roles." + role + ".reasoning_effort must be a non-empty string.");
  }
  const efforts = MODEL_REASONING_EFFORTS[assignment.model];
  if (!efforts) {
    throw new Error(source + ".roles." + role + ".model '" + assignment.model +
      "' is unsupported. Expected one of: " + Object.keys(MODEL_REASONING_EFFORTS).join(", ") + ".");
  }
  if (!efforts.includes(assignment.reasoning_effort)) {
    throw new Error(source + ".roles." + role + ".reasoning_effort '" + assignment.reasoning_effort +
      "' is unsupported for model '" + assignment.model + "'.");
  }
  return { model: assignment.model, reasoning_effort: assignment.reasoning_effort };
}

// Parse a project override. Omission means the shipped profile. An explicit
// override is strict so a typo cannot silently launch a role on another model.
function parseOverride(text, source) {
  if (text == null) return {};
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(source + " contains invalid JSON: " + error.message);
  }
  if (!isPlainObject(parsed)) throw new Error(source + " must contain an object.");
  for (const key of Object.keys(parsed)) {
    if (key !== "roles") throw new Error(source + " has unknown key '" + key + "'. Expected only 'roles'.");
  }
  if (!Object.prototype.hasOwnProperty.call(parsed, "roles")) return {};
  if (!isPlainObject(parsed.roles)) throw new Error(source + ".roles must be an object.");

  const overrides = {};
  for (const [rawRole, assignment] of Object.entries(parsed.roles)) {
    const role = canonicalRole(rawRole);
    if (Object.prototype.hasOwnProperty.call(overrides, role)) {
      throw new Error(source + ".roles assigns '" + role + "' more than once.");
    }
    overrides[role] = validateAssignment(rawRole, assignment, source);
  }
  return overrides;
}

function resolveProfile(role, overrides) {
  const canonical = canonicalRole(role);
  const profile = overrides && overrides[canonical] ? overrides[canonical] : DEFAULT_PROFILE[canonical];
  return {
    requested_role: role,
    role: canonical,
    model: profile.model,
    reasoning_effort: profile.reasoning_effort,
    fork_turns: "none",
  };
}

module.exports = {
  DEFAULT_PROFILE,
  MODEL_REASONING_EFFORTS,
  ROLE_ALIASES,
  ROLE_NAMES,
  canonicalRole,
  parseOverride,
  resolveProfile,
};
