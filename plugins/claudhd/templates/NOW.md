# NOW (read me first)

<!-- claudhd: opt-in marker (do not remove) - ClauDHD's hooks only act on a NOW.md that has this line -->

One active thread at a time. This file is the cursor: what is live, the next physical action, and what is queued behind it. Read it first, update it as you go.

_Committed, so it follows your branch: `git checkout` swaps this cursor to that branch's thread._

Last touched: (set this when you edit the file)

## Active thread (only one)

**(name your current focus here)**

Next physical action:

- [ ] (one tiny step you can start in under a minute)

Rule: when you finish a step, check it off and write the next single tiny step. Do not start another thread until this one ships or you consciously move it to the Queue.

Keep this section lean (about 40 lines): a summary, the live state, and the next action, not a running shipped log. When it grows past that, `/claudhd:wrap` migrates the settled parts out (shipped work to SHIPPED.md, parked or future material to ROADMAP.md or IDEAS.md).

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
