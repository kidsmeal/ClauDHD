# ClauDHD 1.0: the reconciliation

Status: DRAFT, decisions resolved with the user 2026-07-25 (single session). Not yet through the design gate. Open items are marked [OPEN] inline and collected in section 12.

## 1. Intent (the why)

One coherent system instead of ClauDHD plus Gantry. The user should always know where he left off, what is in flight, and what to do next, per project, without maintaining any of that by hand. Documents that describe work must stop being able to drift from the work.

## 2. Diagnosis

The drift is the seam between the two plugins. They share files but not state and not a clock. ClauDHD writes once per session at wrap (which depends on remembering to wrap, the exact failure the system exists to prevent). Gantry works in phases, several per session, and writes nothing ClauDHD reads. Nothing owns the space between them, so NOW.md and ROADMAP.md rot during every work session. Evidence: gantry commit 42cb1bf ("docs: mark review-gate-hardening plan phases done") exists solely to reconcile docs to work that had already shipped.

Hand-maintained documents describing machine-knowable state cannot be kept honest by discipline. They have to be generated.

## 3. Architecture: three layers

| layer | lives in | guarantee |
|---|---|---|
| enforce + reconcile | Claude Code hooks | hard, cannot be bypassed |
| drive + orient | chat (commands, boards, widgets) | board rides the first reply; /claudhd:now on demand |
| glance + dispatch | Object Permanence v2 (Tauri app) | always visible, fs-watcher live, model-free |

Surface constraints, verified 2026-07-25 against docs:
- The model never speaks first. A session renders nothing until the user types.
- SessionStart hook output reaches only the model (invisible context), never the human. It is the orientation channel FOR the agent, which then leads its first reply with the board.
- initialUserMessage applies only to headless (-p) runs.
- The statusline is terminal-only (unconfirmed in the desktop app) and the user has none configured. Nothing is designed around it; init may scaffold one for CLI sessions as a freebie.
- Slash command output in chat is the one guaranteed visible surface. The desktop app additionally renders interactive widgets inline (harness-provided); commands instruct "render as widget when available, else text". Widget buttons sendPrompt commands, making boards clickable.

## 4. File contract

