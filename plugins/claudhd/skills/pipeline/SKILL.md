---
name: claudhd-pipeline
description: Use to run a feature through the full ClauDHD pipeline in the correct order with both review gates - phrases like "run this through the pipeline", "drive the gated build end to end", "design, plan, and build this with reviews", or chaining /claudhd:start through /claudhd:review by hand. Orchestrates design (the grill, absorbed into /claudhd:design) -> design-reviewer -> phase-planner -> per phase (implementer -> phase-reviewer, re-reviewing after any fix), pausing only at the human gates (unresolved decisions, plan blockers, every commit). Not for quick one-off edits (see /claudhd:quick).
version: 1.0.2
---

# ClauDHD pipeline orchestrator

This skill drives a roadmap item through the full pipeline (start -> design -> plan -> per-phase build/review) in order, so you do not have to invoke each command by hand. It chains the underlying agent invocations automatically and stops only at the real human gates: an unresolved design decision, a plan blocker, an uncontained scope drift, a phase still failing review, and every commit. Everywhere else it advances on its own.

Two reviews are built in and neither is skippable:
- **Review gate 1, the design review.** The design-reviewer audits the design before anything is planned.
- **Review gate 2, the phase review, plus a re-review after any fix.** The phase-reviewer audits each phase's diff before commit, and any code the implementer writes to fix a failed review is itself re-reviewed before the commit gate. A fix is unreviewed code until the reviewer sees it again.

## Before you start
1. **Get the design in motion.** If the user gave a roadmap id, run `/claudhd:start <id>` first (the readiness gate: restates the item, sets mode design). If they gave a bare feature idea with no roadmap item, `/claudhd:design` can start from an idea directly. If they already have a design doc path, skip straight to Stage 1 below with that doc.
2. **Confirm the project is initialized.** `CURRENTNESS_AUDIT.md` and `RUNTIME_VERIFICATION_QUEUE.md` should exist and the project's conventions + test command should be known. If not, run `/claudhd:init` first.
3. Keep inter-stage chatter terse: relay each agent's summary, say which gate you are at, and move.

## Backend dispatch (applies to every agent in this skill)
Each agent runs on the model backend configured for its role in `.gantry/models.json`. Wherever a stage below says "spawn the design-reviewer / phase-planner / implementer / phase-reviewer", it means: first run `node ${CLAUDE_PLUGIN_ROOT}/scripts/role.js resolve <role>`, then
- `DISPATCH: native` -> spawn that subagent via the Task tool (use the model it names). This is the default and needs no setup.
- `DISPATCH: external` -> run `node ${CLAUDE_PLUGIN_ROOT}/scripts/role.js run <role> -- <inputs>` and use its stdout as that agent's output instead of spawning the subagent. The `<inputs>` are the same arguments you would have passed the subagent (e.g. the plan path and phase number). On failure (CLI missing/unauthed/non-zero exit), report it and fall back to the native subagent so no gate is ever skipped.

The implementer is special: `role.js` only allows it on a harness backend (`native` or `claude-headless`) and injects the phase-enforcement guards for the headless case, so the file-list and commit guards apply no matter which model implements. The verdict/report you relay is identical either way; this choice only changes which model produces it.

