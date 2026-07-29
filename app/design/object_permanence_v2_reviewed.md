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

**The plugin owns the read path.** `docs/STATE-SCHEMA.md` requires consumers to use the plugin reader and never read state.json directly. The plugin gains a compatibility-preserving `readStateResult(nowDir)` helper alongside the existing `readState(nowDir)`. `readState()` keeps its frozen null-or-state behavior for current callers. `readStateResult()` performs the read once and returns `{ status, state?, reason?, version? }`, retaining the failure detail that `readState()` deliberately collapses. A new `state.js read --json <project-root>` subcommand resolves `<project-root>/.now`, calls `readStateResult()` on that directory, and prints the result as one JSON object. The app reaches it through the same `ScriptRunner` port it uses for writes, so the app has one integration surface with the plugin and zero state.json parsers of its own.

`status` is a closed enum, so no trust failure collapses into the no-state fallback:

| `status` | meaning | card |
|---|---|---|
| `absent` | no state.json | lenient NOW.md card |
| `unreadable` | present, filesystem read failed | raw-fallback card, reason shown |
| `malformed` | present, invalid JSON, an array, or an invalid `schemaVersion` | raw-fallback card, reason shown |
| `v1` | `schemaVersion` 1 or missing | `pre-1.0` card |
| `v2` | `schemaVersion` 2 | full card |
| `future` | integer `schemaVersion` above 2 | raw-fallback card naming the version, never a silent downgrade |

Missing `schemaVersion` and numeric `1` are v1, numeric `2` is v2, and an integer above `2` is future. Every other value is malformed. The subcommand exits zero for all six data statuses. Invalid or non-JSON stdout is a per-project raw-fallback result. A runner failure is reported separately from a data status.

`app/src/core/parse/state.ts` is a typed decoder for the subcommand result, not a state.json reader. It validates every known field the app consumes against `docs/STATE-SCHEMA.md`, including nullable nested objects and enum values. An invalid known field changes that project to raw-fallback and names the field path and expected type. Unknown top-level fields pass through or are ignored as the additive schema permits. No invalid value is coerced into idle, zero, or null.

If node or the plugin is unavailable, every project falls back to the lenient NOW.md card and the provenance line says the plugin read path is down. That degradation is worse than today's for reading, and it is accepted: one honest parser that can be unreachable is preferable to two parsers that silently disagree.

- `schemaVersion: 2` gives the full card: cursor facts as before, plus mode, parent roadmap id, the design board, the build sentinel, and the override record.
- `schemaVersion: 1` gives a card labelled `pre-1.0` carrying only the v1 fields, with an upgrade nudge (`/claudhd:init`) as its remedy. It is never rendered as an idle project, because idle is a real v2 state and a v1 file cannot distinguish itself from one.
- No state.json at all keeps the existing lenient-parse card, unchanged.

The hand-edited-cursor flag is dropped. `generatedAt` is owned by the facts writers (`checkpoint.js`, `reconcile.js`), while `thread.js` and `override.js` legitimately re-render NOW.md without touching it, so NOW.md newer than `generatedAt` is a routine state and not evidence of anything. No canonical content signal exists today, and inventing one means adding a content hash to the plugin's render path to serve one info-tier flag. Not worth it. The v1 precedence rule this flag was meant to replace is still deleted: state.json is authoritative because NOW.md is generated from it.

The lenient NOW.md parser survives with a narrower job: the no-state.json case above, and supplying detail state that state.json deliberately does not carry. `cursor.queueCount` and `cursor.quickFixCount` come from state.json. The Quick fixes cap, `looseEndsCount`, and the Queue, Quick fixes, and Loose ends item text still come from NOW.md. The detail view reads those lines from the file.

### 2. Read layer: the build sentinel replaces the gantry files

The app stops reading `.gantry/active-phase.json`. The plugin performs a one-time import of that file into `build` and then deletes it, and an outside reader racing that migration can only get it wrong. `build` in state.json becomes the only sentinel source.

