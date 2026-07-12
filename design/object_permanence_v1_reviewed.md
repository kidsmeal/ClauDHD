# Object Permanence v1

Status: LOCKED 2026-07-12 (design review complete, all decisions resolved by the user)

Design locked from the founding grill session, 2026-07-11. This doc is the contract for the v1 build. Everything below was resolved with the user in that session or in the review resolution pass of 2026-07-12. No open markers remain.

## 1. What it is

A Windows desktop tool that watches every ClauDHD/Gantry project on this machine and re-orients the user when they open it: what was i doing, whats next, what drifted. It reads the files those tools already write. It is a lens with a memory: in v1 it makes exactly one write to a project file (idea capture, section 9) and otherwise only maintains its own data folder (section 7). It never modifies existing project files.

The name is the point. Projects stop existing for an ADHD brain when the terminal closes. This app is where they keep existing.

Motivating exhibit: `assassinrpg/NOW.md` grew to 251 lines, its single `## Active thread` section alone running about 170 of them against the roughly 40-line budget that section is meant to hold, carrying four fully shipped bundles inline. The cursor stopped being a cursor and nothing said so. This app says so.

### Kill criteria

Two weeks of real use, two questions:

1. Did he actually open it at session starts and project switches?
2. Did it ever re-orient him wrong?

A no on the first or a yes on the second kills the project, same bar that killed Compass Rose and Cartographer. A trust failure (wrong data shown as settled) counts double. The flag fire-rate log (section 6) is the evidence for the verdict.

## 2. Vocabulary rule

The app coins zero new terms. Every word on screen names the mechanism under it:

- ClauDHD words: cursor, thread, wrap, triage, checkpoint, quick fixes, loose ends, queue
- Gantry words: plan, phase, audit
- Git words: dirty, unpushed, branch, commit, clean tree
- Plain description: session, watcher, rescan, since last open

"Heartbeat" was explicitly rejected. The file is written by checkpoint.js, so it is called a checkpoint. This extends the user's no-metaphor prose rule to product vocabulary. All UI copy also follows the global prose rules: no em-dashes, no AI-tell constructions, no emoji.

## 3. Scope

### v1 is

- Discovery and continuous watching of all projects under the configured roots
- The fleet view and project detail view, opening instantly to settled state
- Eleven drift flags with evidence links and a fire-rate history
- Since-last-open diff
- Idea capture via global hotkey (the single write)
- Resume launcher (configurable command templates)

### Non-goals, decided

- **No push UI.** No toasts, no always-on-top widget, no tray notifications. Rejected by the user directly. The only nudge channel is the ClauDHD 0.9 statusline flag, which lives in the terminal where he already looks. The tray icon is static.
- **No Windows autostart.** Start is always manual. Rejected directly.
- **No GUI editing of project files.** Triage, wrap, roadmap ordering all stay chat rituals in the session. The remedies the app suggests are always ClauDHD/Gantry commands, never buttons.
- **No talk-to-claude client.** Parked in the founding session: rebuilding session management, streaming, and permissions is a product of its own with high obsolescence risk. The resume launcher covers the need.
- **Deferred flags:** deploy-behind-main (needs per-project opt-in config, v1.5 candidate), forgotten branches (he works mainline), roadmap-now mismatch and ideas-age/roadmap-age promotion (now measurable via 0.9, revisit after the two-week verdict).

## 4. Data sources

Per project, read-only:

