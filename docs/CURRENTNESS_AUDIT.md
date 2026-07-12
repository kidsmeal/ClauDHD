# Currentness Audit

Last updated: 2026-07-12 (end of the v1 build session)

Purpose: help a future session answer "what is actually current?" before touching an old
plan. This is an audit snapshot, not a reorganization. Prefer correcting this file over
rewriting or moving the older docs. Refresh it with `/gantry:audit`.

## Trust First

The best current anchors. A session can rely on these.

| Area | Current anchor | Current read |
|---|---|---|
| Active implementation | `src/` + `src-tauri/` | v1 complete: all 5 plan phases landed 2026-07-12 (`f16c829`..`e9a7f29`), each through its phase-reviewer gate. Nothing in flight. |
| Codebase lookup | `docs/CONVENTIONS.md` (Layout section) | current as of phase 5; names every core/ui/adapter module and the seam rule |
| Conventions / rules | `docs/CONVENTIONS.md` | authoritative; prose rules, seam rule, render discipline, trust rules |
| Design contract | `design/object_permanence_v1_reviewed.md` | LOCKED; ONE pending-ratification amendment in section 12 (snapshot baseline model, changed under momentum authorization after a reviewer FAIL) awaits the user |
| Plan | `design/object_permanence_v1_reviewed-plan.md` | executed in full; every phase carries an as-built amendments block recording divergences |
| Runtime verification | `docs/RUNTIME_VERIFICATION_QUEUE.md` | one open item (see below) |
| Durable memory | user-level memory (`object-permanence-app.md`) | premise, locked decisions, vocabulary rule, kill criteria |

## Needs Reconciliation

Docs or systems with mixed signals. Name the stale claim and what the code actually shows.

### design/object_permanence_v1_reviewed.md section 12 (phase 3 resolution)
The original user-ratified pin said the baseline "writes on close-to-tray and on quit"; the shipped code writes on focus loss only plus a one-time boot seed, because the phase-3 reviewer proved the original reading let background polls absorb unseen drift (the kill-criterion-2 case). The amendment is marked inline and pending the user's ratification. Read as: the CODE is the current truth; strike the marker once the user ratifies, or reverse the paragraph if he does not.

### design/object_permanence_v1.md (the pre-review draft)
Kept alongside the reviewed contract per convention. Superseded by `object_permanence_v1_reviewed.md` on every point where they differ (251/170 conflation, audit path, capture format, quick-fix cap). Read as: history, never a build source.

## Likely Shipped / Historical

Should not pull attention unless a bug points back here.

| Area | Read |
|---|---|
| The founding grill + design gate (chat session 2026-07-11/12) | decisions all captured in the reviewed contract; the chat is not a build source |
| Section 8 mockups | matched by the shipped views; the running app supersedes them for pixel truth |

## Open doc flags

Written by the review relay when a phase diff made a standing doc stale. Cleared by `/gantry:audit`.
Format: `- [ ] <doc path>: <one line, what the diff invalidated> (phase N, <feature or plan name>)`.

(empty - phase-review doc flags were applied in-commit each phase)

## Deferred review notes

Written by the review relay at the commit gate, one line per Deferred note the phase-reviewer
chose not to fix this phase (pending external API, plan-blessed placeholder, later-phase consumer).
A deferred note is not a dropped note - it lives here until someone clears it. Retire a line when
the work lands or the reason expires; `/gantry:audit` prunes stale ones.
Format: `- [ ] <note, with file:line>: <why deferred> (phase N, <feature or plan name>)`.

- [ ] design section 12 pending-ratification amendment: awaits the user's ratify-or-reverse call (phase 3, watcher + memory)
- [ ] flags.ts unwrapped-rule reading (checkpoint past day-end + min hours vs the plan's day-boundary phrasing): confirm in the week-two fire-rate tuning pass (phase 1/4, flag engine)
- [ ] launcher resume/continueLast templates not live-clicked (they open real claude sessions): clears on first normal use of the split button (phase 5, launcher)
- [ ] launch_detached reports spawn success only; an exe that starts then errors is out of v1 scope by design (phase 5, launcher)

## Rule of thumb
- Roadmap says what to do next.
- Plans say how to do it.
- Design says why it exists and what constraints it obeys.
- Archive says what happened.
- Memory says what must not be forgotten.