- Plan-backed sentinel (`build.plan` set, `build.phase` a number) renders as `phase N of M`. M comes from the existing plan parser's numbered phase headings and Status lines, with checkbox count as its existing fallback only when the plan has no phase headings. The app matches the normalized repo-relative `build.plan` path exactly. A missing plan, parse failure, or parser result with zero phase units renders `phase N, plan progress unavailable` with the path and parse reason as evidence. It never renders `phase N of 0`.
- Quick sentinel (`build.plan` null, `build.phase` the string `quick`) renders as a quick-fixes pass. It never renders as `phase quick of M`.
- Staleness is judged by age alone. `isStale()` in the plugin compares the sentinel's `session` against the current session id, and the app has no session id to compare against. The app therefore flags a sentinel whose `started` age exceeds `staleSentinelHours`, default `6`, as a possibly-abandoned phase and says in the flag copy that it is judging by age, not by session. A missing or invalid `started` value produces `sentinel age unknown` evidence and does not fire the age branch.

The recursive plan-file glob stays, with a reduced job: supplying progress for the active plan through the existing plan parser, and finding plans with no active sentinel so the stalled-plan flag still fires on abandoned work.

### 3. Write layer: the vocabulary is the only write path

The app makes no direct write to any project file. `idea_append` is removed from the courier and `capture.ts`'s hand-derived line format is removed from core. No fallback write path replaces them, because a fallback is a second implementation of the format and that is the defect being fixed.

**Plugin discovery: the rule is core, the listing is the courier.** The plugin lives at `<user-home>/.claude/plugins/cache/claudhd/claudhd/<version>/scripts/`, and the version segment moves on every release. Several versions are installed side by side and the set is not contiguous (this machine currently carries 1.0.0, 1.0.1, 1.0.2, 1.0.3, and 1.0.5), so selection is a real rule and not a directory sort.

`docs/CONVENTIONS.md` says the Rust side is a courier and all logic lives in TypeScript, and v1 deliberately added no `cargo test` gate, so a selection rule living in Rust would ship untested by either suite. The split follows the pattern `app/src/core/migrate.ts` already sets:

- The courier resolves the user home through the OS (never shell expansion), lists the version directory names, and reports which of `state.js`, `vocab.js`, and `quick.js` exist under each. That is filesystem access, no decisions.
- `src/core/plugin.ts` holds the pure rule and is unit-tested against fixture listings including the non-contiguous set above: keep names matching `^\d+(\.\d+)*$`, keep only versions carrying all three scripts, compare integer segments with missing trailing segments treated as zero, select the highest, and tie-break equal numeric versions on the lexically smaller directory name.

The resolved directory and version are cached in the app store, re-resolved on rescan and once after a spawn failure, and reported on the provenance line.

**The probe is a capability check, not a file check.** File existence proves a `state.js` is present, not that it understands `read --json`. Phase 1 of this work adds that subcommand, so every already-installed version fails it, and the highest installed version will keep failing it until a release carrying it is installed. A probe that only stats files would select such a version, get empty stdout for every project, and render the entire fleet in raw fallback with no stated reason, which is the exact silent-degradation failure this design exists to remove.

The probe therefore runs `state.js read --json` against a known project root and requires parseable JSON carrying a recognized `status`. A version that fails it is dropped from selection and the next-highest is tried. If no installed version passes, the app says so by name on the provenance line: the read path is down, the newest installed plugin is `<version>`, and it does not support the read endpoint. That message is the upgrade instruction.

**The courier command.** A new Rust command `plugin_run(script, args, cwd)` spawns `node <resolved-scripts-dir>/<script> <args...>` with `cwd` set to the project root, capturing stdout, stderr, and exit code. `script` is a closed enum of basenames (`state.js`, `vocab.js`, `quick.js`) resolved inside the courier against the discovered directory. A caller-supplied script path is never accepted, matching the `safe_name` discipline the store commands already use. `cwd` must resolve to one of the discovered project roots before spawn.