- `.now/state.json` is the single machine-readable truth: mode, active roadmap id, plan ref, phase, cursor facts, git facts. Gantry's sentinel (.gantry/active-phase.json) folds into it as the build-mode fields.
- **NOW.md is generated, never hand-maintained.** Facts (mode, plan, phase, position, from-link, counts) render from state. Intent lines (what this thread is, in the user's words) are human, one line each, prompted at boundaries. It remains a real committed markdown file following the branch; `git log -p NOW.md` becomes an honest history.
- **ROADMAP.md** holds larger, vaguer, long-term intent. Ordered. Every item carries a stable generated id (e.g. r-0725-1), rendered beside the item text so the id is never typed from memory. Vague is legal; the old readiness gate is removed from this edge.
- **IDEAS.md** unchanged: unsorted inbox, no order, no commitment.
- **SHIPPED.md** written automatically at the commit boundary, never reconstructed by hand.
- The active thread declares its parent: `from: <roadmap-id>`. This single link makes both drift directions mechanically checkable: a thread with no parent is unplanned work surfaced immediately; a finished thread whose roadmap item was never closed is a stale commitment.

## 5. The commit boundary

The reconcile moment is the commit, not wrap. Wrap is dead as a mechanism (depends on remembering). Every commit, gantry phase or not, is discrete, verifiable, and already human-gated. At each commit the hooks: update state.json, re-render NOW.md, flip the plan's per-phase Status line, append SHIPPED.md, and advance the roadmap item's state when its thread finishes. The gantry phase boundary (review PASS then sentinel clear then commit) is the richer special case.

## 6. Modes

All implementation is gantry-lane work. Design sessions exist solely to turn the next roadmap item into an implementable design for the pipeline. There is no third kind of work session.

| mode | source edits | doc/design edits | entered by |
|---|---|---|---|
| build (sentinel present) | only the phase's file list | allowed | /claudhd:build, /claudhd:quick |
| design (design marker) | denied, with reason | allowed | /claudhd:start, /claudhd:design |
| idle (neither) | denied | denied for source-shaped paths | pick a mode |

- The guard inversion: file-list-guard.js currently fails open when no sentinel exists (line ~84), which sanctions unscoped implementation. Inverted: absent sentinel is a real state that denies. Broken guard (malformed stdin, unresolvable root, crash) still fails open; the inversion applies to exactly the sentinel-absent branch and a reviewer gates on that distinction.
- /claudhd:quick writes a lightweight sentinel (small file list). The guard has no exceptions.
- Escape hatch: /claudhd:override, a loud per-session override that records itself in the cursor ("unguarded session, N files outside any phase"). Never a silent bypass; never a hard block with no exit.

## 7. Command surface (one plugin, one namespace)

Locked 2026-07-25 (user approved the table as written).

| command | role |
|---|---|
| /claudhd:now | the board (mode-aware: phases in build, decisions in design) |
| /claudhd:idea | capture to inbox |
| /claudhd:harvest | mine past sessions for ideas |
| /claudhd:triage | inbox to roadmap, tap-card driven |
| /claudhd:roadmap | view or add long-term intent |
| /claudhd:start <id> | activate a roadmap item (the readiness gate now lives here) |
| /claudhd:design | draft + audit the design doc (absorbs grill-me) |
| /claudhd:plan | design to phased plan |
| /claudhd:build | implement one phase |
| /claudhd:review | review phase, open the commit gate |
| /claudhd:quick | small change, scoped sentinel |
| /claudhd:override | loud escape hatch |
| /claudhd:audit | currentness reconcile |
| /claudhd:init | scaffold the file set + backends |
| /claudhd:models | backend routing |

Deleted because the machine does the job: wrap (commit boundary reconciles), shipped (written at commit), regroup (the board is always current), statusline (folded into init), gantry's draft/run/gantry (folded into start, design, plan). Gantry's reviewer routing ships with both reviewers on codex/gpt-5.5 when the codex CLI is on PATH, native fallback otherwise (already landed in gantry 645fe4a, 2026-07-25).

## 8. Design mode

- The design board tracks decisions the way the build board tracks phases: resolved list, open list, doc path, exit criterion ("doc passes design review (codex), ready to plan").
- Grilling renders decisions as clickable option cards and live widget mockups where they help.
- The design doc is generated from resolved decisions as the session goes, same cure as NOW.md: the artifact renders from state, so a long design ramble can never end artifactless.

## 9. Triage

One idea per card in chat: text, age, capture context, buttons (roadmap / quick fix / drop / skip). Each tap sends the decision as a prompt; the agent applies it to the files under the normal gates. Thinking stays in session; the chore cost collapses to taps.

[OPEN, revised recommendation 2026-07-25: triage decisions are mechanical line moves (promote, drop, quick-fix, park) needing no model. The plugin owns them as scripts (idea.js-class atomic writes); /claudhd:triage calls them in chat, and the app calls the SAME scripts, so there is one write path and no duplicated logic. Recommendation now: in-app triage taps, yes. Thinking work still dispatches: a card's "discuss" button opens a primed session; design stays in session entirely. Terminal injection into a live session was investigated and rejected (no such channel exists; headless-per-tap crosses the no-tokens-from-buttons line). OP's rule updates from "zero writes to project files" to "writes only through the plugin's own scripts". User to ratify.]

## 10. Object Permanence v2 (the visual half, sequenced second)

Rescoped from "out of scope, knowingly broken" to the ambient layer of 1.0, updated to the new contract as the phase after core lands. Electron rejected: the Tauri app exists, is lighter, and loses nothing.

- View everything, click to dispatch, still zero writes to project files.
- Dispatch = the existing resume launcher with primed commands: a roadmap item's start button opens a terminal session with /claudhd:start <id> already submitted; resume opens with /claudhd:build; a flag's remedy opens with the named command; review opens /claudhd:review.
- A "next up" panel above the fleet: per project, the next actionable thing (design r-X no doc yet, triage N untriaged oldest Nd, build phase N of M) with a dispatch button each.
- The fs watcher makes boards live: the commit-boundary hooks write state.json, the app updates itself, no model involved.
- The cross-project gantry pipeline view (the feature request that started this session) lands here.
- [OPEN] Safe structural edits in-app (drag-reorder roadmap, park an idea): allowed class is reorder and park only, never create or triage. User has not ruled.
- Hard lines: no chat client in the app, no headless agent runs from buttons. Clicking must never spend tokens without a session open in front of the user.
- Consequence accepted: OP v1's kill trial is superseded; v1's file contract breaks when 1.0 lands and is repaired by the v2 update.

## 11. Rollout

1. bakingapp first (the user's active project for the foreseeable future). Before init, run the reconciliation prompt (appendix A) in a fresh session there to true up the docs, then adopt.
2. Other projects follow as touched. gantrybench arms and squareds excluded (bench integrity; project dropped).
3. No ClauDHD 0.9 install detour, no OP trial detour: build 1.0 directly (user decision, 2026-07-25).

## 12. Open items

1. ~~Command table nod~~ RESOLVED 2026-07-25: table locked as written.
2. Triage in-app vs chat widget (section 9). Recommended yes: taps invoke the plugin's own scripts, one write path, git-revertable; the "discuss" button dispatches when thinking is needed.
3. OP v2 structural edits (section 10). Recommended yes with the vocabulary rule: the app may only invoke the plugin's script vocabulary (append-capture, move, mark, reorder, park), and that vocabulary contains no free-text operation. Free-text always dispatches to a session.
4. Migration path for the six other initialized projects: DEFERRED until 1.0 is proven on bakingapp. Bakingapp's reconciliation (appendix A) is the template.

## Appendix A: bakingapp reconciliation prompt

Run on a fresh agent in C:\Users\atk67\Documents\bakingapp:

> Inventory the true state of work in this repo and reconcile the tracking docs to it. Do not write any code and do not start any work.
>
> 1. Find every plan file (plans/, docs/, design/, any *-plan.md or *.plan.md). For each: its phases, which are actually complete based on the CODE and git history rather than what the doc claims, and its last real activity date.
> 2. Classify each plan: LIVE (work will continue), DONE (finished, doc never updated), or DEAD (abandoned, will not resume). Ask me about any you cannot classify with confidence. Do not guess.
> 3. Read NOW.md and ROADMAP.md. List every place they disagree with what you found in step 1: work described as active that is finished, work finished that was never logged to SHIPPED.md, and anything being built that appears on neither doc.
> 4. Check .now/ and .gantry/ for stale state (active-thread.json, active-phase.json) and say whether it matches reality.
> 5. Report all of it as a single table before changing anything, then wait for my go.
>
> After I approve: update the plan files' phase status lines to the truth, rewrite NOW.md to describe exactly one active thread with a concrete next action, move everything long-term to ROADMAP.md as ordered intent, and backfill SHIPPED.md from the git history for work that shipped without being logged. Commit each of those as a separate commit so I can read them individually. Do not push.

## Appendix B: decisions log (2026-07-25 session)

- No 0.9 install first; build 1.0 directly. No OP kill trial; the work is wanted.
- NOW.md generated: yes. Still a real committed file, viewable and recallable via git history.
- Override: loud, recorded in the cursor. Not a hard block.
- Rollout: bakingapp first.
- /claudhd:quick writes a sentinel: yes.
- One plugin, name claudhd, streamlined commands.
- Migration: via reconciliation prompt per project (appendix A).
- Design sessions exist solely to produce an implementable design for the pipeline; design mode denies source edits entirely.
- Roadmap ids: generated.
- All implementation goes through the gantry lane ("stop random multi-session implementation"); the guard inversion enforces it.
- Reviewers: both design-reviewer and phase-reviewer route to codex/gpt-5.5 (rolled out to all 7 initialized projects' models.json and made the scaffold default in gantry 645fe4a).
- Electron: no. OP v2 in Tauri is the app layer.
