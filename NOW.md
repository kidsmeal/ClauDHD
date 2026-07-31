# NOW (read me first)

<!-- claudhd: opt-in marker (do not remove) - ClauDHD's hooks only act on a NOW.md that has this line -->

One active thread at a time. This file is the cursor: what is live, the next physical action, and what is queued behind it. Read it first, update it as you go.

_Committed, so it follows your branch: `git checkout` swaps this cursor to that branch's thread._

This file is generated (design section 4): the facts below (Mode, Position, from, Counts, Last touched) render from `.now/state.json`, never hand-typed. The Active thread's two lines are the one piece of human prose, prompted at boundaries and persisted as state fields too - so it survives a regeneration without ever being parsed back out of this file.

Mode: design
Position: designing (no doc yet)
from: r-0729-1
Counts: queue 0 · quick fixes 0 · ideas untriaged 6

Last touched: 2026-07-31

## Active thread (only one)

**make ClauDHD legal to work in: the sentinel becomes a record, not a gate**

Next physical action:

- [ ] inventory pre-1.0 commands and scripts from the v0.9.0 tag against 1.0.6's surface, then grill the two halves

Rule: when you finish a step, check it off and write the next single tiny step. Do not start another thread until this one ships or you consciously commit the next one to the roadmap (`/claudhd:roadmap <intent>`) and activate it in its turn (`/claudhd:start <id>`).

Keep this section lean (about 40 lines): a summary, the live state, and the next action, not a running shipped log. Move settled material out as you go: shipped work to SHIPPED.md, parked or future material to ROADMAP.md or IDEAS.md.

## Queue (in order, not now)

What is eligible to become active next, in order. Items clear triage's readiness gate before they land here: each is either a ready task (carries a one-line "done" + first action) or a spike (the unknown to resolve before it can be built). Nothing queues as a bare one-liner.

(nothing queued yet)

## Quick fixes (clear in one pass)

Small, self-contained chores that need no plan and aren't worth their own thread. Capped at 3 — overflow means clear some or promote one out, so this stays a batch and never a second backlog. Add with `/claudhd:quick <text>`, clear them in one focused pass with `/claudhd:quick`. The active thread has right of way: clear these between threads, not mid-thread. A fix that turns out to need real thinking gets kicked back to IDEAS.md.

(nothing queued yet)

## Idea flow (do not open a new chat)

New idea mid-task: `/claudhd:idea <text>` records it in IDEAS.md so you can keep working. `/claudhd:harvest` backfills ideas from past sessions you never recorded. `/claudhd:triage` clears the inbox. Finished work lands in SHIPPED.md automatically at the commit boundary.

## Loose ends

(none yet)

## Leaving this file when you stop

Before you walk away, or whenever you switch context, make the "Next physical action" line true and tiny. That one line is what lets you stop mid-thought and lose nothing. The rest of this file regenerates itself at every commit; only the Active thread's two lines are yours to keep current.