**The port.** Core reaches it through a new `ScriptRunner` in `src/core/ports.ts`, shaped like the existing `GitRunner`: `run(script, args, cwd)` returns `{ ok, stdout, stderr, exitCode, pluginVersion }` and never throws. `ok` is true only for a completed process with exit code zero; an IPC or spawn failure has `exitCode: null` and the failure text in `stderr`. Path resolution and process spawning live entirely in the adapter. `AppStore` remains the only direct filesystem write port and remains confined to the app data directory; `ScriptRunner` is the one controlled project-mutation port and can invoke only the closed plugin script set. `docs/CONVENTIONS.md` must state that distinction while retaining every import and platform boundary in the seam rule.

**Unavailability.** Startup and rescan run `node --version` and then the capability probe above. If node is not on PATH, no installed version carries all three scripts, or no installed version passes the probe, the plugin read path falls back as specified in section 1 and every project-writing tap renders disabled. The provenance line states which of those three it was. A failed invocation returns through the same non-throwing `ScriptRunner` result.

**Verbs and their surfaces.**

| verb | surface | replaces |
|---|---|---|
| `append-capture` | the capture popover | `idea_append` + `capture.ts` line building |
| `mark ideas <pos> <line> dropped` | triage card, drop | new |
| `move <pos> <line> Next` | triage card, promote to roadmap | new |
| `reorder <section> <id> <pos>` | roadmap item, move up / move down | new |
| `park <id> <Next\|Later>` | roadmap item, park | new |
| `quick.js <text>` then `mark ideas <pos> <line> promoted` | triage card, quick fix | new |

`quick.js` receives only the idea's parsed text, using the balanced-parenthesis parsing rule in `docs/SCRIPT-VOCABULARY.md`, never the timestamp or while-context. Triage skip writes nothing. Triage discuss dispatches `/claudhd:triage` in a visible session, since rewording is free text.

**The item read models.** `src/core/parse/ideas.ts` reads the IDEAS.md Inbox into `{ position, expectedLine, marker, capturedAt, thread, text, parseStatus }` rows. `position` counts every Inbox item from one, including promoted and dropped lines, and `expectedLine` preserves the exact bytes without trimming or newline characters. Only open rows become triage cards. The parser uses the vocabulary contract's balanced-parenthesis scan. A malformed open line stays visible with its raw line and a discuss dispatch; promote and quick fix are disabled because the app cannot derive safe text, while drop may still use its exact position and line. `src/core/parse/roadmap.ts` reads Next and Later into `{ section, id, position, marker, text, headingAnchored, rawLine }` rows. For bullet items, `position` is one-based among checkbox item lines in that section, matching `reorder()`. It supplies the stable id used by start, reorder, and park. Missing or duplicate ids disable structural actions on the affected rows and show the parse reason. Heading-anchored ids are marked before rendering so their unsupported block actions are disabled with the canonical refusal text. Both parsers are pure core modules with fixture tests; neither writes a project file.

**Promotion has one destination.** The promote tap always calls `move` with `Next`, matching the verb's own default and what `/claudhd:triage` does. Sending something straight to `Later` is a promote followed by a park tap, which is two taps for the rarer case and keeps the triage card down to one primary action.

**Roadmap completion is not an in-app button.** Section 10 approves reorder and park and does not name completion. `reconcile.js` already moves a roadmap item to Shipped at the commit boundary when its plan finishes, so a manual done button would compete with the mechanism that already owns the transition. `mark roadmap <id> done` stays available to sessions and gets no surface here.

**The quick-fix tap is two writes made crash-safe by an app-side intent record.** `quick.js` and `mark ideas` are separate scripts under separate locks and cannot be one transaction. Ordering alone survives a refused mark but not a crash between the two writes: on restart the app would see an open idea with no memory that its chore already landed, and a second tap would duplicate it.

The fix needs no plugin change and no contract amendment. Before calling `quick.js`, the app writes a pending record to `AppStore` (`pending-quickfix.json`: project path, idea position, `expectedLine`, the text passed, and a timestamp). It clears that record only after the `mark` succeeds. The sequence is therefore:

