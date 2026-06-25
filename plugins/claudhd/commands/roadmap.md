---
description: Show the project roadmap, or add a committed intent to it - the ordered lane between IDEAS.md and the NOW cursor
argument-hint: [intent to add, or empty to show]
allowed-tools: Read, Write, Edit
---
The roadmap is the committed, ordered lane between IDEAS.md (someday, unsorted) and NOW.md (the one active thread): what you have decided to do and roughly in what order, before any of it becomes the live cursor. One cursor still rules - the roadmap orders many intents, NOW.md points at exactly one. Adding to the roadmap never starts work and never changes the active thread.

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

Do not start the work, and do not touch the active thread in NOW.md. The roadmap decides order; activation stays one-at-a-time through triage and the NOW cursor.
