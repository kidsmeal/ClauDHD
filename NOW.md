# NOW (read me first)

<!-- claudhd: opt-in marker (do not remove) - ClauDHD's hooks only act on a NOW.md that has this line -->

One active thread at a time. This file is the cursor: what is live, the next physical action, and what is queued behind it. Read it first, update it as you go.

_Committed, so it follows your branch: `git checkout` swaps this cursor to that branch's thread._

Last touched: 2026-07-12 (phase 5 SHIPPED, v1 BUILD COMPLETE: capture hotkey proven with real global keystrokes (line shape exact, idea.js contract), launcher live, NSIS per-user installer built. 124 tests. reviewer PASS-WITH-NOTES, fix-nows applied incl the directory-lock parity catch. USER NOTES: design section 12 amendment pending ratification; two-week kill-criteria trial starts at first real use)

## Active thread (only one)

**v1 SHIPPED (all 5 phases through the gantry gates, one momentum session 2026-07-12).** Contract: `design/object_permanence_v1_reviewed.md` (LOCKED, one pending-ratification amendment in section 12). Plan: `design/object_permanence_v1_reviewed-plan.md`. Installer: `src-tauri/target/release/bundle/nsis/Object Permanence_0.1.0_x64-setup.exe`. The two-week kill-criteria trial (design section 1) starts at first real use.

Next physical action:

- [ ] user: install the NSIS build (or run `npm run tauri:dev`), use it at session starts for two weeks, and ratify or reverse the section-12 amendment

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
