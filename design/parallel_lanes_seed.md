# Parallel lanes: one plan, many phases in flight (seed, ungrilled)

Drafted 2026-09-06 from a repo audit of ClauDHD 1.0.8, Gantry 0.8.0, Capsule Castle, and the installed Codex CLI 0.153.4. Status: seed. Grill before design review.

## Problem

- The pipeline skill (`plugins/claudhd/skills/pipeline/SKILL.md:70`) runs one phase at a time. A 6-phase plan is 6 serial implement/review/commit loops.
- Plans already declare disjoint file sets per phase (`**Files:**`, parsed by `sentinel.js`). Nothing uses that to run disjoint phases at the same time.
- Two model pools are paid for (Claude, ChatGPT). Only the reviewer roles draw on the second pool today.

## What already exists (verified 2026-09-06)

- `.gantry/models.json` routes any role to `native`, `claude-headless`, `cli`, or `openai-compat` (`role-core.js:54`).
- Capsule Castle routes `design-reviewer` and `phase-reviewer` to `codex` / `gpt-6-astra` via `codex exec --sandbox workspace-write`. Astra is in `~/.codex/models_cache.json`.
- `HARNESS_SAFE_TYPES = ["native", "claude-headless"]` (`role-core.js:34`): the implementer cannot leave the Claude harness because `file-list-guard.js` and `commit-guard.js` are Claude PreToolUse hooks.
- Codex supports PreToolUse hooks (`~/.codex/hooks.json` runs `dangerous-commands.py` on Bash/PowerShell). Payload compatibility with the ClauDHD guards: unverified.
- Codex subagents: `[features] multi_agent = true`, `[agents] max_threads` (default 6), agent defs in `.codex/agents/*.toml`. Not enabled in `~/.codex/config.toml`. Capsule Castle has `.codex/agents/{implementer,phase-planner,phase-reviewer,godot-editor,hero-design-reviewer}.toml` already.
- gantrybench 2026-06-14: the codex reviewer caught the D12 integration gap (engine built, never called) that the same-model opus gate passed. Cost of that arm: ~1.39M codex tokens for one 6-phase plan.
- `.now/`, `NOW.md`, `IDEAS.md`, `SHIPPED.md` are gitignored in Capsule Castle. A git worktree starts with none of them.

## Decision: one orchestrator, N lanes

- Reject two peer orchestrators. `state.json`, `NOW.md`, the plan `Status` fields and `SHIPPED.md` have one writer today. Two orchestrators means two writers on the same cursor and a merge problem on every commit.
- The Claude Code session is the plan orchestrator: owns the plan cursor, the lane scheduler, and the merge gate.
- A lane is one phase of one plan running in its own git worktree. The lane runs the existing implement -> review -> fix loop. Its backend is per lane: `native` (Claude implementer + codex reviewer, as today) or `codex` (one `codex exec` call that runs implementer and reviewer inside Codex, using the `.codex/agents/*.toml` roles).
- Astra reviews every lane regardless of who implemented it. Grounding: gantrybench, cross-model review caught what same-model review missed.

## Lane lifecycle

```
main checkout (orchestrator)              lane worktree ../<repo>-lane-p<N>
------------------------------            -----------------------------------
lanes.js ready <plan>
  -> phases with Depends committed
     and Files disjoint from open lanes
lanes.js open <plan> <N>  ---------->     git worktree add, branch lane/<plan>-p<N>
                                          .now/ created here, sentinel = phase N
                                          implementer (native or codex)
                                          scope check: diff files ⊆ Files, else FAIL
                                          phase-reviewer (codex/astra)
                                          FAIL -> fix round (cap 5) -> re-review
                                          PASS -> commit on lane branch (human gate)
lanes.js merge <N>        <----------     branch ready
  -> merge into main, run reconcile
     (plan Status, SHIPPED.md, NOW.md)
  -> git worktree remove
```

## Schema change (the only one)