| source | gives |
|---|---|
| `.now/state.json` | the primary contract (ClauDHD 0.9, schemaVersion 1): cursor facts (activeThread, activeThreadLineCount [the `## Active thread` section length, not the file], nextAction, lastTouched, queueCount, quickFixCount), ideas (total, untriaged, oldestUntriagedDate), shipped (total, lastEntryDate), roadmap (count, topItem), git block, generatedAt, branch |
| `.now/last-session.md` | the checkpoint: stop time, branch, active thread text, uncommitted list, diffstat, recent commits |
| `NOW.md` | lenient markdown parse, fallback when state.json is absent or stale; also the source for section budgets (Queue, Quick fixes with its self-declared cap, Loose ends; state.json has no loose-ends count, so that one is always parsed here) and non-template section names for bloat evidence |
| `IDEAS.md`, `SHIPPED.md`, `ROADMAP.md` | fallback counts when no state.json; raw display in detail view |
| Gantry plan files + `.gantry/active-phase.json` | the sentinel (written by gantry:build before a phase's first edit, gitignored, fields plan/phase/started) is the authoritative active-plan source when present; plan files found by recursive glob give checkbox phase progress (see stalled plan, section 6) |
| `docs/CURRENTNESS_AUDIT.md` | mtime for the audit-stale flag; Gantry writes it under `docs/` when the project has one, else at the project root |
| git (shelled out) | branch, dirty count, unpushed count, last commit, commit dates and touched paths for the drought window |
| `CLAUDE.md` | first H1 heading as the human project title; folder name when absent |

Precedence: state.json when present and its generatedAt is not older than NOW.md's mtime by more than one day; otherwise lenient parse, and the card labels which source it is showing. Unknown state.json fields are ignored (additive schema). (The one-day staleness window is a placeholder; put it in config.json alongside the flag thresholds.)

### Trust rules (behavioral, not aspirational)

- Every number on screen is evidence-linked: clicking a flag or a since-last-open line opens the lines, dates, or commits it was computed from.
- Parse failure is loud and local: a NOW.md shape the parser does not know renders that card with a "could not parse, showing raw" state and the raw file. It never shows a previous parse as current and never silently drops a section.
- The provenance line at the top of the window states what the watcher knows: repo count, active session if any, last event time, watcher start time, and whether the last focus revalidation was clean.
- If the watcher was down (machine slept, app quit), the since-last-open diff is computed from the persisted snapshot and says the gap out loud.

## 5. Discovery

- Config holds a root list, default `C:\Users\atk67\Documents`, scanned one level deep only.
- A folder is a project if it contains `.git` or `NOW.md`.
- Projects with a ClauDHD-marked NOW.md (the `<!-- claudhd` opt-in marker) get full cards. Git-only repos land on the untracked shelf: name, dirty/unpushed counts, an init nudge. A folder that has a NOW.md without the marker and no `.git` is discovered but shown nowhere; everything with neither `.git` nor `NOW.md` is invisible.
- An ignore list in config is the escape hatch (archived experiments off the shelf). Empty by default.
- No per-project registration anywhere. A new repo appears on the next scan or watch event.

## 6. Flags

Three severities. **crit** and **warn** badge the card; **info** is a dim dot. Severity gates nothing except visual weight in v1 (there are no notifications to gate); the crit tier is kept because a future Object Permanence notification channel would key off it. ClauDHD's own statusline computes its `[over]`/`[drift]`/`[stale]` flags from state.json independently and does not read this severity.

| flag | measures | warn | crit |
|---|---|---|---|
| cursor bloat | active-thread line count = state.json `activeThreadLineCount`, the `## Active thread` section only, not the whole file; evidence lists non-template subsections by name | > 40 | > 80 |
| cursor stale | activity (commits, checkpoints) dated after NOW.md "Last touched"; info tier "unwrapped" when a session ended 3+ hours ago past the cursor date | 2+ days | 5+ days |
| dead cursor | commits/checkpoints exist while the active thread is the template placeholder or empty | warn | never |
| section budgets | Queue > 5; Quick fixes > the cap the file itself declares (default 3 if undeclared, the ClauDHD template default); Loose ends > 5 | warn | never |
| ideas pressure | untriaged inbox lines, state.json `ideas.untriaged` (the `- [ ]` count) | > 20 | > 40 |
| shipped drought | no SHIPPED entry in 10+ days while the repo had 5+ commits in the window | the base case | those commits touch only design/docs paths |
| debt | uncommitted files / unpushed commits | > 5 / > 3 | never / > 10 |
| idle | no checkpoint and no commit for 7+ days | info only | never |
| stalled plan | a Gantry plan with unchecked phases while the repo moved 10+ commits or 7+ days past its mtime; discovery per the resolution note below | warn | never |
| audit stale | docs/CURRENTNESS_AUDIT.md older than 30 days in an otherwise active repo | info only | never |
| hooks not firing | ClauDHD marker present and commits recent, but .now/ missing or the checkpoint is days older than the last commit; all other flags on that project display as suspect | warn | never |

Debt resolution (2026-07-12): uncommitted is warn-only. A dirty tree is the normal working state; the debt that stacks silently is unpushed commits, so crit belongs to unpushed alone.

Plan discovery resolution (2026-07-12): `.gantry/active-phase.json` is authoritative when present. gantry:build writes it (fields plan, phase, started) before a phase's first edit and it is gitignored and transient, so a sentinel that exists and has gone old is itself the stalled-phase signal; it survives exactly the abandonment it detects. For plans with no sentinel, a recursive scan for `*-plan.md` and `*.plan.md` (skipping .git, .now, .gantry, node_modules, dist) covers the real layouts on disk (bakingapp plans/, assassinrpg design/loop_v2/, godot-mcp docs/design/, Gantry docs/), with checkbox counts giving phase progress.

Fleet-level: **wip spread**, 3+ repos dirty at once, one banner above the cards, warn.

All thresholds are placeholders in config.json, tunable without rebuild. Every flag transition (raised, cleared, severity change) is appended to the local event history with its evidence snapshot, so week-two tuning argues from fire rates, never vibes.

## 7. Architecture

Tauri 2 shell, Vite + vanilla TypeScript frontend. The Rust side is a courier: fs watching (official plugins), shelling out to git, tray, global shortcut, window management. All logic lives in TS.

- **Silent resident watcher.** Started manually, never with Windows. Launching opens the window and starts the watcher. Closing the window leaves the watcher and static tray icon up; quit is explicit from the tray menu. Single instance: a second launch focuses the window.
- **Watch + revalidate.** fs events on the watched roots drive incremental updates; a light git poll covers what fs events cannot see (unpushed counts). Windows watchers drop events, so the window revalidates mtimes on every focus and reconciles, reporting "revalidated clean" or what it found in the provenance line.
- **Persistence.** One folder, `%APPDATA%\object-permanence\`: config.json, the event history, and the last-open snapshot (for the since-last-open diff). Delete the folder and its memory is gone. Beyond this folder and the single capture append (section 9), it writes nothing.
- **Render pattern.** The unwoven discipline: one plain store object; events mutate it and call render(); render() rebuilds a card's DOM only when that card's data changed; event delegation on the container; hash-state router for fleet/detail/settings. No framework.

## 8. UI

Three surfaces. Mockups are the approved layout (2026-07-11), vocabulary corrected.

### Fleet view (what opens)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ OBJECT PERMANENCE                                   [rescan]  [settings] │
│ watching 15 repos · no session active · last checkpoint 07-10 22:14      │
│ watcher up since 09:12 · revalidated clean on focus                      │
├──────────────────────────────────────────────────────────────────────────┤
│ SINCE LAST OPEN (thu 20:41, 2 days)                                      │
│  + ClauDHD shipped v0.9.0 (state.json, cursor budget, statusline flag)   │
│  ~ assassinrpg: unwrapped session, checkpoint now 2d past its cursor     │
├──────────────────────────────────────────────────────────────────────────┤
│ [!!] fleet: 3 repos dirty at once (humanizer, Github, gantrybench)       │
├──────────────────────────────────────────────────────────────────────────┤
│ ◐ assassinrpg                                             main · 2d ago  │
│   now   the Loom, the living lore engine                                 │
│   next  user tests Loom v1 in browser (pushed, NOT deployed)             │
│   [!!!] cursor bloat 170 ln   [!] unwrapped 2d   clean tree · ↑0         │
│                                                                          │
│ ◐ git-gud-security                                        main · 4d ago  │
│   now   (active thread)          next  (next action)                     │
│   no flags · clean · ↑0                                                  │
│                                                                          │
│ ○ godot-mcp · ○ capsulecastle · ● object-permanence      (collapsed ▸)   │
├─ untracked (git, no claudhd) ────────────────────────────────────────────┤
│ ClauDHD ↑0 · humanizer dirty 2 · Github dirty 1 · gantrybench dirty 3    │
└──────────────────────────────────────────────────────────────────────────┘
```

Exhibit coherence (resolved 2026-07-12): the banner's three dirty repos (humanizer, Github, gantrybench) are the same three the shelf shows dirty, and the header timeline agrees with the flags below it (no session active, last checkpoint 07-10 22:14, cursor touched 07-08, so unwrapped reads 2d).

Rules: cards sort by user recency, active session on top. `●` active today, `◐` this week, `○` older. Quiet projects collapse to one shared row so the window stays one screen. Every flag and since-last-open line clicks through to evidence.

### Project detail

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ← fleet    ASSASSINRPG (the unwoven)        [open folder]  [resume ▾]    │
│ main · clean tree · ↑0 · last commit 3d "prose style guide shipped"      │
├─ cursor · NOW.md touched 2026-07-08 ─────────────────────────────────────┤
│ now    the Loom, the living lore engine                                  │
│ next   user tests Loom v1 in browser (pushed, NOT deployed)              │
│ queue 2 · quick fixes 0/5 · loose ends 2                                 │
├─ flags ──────────────────────────────────────────────────────────────────┤
│ [!!!] cursor bloat: active thread 170 ln, budget 40             [hide ▾] │
│       4 grown sections: parked story design, npc textgen, cleanup        │
│       index, build bundles. run /claudhd:wrap to migrate them out.       │
│ [!]   unwrapped: last checkpoint 07-10 22:14 · cursor touched 07-08      │
├─ pipeline (gantry) ──────────────────────────────────────────────────────┤
│ plan  textgen_loom_rebase · phase 0/3 · untouched 8d          [!!] stall │
│ audit CURRENTNESS_AUDIT.md 21d old                                       │
├─ recent shipped ─────────────────────────────────────────────────────────┤
│ 07-08  prose style guide, wired into CLAUDE.md + loom keeper             │
├─ backlog ────────────────────────────────────────────────────────────────┤
│ ideas 14 (9 untriaged, oldest 06-15) · roadmap 6 next / 4 later          │
│ roadmap top: evolution stage B (the reading teaches lore)                │
└──────────────────────────────────────────────────────────────────────────┘
```

Remedies shown in flag evidence are always commands for the session (`/claudhd:wrap`, `/claudhd:triage`, `/gantry:audit`), never in-app actions. The human title ("the unwoven") comes from the first H1 of the project's CLAUDE.md, folder name when absent (resolved 2026-07-12; source row added in section 4).

### Capture popover

```
          ┌─ capture ────────────────────────────────────────────────┐
          │ to: [ bakingapp ▾ ]                        ↑↓ ↹ to switch │
          │ ________________________________________________________ │
          │ writes: - [ ] 2026-07-11 14:30 (while: out-of-session) .. │
          │ enter save · esc cancel                                  │
          └──────────────────────────────────────────────────────────┘
```

## 9. Capture (the single write)

- Global hotkey **Ctrl+Alt+A**, configurable. Note: Ctrl+Alt doubles as AltGr on some international layouts; non-issue on US layout, and the config covers it.
- If registration fails at startup (combo taken), the settings pane says so. The app never pretends a capture channel is armed when it is not.
- The popover appends one line to the chosen project's IDEAS.md Inbox, matching the structure `idea.js` writes: `- [ ] YYYY-MM-DD HH:MM (while: out-of-session) <text>`. `idea.js` stamps both date and time via `stampNow()` and tags the line with the active thread; a capture from Object Permanence has no active thread, so the while-value is fixed to `out-of-session` by design. The `YYYY-MM-DD` date sits directly after the checkbox, which is what state.json's ideas parse reads, so ideas-age math keeps working.
- Project picker defaults to the last active project. Append-only, atomic (write temp, rename), never edits existing lines. This is the only write the app performs on any project file.

## 10. Resume launcher

Principle: continuity lives in the cursor, not in an old conversation. Default resumes fresh and lets the ClauDHD SessionStart brief orient the session at zero extra token cost; the continue-last option below is there for the rarer case where a live conversation is worth reattaching.

Split button on the detail view; all entries are command templates in config.json with `{path}` substitution:

| action | default template |
|---|---|
| resume (default) | `wt -d "{path}" powershell -NoExit -Command claude` |
| continue last conversation | `wt -d "{path}" powershell -NoExit -Command "claude -c"` |
| terminal only | `wt -d "{path}"` |
| open folder | `explorer "{path}"` |

The shell stays alive under claude so the session end leaves a prompt at the repo for the git sweep. The default templates assume Windows Terminal (`wt`) and `claude` are on PATH; if a template's executable is missing or the launch otherwise fails, the app reports it rather than silently doing nothing, the same honesty rule capture registration follows. If Claude Code Desktop ever documents a project deep link, it becomes a fifth template entry; the design does not depend on it.

## 11. Packaging

- Tauri NSIS per-user installer: no admin prompt, start menu entry, taskbar-pinnable. No auto-updater; updating is rebuild + reinstall from this repo.
- Config, history, and snapshot live only in `%APPDATA%\object-permanence\`.

## 12. Build phasing (input to the plan)

1. **Core read layer, headless.** Discovery, state.json + lenient parsers, git reads, the store, flag computation. Node-testable without the shell. Exit: parses all the ClauDHD-marked projects under the root correctly, flags match hand-checked expectations for assassinrpg.
2. **Window, read-only.** Fleet + detail views over a one-shot scan, render pattern, evidence links, raw-fallback card state. Exit: opens to correct settled state for the real fleet.
3. **Watcher + memory.** fs events, git poll, focus revalidation, event history, since-last-open snapshot and diff, provenance line, tray residency. Snapshot semantics (resolved 2026-07-12): the last-open snapshot writes on window close-to-tray and on app quit; "last open" anchors to the last time the window gained focus.
4. **Flags live + fire-rate log.** Transitions recorded with evidence snapshots; severity rendering; wip-spread banner.
5. **Capture + launcher + packaging.** Hotkey, popover, append write, resume templates, NSIS installer.

Each phase gates through Gantry (build, review, user commit). Phase 1 needs `gantry:init` run on this repo first, since conventions and a test command will exist from that phase on.

## 13. Risks named

- **Windows fs watcher reliability.** Mitigated by focus revalidation and honest provenance, designed in from phase 3.
- **NOW.md shape drift.** The lenient parser will meet files the template never predicted (the 251-line exhibit). Mitigated by the raw-fallback card state; a parse failure is a visible state, never a crash or a silent omission.
- **Nag fatigue.** Even without notifications, a fleet view full of stale warnings trains the eye to skip them. Mitigated by the fire-rate log feeding the two-week tuning pass, and by thresholds being config edits.
- **The 0.9 contract is one day old.** state.json shipped 2026-07-11 and has processed few real Stops. Phase 1 treats the lenient parser as a first-class citizen, never a stub.
- **Gantry plan layout is not standardized.** Resolved for v1 by the sentinel plus recursive glob (section 6). Residual risk: a plan shape neither path finds surfaces as a missing stall flag, never a wrong one.
