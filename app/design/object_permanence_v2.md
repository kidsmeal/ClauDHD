# Object Permanence v2 - Design

Status: draft
Intent: bring Object Permanence onto ClauDHD 1.0's two frozen contracts (read schema v2 state, write only through the plugin's script vocabulary) and add the two surfaces `design/claudhd-1.0-design_reviewed.md` section 10 promised, a next-up dispatch panel and a cross-project pipeline view.

Parent roadmap item: `r-0727-4`.
Supersedes: `design/object_permanence_v1_reviewed.md` on every point below. v1 stays as the founding contract for everything this doc does not touch (discovery, watcher, persistence, render discipline, packaging, the vocabulary rule of section 2).

## Problem

ClauDHD 1.0 broke v1's file contract, which section 10 of the 1.0 design says outright and accepts. Four consequences, in severity order.

**1. The app goes blind rather than degrading honestly.** `src/core/parse/state.ts:46` returns `null` for any file where `schemaVersion !== 1`. Every 1.0 project writes v2, so every card falls through to the lenient NOW.md parse permanently. NOW.md under 1.0 is generated from state.json by `nowrender.js`, so that fallback parses a projection of the exact file it just refused to read. The v1 design made the lenient parser first-class because state.json was one day old at the time (v1 section 13). That premise is gone.

**2. Two write paths for one line format.** `src-tauri/src/lib.rs`'s `idea_append` does its own temp-plus-rename into IDEAS.md, and `src/core/capture.ts` re-derives `idea.js`'s line shape with a comment explaining it must match or ClauDHD's ideas math breaks. The 1.0 design section 9 ratified one write path: "the app calls the SAME scripts, so there is one write path and no duplicated logic". Two implementations of one format is the drift `docs/SCRIPT-VOCABULARY.md` exists to end.

**3. The app cannot see what a project is doing.** `mode`, `from`, `intent`, `design`, `build`, and `override` are all new in schema v2 and the app models none of them. Its plan and phase knowledge still comes from `.gantry/active-phase.json` plus a recursive plan-file glob, and 1.0 imports that legacy file into `build` once and then deletes it. The stalled-plan flag is aimed at a file that stops existing.

**4. Re-orientation still ends at a terminal you type into by hand.** Every remedy is a command string to read and retype. Section 10's dispatch does not exist, while `launch_detached` already sits in the courier serving the resume launcher only.

## Design

### 1. Read layer: schema v2 is the rich path

`parse/state.ts` accepts `schemaVersion` 1 and 2 and branches on it explicitly. Field presence is never used to infer a project's mode, because `docs/STATE-SCHEMA.md` states that a v1 file and a v2 file with `mode`/`from`/`build`/`design`/`intent`/`roadmapIds` genuinely absent are indistinguishable to a presence check.

- `schemaVersion: 2` gives the full card: cursor facts as before, plus mode, parent roadmap id, the design board, the build sentinel, and the override record.
- `schemaVersion: 1` gives a card labelled `pre-1.0` carrying only the v1 fields, with an upgrade nudge (`/claudhd:init`) as its remedy. It is never rendered as an idle project, because idle is a real v2 state and a v1 file cannot distinguish itself from one.
- No state.json at all keeps the existing lenient-parse card, unchanged.