- Add `**Depends:** phase N, M` or `none` to the PLAN template and `phase-planner.md`. Precedent: the optional `Wires / Wired-by` field.
- Scheduler rule: a phase is ready when every `Depends` phase has Status `committed` on main AND its `Files` set intersects no open lane's `Files` set.
- Phases listed under `## Cross-cutting concerns` are never auto-scheduled in parallel; the planner marks them `Depends: all prior`.

## Guard equivalence for a codex lane

- Correction (verified 2026-09-06, `scripts/hooks/file-list-guard.js:5-27`): since r-0729-1 the guard never denies. It logs out-of-scope edits to `.now/` and exits 0. With no sentinel it returns silently. So the native lane has no write-time block either; `HARNESS_SAFE_TYPES` protects a log, not a gate.
- Root resolution: `resolveRoot.walkForRoot` walks up from the edited file, so a worktree with its own `.now/enabled` resolves to itself. `scripts/root.js` prefers `CLAUDHD_PROJECT_DIR` over cwd for scripts; every lane invocation must set it to the worktree path or scripts will act on main.
- Decision: the post-hoc scope check runs for every lane, native or codex. `git diff --name-only` in the worktree must be a subset of the phase `Files` (plus the sentinel allow-list) before review.
- Codex lane: post-hoc scope check. After `codex exec` returns, `git diff --name-only` in the worktree must be a subset of the phase `Files`. Any extra path fails the lane before review runs; the worktree diff is kept for inspection, never merged.
- Option B, unverified: port `file-list-guard.js` to a Codex PreToolUse hook in `.codex/hooks.json`. Test the hook payload shape first.

## Backend routing per role (proposal)

| role | backend | reason |
|---|---|---|
| orchestrator, planner, merge-conflict fixes, grill | Claude session (Fable/opus) | owns state; PLAN template compliance is what the scheduler parses |
| design-reviewer, phase-reviewer | codex `gpt-6-astra` | already configured; cross-model catch rate |
| implementer, lane type `codex` | codex `gpt-5.6-sol` (Astra when the phase touches shared sim/contract files) | draws on ChatGPT usage; post-hoc scope check |
| implementer, lane type `native` | Claude sonnet | phases that need the write-time guard (shared registries, `systems/sim/*`) |

## Known costs and gaps

- Godot: each worktree reimports `.godot/` on first headless run. Duration unmeasured. Mitigation candidates: copy `.godot/` from main on `lanes.js open`, or keep 2 to 3 long-lived lane worktrees and reuse them.
- `.codex/config.toml` pins `godot-grounding` `cwd` and `GODOT_PROJECT` to the main checkout. A codex lane needs those overridden per worktree (`-c` overrides on the `codex exec` line).
- Commit reconcile (`SKILL.md:49-55`) assumes the sentinel and the commit are in the same checkout. In this design the lane commit happens in the worktree and the reconcile happens at merge on main. `lanes.js merge` must run the reconcile explicitly instead of relying on the commit hook.
- Uncommitted work on main is invisible to lanes. Fan-out requires a clean main or a deliberate stash.
- Test suite contention: N lanes running the Godot unit suite at once on one machine. Cap lanes at 3 until measured.
- Codex `multi_agent` inside a lane is optional. It gives a codex lane its own fan-out (up to 6 threads). Not needed for v1; the lane split is the parallelism.

## Capsule Castle first fan-out (from the 2026-09-06 plan audit)

Prerequisite: commit or stash the 56 dirty paths on main.

| lane | work | backend | shared-file risk |
|---|---|---|---|
| A | `docs/plan_code_review_fixes.md` Phase 1, items minus the `hero_p_5.tscn` item | codex | none |
| B | `docs/plan_combat_vfx_implementation.md` Phase 0 (asset import), then Phases 3, 4, 6 as three lanes | codex | plan declares 3/4/6 independent |
| C | `design/hero_p_5_design_reviewed-plan.md` R1 -> R5 serial inside one lane, plus the `hero_p_5.tscn` item from Phase 1 | native | R3 edits `series/series_catalog.gd` (shared) |
| D | 0.1 item 6c journal `.tres` entries | codex | none |

