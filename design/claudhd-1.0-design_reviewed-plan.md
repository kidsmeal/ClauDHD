# ClauDHD 1.0 (the reconciliation) - Implementation Plan

Source design: `design/claudhd-1.0-design_reviewed.md`
Conventions read: `CLAUDE.md` (repo root, git workflow only: solo repo, commit straight to `main`, no branches, no PRs). No `AGENTS.md`, `CONVENTIONS.md`, `STYLE.md`, `docs/` conventions files exist in this repo. Everything else below was inferred from a read of the actual sources: `plugins/claudhd/scripts/*.js`, `plugins/claudhd/hooks/hooks.json`, `test/*.test.js`, `tools/helpers.js`, and the Gantry plugin at `C:\Users\atk67\Documents\Github\gantry\plugins\gantry\`.
Verification command(s): `npm test` (= `node --test`, Node's built-in runner, zero dependencies; verified green at 97 pass / 0 fail on 2026-07-25 before any change). Release-manifest gate: `node --test test/manifest.test.js`. CI runs `npm test` on ubuntu/macos/windows x node 20/22/24 (`.github/workflows/test.yml`), so every test added below must be path-separator safe and must not depend on autocrlf.

## Summary

Seven phases merge the Gantry plugin (a different repo: `C:\Users\atk67\Documents\Github\gantry\plugins\gantry\`) into this repo's `plugins/claudhd/`, then rebuild the state layer underneath it: `state.json` schemaVersion 2 with Gantry's sentinel folded in, a generated NOW.md, a reconcile that rides the pre-commit interception point, mode-aware deny-by-default guards, a mechanical write vocabulary, and the locked 15-command surface at version 1.0.0. Object Permanence v2 (design section 10) is deferred out of this plan with a note at the end; this plan's job toward it is to freeze the two contracts it consumes.

Phase order is dependency order: import (1) -> state contract (2) -> generated documents (3) -> commit boundary (4) -> guards and modes (5) -> write vocabulary (6) -> command surface and release (7).

## Blockers / Open Questions

All four RESOLVED by the user 2026-07-25, recorded inline below. Nothing blocks any phase.

**B1 resolution:** enforcement stays per-project opt-in. The activation gate is `.now/enabled`, written only by /claudhd:init's explicit opt-in step; the legacy `.gantry/enabled` is also honored so gantry-era projects stay enforced. The mode allowlists apply only inside an adopted project; a repo without either marker is entirely inert, asserted by test.

**B2 resolution:** the batch survives, merged into the quick lane. `/claudhd:quick <text>` appends to the `## Quick fixes` batch (script write, zero tokens, as today); bare `/claudhd:quick` runs the clearing pass and writes a sentinel scoped to the batch's files (the section-7 "small change, scoped sentinel" behavior). The triage card's quick-fix tap writes to the batch via the same script. The section stays in rendered NOW.md; `quickFixCount` stays in state.

**B3 resolution:** intent lines persist as fields in state.json (thread intent, next intent), rendered into NOW.md like every other fact. The renderer never parses NOW.md to recover them; there is no second source of truth.

**B4 resolution:** `/claudhd:version` stays; the surface is 16 commands and the design's section-7 count is amended accordingly. `/gantry:verify`'s RUNTIME_VERIFICATION_QUEUE maintenance folds into `/claudhd:audit`. `skills/gantry/SKILL.md` is rewritten as the claudhd pipeline orchestration (start, design, plan, build, review); `skills/design-plan-creator/SKILL.md` folds into `/claudhd:design`. Anything left redundant after those folds is deleted, the table stays authoritative.

**B1. What activates the guards in a project that has not adopted 1.0?** (blocks phase 5)
Section 6 makes idle mode deny source-shaped paths, and section 11 says nothing may assume the other six projects migrate during this plan. Today both guards gate on a `.gantry/enabled` opt-in marker (`file-list-guard.js` step 4, `commit-guard.js` step 4) and are inert without it. The design never mentions that marker. If the marker is dropped and absent state means idle, installing 1.0 denies every Edit in every repo that has the plugin but no `.now/state.json`. Reading section 11 forward, the marker (or an equivalent explicit opt-in) has to survive as the guard's activation gate, with the mode allowlist applying only inside an adopted project. That reading is not written down anywhere in the design, and it decides whether phase 5 ships a fleet-wide denial. Confirm the activation gate and its filename before phase 5.

