# NOW (read me first)

<!-- claudhd: opt-in marker (do not remove) - ClauDHD's hooks only act on a NOW.md that has this line -->

One active thread at a time. This file is the cursor: what is live, the next physical action, and what is queued behind it. Read it first, update it as you go.

_Committed, so it follows your branch: `git checkout` swaps this cursor to that branch's thread._

Last touched: 2026-07-12 (design gate PASSED: reviewer fixed 11 violations incl the 251/170 conflation, user resolved all 3 decisions + 2 pins with "all recs"; contract is `design/object_permanence_v1_reviewed.md`, status LOCKED)

## Active thread (only one)

**v1 design LOCKED, next: founding commit, then the phase plan.** The grill resolved everything: silent tray watcher (manual start, no autostart), trust-on-open (no push UI, no toasts, no widget), 11 flags + wip-spread with crit/warn/info tiers, evidence-linked everything, capture hotkey Ctrl+Alt+A (the single write), resume launcher templates, NSIS per-user packaging, unwoven render discipline. Vocabulary rule: zero coined terms (checkpoint, never heartbeat). ClauDHD 0.9 shipped same day (state.json contract live). Doc: `design/object_permanence_v1.md`.

Next physical action:

- [ ] user says the word: founding commit (scaffold + both design docs), then gantry:init and /gantry:plan on `design/object_permanence_v1_reviewed.md`

Rule: when you finish a step, check it off and write the next single tiny step. Do not start another thread until this one ships or you consciously move it to the Queue.

## Queue (in order, not now)

What is eligible to become active next, in order. Items clear triage's readiness gate before they land here: each is either a ready task (carries a one-line "done" + first action) or a spike (the unknown to resolve before it can be built). Nothing queues as a bare one-liner.

(nothing queued yet)

## Quick fixes (clear in one pass)

Small, self-contained chores that need no plan and aren't worth their own thread. Capped at 3 — overflow means clear some or promote one out, so this stays a batch and never a second backlog. Add with `/claudhd:quick <text>`, clear them in one focused pass with `/claudhd:quick`. The active thread has right of way: clear these between threads, not mid-thread. A fix that turns out to need real thinking gets kicked back to IDEAS.md.

(nothing queued yet)

## Idea flow (do not open a new chat)

New idea mid-task: `/claudhd:idea <text>` records it in IDEAS.md so you can keep working. `/claudhd:harvest` backfills ideas from past sessions you never recorded. `/claudhd:triage` clears the inbox. Finished work is recorded in SHIPPED.md via `/claudhd:shipped`.

## Loose ends

(none yet)

## Leaving this file when you stop

Before you walk away, or whenever you switch context, make the "Next physical action" line true and tiny. That one line is what lets you stop mid-thought and lose nothing. The quick way: run `/claudhd:wrap` and it reconciles this file for you - checks off what's done, writes the next action, and closes out loose ends.