Never concurrent with a hero lane: code-review Phase 4.4 (`EnemyRegistry` sweep touches `hero_p_1/2/4/5.gd`).
Never concurrent: code-review Phase 3 group D and VFX Phase 7 (both edit `wildcard_effect_runner.gd`). Phase 7 is out of 0.1.

Stale references to fix before dispatch: P5 plan R5 names `ui/debug_buttons.gd` (deleted by the debug-console plan); P5 plan still marks R6/R7 BLOCKED (unblocked since 2026-06-07).

## Build order (sketch for phase-planner, not a plan)

1. `Depends:` field in template + planner; `lanes.js ready` (pure, tested against fixture plans).
2. `lanes.js open` / `lanes.js merge` with worktree create/remove and explicit reconcile.
3. Lane runner in `role.js`: `run lane <plan> <N> --backend native|codex`, post-hoc scope check for codex.
4. `claudhd:now` lists open lanes (this is `r-0727-1` made real).
5. Measure on Capsule Castle lanes A + D first (no shared files, cheap phases). Record wall time and token cost per lane against the serial baseline.

## Decisions (grill 2026-09-06)

- G1. Commit gate: a lane commits to its own branch automatically after review PASS. The human gate is the merge into main, one per phase. Lane branches are disposable until merged.
- G2. Cursor: while any lane is open, NOW.md's active thread is the plan and the "next physical action" line is replaced by a lane table (phase, backend, status, branch). `state.json` gains `build.lanes[]` beside the existing single `build` section, which stays for serial phases.
- G3. Opening: `lanes.js ready` prints the ready set with a backend per lane; the user approves the batch once; all approved lanes open. No further prompts until merge gates.
- G4. Merge: rebase the lane branch onto main inside its worktree, run the plan's verification command there, then fast-forward merge. The merge gate prompt shows the post-rebase test result. Main never receives an untested tip.
- G5. Worktrees: create per lane at `../<repo>-lane-p<N>`, copy `.godot/` from the main checkout on open (measured 303M on Capsule Castle 2026-09-06; the class cache is gitignored and headless runs fail without it, CLAUDE.md line 34), delete the worktree on merge. Generic rule: a project may declare `lane.copy` paths in its ClauDHD config; Godot projects list `.godot/`.
- G6. Cap: `lanes.cap` in the project's ClauDHD config, default 3. The ready set is truncated to the cap at open time. Raise after the first measured batch.
- G7. Codex lane implementer: new role `lane-implementer` in `models.json`, default `codex` / `gpt-5.6-sol`, reasoning high. Astra stays on review only. The batch approval table has a per-lane override column.
- G8. Lane loop: `lanes.js run <N>` drives implement -> review -> fix -> re-review (cap 5 rounds) as external processes. Codex lanes call `codex exec`; native lanes call `claude -p` through the existing `claude-headless` backend. No in-session Task-tool subagents inside a lane. The orchestrator launches N runs in the background and reads results. `HARNESS_SAFE_TYPES` no longer applies to lane steps; the post-hoc scope check is the guard for every lane. Each step sets `CLAUDHD_PROJECT_DIR` to the worktree.
- G9. Failure: on exhausted rounds, scope violation, non-zero backend exit, or a red post-rebase suite, the lane goes `blocked`. Worktree and branch are kept; the lane table shows the last review verdict and diff summary. The user chooses retry on the other backend, hand fix, or drop. No automatic backend switch or drop for implementer lanes. Reviewer fallback to native stays as today.

## Open decisions (owner: user)

- Lane cap (proposal: 3).
- Whether a codex lane implementer defaults to `gpt-5.6-sol` or Astra.
- Worktree reuse vs create-per-lane for Godot projects.
