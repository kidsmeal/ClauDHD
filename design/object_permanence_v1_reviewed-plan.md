# Object Permanence v1 - Implementation Plan

Source design: `design/object_permanence_v1_reviewed.md` (Status: LOCKED 2026-07-12, zero open markers)
Conventions read: none exist in-repo yet (fresh repo: claudhd scaffold + gantry living docs, no code). The design doc is the convention source, as stated in the task. Contract sources read directly from ClauDHD 0.9: `ClauDHD/plugins/claudhd/scripts/state.js`, `nowfile.js`, `idea.js`, `constants.js`. Six real marked repos under `C:\Users\atk67\Documents` spot-checked on disk.
Verification command(s): `npm test` (vitest run, headless node), `npm run typecheck` (tsc --noEmit strict), `npm run acceptance` (live-fleet scan, manual hand-check), `npm run tauri:dev` (app smoke, phase 2+), `npm run tauri:build` (NSIS bundle, phase 5). Reviewers gate on `npm test` + `npm run typecheck` every phase; phases 2-5 add the runtime check named in that phase.

## Summary

Object Permanence v1 is a Tauri 2 + Vite + vanilla TypeScript desktop tool that watches every ClauDHD/Gantry project under a configured root and re-orients the user on open. It is built in the 5 locked phases: a headless node-testable core (discovery, parsers, git reads, flag engine), a read-only window, the resident watcher plus since-last-open memory, the live flag fire-rate log, then capture plus launcher plus packaging. All logic lives in TypeScript; the Rust side is a thin courier. The design makes exactly one write to a project file (idea capture) and otherwise touches only `%APPDATA%\object-permanence\`.

## Test runner and toolchain (recorded per the task)

- **Test runner: vitest.** It shares Vite's config and TS transform, runs plain TS modules on node with no shell, has fast watch and clean fixture ergonomics. Phase 1 core modules import zero `@tauri-apps/api` at module scope so vitest runs them on node with no Tauri or cargo involvement.
- **Live-fleet scan: `tsx scripts/acceptance.ts`** (or vite-node), a node entry that drives the core over the real `C:\Users\atk67\Documents` roots and prints the fleet plus flags. This is the manual hand-check surface, kept out of CI so unit tests stay deterministic and offline.
- **npm scripts to create in the scaffold:** `test` -> `vitest run`; `test:watch` -> `vitest`; `typecheck` -> `tsc --noEmit`; `acceptance` -> `tsx scripts/acceptance.ts`; `dev` -> `vite`; `tauri:dev` -> `tauri dev`; `tauri:build` -> `tauri build`.
- **Rust:** built through the Tauri CLI. The courier is thin enough that v1 adds no separate `cargo test` suite; Rust-touching phases verify by the app building and the observable behavior named in the phase.
- Verified toolchain on this machine: node v24.15.0, npm 11.12.1, cargo/rustc 1.96.0, `wt` and `claude` on PATH, Windows 11.

## Preconditions before Phase 1 (mechanical, no design decision)

These are sequencing gates, not open questions. The design already calls for them (section 12: "Phase 1 needs `gantry:init` run on this repo first").

1. **Scaffold the project.** Create the Tauri 2 + Vite + vanilla TS app (`create-tauri-app`, vanilla-ts template) so `src/` (frontend TS), `src-tauri/` (Rust courier), `index.html`, `vite.config.ts`, `tsconfig.json`, and `package.json` exist. Add vitest and the npm scripts above. Extend the repo `.gitignore` for `node_modules/`, `dist/`, `src-tauri/target/` (the existing `.gitignore` already covers `.now/` and the `.gantry/` local files).
2. **Run `gantry:init`** so the repo carries a conventions doc and the recorded test command (`npm test`) that the phase reviewer gates against. Until this lands there is no in-repo convention doc; this plan and the design are the only convention source.

Once both are done, Phase 1 builds pure TS under `src/core/` with vitest, no shell.

## Blockers / Open Questions

Two are real design-versus-reality gaps in the **stalled-plan flag**, both found by reading the actual plan files on disk. Neither blocks starting Phase 1 as a whole (discovery, config, all parsers, git reads, and 10 of the 11 flags plus wip-spread are fully specified). Both must be resolved before the stalled-plan rule is locked and before the assassinrpg hand-check's stalled-plan line can be written.

1. **Plan phase-progress is not encoded as checkboxes.** Section 6 says the recursive-glob path reads "checkbox phase progress" and "checkbox counts giving phase progress." The real plan files contain zero `- [ ]` phase checkboxes. They mark progress with a freeform `**Status:**` line under each `## Phase N` heading, and the values are prose, not a fixed vocabulary: `pending`, `DEFERRED. Gating the Study domains...`, `ready to commit - reviewed PASS-WITH-NOTES ... 628 full suite green`, `committed`, `v2, 2026-07-03 ...`. Some plans (godot-mcp `procgen-tools.plan.md`) carry one Status line for seven `## Phase` headings, so most phases have no Status line at all. As specified, the flag would find zero checkboxes in every real plan, compute zero unchecked phases, and never fire against the whole fleet. RESOLVED (build session, 2026-07-12, under the user's momentum authorization): a plan's phase units are its `## Phase` headings. A phase counts done when its `**Status:**` line's first word is one of `committed`, `done`, `shipped`, `complete`, `completed` (case-insensitive); any other Status value (pending, deferred, ready-to-commit prose, version notes) and a missing Status line count as not done. When a plan has no Phase headings at all, `- [x]`/`- [ ]` checkbox counting applies as the fallback unit. An unmarked-but-actually-built plan firing the flag is correct behavior under this rule: the plan document is lying about state, which is exactly what the flag polices; the evidence panel names each phase it counted and the basis (status word or missing line), so a wrong-feeling fire is inspectable and tunable. The `- [ ]` checkbox parsing stays as specified for IDEAS.md, NOW.md Queue/Quick fixes/Loose ends, and ROADMAP.
2. **Archived plans are inside the glob's reach.** The recursive-glob skip set (section 6: `.git, .now, .gantry, node_modules, dist`) does not exclude archive folders. capsulecastle carries six plans under `docs/archive/` that are archived by folder convention; the glob would scan them and most would read as long-untouched with incomplete phases, producing stalled-plan flags on intentionally-retired plans. That is the wrong-flag case the kill criteria weight double. The repo-level `ignore` list in config does not cover this (it takes whole projects off the shelf, not plan paths within a shown project). RESOLVED (build session, 2026-07-12, under the user's momentum authorization): the plan glob's skip set gains any path segment named `archive` (case-insensitive), alongside `.git`, `.now`, `.gantry`, `node_modules`, `dist`. Archived-by-folder is an existing fleet convention (capsulecastle docs/archive/), and a stall flag on a deliberately retired plan is the wrong-flag case the kill criteria weight double, so accept-and-tune was rejected. The skip set lives in config (`planSkipSegments`) so a differently named archive convention is a config edit.