The v1 precedence rule (state.json wins unless its `generatedAt` is older than NOW.md's mtime by more than a day) is deleted. Under 1.0, NOW.md is derived from state.json, so a NOW.md newer than `generatedAt` no longer indicates a fresher source. It indicates a hand edit that the next commit will overwrite, which becomes an info flag instead of a precedence switch.

The lenient NOW.md parser survives with a narrower job: the no-state.json case above, and supplying item text that state.json deliberately does not carry. `docs/STATE-SCHEMA.md`'s "Fields NOT in this file" section is explicit that Queue, Quick fixes, and Loose ends carry counts in state.json and prose only in NOW.md, so the detail view still reads those lines from the file.

### 2. Read layer: the build sentinel replaces the gantry files

The app stops reading `.gantry/active-phase.json`. The plugin performs a one-time import of that file into `build` and then deletes it, and an outside reader racing that migration can only get it wrong. `build` in state.json becomes the only sentinel source.

- Plan-backed sentinel (`build.plan` set, `build.phase` a number) renders as `phase N of M`, where M comes from checkbox counts in the plan file that `build.plan` names.
- Quick sentinel (`build.plan` null, `build.phase` the string `quick`) renders as a quick-fixes pass. It never renders as `phase quick of M`.
- Staleness is judged by age alone. `isStale()` in the plugin compares the sentinel's `session` against the current session id, and the app has no session id to compare against, so it flags a sentinel whose `started` is more than six hours old as a possibly-abandoned phase and says in the flag copy that it is judging by age, not by session.

The recursive plan-file glob stays, with a reduced job: checkbox phase progress for the active plan, and finding plans with no active sentinel so the stalled-plan flag still fires on abandoned work.

### 3. Write layer: the vocabulary is the only write path

The app makes no direct write to any project file. `idea_append` is removed from the courier and `capture.ts`'s hand-derived line format is removed from core. No fallback write path replaces them, because a fallback is a second implementation of the format and that is the defect being fixed.

**Plugin discovery.** The plugin lives at `~/.claude/plugins/cache/claudhd/claudhd/<version>/scripts/`, and the version segment moves on every release. The app globs that path, takes the highest version, caches the resolved scripts directory in its own store, and re-resolves on rescan and after any spawn failure.

**The courier command.** A new Rust command `plugin_run(script, args, cwd)` spawns `node <resolved-scripts-dir>/<script> <args...>` with `cwd` set to the project root, capturing stdout, stderr, and exit code. `script` is a closed enum of basenames (`vocab.js`, `quick.js`) resolved inside the courier against the discovered directory. A caller-supplied path is never accepted, matching the `safe_name` discipline the store commands already use.

**The port.** Core reaches it through a new `ScriptRunner` in `src/core/ports.ts`, shaped like the existing `GitRunner`: it returns a result and never throws. The seam rule in `docs/CONVENTIONS.md` holds unchanged, since path resolution and process spawning live entirely in the adapter.

**Unavailability.** If node is not on PATH or no plugin directory is found, every tap renders disabled and the provenance line states the reason. Read-only surfaces keep working. The app never pretends a write channel is armed when it is not, the same rule v1 applied to hotkey registration.

**Verbs and their surfaces.**

| verb | surface | replaces |
|---|---|---|
| `append-capture` | the capture popover | `idea_append` + `capture.ts` line building |
| `mark ideas <pos> <line> dropped` | triage card, drop | new |
| `move <pos> <line> [Next\|Later]` | triage card, promote to roadmap | new |
| `mark roadmap <id> done` | roadmap item, mark done | new |
| `reorder <section> <id> <pos>` | roadmap item, move up / move down | new |
| `park <id> <Next\|Later>` | roadmap item, park | new |
| `quick.js <text>` | triage card, quick fix | new |

`quick.js` is called directly rather than through `vocab.js`, per the "What is deliberately NOT a vocabulary verb" section of `docs/SCRIPT-VOCABULARY.md`. Triage skip writes nothing. Triage discuss dispatches a session, since rewording is free text.

Structural edits ship as move-up, move-down, and park buttons. Section 10 says drag-reorder; this narrows it deliberately. Drag adds a pointer-interaction layer to a render loop whose whole discipline is rebuilding a card only when its data changed, and `reorder()` takes a target position either way, so the buttons reach the same verb with the same argument.

**Optimistic concurrency.** `move()` and `mark(file: "ideas")` require `expectedLine`, the exact line text the caller last rendered. On mismatch the verb throws and writes nothing. The app catches that, re-reads IDEAS.md, re-renders the card list, and shows an inline notice on the affected card saying the list changed underneath the tap. It never retries blindly with the same stale position, which `docs/SCRIPT-VOCABULARY.md` names as the wrong response, and it never fails silently.

**Refusals.** `mark(roadmap)`, `reorder()`, and `park()` throw on a heading-anchored id, with an error saying block operations are not supported and to edit ROADMAP.md in a session. The app surfaces that message on the item and offers dispatch instead of the button.

### 4. Next-up panel

One row per project, above the fleet, sorted by the same user-recency order the cards use. A project with nothing actionable is absent rather than shown as a no-op row, so the panel's length is itself the signal.

Precedence within a project, first match wins:

| rank | condition | row reads | dispatch |
|---|---|---|---|
| 1 | `override` present | unguarded session running | `/claudhd:override --clear` |
| 2 | `build` set, tree dirty | phase N ready for review | `/claudhd:review` |
| 3 | `build` set, tree clean | build phase N of M | `/claudhd:build` |
| 4 | `mode: design`, `design.doc` null | design `from`, no doc yet | `/claudhd:design` |
| 5 | `mode: design`, open decisions | design `from`, N open | `/claudhd:design <doc>` |
| 6 | cursor bloat or unwrapped | cursor needs a wrap | `/claudhd:wrap` |
| 7 | untriaged over threshold | N untriaged, oldest Nd | `/claudhd:triage` |
| 8 | quick fixes at cap | N quick fixes waiting | `/claudhd:quick` |
| 9 | `mode` null, `roadmap.topItem` set | start `<id>` | `/claudhd:start <id>` |

Override sits above build because an unguarded session means the guards are off, which makes every other row on that project suspect.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ CLAUDHD                                             [rescan]  [settings] │
│ watching 15 repos · vocabulary ready (claudhd 1.0.5) · node 22.11        │
├─ next up ────────────────────────────────────────────────────────────────┤
│ bakingapp      build phase 3 of 5                            [build ▸]   │
│ ClauDHD        design r-0727-4, 25 resolved / 1 open         [design ▸]  │
│ assassinrpg    9 untriaged, oldest 44d                       [triage ▸]  │
├─ fleet ─────────────────────────────────────── [ cards | lanes ] ────────┤
```

### 5. Cross-project pipeline view

A lane toggle on the fleet rather than a third view. The same cards regroup under `design`, `build`, `review`, `idle`, and `pre-1.0` headers, driven by `mode` and `build`. A second view would mean a second card renderer and a second router branch over identical data, and regrouping is a container-level reorder of cards that already exist, which is what the render discipline is built for.

```
├─ fleet ─────────────────────────────────────── [ cards | lanes ] ────────┤
│ BUILD                                                                    │
│   bakingapp        phase 3 of 5 · started 2h · dirty 4                   │
│ DESIGN                                                                   │
│   ClauDHD          r-0727-4 · 25 resolved · 1 open · doc set             │
│ IDLE                                                                     │
│   godot-mcp · capsulecastle · humanizer                                  │
│ PRE-1.0                                                                  │
│   Github · gantrybench                              run /claudhd:init    │
```

### 6. Dispatch

Dispatch reuses `launch_detached` and the existing config command templates, with a `{cmd}` substitution added alongside `{path}`. Default template:

```
wt -d "{path}" powershell -NoExit -Command "claude '{cmd}'"
```

Every dispatch appends one line to the existing event history (project, command, timestamp), so the since-last-open diff can report a dispatch that never produced a commit or a checkpoint.

Whether the `claude` CLI submits a slash command passed as an argument is unverified and goes to `docs/RUNTIME_VERIFICATION_QUEUE.md` rather than being assumed. If it does not, dispatch degrades to opening the terminal at the project with the command placed on the clipboard, one paste. A headless run is never the fallback, per section 10's hard line that clicking must never spend tokens without a session open in front of the user.

### 7. Flags

Re-keyed:

- **hooks not firing** now compares state.json `generatedAt` against the last commit date, instead of testing whether `.now/` exists.
- **stalled plan** now reads `build` plus the plan glob, per section 2 above.

New:

| flag | measures | severity |
|---|---|---|
| unguarded session | `override` present in state.json | warn, and marks that project's other flags suspect |
| hand-edited cursor | NOW.md mtime newer than `generatedAt` | info |
| design with no doc | `mode: design` and `design.doc` null past the threshold | info |
| stale sentinel | `build.started` more than 6h old | warn |
| pre-1.0 project | `schemaVersion: 1` | info |

Every other v1 flag keeps its definition and its config-placeholder thresholds. The fire-rate history keeps recording transitions, which is what the week-two tuning pass (`r-0727-3`) argues from.

### 8. Kill criteria

v1's two-week trial is superseded, which section 10 states. v2's criterion is narrower and testable: does he dispatch from the panel, or does every session still start by typing `claude` in a terminal by hand. Two weeks of real use answers it. If dispatch goes unused, the dispatch half is cut and the read-only lens stays, which is still the whole of v1's value. The trust criterion carries over unchanged: re-orienting him wrong counts double. This rides `r-0727-2`'s existing kill-criteria trial rather than starting a parallel one.

## Contracts touched

| contract | how |
|---|---|
| `docs/STATE-SCHEMA.md` | consumed, not changed. The app reads `schemaVersion`, `cursor`, `ideas`, `shipped`, `roadmap`, `git`, `mode`, `from`, `build`, `design`, `intent`, `override`. |
| `docs/SCRIPT-VOCABULARY.md` | consumed, not changed. All five verbs plus the `quick.js` exception. |
| `app/src/core/ports.ts` | new `ScriptRunner` port. `AppStore` keeps its "only write port" role for the app's own data dir. |
| `app/src-tauri/src/lib.rs` | `idea_append` removed, `plugin_run` added. |
| `app/src/core/capture.ts` | line-format construction removed, launcher template logic kept and extended with `{cmd}`. |
| `app/src/core/parse/state.ts` | v2 fields, explicit `schemaVersion` branch. |
| `app/src/core/flags.ts` | two flags re-keyed, five added. |
| `app/docs/CONVENTIONS.md` | Layout section gains the new modules; the seam rule is unchanged and still gates. |
| `app/design/object_permanence_v1_reviewed.md` | superseded on sections 4, 6, 9, and 12; the section 12 amendment still awaits ratification independently of this work. |

## Edge cases

- **Mixed fleet during rollout.** Most projects are pre-1.0 until touched. The `pre-1.0` lane and the info flag turn that into a visible migration checklist rather than a silent degradation.
- **Plugin version moves under a running app.** The cached scripts directory goes stale on upgrade. Re-resolution on rescan and after any spawn failure covers it, and the resolved version shows in the provenance line.
- **Two writers at once.** The plugin's locks protect writers from each other and its atomic renames protect readers from writers, which `docs/SCRIPT-VOCABULARY.md` calls out as written specifically for this app's watcher. The app holds no locks and needs none.
- **A tap fires while a capture lands.** Handled by `expectedLine` above: the verb refuses, the app re-renders.
- **Heading-anchored roadmap id.** Buttons refuse and offer dispatch, per the verb's own error.
- **Sentinel from another machine or another session.** Age-only staleness will occasionally flag a phase that is genuinely active in a long session. The flag copy says it is judging by age, so the reading stays honest.
- **`unpushed` is null, not zero.** No upstream tracking branch is distinct from a clean count, per `docs/STATE-SCHEMA.md`. The debt flag must not read null as zero.
- **`override` absent versus unset.** `.override` reads as `undefined` when the key is absent, so the check is truthiness, never `"override" in state`.
- **Dispatch launches nothing.** `launch_detached` reports spawn success only, which v1 accepted as a limitation. An exe that starts and then errors is still out of scope, and the deferred note recording that stays open.

## Out of scope

Carried from v1 and section 10, restated because this rework touches the surfaces where each would be tempting:

- No chat client in the app.
- No headless agent runs from buttons. Clicking never spends tokens without a session open in front of the user.
- No free-text edits of any project file. Anything a model would phrase dispatches to a session.
- No drag-and-drop.
- No Windows autostart, no toasts, no tray notifications.
- No change to the app's own data-dir format beyond additive history lines.
- No migration of the six other projects. That is `r-0727-4`'s sibling work and stays deferred per open item 4 of the 1.0 design.

## Open questions

1. Does the `claude` CLI submit a slash command passed as an argument (`claude "/claudhd:start r-0727-4"`), or does dispatch have to fall back to the clipboard path? Goes to `docs/RUNTIME_VERIFICATION_QUEUE.md` and is answered by one manual run before the dispatch phase starts.
