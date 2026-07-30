# IDEAS (capture, do not chase)

When an idea comes up mid-task, it is recorded here in one line. Do NOT open a new chat for it; the current thread survives. Triage regularly: each idea is promoted to the NOW.md Queue, kept parked, or dropped. Promotion runs a readiness gate — only ideas ready to act on (or worth a spike to think through) enter the Queue, never a bare one-liner.

Capture: `/claudhd:idea <your idea>` in any chat.
Harvest: `/claudhd:harvest` to backfill ideas from past sessions you never recorded.
Triage: `/claudhd:triage` to review this list.

Legend: `[ ]` new, `[~]` promoted to NOW.md Queue, `[x]` done or dropped.

## Inbox

- [ ] 2026-07-30 05:33 (while: rework app/ to the 1.0 contracts (Object Permanence v2)) BLOCKER: review.md's prescribed commit command can never execute. It says commit as ONE invocation (sentinel.js clear && thread.js clear-mode && git add && git commit) and warns that splitting it makes the reconcile skip the phase-status flip and the roadmap-to-Shipped move. But commit-guard.js is a PreToolUse hook whose decision turns solely on sentinel presence, and it fires before any part of the compound command runs, so it always denies. The documented path is impossible and the only usable path is the one the docs say corrupts the bookkeeping. Fix: the guard must recognize a command that clears the sentinel before committing, or the reconcile must read the phase from the review-log/round record instead of the live sentinel.
- [ ] 2026-07-29 10:53 (while: rework app/ to the 1.0 contracts (Object Permanence v2)) no command owns the cursor's two human lines outside init and design - grep of 1.0.5 commands/ shows set-intent appears only in init.md and design.md, so once a thread is live there is no user-facing way to update the next action; wrap owned this before 1.0 dropped it. Proposal: /claudhd:now <text> sets the next action while bare /claudhd:now keeps showing the board, matching the bare-vs-argument split idea/quick/roadmap already use, and the NOW.md edit-deny message then points at a real command instead of a raw thread.js call.
- [ ] 2026-07-29 10:53 (while: rework app/ to the 1.0 contracts (Object Permanence v2)) NOW.md accepts hand edits that are silently regenerated away - modes.js isMarkdownPath() allows NOW.md in every mode, so an Edit succeeds and then vanishes at the next render. Fix: deny Edit/Write on NOW.md in modes.js with a reason naming 'thread.js set-intent' as the write path, and reword templates/NOW.md line 9 which currently calls the Active thread lines 'the one piece of human prose' and so invites the edit. Script writes (quick.js, override.js, nowrender.js) go through Bash and are unaffected by the deny.
- [ ] 2026-07-29 08:10 (while: rework app/ to the 1.0 contracts (Object Permanence v2)) /claudhd:review returns a false FAIL when the phase was already committed - it reads the uncommitted diff, finds it empty, and reports FAIL instead of noticing the sentinel's phase is in a commit and reviewing that range (seen in bakingapp phase 3, commit f750661)
