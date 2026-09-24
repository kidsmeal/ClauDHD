---
name: claudhd-codex-pipeline
description: Run a feature through ClauDHD's gated design, planning, implementation, and review workflow in Codex. Use when the user asks to run ClauDHD, drive a reviewed feature pipeline, or execute a quick fix under ClauDHD.
---

# ClauDHD Codex pipeline

Use the shared scripts, agents, templates, and commands packaged beside this skill. This is the Codex execution adapter. Do not invoke the Claude `Task` tool or Claude external backends.

Resolve `<plugin-root>` as the plugin root containing this loaded `skills/claudhd-codex-pipeline/SKILL.md`. Use absolute paths under `<plugin-root>` for script commands. `PLUGIN_ROOT` is only guaranteed inside bundled hook commands.

## Roles

Resolve every role before dispatching it:

```text
node "<plugin-root>/scripts/codex-role.js" resolve <role>
```

The result is one JSON profile with `role`, `model`, `reasoning_effort`, `fork_turns`, and `instruction_path`. Dispatch only through `collaboration.spawn_agent` with all of these explicit fields:

```text
collaboration.spawn_agent({
  task_name: <unique role_phase_attempt name>,
  message: <shared agent instructions plus the bounded runtime task>,
  model: profile.model,
  reasoning_effort: profile.reasoning_effort,
  fork_turns: "none"
})
```

- `orchestrator` and `phase-planner`: `gpt-6-astra`, `medium`.
- `implementer`: `gpt-5.6-terra`, `high`.
- `design-reviewer` and `phase-reviewer`: `gpt-5.6-sol`, `high`.
- Read `instruction_path` before building the subagent message. Strip its YAML frontmatter; it carries Claude model and tool metadata. The resolved spawn profile is the sole model and reasoning source. Append only the Markdown body, current plan path, phase, review round, and bounded assignment.
- Give an implementer one phase or one verbatim reviewer-fix pass. Give a reviewer one design or one uncommitted phase diff. Give a planner one reviewed design.
- The main agent coordinates state and gates. It never takes over implementation, reviewer fixes, or quick changes after delegation begins.

Build `task_name` from the canonical role, phase or stage, and attempt number, using only lowercase letters, digits, and underscores. Example: `claudhd_implementer_p2_r1` or `claudhd_phase_reviewer_p2_r2`. Never reuse a completed task name.

Before each dispatch, write `.gantry/codex-run.json` with `agent_id: null`, `task_name`, role, profile, assignment, plan path, phase, review round, and `state: "running"`. Immediately after `collaboration.spawn_agent` returns, update `agent_id` while state remains `running`. On return, update `state` to `completed` and retain the full report for the next relay. This file is transient and ignored by git.

Resume a live agent only when `collaboration.list_agents` shows its recorded `agent_id` in the current live tree. Use that agent for its result or a bounded follow-up. If it is absent, use the saved plan, phase, round, and findings to dispatch a new uniquely named role agent. Wait only when the next gate depends on that result; do not issue empty status polls.

## Full pipeline

1. Initialize the project with `node "<plugin-root>/scripts/init.js"` when its ClauDHD files are absent.
2. Drive design using the shared design command and decision records. Dispatch `design-reviewer` for every draft. Resolve each `[NEEDS USER DECISION]` with the user, then re-review when a resolution changed the design. Do not plan an unreviewed design.
3. Dispatch `phase-planner` on the reviewed design. Surface blockers. Show the phase list and wait for the user's approval before phase 1.
4. For one phase, run `node "<plugin-root>/scripts/sentinel.js" write <plan> <phase>` and `node "<plugin-root>/scripts/thread.js" enter-build`, then dispatch `implementer`. The sentinel records the active plan, phase, and review history for reconciliation. It does not enforce a file scope. The implementer runs checks, edits only that phase, does not commit, and returns its full report.
5. Set the phase status to `built`, then dispatch `phase-reviewer` on the uncommitted diff. The reviewer stays read-only.
6. On `FAIL` or fix-now notes, run `node "<plugin-root>/scripts/sentinel.js" add-files` to keep the phase record current and `node "<plugin-root>/scripts/sentinel.js" record-round`, then dispatch `implementer` again with the required fixes verbatim. Dispatch `phase-reviewer` again with the saved round context. Stop for the user after five failed rounds.
7. Log surviving deferred notes before the commit policy check. On a clean review, set the phase status to `ready to commit`, present the diff and verdict, then run `node "<plugin-root>/scripts/thread.js" commit-policy`. `gate` requires user approval. `auto <plan>` permits this plan's commit because the user explicitly granted it earlier with `thread.js commit-policy auto <plan>`; never create that grant yourself. Push always requires user approval.
8. Keep the shared commit boundary command intact when policy permits the commit: `node "<plugin-root>/scripts/sentinel.js" clear && node "<plugin-root>/scripts/thread.js" clear-mode && git add <files> && git commit -m "<message>"`. Run it as one shell invocation so `commit-guard.js` reconciles before the commit and `commit-verify.js` records its outcome after the Bash call.

## Quick changes

`node "<plugin-root>/scripts/quick.js"` only captures and lists the batch. When clearing it, resolve and dispatch the `implementer` role with `fork_turns: "none"` after `node "<plugin-root>/scripts/sentinel.js" write-files` records the quick-fix batch. The bounded task is the current quick-fix batch only. The main agent does not edit the quick fixes itself. Run the named verification for each item, restore the active thread, and clear the sentinel. Do not commit.

## Gates

- Stop for unresolved design decisions, planner blockers, implementer blockers, five failed review rounds, and a `gate` commit policy.
- A reviewer finding that leads to any code change requires a new review before the commit gate opens.
- Keep reports compact: phase, verdict, files, check result, and only user decisions or blockers. Preserve full subagent reports in the run record or relay context.