1. write the pending record
2. run `quick.js <text>`
3. run `mark ideas <pos> <line> promoted`
4. clear the pending record

Every interruption point is recoverable and none can duplicate:

| crash between | on restart the app sees | what it does |
|---|---|---|
| 1 and 2 | pending record, chore absent from the batch | offers to retry from step 2 |
| 2 and 3 | pending record, chore present in the batch | offers a mark-only retry, never re-runs `quick.js` |
| 3 and 4 | pending record, chore present, idea marked | clears the record silently, nothing to do |

The batch is read from NOW.md's `## Quick fixes` section, so "chore present" is a real check against the file rather than an assumption. `AppStore` is already the app's only direct write port and is confined to its own data directory, so this adds no new write surface. A pending record whose `expectedLine` no longer matches is surfaced as a stale recovery the user resolves in a session, never auto-applied.

**Structural edits ship as buttons, which narrows a ratified decision.** Section 10 of the 1.0 design ratifies drag-reorder. This design substitutes move-up, move-down, and park buttons, for a concrete reason: the render discipline rebuilds a card's DOM only when that card's data changed, and drag requires a live pointer-tracking layer holding transient position state across those rebuilds. `reorder()` takes a target position either way, so both interactions reach the identical verb with the identical argument, and the button version is reachable by keyboard.

This is a narrowing of a decision the user ratified on 2026-07-25, not an oversight, and it requires a one-line amendment to section 10 of `design/claudhd-1.0-design_reviewed.md` recording that reorder ships as buttons and why. That amendment is the user's to make or refuse. If refused, drag is implemented as ratified and this paragraph is struck; the rest of the design is unaffected either way, since the verb and its arguments do not change.

**Optimistic concurrency.** `move()` and `mark(file: "ideas")` require `expectedLine`, the exact line text the caller last rendered. On mismatch the verb throws and writes nothing. The app catches that, re-reads IDEAS.md, re-renders the card list, and shows an inline notice on the affected card saying the list changed underneath the tap. It never retries blindly with the same stale position, which `docs/SCRIPT-VOCABULARY.md` names as the wrong response, and it never fails silently.

**Refusals.** `mark(roadmap)`, `reorder()`, and `park()` throw on a heading-anchored id, with an error saying block operations are not supported and to edit ROADMAP.md in a session. The app surfaces that message on the item and offers the existing resume launcher so the user can handle the block in a visible session.

### 4. Next-up panel

One row per project, above the fleet, sorted by the same user-recency order the cards use. A project with nothing actionable is absent rather than shown as a no-op row, so the panel's length is itself the signal.

Precedence within a project, first match wins:

| rank | condition | row reads | dispatch |
|---|---|---|---|
| 1a | plan-backed `build` set | build phase N of M | `/claudhd:build` |
| 1b | quick `build` set | quick-fixes pass | `/claudhd:quick` |
| 2 | `mode: design`, `design.doc` null | design `<from>`, no doc yet | `/claudhd:design` |
| 3 | `mode: design`, `design.doc` set | design `<from>`, N open | `/claudhd:design <doc>` |
| 4 | untriaged over threshold | N untriaged, oldest Nd | `/claudhd:triage` |
| 5 | quick fixes at cap | N quick fixes waiting | `/claudhd:quick` |
| 6 | `mode` null, parsed Next item has an id | start `<id>` | `/claudhd:start <id>` |

Rank 2 and 3 render `unplanned` when `from` is null. Rank 3 remains actionable at zero open decisions because `/claudhd:design <doc>` is the existing-doc audit entry point; zero open decisions alone does not prove the design passed review. Rank 4 uses `ideasPressureWarn` as its threshold and renders `age unknown` when `oldestUntriagedDate` is null. Rank 5 compares the NOW.md-derived cap against `quickFixCount` and requires both values; an unknown cap produces no row. Rank 6 uses the parsed roadmap item model from section 3 because schema v2's `roadmap.topItem` carries text without an id.

