---
description: Show the project roadmap, add a committed intent, or mark/reorder/park an existing item by id
argument-hint: '[intent to add, or empty to show, or "done <id>" / "reopen <id>" / "park <id> Next|Later" / "reorder <id> <position>"]'
allowed-tools: Read, Write, Edit, Bash(node:*)
---
The roadmap is the committed, ordered lane between IDEAS.md (someday, unsorted) and NOW.md (the one active thread): what you have decided to do and roughly in what order, before any of it becomes the live cursor. One cursor still rules - the roadmap orders many intents, NOW.md points at exactly one. Adding to the roadmap never starts work and never changes the active thread.

Every item carries a stable `` `r-MMDD-N` `` id, rendered beside its text, so it is never typed from memory. `/claudhd:start <id>` is how an item goes from committed intent to something being designed; `/claudhd:triage`'s "roadmap" tap is how an idea gets promoted here in the first place, verbatim, with its own id stamped at promotion time.

Read `ROADMAP.md` at the project root.

**If it does not exist**, create it with this structure, then continue:

~~~
# ROADMAP

The committed, ordered lane between IDEAS.md (someday) and NOW.md (the active thread). One cursor rules: this orders many intents, NOW.md points at one.

## Now
- (the intent NOW.md is working, or "nothing in flight")

## Next
- [ ] (next committed intent) - done: (one line)

## Later
- [ ] (a known-but-not-soon intent)

## Shipped
- (most recent shipped intent)

## Non-goals (decided, not "later")
- (a deliberately-killed direction) - why: (one line)
~~~

**With no argument**, show `## Now`, `## Next`, and `## Later` compactly, numbered within each section, so I can see what is committed and in what order. Skip Shipped and Non-goals unless I ask. Close by noting that the active thread in NOW.md is unchanged.

**With an intent (`$ARGUMENTS`)**, add it:

1. Pick the horizon. Default to `## Next` (committed, on-deck after the current work). Use `## Later` if it is clearly not soon. Use `## Now` only if it is what the active thread already serves. If it is genuinely unclear, ask me Next or Later in one line.
2. Write it carrying what "done" looks like, so it is ready to activate later, not re-litigated: `- [ ] <intent> - done: <one line>`. If I did not give enough to state "done", ask me for it in one line.
3. Place it where it belongs in that section's order, not blindly at the end.
4. It will not carry an id yet; ids are stamped by the next commit-boundary reconcile or `/claudhd:init` run, not by this edit. Mention that in one line if I ask to `/claudhd:start` it right away.

**With `done <id>` / `reopen <id>` / `park <id> Next|Later` / `reorder <id> <position>`**, apply it through the mechanical write vocabulary rather than a hand-edit, so an id's own checkbox and position are never touched by anything but a structured call (see `docs/SCRIPT-VOCABULARY.md`):

- `done <id>`: `node ${CLAUDE_PLUGIN_ROOT}/scripts/vocab.js mark roadmap <id> done`
- `reopen <id>`: `node ${CLAUDE_PLUGIN_ROOT}/scripts/vocab.js mark roadmap <id> open`
- `park <id> <Next|Later>`: `node ${CLAUDE_PLUGIN_ROOT}/scripts/vocab.js park <id> <Next|Later>`
- `reorder <id> <position>`: `node ${CLAUDE_PLUGIN_ROOT}/scripts/vocab.js reorder <Next|Later> <id> <position>` (ask me which section if it is not obvious which one the id is currently in)

Relay the script's own confirmation line. This is a structural edit, not new prose, so it never goes through a session-authored rewrite of the item's text.

Do not start the work, and do not touch the active thread in NOW.md. The roadmap decides order; activation stays one-at-a-time through triage and the NOW cursor.
