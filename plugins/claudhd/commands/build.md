---
description: Implement exactly one phase of a plan, tests-first, then stop for review
argument-hint: <path-to-plan> <phase-number>
---
Arguments: $ARGUMENTS

Resolve a plan file and a phase number from those arguments before doing anything else, tolerating filler:
- **Plan file**: the plan path in the arguments (a path, normally ending in `_plan.md` or `-plan.md`).
- **Phase**: the phase number (the integer). Ignore a literal `phase` token if it appears, so `<plan> phase 3`, `<plan> 3`, and `phase 3` all resolve to the same plan and phase 3.
- If a phase number is given with no plan path, locate the plan yourself (the `*_plan.md` / `*-plan.md` the project is currently building) and confirm it with me before continuing.
- If you cannot determine BOTH a plan file and a phase number, ask me. Do not guess the phase.

Use the resolved plan path and phase number (called `<plan>` and `<phase>` below), not the raw argument tokens, in every command and subagent call.

Before spawning the implementer, run and wait for:

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/sentinel.js write <plan> <phase>
```

This writes the active-phase sentinel into `.now/state.json`'s build section with the phase's file list, before the implementer's first edit, so the file-list guard is active from the first tool call. Then run:

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/thread.js enter-build
```

so `Mode: build` renders correctly on the board (guard enforcement itself keys off the sentinel's presence, not this field; this call is display only). If the project has not opted in (no `.now/enabled` or legacy `.gantry/enabled` marker), both guards are inert and these calls are harmless no-ops; run them regardless.

**Dispatch the implementer to its configured model backend.** Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/role.js resolve implementer`:
- `DISPATCH: native`: spawn the **implementer** subagent (use the model the resolve output names) to implement exactly ONE phase, passing it the resolved `<plan>` and `<phase>`.
- `DISPATCH: external`: run `node ${CLAUDE_PLUGIN_ROOT}/scripts/role.js run implementer -- <plan> <phase>` and treat its stdout as the implementer's report. This runs a headless `claude -p` inside the Claude Code harness with the phase-enforcement guards injected, so the file-list and commit guards apply exactly as they do for the native implementer. On failure (CLI missing/unauthed/non-zero), report it and fall back to the native subagent.

**Fix-relay invocations carry the fixes verbatim.** When this command is re-invoked as the fix-relay path (below) rather than a fresh phase, read the Required fixes or Fix-now notes back from the round you just recorded (`.gantry/review-round.json`, or the reviewer's verdict still in front of you) and pass that text VERBATIM as part of the implementer's input, in both dispatch forms - never a paraphrase, and never just a pointer like "apply the reviewer's findings":
- `DISPATCH: native`: include the fixes text verbatim in the **implementer** subagent's Task prompt, alongside the plan and phase.
- `DISPATCH: external`: append the fixes text verbatim to `<inputs>` in `role.js run implementer -- <plan> <phase> <fixes text>`.

The implementer's own fix-mode contract (`agents/implementer.md`) is to apply only the listed fixes; it cannot do that without receiving them verbatim, native or external alike.

`role.js` refuses any implementer backend that is not `native` or `claude-headless`, so the implementer can never run somewhere the hooks cannot see it. The sentinel written above is what those guards enforce against, native or headless alike.

The implementer works tests-first (where a test framework exists), stays inside the plan's file list, will not commit, and will not advance past the one phase. When it returns, relay its report verbatim: files changed, test status, each exit criterion, scope drift, and any blockers it hit. Set the phase's `**Status:**` line in the plan to `built` (the implementer never edits the plan; you do). Then stop and recommend `/claudhd:review <plan> <phase>` before I commit. Do not start the next phase, and do not commit.

This command is also the fix-relay path for the reviewer: when phase-reviewer returns a FAIL or fix-now notes, the orchestrator widens the sentinel with `sentinel.js add-files` for the cited paths, records the round with `sentinel.js record-round <plan> <phase> <verdict>` (the fixes piped on stdin), and then re-invokes `/claudhd:build <plan> <phase>` with the Required fixes passed to the implementer verbatim (see "Fix-relay invocations carry the fixes verbatim" above). Build itself is unchanged: the same implementer spawn as a normal fix pass, and re-running the sentinel write for the same plan and phase keeps the recorded rounds. After the fix, phase-reviewer is re-run WITH the recorded rounds as re-review context (external: `--context .gantry/review-round.json`; native: the `role.js show-round` block in the subagent prompt), so a fresh re-review treats fixes applied as ordered as settled instead of contradicting them.