**No review row.** A dirty tree describes implementation in progress just as well as a finished phase, and schema v2 carries no review-ready fact, so next-up would be guessing. Every live sentinel dispatches `/claudhd:build` and the session decides whether the next step is review. `/claudhd:review` stays available as an explicit choice in the detail view's dispatch menu, where the user is the one asserting the phase is done.

**No override row, and no clear button anywhere.** An override is active for a session only when `override.session` matches that session's id, and the app has no current session id, so it cannot distinguish a stale record from a live one. Dispatching `/claudhd:override --clear` against a live override would revoke the guards' escape hatch under a session that is relying on it. Dispatching the bare command is worse: `commands/override.md` shows that `/claudhd:override` with no argument *records* an override, so a button meant to clean up would create the thing it was clearing.

It is also not next-up material. The command doc states that entering `/claudhd:build`, `/claudhd:design`, or a fresh override already clears the record automatically, so a stale override resolves itself the moment real work starts. It is a fact to display, not an action to take.

The record therefore surfaces as an info flag on the project card, reporting `override recorded <startedAt>` with the recorded file list as its evidence, and nothing in the app ever writes to that key.

**No cursor-drift row.** See section 7: cursor bloat and unwrapped are retired under 1.0 rather than re-pointed at a new command.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ CLAUDHD                                             [rescan]  [settings] │
│ watching 15 repos · claudhd 1.0.5 ready · node 22.11                     │
├─ next up ────────────────────────────────────────────────────────────────┤
│ bakingapp      build phase 3 of 5                            [build ▸]   │
│ ClauDHD        design r-0727-4, 25 resolved / 1 open         [design ▸]  │
│ assassinrpg    21 untriaged, oldest 44d                      [triage ▸]  │
├─ fleet ───────────────────────────────────── [ cards | pipeline ] ───────┤
```

### 5. Cross-project pipeline view

A group toggle on the fleet, not a third view. The same cards regroup under headers driven by the state the plugin already writes. A second view would mean a second card renderer over identical data, and regrouping is a container-level reorder of cards that already exist, which is what the render discipline is built for.

Grouping is a first-match-wins ladder, so every project lands in exactly one group without turning an unknown state into idle:

| rank | condition | group |
|---|---|---|
| 1 | `status: v2`, `build` set | BUILD |
| 2 | `status: v2`, `mode: design` | DESIGN |
| 3 | `status: v2`, everything else | IDLE |
| 4 | `status: v1` | PRE-1.0 |
| 5 | `status: absent` | NO STATE |
| 6 | `status: unreadable`, `malformed`, or `future` | RAW FALLBACK |

`build` outranks `mode` because a live sentinel is the fact the guards themselves enforce against (`file-list-guard.js` hardcodes build mode whenever a sentinel exists, regardless of the `mode` field), so a project carrying `mode: design` with a live sentinel is building. There is no REVIEW group, for the same reason there is no review row: schema v2 exposes no review-ready state and the app will not invent one. NO STATE keeps the lenient NOW.md card's evidence, while RAW FALLBACK keeps the status, reason, and version evidence defined in section 1. Within a group, cards keep user-recency order. Empty groups are omitted.

```
├─ fleet ───────────────────────────────────── [ cards | pipeline ] ───────┤
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

Commands come from a closed `DispatchCommand` builder, never from arbitrary UI text. Roadmap ids must match `^r-\d{4}-\d+$`. A design doc argument must be a normalized repo-relative path with no `..`, quote, carriage-return, line-feed, or NUL characters. A command that fails validation is shown as selectable text with dispatch disabled and the reason visible. Template expansion tokenizes the configured template first, replaces `{path}` and `{cmd}` inside the resulting argument vector, and applies the default PowerShell template's single-quoted argument escaping before spawn. Tests cover spaces, apostrophes, quotes, and control characters in both placeholders.

After `launch_detached` reports spawn success, dispatch appends `{ kind: "dispatch", atMs, project, command }` to `history.jsonl`. History parsing becomes a discriminated union: transition validation accepts only `raised`, `cleared`, and `severity`; fire-rate code receives only those records. Since-last-open reads dispatch records whose `atMs` is later than the saved snapshot's `savedAtMs`. A failed spawn appends nothing and reports the failure on the launching surface.