**B2. Does the quick-fixes batch survive, and what feeds and clears it?** (blocks phases 3 and 6)
Section 7 reassigns `/claudhd:quick` to "small change, scoped sentinel" (Gantry's lite lane, plus a sentinel). Section 9 still lists "quick fix" as one of the five triage card buttons, so the batch is still a promotion destination. But nothing in the locked table captures into it or clears it any more, and the batch is real machinery today: `quick.js` add/list modes, the `## Quick fixes` section in `templates/NOW.md`, `QUICK_CAP`, `cursor.quickFixCount` in `state.json`, and the `q:<n>` statusline suffix. Three coherent answers exist (fold the batch into IDEAS.md and retire the triage button; keep the batch and give it a different verb; keep the batch and let the triage script write it with no chat command). Pick one. Phase 3 cannot render NOW.md without knowing whether the section exists, and phase 6 cannot implement the triage buttons without knowing where "quick fix" writes.

**B3. Where do NOW.md's human intent lines live?** (blocks phase 3)
Section 4 says NOW.md is generated from state, and that intent lines ("what this thread is, in the user's words") are human, one line each, prompted at boundaries. It does not say where those lines persist between regenerations. Two options: store them as fields in `state.json` (consistent with "state.json is the single machine-readable truth", but it puts human prose in the machine file), or have the renderer parse them back out of the previous NOW.md before overwriting (keeps prose in the document, but makes the document partly its own source and reintroduces a parse the design was trying to kill). This is exactly the kind of decision the design says the generator exists to remove; it needs an answer before the renderer is written.

**B4. Four surfaces are in neither the locked table nor the deleted list.** (blocks phase 7)
Section 7 locks 15 commands and names what is deleted. It does not account for: `/claudhd:version` (ships today, in the README table, covered by tests), `/gantry:verify` (maintains `RUNTIME_VERIFICATION_QUEUE.md`, which `/claudhd:init` still scaffolds and the phase-reviewer pipeline still feeds), `skills/gantry/SKILL.md` (the pipeline orchestrator; section 7's deleted list says "gantry's draft/run/gantry ... folded into start, design, plan", which may or may not mean this skill), and `skills/design-plan-creator/SKILL.md` (never mentioned anywhere in the design). Decide each: ship, fold, or delete. If any command survives, the "15-command surface" line in section 7 needs the user's blessing to become 16 or 17.

**Resolved by reading, recorded so nobody re-opens it:** section 6's mode table says design mode is entered "(design marker)", but the same section's prose resolves that mode lives ONLY in `.now/state.json` with no sibling marker file. The prose wins. Do not create a design-marker file.

**Ambient repo state (not phase artifacts):** the repo root carries its own untracked ClauDHD working files, predating this plan (NOW.md with the opt-in marker since 2026-07-11, IDEAS.md and SHIPPED.md since 2026-06-02, all template-identical). The NOW.md opt-in marker is what activates the plugin's hooks on this repo, so these files are load-bearing and must not be removed by any phase. Reviewers: treat them as pre-existing background, out of every phase's diff.

## Phase 1: Import the Gantry runtime into plugins/claudhd

**Status:** committed (reviewed PASS-WITH-NOTES by codex 2026-07-25 after two FAIL rounds; one deferred note in CURRENTNESS_AUDIT.md)
**Goal:** Every Gantry script, agent, template and test lives in this repo under `plugins/claudhd/`, wired through one hooks file and one project-root resolver, with behavior byte-identical to Gantry today.
**Files:**
- create `plugins/claudhd/scripts/root.js` (single project-root resolver; order `CLAUDHD_PROJECT_DIR` > `GANTRY_PROJECT_DIR` > `CLAUDE_PROJECT_DIR` > `cwd`, so both plugins' existing env contracts keep working)
- create `plugins/claudhd/scripts/sentinel-core.js` (from gantry, `resolveRoot` replaced by `root.js`)
- create `plugins/claudhd/scripts/sentinel.js` (from gantry, same substitution)
- create `plugins/claudhd/scripts/role-core.js` (from gantry, unchanged; it is a pure module)
- create `plugins/claudhd/scripts/role.js` (from gantry, script paths repointed at `plugins/claudhd/scripts/`)
- create `plugins/claudhd/scripts/hooks/file-list-guard.js` (from gantry, unchanged logic including the fail-open branch; the inversion is phase 5)
- create `plugins/claudhd/scripts/hooks/commit-guard.js` (from gantry, unchanged logic; the reconcile is phase 4)
- create `plugins/claudhd/agents/design-reviewer.md`, `implementer.md`, `phase-planner.md`, `phase-reviewer.md` (from gantry; rewrite `/gantry:` command references to `/claudhd:` and `${CLAUDE_PLUGIN_ROOT}/scripts/` paths to the new locations)
- create `plugins/claudhd/templates/CURRENTNESS_AUDIT.md`, `RUNTIME_VERIFICATION_QUEUE.md`, `DESIGN.md`, `PLAN.md` (from gantry)
- modify `plugins/claudhd/hooks/hooks.json` (add the two `PreToolUse` blocks: `Edit|Write|MultiEdit` -> file-list-guard, `Bash` -> commit-guard, alongside the existing SessionStart and Stop entries)
- modify `plugins/claudhd/scripts/brief.js`, `budget.js`, `checkpoint.js`, `idea.js`, `init.js`, `quick.js`, `harvest.js`, `shipped.js`, `statusline.js` (each replaces its inline `const ROOT = process.env.CLAUDHD_PROJECT_DIR || ...` line with `require("./root.js")`; budget.js added to this list at review, same mechanical substitution, required by the unconditional root-resolution exit criterion)
- modify `plugins/claudhd/scripts/init.js` (fold in gantry `init.js`: scaffold `CURRENTNESS_AUDIT.md` / `RUNTIME_VERIFICATION_QUEUE.md` into `docs/` or root, scaffold `.gantry/models.json` via `roleCore.scaffoldConfig(codexAvailable)`, add the three `.gantry/*` gitignore entries next to `.now/`, keep the existing NOW/IDEAS/SHIPPED/ROADMAP scaffold, opt-in marker and repo-signal report, keep the `--enable-hooks` path)
- create `test/root.test.js` (env precedence across all four sources, and that the guards and the state writers resolve the same root from the same env)
- create `test/sentinel.test.js`, `test/sentinel-core.test.js`, `test/role-core.test.js`, `test/role.test.js`, `test/file-list-guard.test.js`, `test/commit-guard.test.js` (ported from `C:\Users\atk67\Documents\Github\gantry\test\`, script paths repointed; they are self-contained and do not use `tools/helpers.js`, so port them as-is rather than rewriting them onto the helper)
- modify `test/init.test.js` (extend the existing claudhd init tests with gantry's init assertions: audit docs scaffolded, models.json scaffolded and never overwritten, gitignore entries appended idempotently)
- modify `test/manifest.test.js` (the hooks assertion now also requires both `PreToolUse` matchers; keep the existing "must not re-declare hooks/hooks.json" invariant)

**Verification:** `npm test`. Expected: the 97 existing tests plus the ported Gantry suites (gantry's own suite is 6 ported files; role-core alone is 724 lines of assertions), all passing on the first run without weakening any imported assertion. Manually confirm the merged hooks file loads by starting one Claude Code session in this repo and checking no "Duplicate hooks file detected" error appears.
**Exit criteria:** `npm test` passes; no script in `plugins/claudhd/scripts/` resolves the project root by any path other than `root.js`; `plugins/claudhd/hooks/hooks.json` declares exactly four hook entries; no file under `plugins/claudhd/` references `/gantry:` any more; the Gantry repo is untouched.
**Blockers:** None.
**Wired-by:** the two guards ARE wired here, through `hooks/hooks.json`. Everything else imported in this phase is deliberately caller-less until its consuming phase lands: the four agents and two pipeline templates are wired by phase 7 (the command surface); `sentinel.js`'s CLI (write/clear/add-files) is wired by phase 5 (the mode guards enforce against it) and phase 7 (`/claudhd:build` and `/claudhd:review` invoke it); `role.js`'s CLI (resolve/run/show) is wired by phase 7 (`/claudhd:models`, `/claudhd:design`, `/claudhd:build`, `/claudhd:review` dispatch through it). Test-only reachability in this phase is intentional and declared.

## Phase 2: state.json schemaVersion 2, with the sentinel folded in

**Status:** committed (reviewed PASS by codex 2026-07-26 on round three; round one caught a live sentinel parser bug, round two caught ambient repo files since declared in the plan header)
**Goal:** `.now/state.json` becomes the single machine-readable truth, carrying mode, active roadmap id, plan ref, phase and file list alongside today's cursor/ideas/shipped/roadmap/git facts, readable by both v1 and v2 consumers and written without clobbering.
**Files:**
- modify `plugins/claudhd/scripts/state.js` (`SCHEMA_VERSION = 2`; add `mode`, `from` (the roadmap-id parent link), `build` (plan ref, phase, files, allow, started, session) and `design` (doc path, resolved/open decision lists) sections; add `readState(nowDir)` that accepts v1 and v2 and returns absent build/design sections as `null`; convert `writeStateAtomic` into a merge-preserving write that reads the existing object, applies only the fields the caller owns, and keeps everything else, all inside `withLock` from `lock.js`)
- modify `plugins/claudhd/scripts/sentinel-core.js` (`readSentinel(root)` now reads the `build` section of `.now/state.json`; on first run it imports a legacy `.gantry/active-phase.json` into that section and then removes the legacy file; `isStale`, `normalize`, `isInList`, `FAIL_OPEN` keep their exact current semantics)
- modify `plugins/claudhd/scripts/sentinel.js` (`write` / `clear` / `add-files` operate on the `build` section through the merge-preserving writer; the "zero files parsed means do not write a sentinel" fail-open rule at lines 196-202 stays exactly as it is)
- modify `plugins/claudhd/scripts/checkpoint.js` (the Stop hook's `buildState` + write path must merge, never replace, so a Stop between two phase edits cannot erase the build section)
- modify `plugins/claudhd/scripts/hooks/file-list-guard.js`, `plugins/claudhd/scripts/hooks/commit-guard.js` (deny reasons stop telling the user to delete `.gantry/active-phase.json` and name the real clear path instead; no behavior change)
- modify `plugins/claudhd/scripts/role-core.js` (`buildGuardSettings` comment and the headless-implementer settings path text reference the new sentinel location)
- create `test/state-v2.test.js` (v1 file reads without error and yields null build/design; first v2 write preserves every pre-existing cursor fact; a v2 file round-trips; unknown keys survive a write)
- create `test/state-concurrency.test.js` (a `sentinel.js write` racing a `checkpoint.js` Stop leaves both the build section and the cursor facts intact; reuse the pattern in the existing `test/lock.test.js` and `tools/hold-lock.js`)
- modify `test/state.test.js`, `test/checkpoint.test.js`, `test/sentinel.test.js`, `test/sentinel-core.test.js`, `test/file-list-guard.test.js`, `test/commit-guard.test.js` (retarget to the new sentinel location; the legacy-import case gets its own named test)

**Verification:** `npm test`. Three assertions carry the phase: a v1 `state.json` read produces no throw and null build/design; a write of the build section leaves `cursor`, `ideas`, `shipped`, `roadmap` and `git` byte-identical; a legacy `.gantry/active-phase.json` present at first read is imported and then gone.
**Exit criteria:** `npm test` passes; no script writes `state.json` outside the merge-preserving locked writer; no code path anywhere reads `.gantry/active-phase.json` except the one-shot legacy import.
**Blockers:** None.
**Wires:** `checkpoint.js`, `sentinel.js` and both guards all read and write the v2 fields in this phase. `readState()` is the one deliberate exception: it is the read contract phase 3's NOW renderer and statusline retarget consume, declared here so its test-only reachability in this phase is intentional.

## Phase 3: Generated NOW.md and generated roadmap ids

**Status:** committed (PASS-WITH-NOTES by codex/sol on round eight, fix-nows applied, zero deferred notes; eight rounds total: two plan-ambiguity oscillations since resolved in plan text, six rounds of real findings, and the phase that triggered the severity-scale review policy)
**Goal:** NOW.md renders from state (facts machine-generated, intent lines human), and every ROADMAP.md item carries a stable, collision-safe generated id rendered beside its text.
**Files:**
- create `plugins/claudhd/scripts/nowrender.js` (pure function: state object in, NOW.md text out; mode-aware, renders mode, plan, phase, position, the `from: <roadmap-id>` link and the counts; keeps the `<!-- claudhd` opt-in marker in the output)
- create `plugins/claudhd/scripts/roadmapids.js` (id generation `r-MMDD-N`: scan existing ids for today's date prefix, take the next unused counter, never reuse; backfill ids onto existing id-less lines without touching their wording; render the id beside the item text)
- modify `plugins/claudhd/scripts/nowfile.js` (parse the generated shape; keep the existing extractors working against a hand-written NOW.md so a pre-1.0 project still reports facts)
- modify `plugins/claudhd/scripts/state.js` (persist `from`, which IS the active-roadmap-id field - one field, resolved at review 2026-07-26, not two names for the same fact; persist intent lines per B3: state fields)
- state schema addition (declared at review 2026-07-26): `roadmapIds`, a durable flat array of every issued r-MMDD-N id, owned by whichever script issues ids, written through the merge-preserving writer, never a Stop-hook owned key. It is what makes "never reuse an id" hold across process runs and deletions.
- modify `plugins/claudhd/templates/NOW.md` (becomes the generated shape, not a hand-editing prompt)
- modify `plugins/claudhd/templates/ROADMAP.md` (items carry ids)
- modify `plugins/claudhd/scripts/init.js` (scaffold a fresh NOW.md via `nowrender.render({})` rather than template copy - AMENDED at review 2026-07-26 to close a genuine plan ambiguity that caused three contradictory review rounds: the renderer-only exit criterion governs, and this bullet now states the wiring explicitly; assign roadmap ids at init through `roadmapids.js` with the current date, never hardcoded template samples; backfill existing id-less items per section 4)
- create `test/nowrender.test.js` (facts render from state; a thread with no parent renders as unplanned work; intent lines survive a regeneration; the opt-in marker survives)
- create `test/roadmapids.test.js` (next-unused counter, no reuse after a delete, same-day collision, backfill preserves wording byte-for-byte, non-date-prefixed legacy ids ignored safely)
- modify `test/init.test.js`, `test/state.test.js`

**Verification:** `npm test`. The load-bearing tests: regenerate NOW.md twice from the same state and get identical output; regenerate after an intent-line edit and the intent line survives; backfill ids into a ROADMAP.md with mixed id-carrying and id-less lines and assert every original line's wording is unchanged.
**Exit criteria:** `npm test` passes; NOW.md's fact lines are produced by `nowrender.js` alone (no other module writes them); id generation never returns an id already present in the file.
**Blockers:** B2 (does the `## Quick fixes` section exist in the rendered NOW.md), B3 (where intent lines persist). Both must be answered before this phase starts.
**Wired-by:** phase 4 (the reconcile calls the renderer at the commit boundary) and phase 7 (`/claudhd:now`, `/claudhd:roadmap`, `/claudhd:start` call it on demand). nowfile.js's `modeLine`/`fromLine` extractors are consumed by phase 4's reconcile (drift check against the rendered shape) and phase 7's board; test-only reachability in this phase is declared intentional.

## Phase 4: The commit boundary reconcile

**Status:** committed (five sol rounds, all findings real, valve tripped on round five: finding 1 deferred to phase 5 by user ruling, findings 2-3 fixed; end-to-end smoke passed: one hook-driven commit carrying code, NOW.md, ROADMAP.md, SHIPPED.md and the plan status flip)
**Goal:** Every `git commit` made inside a session regenerates state.json, NOW.md, the plan's per-phase Status line, the SHIPPED.md entry and the roadmap item's state, stages them, and rides the same commit.
**Files:**
- create `plugins/claudhd/scripts/reconcile.js` (takes the commit message and the project root; regenerates state, renders NOW.md, updates the active plan's `**Status:**` line for the active phase, appends the SHIPPED.md entry with message and date and no hash, updates the roadmap item's state, then stages exactly the files it wrote)
- modify `plugins/claudhd/scripts/hooks/commit-guard.js` (run the reconcile at the existing interception point BEFORE the gate decision and before the early returns at today's steps 4-6, so a commit outside a build phase is reconciled too; keep every fail-open path, keep "always exit 0", keep the deny-via-stdout-JSON contract; a reconcile failure must never block or fail the commit)
- modify `plugins/claudhd/scripts/shipped.js` (the entry writer becomes the shared path the reconcile calls; keep the message+date format SHIPPED.md has always used)
- create `test/reconcile.test.js` (a throwaway repo, a plan file with phases, a commit driven through the guard's stdin contract: assert NOW.md, SHIPPED.md, ROADMAP.md and the plan Status line all updated and staged; assert `.now/state.json` is regenerated but NOT staged, because `.now/` is gitignored; assert a commit with no active plan still writes the SHIPPED entry; assert a reconcile throw leaves the commit permitted)
- modify `test/commit-guard.test.js` (the existing deny/allow matrix must still hold with the reconcile in front of it, including every fail-open case)
- modify `test/shipped.test.js`

**Verification:** `npm test`, plus one manual run: in a throwaway repo, commit through a real session and confirm `git show --stat HEAD` lists NOW.md and SHIPPED.md in the same commit as the code.
**Exit criteria:** `npm test` passes; the guard still exits 0 on every path; a commit made outside a session (the design's stated known limit) leaves the docs untouched and is asserted as such by a named test, so the limit is visible rather than assumed.
**Blockers:** None once phase 3 lands.
**Wires:** `reconcile.js` is wired here, at `commit-guard.js`'s interception point; it has no other caller.

## Phase 5: Modes, the guard inversion, and the override

**Status:** committed (PASS on round four; findings trajectory 9 -> 3 -> 1 -> 0 under the severity scale plus the first context-carrying re-reviews, zero relitigation across all rounds)
**Goal:** The guards read mode from state.json and enforce a deny-by-default per-mode path allowlist; sentinel-absent denies while crash paths still fail open; `/claudhd:override` exists as a loud, recorded escape hatch.
**Files:**
- create `plugins/claudhd/scripts/modes.js` (pure: mode + path in, allow/deny out. design and idle allow `*.md` plus `.now/`, `.gantry/`, `.claude/`; build allows the build section's file list plus those same state dirs; everything else denies)
- modify `plugins/claudhd/scripts/hooks/file-list-guard.js` (invert exactly the sentinel-absent branch at today's step 5: absent build section is a real state that resolves to the current mode and denies per the allowlist. Every OTHER fail-open path stays: malformed stdin, missing `tool_input`, missing `file_path`, unresolvable root, stale sentinel, and the top-level catch. The reviewer gates on that distinction, so each surviving fail-open path needs its own named test)
- modify `plugins/claudhd/scripts/hooks/commit-guard.js` (mode-aware gate messages)
- create `plugins/claudhd/scripts/override.js` (records "unguarded session, N files outside any phase" as state.json's top-level `override` field - AMENDED at review 2026-07-26: a dedicated owned key per the phase-2 ownership pattern, not folded into cursor facts; rendered into NOW.md only through nowrender, never by direct write; per-session, never silent. The override covers BOTH unguarded-mode edits and out-of-list edits under a live sentinel: "outside any phase" includes outside the phase's file list)
- create `test/modes.test.js` (the full matrix: three modes x source path / markdown path / state-dir path / build-list path)
- create `test/override.test.js` (the override records itself and the count is visible in state and in the rendered NOW.md)
- modify `test/file-list-guard.test.js` (the inversion case, plus one named test per surviving fail-open path)
- modify `test/reconcile.test.js`, `test/commit-guard.test.js`, `plugins/claudhd/scripts/init.js`, `test/init.test.js` (AMENDED at review 2026-07-26: the phase-4 deferral lands here - init's opt-in writes `.now/enabled`, computeGate honors either marker - and the B1 activation widening has structurally necessary fallout in these tests)

**Verification:** `npm test`. The phase is proven by two things: a table-driven mode matrix that passes, and a named test for each of the six crash/fail-open branches showing they still exit 0 with no output.
**Exit criteria:** `npm test` passes; the only branch that changed from allow to deny is sentinel-absent-with-a-known-mode, where malformed or unreadable state.json content in an ADOPTED project is DEFINED as mode null = idle (readState's null-normalization is the contract, not a crash; the fail-open guarantee covers guard crashes and unparseable hook input, never semantic state content); the guard still always exits 0; a project without the activation gate from B1 is still entirely unaffected, asserted by a test.
**Blockers:** B1 (the activation gate). Do not start this phase before it is answered; it decides whether the six unmigrated projects get denied.
**Wired-by:** `modes.js` and `override.js` are both wired here: the guards call `modes.decide()` for the allowlist and `override.js`'s `noteOverrideFile` for override-permitted edits (AMENDED at review 2026-07-26: the count-freshness and atomicity findings made the guards direct callers, superseding the original only-caller note). Phase 7 additionally wires `/claudhd:override` to `recordOverride`.

## Phase 6: The mechanical write vocabulary

**Status:** committed (PASS-WITH-NOTES on round three, fix-now applied, zero deferred; findings 3 -> 3 -> 1, all real, zero relitigation under the full calibration stack)
**Goal:** Triage and roadmap decisions are scripts, not model work: one write path that chat and (later) Object Permanence both call, containing no free-text operation.
**Files:**
- create `plugins/claudhd/scripts/vocab.js` (the five verbs from section 10: `append-capture`, `move`, `mark`, `reorder`, `park`. Promotion is verbatim: the script moves the line, stamps a generated id via `roadmapids.js`, and carries the capture date and while-context along. Atomic + locked, in the shape `idea.js` already uses)
- modify `plugins/claudhd/scripts/idea.js` (capture routes through `vocab.js` so there is one write path)
- create `docs/STATE-SCHEMA.md` (the frozen v2 `state.json` contract: every field, its type, and its null semantics)
- create `docs/SCRIPT-VOCABULARY.md` (the frozen verb list plus each verb's argv contract, and the explicit statement that free text always dispatches to a session)
- create `test/vocab.test.js` (verbatim promotion asserted byte-for-byte on the item text; id stamped; capture date and while-context carried; reorder is stable; park is reversible; two concurrent verbs do not clobber; no verb accepts free text)
- modify `test/idea.test.js`

**Verification:** `npm test`. The load-bearing assertion is verbatim promotion: take an idea line with awkward wording, promote it, and assert the roadmap line contains that exact substring unchanged.
**Exit criteria:** `npm test` passes; every file mutation triage can perform goes through `vocab.js`; the two docs describe what the code actually does (an implementer reading only those two files could write a consumer).
**Blockers:** B2 (where the triage card's "quick fix" button writes).
**Wired-by:** phase 7 for the chat side (`/claudhd:triage`, `/claudhd:idea`, `/claudhd:roadmap`), and deferred for the app side (Object Permanence v2, see the note at the end; `docs/SCRIPT-VOCABULARY.md` is the handoff artifact).

## Phase 7: The 15-command surface, docs, and the 1.0.0 release

**Status:** pending
**Goal:** One plugin, one namespace, the locked command table, and a release the manifests agree on.
**Files:**
- create `plugins/claudhd/commands/start.md`, `design.md`, `plan.md`, `build.md`, `review.md`, `override.md`, `audit.md`, `models.md` (start absorbs the readiness gate; design absorbs grill-me and drives the design board; build/review/plan/models/audit adapted from gantry's equivalents with `/claudhd:` names and the new script paths)
- modify `plugins/claudhd/commands/now.md` (mode-aware board: phases in build, decisions in design; "render as widget when available, else text", with text as the acceptance baseline)
- modify `plugins/claudhd/commands/quick.md` (Gantry's lite lane, and it writes a sentinel)
- modify `plugins/claudhd/commands/idea.md`, `harvest.md`, `triage.md` (triage becomes tap-card driven over `vocab.js`), `roadmap.md`, `init.md`
- delete `plugins/claudhd/commands/wrap.md`, `shipped.md`, `regroup.md`, `statusline.md`
- delete `plugins/claudhd/scripts/statusline.js` and `test/statusline.test.js` (statusline folds into init per section 7; if init still scaffolds a CLI statusline as the section-3 freebie, keep the script and move its tests instead. Decide from B4's outcome, not here)
- modify `plugins/claudhd/.claude-plugin/plugin.json` (version 1.0.0, new description covering the merged pipeline)
- modify `.claude-plugin/marketplace.json` (version 1.0.0 in lockstep, new description)
- modify `README.md` (rewrite around the 15-command table and the three layers)
- create `test/consistency.test.js` (ported from gantry: every command in the README table exists in `commands/` and vice versa; versions agree across `plugin.json`, `marketplace.json` and any surviving skill frontmatter; the phase-reviewer/phase-planner content invariants gantry's suite already enforces)
- modify `test/manifest.test.js` (unchanged invariants, new hook shape already handled in phase 1)
- skills: ship, fold or delete `plugins/claudhd/skills/gantry/SKILL.md` and `plugins/claudhd/skills/design-plan-creator/SKILL.md` per B4
- AMENDED at review 2026-07-26 (structurally necessary command wiring): create `plugins/claudhd/scripts/thread.js` (the mode/from/intent/design writers the reserved state fields require) and `plugins/claudhd/skills/pipeline/SKILL.md` (B4's orchestrator rewrite under a claudhd-named path); modify `plugins/claudhd/scripts/sentinel.js`, `role.js`, `role-core.js` (record-round/--context/write-files ported so build.md/review.md carry the recorded-round re-review flow), `agents/phase-reviewer.md` (prior-rounds input note), `brief.js` (mode-drift flag wiring nowfile's extractors), `nowrender.js`, `templates/NOW.md`, `templates/SHIPPED.md`, `shipped.js`, `init.js`, `constants.js` (dangling-reference cleanup), the root `CURRENTNESS_AUDIT.md` and `RUNTIME_VERIFICATION_QUEUE.md` (live /gantry: reference fixes, in scope for the no-references exit criterion), and delete `plugins/claudhd/scripts/budget.js` + `test/budget.test.js` (orphaned by wrap.md's deletion); create `test/thread.test.js`, `test/brief-mode-drift.test.js`; the adversary flow from gantry's review.md is NOT ported (out of 1.0 scope, removed at review).

**Verification:** `npm test` and `node --test test/manifest.test.js`. Then a real install check: install the plugin from this repo into a throwaway project, run `/claudhd:init`, and confirm all shipped commands appear in the command list and none of the deleted ones do.
**Exit criteria:** `npm test` passes; `plugins/claudhd/commands/` contains exactly the agreed command set and the README table matches it (enforced by the ported consistency test); `plugin.json` and `marketplace.json` both read 1.0.0; nothing in the repo references `/gantry:` outside the design and plan documents.
**Blockers:** B4 (version, verify, and the two skills).
**Wires:** this phase wires everything phases 1, 3, 5 and 6 left without a caller: the four agents, `nowrender.js`, `roadmapids.js`, `override.js` and `vocab.js` all get their live callers here. A capability still unreachable at the end of this phase is a defect, not a follow-up.

## Cross-cutting concerns

**1. `state.json` format migration, v1 to v2.** Changes in phase 2. Affects `checkpoint.js` (the Stop hook writer), both guards, `sentinel.js`, the phase-3 renderer, and every external consumer of `.now/state.json`, which today means Object Permanence v1. Readers must accept v1 and v2; absent build/design sections read as null; the first v2 write preserves the existing cursor facts. Rollback: the schema is additive, so reverting the code leaves a v2 file readable by v1 logic except for the version integer itself. OP v1's breakage is accepted by design section 10 and is repaired by the deferred v2 work, not by this plan.

**2. The sentinel moves out of `.gantry/active-phase.json` into `state.json`'s build section.** Phase 2. Affects both guards, `sentinel.js`, `role-core.js`'s injected headless-implementer settings, every deny message that currently tells the user to delete the old file, the ported gantry tests, and the `.gitignore` entries. Migration: on first read, import a legacy sentinel into the build section then delete the legacy file, once, in `sentinel-core.js`. Rollback: the legacy path is import-only, so a revert re-reads nothing; a project mid-phase at revert time loses its sentinel and the guard fails open, which is the safe direction.

**3. Two divergent project-root resolvers become one.** Phase 1. ClauDHD resolves `CLAUDHD_PROJECT_DIR` > `CLAUDE_PROJECT_DIR` > cwd; Gantry resolves `GANTRY_PROJECT_DIR` > `CLAUDE_PROJECT_DIR` > cwd. Once state.json is shared, a guard resolving a different root than the writer reads a different repo's state and enforces the wrong thing. `root.js` accepts all three vars in the order given in phase 1, so neither plugin's existing env contract breaks. This must land in phase 1, before anything shares state.

**4. One hooks file now declares four hooks.** Phase 1. `hooks/hooks.json` gains two `PreToolUse` blocks alongside SessionStart and Stop. Claude Code auto-loads this file; `plugin.json` must never reference it (already enforced by `test/manifest.test.js`, the fresh-install blocker that bit this repo before). Any PreToolUse regression here silently disables enforcement across every adopted project, so the manifest test's hook assertion must be extended in the same phase.

**5. Concurrent writers to `state.json`.** Established in phase 2, respected by 4, 5 and 6. Four writers exist: the Stop hook, the pre-commit reconcile, `sentinel.js`, and the vocabulary scripts. All of them must go through one merge-preserving writer wrapped in `withLock` (`scripts/lock.js`) with the existing atomic temp-file-plus-rename, including its Windows EPERM retry. Any later phase that adds a fifth writer must use the same path; a direct `fs.writeFileSync` on state.json is a defect.

**6. `.now/` is gitignored, so the reconcile cannot stage `state.json`.** Phase 4. `init.js` adds `.now/` to `.gitignore` today and `state.json` lives there. The reconcile stages NOW.md, SHIPPED.md, ROADMAP.md and the plan file; `git add` on `.now/state.json` would fail without `-f` and must not be attempted. Assert this explicitly in `test/reconcile.test.js` so nobody "fixes" it later by force-adding local state into commits.

**7. Public command-surface deletion and namespace change.** Phase 7. `/claudhd:wrap`, `/claudhd:shipped`, `/claudhd:regroup`, `/claudhd:statusline` and every `/gantry:*` command disappear. Anything referencing them breaks: this repo's README and `routines/*.md`, the ported agents and skills, and any project doc in an adopted repo. Ordering: last, after the mechanics exist, so no command points at a script that is not there yet. Rollback: command files are markdown; restoring one is a file restore. The fate of the Gantry plugin's own repo and marketplace listing is outside this plan and needs the user's call.

**8. Release manifests move in lockstep.** Phase 7. `plugin.json` and the `marketplace.json` entry must both read 1.0.0 or `test/manifest.test.js` fails, which is the release gate `tools/release.js` also runs. The ported `test/consistency.test.js` adds a second lockstep: any surviving skill frontmatter version must match too.

**9. `.gantry/models.json` keeps its path.** Section 7 says so explicitly for 1.0. Phase 1 keeps init scaffolding it there and keeps the three `.gantry/*` gitignore entries. Do not "tidy" it into `.now/`; that is a separate decision the design deliberately did not make.

**10. Rollout is opt-in and stays opt-in.** Section 11: bakingapp is the first adopter and the other six projects do not migrate during this plan. Two consequences the implementer must hold: B1's activation gate has to keep unadopted projects inert, and no phase may write into a project that has not run `/claudhd:init` for 1.0. Adoption itself is a runtime step, not code: after phase 7, the user runs appendix A's reconciliation prompt in `C:\Users\atk67\Documents\bakingapp` and then inits. That is not a phase in this plan.

**11. CI matrix.** `.github/workflows/test.yml` runs the suite on three OSes and three Node versions. The guards do Windows-vs-POSIX path normalization (`sentinel-core.normalize` picks path semantics from the input shape, deliberately, so Windows-shaped paths relativize the same way on Linux CI). Every new path test must preserve that property, and no new test may depend on line endings, since Windows CI disables autocrlf.

**No generated code, no database, no build step.** The plugin has zero dependencies and ships as source; nothing needs regeneration after a change.

## Review policy (set by the user 2026-07-26, after phase 3 ran eight rounds)

The phase-reviewer prompt now carries a severity scale (S1 category-fail -> FAIL; S2 real-but-edge defect -> fix-now note on PASS-WITH-NOTES, three distinct S2s escalate to FAIL; S3 polish -> deferred note; S4 observation). Ambiguous severity resolves DOWN with a one-clause justification. Review rounds are not capped while S1 findings exist, but after 5 FAIL rounds on one phase the loop stops and the remaining findings go to the user with the round history: fix, defer, or overrule is his call. The re-review context mechanism (prior rounds injected so applied fixes are settled) is being built in the gantry repo and ports here when it lands, as does the severity scale (currently live in this repo's agents/phase-reviewer.md and the installed plugin cache; the gantry-repo mirror waits for the in-flight review-context task to finish to avoid racing that tree).

## Deferred: Object Permanence v2

Design section 10 is sequenced after core and lives in a different repo (`C:\Users\atk67\Documents\object-permanence`, a Tauri + Vite/TS app with its own test setup). It is deferred out of this plan rather than tacked on as a final phase, for three reasons: it is a different codebase with different conventions, its scope (next-up panel, fs-watcher live boards, dispatch launcher, in-app triage taps, drag-reorder and park) is large enough to want its own design-to-plan cycle, and it consumes contracts this plan has to freeze first.

What this plan owes it, and where: `docs/STATE-SCHEMA.md` and `docs/SCRIPT-VOCABULARY.md`, both exit criteria of phase 6. Those two files are the entire interface. The app's rule from section 10 is "writes only through the plugin's own scripts", so if the vocabulary doc is honest, the OP v2 plan can be written against it without reading this repo's source.

Known consequence, already accepted in section 10: OP v1's file contract breaks the moment phase 2 lands, and stays broken until the v2 work happens.
