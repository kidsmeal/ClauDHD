# ClauDHD 1.0: the reconciliation

Status: reviewed (codex design review 2026-07-25, 9 violations: 4 fixed by the reviewer, 5 resolved by the user same day; all markers cleared)

## 1. Intent (the why)

One coherent system instead of ClauDHD plus Gantry. The user should always know where he left off, what is in flight, and what to do next, per project and across the fleet at a glance, without maintaining any of that by hand. Documents that describe work must stop being able to drift from the work.

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

- `.now/state.json` is the single machine-readable truth: `schemaVersion: 2`, mode, active roadmap id, plan ref, phase, cursor facts, git facts. Gantry's sentinel (`.gantry/active-phase.json`) folds into it as the build-mode fields. Migration is backward-compatible: readers accept schema v1 and v2, absent build/design fields read as null, and the first v2 write preserves the existing cursor facts while adding the new fields.
- **NOW.md is generated, never hand-maintained.** Facts (mode, plan, phase, position, from-link, counts) render from state. Intent lines (what this thread is, in the user's words) are human, one line each, prompted at boundaries. It remains a real committed markdown file following the branch; `git log -p NOW.md` becomes an honest history.
- **ROADMAP.md** holds larger, vaguer, long-term intent. Ordered. Every item carries a stable generated id (e.g. `r-0725-1`), rendered beside the item text so the id is never typed from memory. ID generation scans existing IDs for the current date prefix, uses the next unused counter, and never reuses an ID. Existing roadmap lines without IDs receive IDs during init/reconcile without rewriting their wording. Vague is legal; the old readiness gate is removed from this edge.
- **IDEAS.md** unchanged: unsorted inbox, no order, no commitment.
- **SHIPPED.md** written automatically at the commit boundary, never reconstructed by hand.
- The active thread declares its parent: `from: <roadmap-id>`. This single link makes both drift directions mechanically checkable: a thread with no parent is unplanned work surfaced immediately; a finished thread whose roadmap item was never closed is a stale commitment.

## 5. The commit boundary

The reconcile moment is the commit, not wrap. Wrap is dead as a mechanism (depends on remembering). Every commit, gantry phase or not, is discrete, verifiable, and already human-gated. The gantry phase boundary (review PASS then sentinel clear then commit) is the richer special case.

Mechanics (RESOLVED 2026-07-25, pre-commit model): the existing PreToolUse guard on `git commit` (commit-guard.js's interception point) runs the reconcile before the commit executes. At that moment the commit message is available in the command string, so the hook regenerates state.json, NOW.md, the plan's per-phase Status line, the SHIPPED.md entry, and the roadmap item's state, then stages them, and everything rides the same commit. SHIPPED.md entries carry message and date, never a hash (matching how SHIPPED.md has always been written). Known limit, stated: commits made outside a Claude Code session bypass the hook and are reconciled lazily at the next boundary or by /claudhd:audit. No amends, no automatic follow-up commits.

## 6. Modes

Mode storage and path classes (RESOLVED 2026-07-25): mode lives ONLY in `.now/state.json`, no sibling marker file (section 4 makes state.json the single truth; a second marker would violate the contract this design exists to create). The guards read state.json. Path classes are a deny-by-default allowlist per mode: design and idle modes may write `*.md` files plus the plugin's own state dirs (`.now/`, `.gantry/`, `.claude/`); build mode may write the sentinel's file list plus the same state dirs; everything not matching the mode's allowlist is source-shaped by definition and denies. One rule, no extension taxonomy to maintain.

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
| /claudhd:models | view/edit `.gantry/models.json` role-to-backend routing (gantry's models command absorbed; the file stays at its current path in 1.0). Success condition: the resolved routing table (resolveRole output per role) renders without error |

Deleted because the machine does the job: wrap (commit boundary reconciles), shipped (written at commit), regroup (the board is always current), statusline (folded into init), gantry's draft/run/gantry (folded into start, design, plan). Gantry's reviewer routing ships with both reviewers on codex/gpt-5.5 when the codex CLI is on PATH, native fallback otherwise (already landed in gantry 645fe4a, 2026-07-25).

## 8. Design mode

- The design board tracks decisions the way the build board tracks phases: resolved list, open list, doc path, exit criterion ("doc passes design review (codex), ready to plan").
- Widget mockups and option cards are OPTIONAL, never blocking (RESOLVED 2026-07-25): text is the acceptance baseline for every board and every design artifact; widgets are progressive enhancement when the harness provides the renderer. A design session that produces zero widgets is fully valid. This is also the answer to the harness-dependency coherence flag: nothing in 1.0 depends on the widget contract existing.
- The design doc is generated from resolved decisions as the session goes, same cure as NOW.md: the artifact renders from state, so a long design ramble can never end artifactless.

## 9. Triage

One idea per card in chat: text, age, capture context, buttons (roadmap / quick fix / drop / skip / discuss). In chat, each tap sends the decision as a prompt and the agent applies it to the files under the normal gates. In the app, mechanical taps call the plugin scripts directly as defined below, with no headless agent run. Thinking stays in session; the chore cost collapses to taps.

Promotion is VERBATIM: no model rewrites the words on a tap. The script moves the line, stamps a generated id, and carries the capture date and while-context along. Vague wording is legal on the roadmap (the gate moved to /claudhd:start) and gets trued up at activation, when the design session restates the item and the reconcile writes the cleaned wording back to the roadmap line. Lost-context fragments (no verb, trivially short) are the case verbatim promotion cannot save; both surfaces flip button emphasis toward "discuss" on such cards (a presentation nudge, never a block), which dispatches to a session for rewording before promotion.

RATIFIED 2026-07-25: triage decisions are mechanical line moves (promote, drop, quick-fix, park) needing no model. The plugin owns them as scripts (idea.js-class atomic writes); /claudhd:triage calls them in chat, and the app calls the SAME scripts, so there is one write path and no duplicated logic. In-app triage taps: yes. Thinking work still dispatches: a card's "discuss" button opens a primed session; design stays in session entirely. Terminal injection into a live session was investigated and rejected (no such channel exists; headless-per-tap crosses the no-tokens-from-buttons line). OP's rule updates from "zero writes to project files" to "writes only through the plugin's own scripts".

## 10. Object Permanence v2 (the visual half, sequenced second)

Rescoped from "out of scope, knowingly broken" to the ambient layer of 1.0, updated to the new contract as the phase after core lands. Electron rejected: the Tauri app exists, is lighter, and loses nothing.

- View everything and click to dispatch with zero direct app writes to project files. The only in-app writes allowed are the ratified triage and structural edits below, and those writes go through the plugin's own scripts.
- Dispatch = the existing resume launcher with primed commands: a roadmap item's start button opens a terminal session with /claudhd:start <id> already submitted; resume opens with /claudhd:build; a flag's remedy opens with the named command; review opens /claudhd:review.
- A "next up" panel above the fleet: per project, the next actionable thing (design r-X no doc yet, triage N untriaged oldest Nd, build phase N of M) with a dispatch button each.
- The fs watcher makes boards live: the commit-boundary hooks write state.json, the app updates itself, no model involved.
- The cross-project pipeline view stays in 1.0's OP v2 phase (RESOLVED 2026-07-25): the intent line in section 1 is expanded to cover it rather than the view being trimmed to fit the sentence. OP is inherently cross-project (the fleet is its founding shape) and the fleet-wide glance was the founding request of this design.
- RATIFIED 2026-07-25: structural edits in-app (drag-reorder roadmap, park), plus triage taps, under the vocabulary rule: the app may only invoke the plugin's script vocabulary (append-capture, move, mark, reorder, park), and that vocabulary contains no free-text operation. Free-text always dispatches to a session.
- Hard lines: no chat client in the app, no headless agent runs from buttons. Clicking must never spend tokens without a session open in front of the user.
- Consequence accepted: OP v1's kill trial is superseded; v1's file contract breaks when 1.0 lands and is repaired by the v2 update.

## 11. Rollout

1. bakingapp first (the user's active project for the foreseeable future). Before init, run the reconciliation prompt (appendix A) in a fresh session there to true up the docs, then adopt.
2. Other projects follow as touched. gantrybench arms and squareds excluded (bench integrity; project dropped).
3. No ClauDHD 0.9 install detour, no OP trial detour: build 1.0 directly (user decision, 2026-07-25).

## 12. Open items

1. RESOLVED 2026-07-25: command table locked as written.
2. RESOLVED 2026-07-25: in-app triage approved (section 9).
3. RESOLVED 2026-07-25: structural edits approved under the vocabulary rule (section 10).
4. DEFERRED (his call): migration of the six other projects waits until 1.0 is proven on bakingapp. Bakingapp's reconciliation (appendix A) is the template.

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