**The tap record.** Section 8's write-half criterion counts taps per verb, so taps are recorded in the same file under their own discriminant: `{ kind: "tap", atMs, project, verb, outcome }`. `verb` is the closed set actually invoked (`append-capture`, `move`, `mark-ideas`, `mark-roadmap`, `reorder`, `park`, `quick-fix`), and `outcome` is `ok`, `refused` (the verb threw, which includes an `expectedLine` mismatch and a heading-anchored refusal), or `unavailable` (no usable plugin or node). A refused tap is still a tap for the kill criterion, since it proves the surface was used, and separating the outcomes is what makes a surface that is always refusing visible rather than looking healthy. The quick-fix tap writes one record for the whole two-write sequence, with `outcome: refused` when the mark leg fails after `quick.js` succeeded.

`history.ts` therefore validates three discriminants: transition records, dispatch records, and tap records. Fire-rate code continues to receive transition records only.

Whether the `claude` CLI submits a slash command passed as an argument is unverified, and one manual run answers it. The plan must add that exact check and its pass condition to `app/docs/RUNTIME_VERIFICATION_QUEUE.md`, where it is currently absent. The plan must not start the dispatch phase before the check is recorded and run.

Both branches are specified now so the plan can be written either way:

- **CLI submits it.** The template above ships unchanged and the row's button is labelled with the command it will run.
- **CLI does not submit it.** The row action is labelled `copy + open`. It calls a new `clipboard_write(text)` courier command first. On success it launches the existing terminal-only template at the project path. If the clipboard write fails, it does not launch and shows the command as selectable text. If the launch fails after the copy succeeds, it reports the launch failure and says the command is still copied. Neither failure claims that a command was submitted.

A headless run is not a branch here, per section 10's hard line.

### 7. Flags

Re-keyed:

- **hooks not firing** applies to v2 projects. It fires when the last commit is within `recentCommitDays` and state.json `generatedAt` is null or trails that commit by more than `hooksDeadLagDays`. Evidence shows the commit timestamp, the missing or present `generatedAt`, and both configured thresholds. Absent and v1 state use their migration/read statuses instead of this flag.
- **stalled plan** has two evidence branches under one flag id: an active `build` sentinel older than `staleSentinelHours`, judged by age only, or a plan with no active sentinel that crosses the inherited time/commit thresholds. This avoids a duplicate stale-sentinel flag.

New:

| flag | measures | severity |
|---|---|---|
| recorded override | an `override` record exists, reported with its `startedAt` and never as proof that a session is running | info |

That is the only new flag. Three candidates from the draft are dropped:

- **hand-edited cursor** has no valid signal, per section 1.
- **design with no doc** is already next-up rank 2.
- **pre-1.0** is already the card label and a pipeline group.

The recorded-override flag does not mark a project's other flags suspect. Commit counts, dirty counts, and idea counts are facts read from git and the files, and an override record has no bearing on whether they are true. The draft copied that treatment from hooks-not-firing, where it is earned, because a dead hook means every state.json-derived number is stale.

The recorded-override flag owns detail evidence and transition history, and it is the only surface for the override record. Next-up has no override row, per section 4.

**Cursor bloat, cursor stale, and unwrapped are retired.** Cursor bloat and unwrapped used `/claudhd:wrap`, which 1.0.5 does not ship. Their condition is also gone: NOW.md's `## Active thread` section is rendered from `intent.thread` and `intent.next`, two lines that cannot accumulate, so the 170-line motivating exhibit is structurally impossible under 1.0. The proposed cursor-stale re-key used the same `generatedAt` versus activity comparison as hooks-not-firing, so G2 merges that job into hooks-not-firing instead of keeping two flags for one fact. `cursorBloatWarn`, `cursorBloatCrit`, `cursorStaleWarnDays`, `cursorStaleCritDays`, and `unwrappedMinHours` leave the typed defaults. Existing config files may retain them as ignored unknown keys under the additive config merge.