Everything else in the design is resolved. Minor computation definitions the flag engine will pin with a config-tunable default and record inline (low trust risk, not human-gated): the exact "design/docs paths" set for shipped-drought crit (proposed default: a commit whose touched paths are all under `design/` or `docs/`, or all `*.md`), and how the timeless cursor "Last touched" date compares to a timestamped checkpoint for the info-tier "unwrapped" rule (proposed default: checkpoint stop time later than the Last touched date by the day boundary plus `unwrappedMinHours`).

## Phase 1: Core read layer, headless

**Status:** pending
**Goal:** A node-testable core that discovers projects under the root, parses state.json and the lenient NOW.md/IDEAS/SHIPPED/ROADMAP/plan sources, reads git, and computes the flag set into one plain snapshot object, with parse-failure and source provenance as first-class fields.
**Files:**
- `src/core/model.ts` (types: `FleetSnapshot`, `ProjectCard`, `Flag`, `Severity` = crit|warn|info, `CardSource` = state.json|now.md, `ParseStatus` = ok|raw-fallback+reason, `Provenance`, `UntrackedRepo`)
- `src/core/ports.ts` (adapter interfaces: `GitRunner`, `FileSystem`, `Clock`, `DataDir`, so the core stays free of node and Tauri APIs and both fill it)
- `src/core/config.ts` (schema, defaults per the Cross-cutting config block, tolerant merge of a partial `config.json`)
- discovery (as-built: folded into `src/core/scan.ts`, no separate discovery.ts): root scan to `scanDepth` levels (default 1, qualifying dirs never descended); classify full-card vs untracked-shelf vs invisible; marker detect on the substring `<!-- claudhd`
- `src/core/parse/now.ts` (lenient NOW.md parser porting `nowfile.js` semantics to TS: `activeThread` first bold span, `activeThreadSection`/`activeThreadLineCount` from `## Active thread` heading through the last non-blank line before the next `## `, `### ` does not close the section, `nextAction`, `lastTouchedDate`, `queueCount`, `quickFixCount`, plus loose-ends count and non-template section names; returns a `ParseStatus`)
- `src/core/parse/state.ts` (state.json reader: schemaVersion 1, tolerate null sections and ignore unknown fields)
- `src/core/parse/counts.ts` (parseIdeas/parseShipped/parseRoadmap fallback counts porting the `state.js` regexes; as-built consolidation of the ideas/shipped/roadmap modules)
- `src/core/parse/checkpoint.ts` (as-built plan amendment, phase-1 review: `.now/last-session.md` parse, structurally required by cursor-stale, dead-cursor, hooks-not-firing, idle, and lastActivity)
- `src/core/parse/plan.ts` (gantry plan discovery: `.gantry/active-phase.json` sentinel authoritative when present, reading plan/phase/started and ignoring the extra `files`/`allow`/`session` fields the real sentinel carries; else recursive glob for `*-plan.md` and `*.plan.md` with the section-6 skip set; phase-progress read is gated by Open Question 1)
- `src/core/git.ts` (branch, dirty count, unpushed count, last commit, commit dates and touched paths in the drought window, all through the injected `GitRunner`)
- `src/core/precedence.ts` (choose state.json vs NOW.md by `stateJsonMaxLagDays`; label the source on the card)
- `src/core/flags.ts` (the 11 project flags and fleet wip-spread; thresholds read from config)
- `src/core/scan.ts` (orchestrates discovery -> parse -> git -> flags into a `FleetSnapshot`; the core's public entry)
- `src/adapters/node.ts` (node impls: `child_process` git, `fs`, `%APPDATA%` via `process.env.APPDATA`, real `Date`)
- `scripts/acceptance.ts` (live scan of the real roots using the node adapter; prints fleet plus flags)
- `test/fixtures/**` (frozen real-file-derived fixtures: an assassinrpg NOW.md snapshot, a synthesized state.json v1 covering present, null-section, and unknown-field cases, a capsulecastle plan, a godot-mcp sentinel, IDEAS/SHIPPED/ROADMAP samples)
- `test/now.test.ts`, `test/state.test.ts`, `test/ideas-shipped-roadmap.test.ts`, `test/discovery.test.ts`, `test/precedence.test.ts`, `test/plan.test.ts`, `test/git.test.ts`, `test/flags.test.ts`, `test/config.test.ts`
- `test/oracle/assassinrpg.expected.ts` (the hand-checked expected flag set for assassinrpg, the acceptance oracle)
**Verification:** `npm test` green (parsers, discovery, precedence, git, flags, config against the frozen fixtures) and `npm run typecheck` clean. `npm run acceptance` against the real `C:\Users\atk67\Documents` prints all six marked repos (assassinrpg, bakingapp, capsulecastle, git-gud-security, godot-mcp, object-permanence) as full cards, the git-only repos on the untracked shelf, and nothing for non-project folders. The flag output matches `test/oracle/assassinrpg.expected.ts`, whose non-negotiable anchor is **cursor bloat crit** on assassinrpg (active-thread section about 170 lines, budget 40, over the 80 crit line). The lenient NOW.md path is exercised for real: no repo on disk has emitted a `state.json` yet, so today the entire live fleet resolves through the NOW.md parser (this is why the design calls it a first-class citizen, section 12).
**Exit criteria:** `npm test` and `npm run typecheck` pass; the acceptance scan reproduces the assassinrpg oracle including cursor-bloat crit; parse failure returns a `raw-fallback` result rather than throwing or emitting a stale parse; state.json precedence, null-section tolerance, and unknown-field tolerance are covered by tests; the only flag not fully locked is stalled-plan, pending Open Questions 1 and 2.
**Blockers:** Open Questions 1 and 2 gate the stalled-plan rule and its oracle line only. Preconditions (scaffold, gantry:init) must be done first.
**Wires:** `scripts/acceptance.ts` is the live caller that drives the core over the real fleet in-phase; the window UI wires the same core in phase 2, so the core is reachable, not dead.

## Phase 2: Window, read-only

**Status:** pending
**Goal:** The fleet and detail views render a one-shot scan of the real fleet, opening to correct settled state, with evidence links and the raw-fallback card state.
**Files:**
- `src/adapters/tauri.ts` (Tauri impls of the phase-1 ports: git via the shell/command plugin, fs reads, data-dir path; wired into `scan.ts` so the same core runs in the app)
- `src-tauri/` Rust courier: git shell-out command, filesystem read command, single-instance focus, `tauri.conf.json`, `Cargo.toml` deps for the fs and shell plugins and window
- `src/main.ts` (app entry: run a scan, hand the snapshot to the store, render)
- `src/ui/store.ts` (one plain store object per the unwoven render discipline)
- `src/ui/render.ts` (rebuild a card's DOM only when that card's data changed; event delegation on the container)
- `src/ui/router.ts` (hash-state router for fleet / detail / settings)
- `src/ui/views/fleet.ts`, `src/ui/views/detail.ts` (the two surfaces from the section-8 mockups; vocabulary-corrected copy under the prose rules)
- `src/ui/evidence.ts` (a flag or a line clicks through to the lines, dates, or commits it was computed from)
- `src/ui/styles.css`
- `test/render.test.ts` (render() rebuilds only changed cards; raw-fallback renders "could not parse, showing raw" with the raw file and drops no section)
- as-built amendments (phase-2 review): the `shippedRecent` feed required core additions (`model.ts`, `parse/counts.ts` parseShippedRecent, `scan.ts`) because the UI only receives the finished snapshot and the section-8 detail feed needs entry text, not counts; `src/ui/views/settings.ts` landed now as an inert labeled placeholder because the in-scope router and header expose the settings route; shared view bits live at `src/ui/views/evidence.ts`; the dev fixture mode (`src/adapters/fixture.ts`, `scripts/snapshot.ts`, gitignored `public/dev-fleet.json`, `npm run snapshot`) is the browser verification surface, provenance-labeled "frozen scan" so it never masquerades as live; single-instance focus moved wholly to Phase 3 where the resident model it serves lands
**Verification:** `npm test` green including `test/render.test.ts`; `npm run typecheck` clean; `npm run tauri:dev` opens the window against the real fleet and shows the settled state, with the six marked repos as full cards, assassinrpg carrying cursor-bloat crit at about 170 lines, quiet projects collapsed to the shared row, and the untracked shelf populated. Manual pass condition: sort order (active session on top, then `●`/`◐`/`○` by recency), one-screen layout, a flag clicks through to its evidence, and a deliberately malformed NOW.md fixture renders the raw-fallback card rather than a crash or a silent drop.
**Exit criteria:** the window opens to the correct settled state for the real fleet with no console errors; every flag and every visible number is evidence-linked; the raw-fallback state is reachable and correct; card copy passes the prose-rule checklist.
**Blockers:** none beyond Phase 1. Detail-view remedy strings must be ClauDHD/Gantry commands, never in-app buttons (section 8).
**Wires:** the Tauri window renders the phase-1 core's one-shot scan; `src/adapters/tauri.ts` wires the git and fs ports to the Rust courier. The resume split-button and capture are stubbed as inert here and wired in phase 5.

## Phase 3: Watcher plus memory

**Status:** pending
**Goal:** A resident watcher keeps the store live from fs events and a light git poll, revalidates on focus, and persists the last-open snapshot and event history so the since-last-open diff and provenance line are honest across sleep and quit.
**Files:**
- `src-tauri/` courier additions: fs-watch on the roots (official plugin), a periodic git-poll trigger, static tray with a quit item, single-instance focus, window close-to-tray
- `src/core/persistence.ts` (the `%APPDATA%\object-permanence\` folder: `config.json` already there, `snapshot.json` last-open, `history.jsonl` append log location defined here; data-dir comes from the `DataDir` port so tests use a temp dir)
- `src/core/diff.ts` (since-last-open diff computed from the persisted snapshot; states the gap out loud when the watcher was down)
- `src/core/revalidate.ts` (mtime revalidation and reconcile on focus; reports "revalidated clean" or what it found)
- `src/ui/provenance.ts` (the top line: repo count, active session, last event time, watcher start time, last revalidation result)
- `src/ui/views/fleet.ts` (add the since-last-open block and provenance line)
- `test/persistence.test.ts`, `test/diff.test.ts`, `test/revalidate.test.ts`
**Verification:** `npm test` green including the three new suites (snapshot round-trips through a temp data dir; diff against a stale snapshot reports the gap; revalidation detects a changed mtime that no fs event delivered); `npm run typecheck` clean; `npm run tauri:dev` runtime check: edit a watched NOW.md and the card updates without a manual rescan; blur then refocus the window and the provenance line reports "revalidated clean" or the reconciled change; close to tray and the watcher plus static tray icon stay up, quit from the tray writes the snapshot; on next launch the since-last-open block reflects the real gap.
**Exit criteria:** fs events drive incremental updates, the git poll covers unpushed counts fs cannot see, focus revalidation reconciles dropped events and reports honestly, the baseline writes on focus loss only plus a one-time boot seed (close-to-tray is covered because hiding blurs; polls and fs events never advance it; see the amended section-12 resolution in the design doc), "last open" anchors to the last time the window gained focus, and a watcher-down gap is stated rather than hidden.
**As-built amendments (phase-3 review):** persistence runs through a new write-capable `AppStore` port scoped to the data folder (bare filenames only), not the read-only `DataDir` path idea; `src/ui/provenance.ts` folded into `fleet.ts` (fleetHeaderHtml + sinceLastOpenHtml); integration touched `ports.ts`, `adapters/tauri.ts`, `core/scan.ts` (scanOneProject + withCard), `main.ts`, `ui/store.ts`, `ui/render.ts`, `ui/styles.css`, `test/helpers.ts` (memStore), `test/discovery.test.ts`; quit from tray deliberately does not flush (baseline stays the last-looked-at state, which is the honest value).
**Blockers:** none beyond Phase 1. Windows watchers drop events; the focus revalidation is the designed mitigation, not optional (section 13).
**Wires:** fs-watch, git-poll, and focus-revalidate wire the store to live updates; the tray menu wires explicit quit; the persisted snapshot wires the since-last-open diff on launch.

## Phase 4: Flags live plus fire-rate log

**Status:** pending
**Goal:** Every flag transition is recorded to the event history with its evidence snapshot, severity drives visual weight, and the fleet wip-spread banner renders, so the two-week tuning pass argues from fire rates.
**Files:**
- `src/core/history.ts` (append a flag transition, raised / cleared / severity change, with its evidence snapshot to `history.jsonl`; read back for display)
- `src/core/flags.ts` (diff the current flag set against the prior snapshot to detect transitions; emit them to history)
- `src/ui/render.ts` (crit and warn badge the card, info is a dim dot; severity gates only visual weight in v1)
- `src/ui/views/fleet.ts` (the wip-spread banner above the cards when 3+ repos are dirty at once)
- `src/ui/history-view.ts` (surface the fire-rate history behind the evidence click)
- `test/history.test.ts`, `test/transitions.test.ts`
- **As-built amendments (phase-4 review):** transition detection lives in `src/core/history.ts` (computeTransitions), keeping `flags.ts` pure flag computation; the view is `src/ui/views/history.ts` per the established views/ layout; `transitions.test.ts` folded into `test/history.test.ts`; wiring touched `src/main.ts` (recordTransitions at both adoption points, lazy history load), `src/ui/router.ts` (#/history routes), `src/ui/store.ts` (history state). Boot records nothing (standing state never inflates fire counts); a vanished project is unobserved, never a burst of cleared flags; fleet flags transition under the project name "fleet".
**Verification:** `npm test` green including transition detection (a flag raised then cleared across two snapshots appends exactly two history entries with evidence) and history append/read; `npm run typecheck` clean; `npm run tauri:dev` runtime check: force a threshold in `config.json` low enough to raise then clear a flag on a real repo and confirm the transition lands in `history.jsonl` with its evidence snapshot; with three repos dirty at once the wip-spread banner shows and names them, matching the dirty repos on the untracked shelf (section 8 exhibit coherence).
**Exit criteria:** transitions are recorded with evidence and survive restart, severity rendering matches the mockups, the wip-spread banner fires at the configured count and its named repos agree with the shelf, and thresholds are honored live from `config.json`.
**Blockers:** none beyond Phase 1. If Open Question 1 or 2 is still unresolved, the stalled-plan flag records no transitions until its rule is locked; every other flag is live.
**Wires:** flag transitions wire into the phase-3 history store; the wip-spread banner wires into the fleet view.

## Phase 5: Capture plus launcher plus packaging

**Status:** pending
**Goal:** The global hotkey opens the capture popover that appends one line to a project's IDEAS.md, the resume split-button launches configured command templates, and the app ships as a per-user NSIS installer.
**Files:**
- `src-tauri/` courier additions: global shortcut registration (default Ctrl+Alt+A) with a startup success/failure result surfaced to the frontend; launch a command template as a detached process and report failure; NSIS bundle config in `tauri.conf.json` (per-user, start menu entry, taskbar-pinnable, no auto-updater)
- `src/ui/views/capture.ts` (the popover: project picker defaulting to the last active project, `enter` save, `esc` cancel, the writes-preview line)
- `src/core/capture.ts` (append one line to the chosen IDEAS.md Inbox in the exact `idea.js` shape `- [ ] YYYY-MM-DD HH:MM (while: out-of-session) <text>`, atomic write-temp-then-rename, append-only, never edits existing lines)
- `src/core/launcher.ts` (`{path}` substitution into the four config templates; report a missing executable or a failed launch rather than silently doing nothing)
- `src/ui/views/detail.ts` (wire the resume split-button and open-folder to the launcher; settings pane reports hotkey registration failure)
- `src/ui/views/settings.ts` (config surface: roots, ignore, hotkey, launcher templates, thresholds; reports the capture-channel armed state honestly)
- `test/capture.test.ts` (the appended line matches the idea.js shape and the `- [ ] YYYY-MM-DD` prefix that state.json's ideas parse reads; append is atomic and preserves existing lines), `test/launcher.test.ts` (template substitution and the failure-reporting path)
**Verification:** `npm test` green including capture and launcher suites; `npm run typecheck` clean; `npm run tauri:dev` runtime check: the hotkey opens the popover, a capture appends the correctly shaped line to the chosen IDEAS.md (verified by re-reading the file) and to no other file, a taken hotkey combo makes the settings pane say the channel is not armed, the resume default launches `wt` with claude at the repo, a template with a missing executable is reported not swallowed; `npm run tauri:build` produces the per-user NSIS installer.
**Exit criteria:** capture is the only write the app makes to any project file and it matches the ClauDHD ideas contract exactly, launcher failures and hotkey-registration failure are reported (never a silent no-op), the installer installs per-user with no admin prompt, and config/history/snapshot live only in `%APPDATA%\object-permanence\`.
**Blockers:** none beyond Phase 1.
**Wires:** the global shortcut wires the capture popover, which wires the IDEAS.md append; the detail-view split-button wires the resume launcher; the NSIS config wires the release bundle.

## Cross-cutting concerns

1. **config.json schema and defaults (spans phases 1, 3, 5).** Defaults live in `src/core/config.ts` and a missing or partial file is filled tolerantly (additive, forward-compatible). First run writes the defaults to `%APPDATA%\object-permanence\config.json`. Thresholds are the section-6 values and are tunable without rebuild:
   ```json
   {
     "roots": ["C:\\Users\\atk67\\Documents"],
     "scanDepth": 1,
     "ignore": [],
     "stateJsonMaxLagDays": 1,
     "hotkey": "Ctrl+Alt+A",
     "launcher": {
       "resume": "wt -d \"{path}\" powershell -NoExit -Command claude",
       "continueLast": "wt -d \"{path}\" powershell -NoExit -Command \"claude -c\"",
       "terminalOnly": "wt -d \"{path}\"",
       "openFolder": "explorer \"{path}\""
     },
     "thresholds": {
       "cursorBloatWarn": 40, "cursorBloatCrit": 80,
       "cursorStaleWarnDays": 2, "cursorStaleCritDays": 5, "unwrappedMinHours": 3,
       "queueBudget": 5, "quickFixDefaultCap": 3, "looseEndsBudget": 5,
       "ideasPressureWarn": 20, "ideasPressureCrit": 40,
       "shippedDroughtDays": 10, "shippedDroughtMinCommits": 5,
       "uncommittedWarn": 5, "unpushedWarn": 3, "unpushedCrit": 10,
       "idleDays": 7,
       "stalledPlanCommits": 10, "stalledPlanDays": 7,
       "auditStaleDays": 30, "wipSpreadRepos": 3
     }
   }
   ```
   `quickFixDefaultCap` is the fallback when the file does not declare its own cap; the file's self-declared cap wins. Ordering: the schema and thresholds must be defined in Phase 1 (the flag engine reads them); launcher and hotkey keys are consumed in Phase 5; roots and ignore in Phase 1 discovery. Rollback: delete the folder and defaults regenerate.

2. **The `%APPDATA%\object-permanence\` data folder (spans phases 1, 3, 4).** Holds `config.json`, `snapshot.json` (last-open), and `history.jsonl` (flag transitions). It is the app's entire memory and the only place it writes besides the single capture append. The path resolves through the `DataDir` port so vitest writes to a temp dir, never the real `%APPDATA%`. Ordering: config in Phase 1, snapshot and history-file location in Phase 3, history appends in Phase 4. Rollback: deleting the folder resets memory with no other effect.

3. **External contract consumed: ClauDHD state.json v1 (Phase 1, ripples to every later phase's data).** The core reads `.now/state.json` (schemaVersion 1) as the primary source and must tolerate null sections (checkpoint.js writes nulls when a source file is absent) and ignore unknown fields (additive schema). Load-bearing reality: no repo on disk has emitted a state.json yet, so the lenient NOW.md parser is the live path for the whole fleet today, not a fallback. The NOW.md parser must reproduce `nowfile.js` semantics exactly (notably `activeThreadLineCount` measured from the `## Active thread` heading through the last non-blank line before the next `## `, with `### ` not closing the section, and the heading matched by `startsWith("## Active thread")` since the real file reads `## Active thread (only one)`). Migration/rollback: none; this is read-only consumption. If ClauDHD bumps schemaVersion, revisit precedence and the reader.

4. **External format written: the IDEAS.md capture append (Phase 5, the single project-file write).** The appended line must match `idea.js` exactly, `- [ ] YYYY-MM-DD HH:MM (while: out-of-session) <text>`, because state.json's ideas parse keys the untriaged count and the ideas-age date off the `- [ ] YYYY-MM-DD` prefix; a differently shaped line silently breaks ClauDHD's ideas math. Append-only, atomic write-temp-then-rename, into the `## Inbox` section, never editing existing lines. This is the only write to any project file in v1. Rollback: the line is a normal IDEAS.md entry the user can delete.

5. **Gantry sentinel additive fields (Phase 1).** The real `.gantry/active-phase.json` carries `files`, `allow`, and `session` beyond the design's stated `plan`/`phase`/`started`. Read the three named fields and ignore the rest, same additive tolerance as state.json, so a richer sentinel does not break plan discovery.

6. **Honesty and error contract (spans all phases).** Parse failure is a first-class result from Phase 1 (`ParseStatus` raw-fallback with a reason), rendered in Phase 2 as "could not parse, showing raw" with the raw file and no dropped section; it never shows a prior parse as current. The provenance line (Phase 3) states repo count, active session, last event time, watcher start time, and revalidation result, and a watcher-down gap is stated out loud. Launcher failure and hotkey-registration failure (Phase 5) are reported, never a silent no-op. Every number is evidence-linked (Phase 2). A wrong number shown as settled is the double-weighted kill-criterion failure, so these surfaces are not optional polish.

7. **Prose and vocabulary rules (every phase that emits copy: 2, 4, 5).** All UI strings, flag summaries, remedy text, and settings copy follow the global prose rules: no em-dashes, no AI-tell constructions (no "not X but Y", no rhetorical three-beat lists, no tagline closers), no emoji, lowercase-friendly and terse. The vocabulary rule (section 2) coins zero new terms and names the mechanism under each word (checkpoint, never heartbeat; cursor, thread, wrap, triage, plan, phase, audit, dirty, unpushed). Remedies are always ClauDHD/Gantry commands, never in-app actions. This is a review-checklist item on every phase that touches copy.

8. **Build and packaging config (Precondition and Phase 5).** The Tauri scaffold and `.gitignore` additions land in the preconditions; the NSIS per-user bundle config (start menu entry, taskbar-pinnable, no admin prompt, no auto-updater) lands in Phase 5's `tauri.conf.json`. Updating is rebuild plus reinstall from this repo, by design (section 11).

9. **Port/adapter seam (Phase 1, consumed in Phase 2).** The core depends on `GitRunner`, `FileSystem`, `Clock`, and `DataDir` interfaces only. The node adapter fills them for vitest and the acceptance script; the Tauri adapter fills them in the app (git through the Rust shell-out, fs through the plugin). This is what lets Phase 1 be node-testable without the shell while the same core runs unchanged in the window. Any core module importing `@tauri-apps/api` at module scope breaks the node tests and is a review flag.
