---
description: Turn a finalized design doc into a phased implementation plan
argument-hint: <path-to-design-doc>
---
If no path was given, ask me for one. Do not invent a design.

**Dispatch the phase-planner to its configured model backend.** Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/role.js resolve phase-planner`:
- `DISPATCH: native`: spawn the **phase-planner** subagent (use the model the resolve output names) to plan the implementation of the design doc at `$ARGUMENTS`.
- `DISPATCH: external`: run `node ${CLAUDE_PLUGIN_ROOT}/scripts/role.js run phase-planner -- $ARGUMENTS` and treat its stdout as the planner's result. The external planner reads the design and writes the plan itself; do not also spawn the subagent. On failure (CLI missing/unauthed/non-zero), report it and fall back to the native subagent.

Tell the agent (native or external) to read this project's convention files (`CLAUDE.md` / `AGENTS.md` / `CONVENTIONS.md` / `docs/CONVENTIONS.md`, whichever exist) and to detect the project's test/build command before planning.

When it returns, relay its summary verbatim: phase count, any blockers that prevent starting phase 1, and the path to the written plan. The plan is the deliverable; do not start implementing. If there are blockers, surface them so I can resolve them before we run `/claudhd:build`.

Once the plan is written, mode stays `design` until the first `/claudhd:build` call on it (which flips it to `build`). This is deliberate: the design thread is not done until a plan exists and phase 1 starts.