**Dead cursor** survives as the cursor drift flag: commits exist while `intent.thread` is null or the template placeholder, remedied by `/claudhd:now`. The long-running-thread clock in `.now/active-thread.json` remains plugin-owned and is not read or rendered by this app. Every other v1 flag keeps its definition and its config-placeholder thresholds.

The fire-rate history keeps recording transitions, which is what the week-two tuning pass (`r-0727-3`) argues from.

### 8. Kill criteria

v1's two-week trial is superseded, which section 10 states. v2 has four halves and each is cut on its own evidence, so an unused surface dies without taking the working ones with it. Two weeks of real use.

Two halves are measurable from `history.jsonl` and two are not. Rather than inventing an in-app useful/wrong button that would go untapped, each half names the evidence it actually has.

| half | evidence | success | cut if |
|---|---|---|---|
| write (triage taps, structural edits) | tap events in `history.jsonl`, counted per verb | any mechanical triage happens as taps | zero tap events in two weeks; the vocabulary wiring is cut and reading stays |
| dispatch (next-up buttons) | dispatch events in `history.jsonl` | at least one session per working day starts from the panel | zero dispatch events in two weeks; dispatch is cut and reading stays |
| read (schema v2 orientation, pipeline grouping) | a dated line in the trial log, written when it happens | the fleet surfaced something he did not already know, at least twice | no entries in two weeks; it is a slower `git status` and the app is dead outright |
| trust (carried from v1, unchanged) | a dated line in the trial log | no wrong re-orientation logged | any single wrong re-orientation shown as settled state, which counts double and can kill the project on its own |

The two logged halves are judgments only the user can make, so they are written down when they happen rather than reconstructed at the end of the fortnight. The trial log is the same one `r-0727-2` already runs; this adds two line types to it and starts no parallel trial.

The read half is load-bearing: it failing kills the whole thing, since write and dispatch are both surfaces on top of it. The other three are independently removable. Two positive read observations in two weeks is a deliberately low bar, chosen because the app's read value is concentrated in the moments after a context switch rather than spread evenly across sessions; if it clears only that bar it survives the trial in a weak state and is worth re-examining at the next one.

## Contracts touched

| contract | how |
|---|---|
| `docs/STATE-SCHEMA.md` | extended compatibly: documents `readStateResult()`, the new `state.js read --json` consumer endpoint, and its `status` enum. Existing `readState()` behavior stays unchanged. |
| `plugins/claudhd/scripts/state.js` | adds `readStateResult()` and the `read --json` subcommand for out-of-process consumers. |
| `docs/SCRIPT-VOCABULARY.md` | consumed unchanged unless the pending quick-fix decision selects an atomic plugin operation, in which case this frozen contract needs an explicit amendment. |
| `app/src/core/ports.ts` | new `ScriptRunner` controlled project-mutation port. `AppStore` remains the only direct filesystem write port and stays confined to the app data directory. |
| `app/src-tauri/src/lib.rs` | `idea_append` removed, `plugin_run` added. A clipboard command is added only if the dispatch decision selects that fallback. |
| `app/src/core/capture.ts` | line-format construction removed, launcher template logic kept and extended with `{cmd}`. |
| `app/src/core/parse/state.ts` | stops parsing state.json. Becomes a thin typed reader over `state.js read --json`'s output and its `status` enum. |
| `app/src/core/parse/ideas.ts`, `app/src/core/parse/roadmap.ts` | new pure item parsers supplying exact optimistic-concurrency lines, stable roadmap ids, positions, and refusal states for the write surfaces. |
| `app/src/core/flags.ts` | hooks-not-firing and stalled-plan re-keyed, dead-cursor re-keyed, cursor-bloat/cursor-stale/unwrapped retired, recorded-override added. |
| `app/src/core/history.ts`, `app/src/core/diff.ts` | add the discriminated dispatch and tap events and merge post-baseline dispatches into since-last-open. |
| `app/src/core/plugin.ts` | new pure module: version selection and probe-result interpretation, unit-tested against fixture listings. |
| `app/test/oracle/assassinrpg.expected.ts` | re-cut. It names cursor-bloat crit as its non-negotiable anchor and this design retires that flag. |
| `app/src/core/config.ts` | adds `{cmd}` handling and `staleSentinelHours: 6`; removes `stateJsonMaxLagDays`, `cursorBloatWarn`, `cursorBloatCrit`, `cursorStaleWarnDays`, `cursorStaleCritDays`, and `unwrappedMinHours` from typed defaults while tolerating them as ignored stored keys. |
| `app/docs/CONVENTIONS.md` | Layout gains the new modules; the seam rule distinguishes the direct filesystem write port from the closed script-invocation mutation port. |
| `app/docs/RUNTIME_VERIFICATION_QUEUE.md` | adds the manual Claude CLI argument-submission check before the dispatch phase. |
| `design/claudhd-1.0-design_reviewed.md` | needs an explicit amendment only if the pending structural-edit decision replaces the ratified drag-reorder interaction. |
| `app/design/object_permanence_v1_reviewed.md` | superseded on sections 4, 6, 8, 9, and 10; the section 12 amendment still awaits ratification independently of this work. |