## Stage 1 - Design (review gate 1)
1. Run the grill following `/claudhd:design`'s own process: read conventions, interrogate the decision tree one fork at a time, record each resolution with `node ${CLAUDE_PLUGIN_ROOT}/scripts/thread.js decision resolved "<text>"` (or `decision open` for a deliberately deferred fork), then write the design doc once the tree resolves.
2. Spawn the **design-reviewer** on the draft (and the project's rubric if one exists). Relay its summary.
3. If it reports `[NEEDS USER DECISION: ...]` markers: **stop.** First record every marker as an open decision, verbatim (`node ${CLAUDE_PLUGIN_ROOT}/scripts/thread.js decision open "<the exact marker text>"`) - `resolve-decision` requires the exact text to already be in `design.open`, and it is not there yet just because the reviewer wrote it into the doc. Only then resolve each with the user, one at a time: update the reviewed doc with the resolution, and record it as that SAME marker's resolution (`node ${CLAUDE_PLUGIN_ROOT}/scripts/thread.js resolve-decision "<the exact marker text>" -- "<the real resolution>"`) - never a marker you have not first recorded as open.
4. If resolving those decisions materially changed the design, spawn the **design-reviewer once more** on the updated doc to confirm it now reads "Ready for phase planning: yes". This second pass catches problems the resolutions introduced.
5. **Gate:** do not proceed to planning until the reviewed design is clean.

## Stage 2 - Plan
1. Spawn the **phase-planner** on the finalized/reviewed design. Relay its summary: phase count, blockers, plan path.
2. If it reports blockers: **stop** and resolve them with the user (a blocker is a human decision, never a guess). Update the inputs and re-plan if needed.
3. Present the phase list and get the user's go-ahead to start phase 1. The user should see the plan before any code is written.

## Stage 3 - Phased build with review (review gate 2, repeated per phase)
For each phase, in dependency order (keep the phase's `**Status:**` line in the plan file current at every transition below; the implementer never edits the plan, so this write is yours):
1. Before spawning the implementer, run and wait for: `node ${CLAUDE_PLUGIN_ROOT}/scripts/sentinel.js write <plan-path> <phase-number>`, then `node ${CLAUDE_PLUGIN_ROOT}/scripts/thread.js enter-build` (display only; the sentinel is what the guard actually enforces against). If the project has not opted in (no `.now/enabled`/`.gantry/enabled`), both are harmless no-ops; run them regardless. Then spawn the **implementer** with the plan path and the phase number. Relay its report, then set the phase's Status to `built`.
2. If the implementer reports a blocker or a scope drift it could not contain: **stop**, resolve with the user, then re-run the phase or adjust the plan. Never let scope expand silently.
3. Spawn the **phase-reviewer** with the plan path and phase number, over the uncommitted diff. Relay the verdict in full, including the Docs impact section: standing docs the diff made stale, each tagged mechanical (fix immediately, plain text edit) or judgment (append to `CURRENTNESS_AUDIT.md`'s `## Open doc flags` for `/claudhd:audit` to reconcile).
4. **Re-review loop (the second review):**
   - On **FAIL**: set the phase's Status to `review failed`. Before re-spawning the implementer for the fix pass, run `node ${CLAUDE_PLUGIN_ROOT}/scripts/sentinel.js add-files <the reviewer's cited file paths>`, then record the round: `node ${CLAUDE_PLUGIN_ROOT}/scripts/sentinel.js record-round <plan> <phase> FAIL` with the Required fixes piped verbatim on stdin. Send the fixes to the **implementer** as a scoped fix pass, passed VERBATIM as part of its input (native Task prompt or external `role.js run implementer` input alike, per `/claudhd:build`'s own fix-relay contract - never a paraphrase). Then spawn the **phase-reviewer again** with the recorded re-review context: external dispatch adds `--context .gantry/review-round.json`; native dispatch includes `node ${CLAUDE_PLUGIN_ROOT}/scripts/role.js show-round`'s output verbatim in the subagent prompt. The context marks prior required fixes applied as ordered as settled; a re-reviewer may flag one only for a NEW defect the fix itself introduced. The first review of a phase carries no context. Repeat while FAIL persists. **After 5 FAIL rounds on this phase, stop** and present the outstanding findings to the user with the full round history, and three options: (1) keep iterating (user takes responsibility for the added rounds); (2) amend the plan (findings reveal the plan is incomplete; revise it and re-run the phase); (3) overrule the reviewer (user judges a finding a false positive and logs an explicit reason before the commit gate opens). Never auto-pass a real defect because the cap was reached.
   - On **PASS-WITH-NOTES**: check for **Fix-now notes**. If any exist, run `sentinel.js add-files`, record the round (`sentinel.js record-round <plan> <phase> PASS-WITH-NOTES` with the Fix-now notes on stdin), send them to the **implementer** as a scoped fix pass, verbatim, the same as a FAIL's Required fixes, then re-review with the recorded context, as on FAIL. Fix-now passes share the same 5-FAIL-round cap. Only **Deferred notes** (pending external APIs, plan-blessed placeholders, later-phase consumers) may survive to the commit gate without a fix pass.
   - Rule: any time the implementer touches code after a review, that new diff **must** be re-reviewed before the commit gate.
5. **Log deferred notes, then commit gate.** Append every surviving Deferred note to `CURRENTNESS_AUDIT.md`'s `## Deferred review notes` section before presenting for commit; a deferred note that lives only in chat is a dropped note. Then, on PASS or on PASS-WITH-NOTES where all remaining notes are Deferred (now logged), set the phase's Status to `ready to commit`, present the clean diff and verdict, and **stop for the user to say go.** This skill never commits. claudhd 1.0 ships primary-reviewer-only, so the primary reviewer's clean verdict is what opens the gate; there is no second-opinion pass.
6. **The commit itself is ONE Bash invocation, never a separate clear step followed by a separate commit step:**

   ```
   node ${CLAUDE_PLUGIN_ROOT}/scripts/sentinel.js clear && node ${CLAUDE_PLUGIN_ROOT}/scripts/thread.js clear-mode && git add <files> && git commit -m "<message>"
   ```

   This is mechanical, not stylistic: the commit-boundary reconcile runs inside the same `PreToolUse` hook invocation this whole compound command triggers, which fires before any part of it executes - so the reconcile still sees the phase's real, pre-clear sentinel (plan, phase, files) at that instant, which is what lets it flip the plan's phase `**Status:**` line to `committed` and move the roadmap item to Shipped (at the final phase), automatically, riding this same commit. Splitting `sentinel.js clear` into its own earlier Bash call means the reconcile, when the later `git commit` call fires, finds an already-cleared (null) sentinel and silently skips both writes. Never hand-edit the plan's Status line to `committed` yourself after this lands - the reconcile just wrote it.
7. Advance to the next phase. Never start phase N+1 before phase N is reviewed and committed.

## The only places you stop and ask
- An unresolved `[NEEDS USER DECISION]` from the design review.
- A plan blocker.
- A scope drift or blocker the implementer could not contain.
- A phase still failing review after 5 FAIL rounds.
- Every commit.

Everywhere else, advance automatically through the stages above. Do not make the user invoke each command by hand; that is the whole reason this skill exists.

## Hard rules
- Run the stages strictly in order. Never plan an unreviewed design, never build an unplanned phase, never present an unreviewed diff for commit.
- Both reviews are mandatory: the design review before planning, and a phase review (plus a re-review after any fix) before every commit. Skipping a review to save a step defeats the purpose.
- One phase at a time. Never start phase N+1 before phase N is committed.
- Never commit, push, or run destructive git on the user's behalf.
- If invoked with an already-approved, `_reviewed` design and the user confirms it is final, start at Stage 2, but never skip Stage 3's per-phase reviews.

## Doc-lifecycle taxonomy (what feeds what)
The roadmap says what to do next, `/claudhd:start` activates one item into a design thread, `/claudhd:design` says why and under what constraints (audited by design-reviewer), the plan says how in phases (made by phase-planner), the implementer builds it, the phase-reviewer guards the commit, and `/claudhd:audit` keeps the record honest afterward.