## Edge cases

- **Mixed fleet during rollout.** Most projects are pre-1.0 until touched. The `pre-1.0` label and pipeline grouping turn that into a visible migration checklist rather than a silent degradation.
- **Plugin version moves under a running app.** The cached scripts directory goes stale on upgrade. Re-resolution on rescan and after any spawn failure covers it, and the resolved version shows in the provenance line.
- **Quick-fix partial write.** `quick.js` writes NOW.md under its own lock and shares no transaction with the IDEAS.md source mark. Covered by the `AppStore` pending record in section 3, which makes every interruption point recoverable and none of them duplicating, including a crash between the two writes.
- **A tap fires while a capture lands.** Handled by `expectedLine` above: the verb refuses, the app re-renders.
- **Heading-anchored roadmap id.** Buttons refuse and offer the resume launcher, per the verb's own error.
- **Sentinel from another machine or another session.** Age-only staleness will occasionally flag a phase that is genuinely active in a long session. The flag copy says it is judging by age, so the reading stays honest.
- **`unpushed` is null, not zero.** No upstream tracking branch is distinct from a clean count, per `docs/STATE-SCHEMA.md`. The debt flag must not read null as zero.
- **`override` absent versus unset.** `.override` reads as `undefined` when the key is absent. Truthiness detects a record, but does not prove it is active for the current session.
- **Dispatch launches nothing.** `launch_detached` reports spawn success only, which v1 accepted as a limitation. An exe that starts and then errors is still out of scope, and the runtime verification entry remains open until a live launch succeeds.

## Out of scope

Carried from v1 and section 10, restated because this rework touches the surfaces where each would be tempting:

- No chat client in the app.
- No headless agent runs from buttons. Clicking never spends tokens without a session open in front of the user.
- No free-text edits of any project file. Anything a model would phrase dispatches to a session.
- No drag-and-drop. Reorder ships as buttons, which narrows section 10's ratified drag interaction and needs the one-line amendment named in section 3.
- No Windows autostart, no toasts, no tray notifications.
- No change to the app's own data-dir format beyond additive history lines.
- No migration of the six other projects. That is `r-0727-4`'s sibling work and stays deferred per open item 4 of the 1.0 design.

## Open questions

1. Does the `claude` CLI submit a slash command passed as an argument? One manual run answers it. Queued as active check 3 in `app/docs/RUNTIME_VERIFICATION_QUEUE.md`; both branches are specified in section 6, so the result gates the dispatch phase without requiring another design decision.

2. Section 10 of `design/claudhd-1.0-design_reviewed.md` needs a one-line amendment recording that roadmap reorder ships as buttons rather than the ratified drag interaction, per section 3. This is the user's call to make or refuse, and the design holds either way.
