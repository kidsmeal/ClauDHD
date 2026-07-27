# SCRIPT-VOCABULARY.md - the mechanical write vocabulary

This is the frozen contract for every mechanical (non-model) write the
plugin's own scripts can make to IDEAS.md and ROADMAP.md. It is the
interface Object Permanence v2 builds against (design section 10): "the app
may only invoke the plugin's script vocabulary, and that vocabulary contains
no free-text operation. Free text always dispatches to a session." A
consumer that only reads this file should be able to write a working
in-app dispatcher without reading the plugin's source.

## The rule

Every verb below takes structured argv only: paths, ids, positions, dates,
and a small closed set of enum strings. NONE of them accept arbitrary text
as new file content, except `append-capture`, which is the one verb DEFINED
to carry text - a straight capture, never a rewrite. If a UI surface wants
to write new prose anywhere else (reword a roadmap item, comment on
something, anything a model would normally phrase), that is not a
vocabulary call: it opens a session. Nothing here spends a token.

All five verbs live in `plugins/claudhd/scripts/vocab.js`, both as an
importable module (`require("./vocab.js")`) and as a CLI
(`node vocab.js <verb> <args...>`). `idea.js` (the `/claudhd:idea` command)
is a thin CLI wrapper over `vocab.appendCapture()` - there is one write path
for a capture, not two.

## Optimistic concurrency on position-addressed lines

IDEAS.md lines carry no id of their own, so `move()` and `mark(file:
"ideas")` address a line by `position` (its 1-based rank among ALL Inbox
lines, top to bottom - stable for the file's whole lifetime, since a line is
never physically removed, only its marker flips in place). A position alone
is not a safe tap target: a capture landing between a consumer rendering its
card list and the tap actually firing shifts every position below it, so a
stale tap addressed by position alone could silently act on the WRONG line.

Both verbs therefore also require `expectedLine`: the EXACT line text the
caller last rendered at that position. This is structured argv, not free
text - it is an exact-match echo of a line the caller already has in hand
from its own prior read, never composed or rephrased. If the line currently
at `position` does not match `expectedLine` byte-for-byte, the verb REFUSES:
it throws, writes nothing to any file, and the error message says the list
changed underneath the tap. The correct response is to re-render (re-read
the current line at whatever position the item now occupies) and retry -
never to retry blindly with the same stale position.

`mark(file: "roadmap")`, `reorder()`, and `park()` are NOT subject to this:
they address a ROADMAP.md item by its own `r-MMDD-N` id, which is unique and
never reassigned, so there is nothing for a position to shift out from under.

## Parsing a captured line: thread names may themselves contain parentheses

A captured IDEAS.md line has the shape `- [<marker>] <date> <time> (while:
<thread>) <text>`. `<thread>` is not guaranteed to be paren-free - the
shipped default thread name (`templates/NOW.md`) is itself
`(name your current focus here)`, so a real captured line can read `...
(while: (name your current focus here)) <text>`. `move()`/`mark()`/the
`parseIdeaLine()` helper never use a naive regex to find the wrapper's
closing paren (a non-greedy `(while: (.*?))` stops at the FIRST `)`, which
truncates the thread name and leaves a stray `)` glued onto the front of
`text`). The real parse is structural: anchor on the literal `(while: `
prefix, then scan forward tracking paren depth until it returns to the
wrapper's own close. This is exact for any number of balanced parens in the
thread name; an unterminated/malformed tag fails safe (no thread parsed,
the whole remainder treated as `text`) rather than guessing. Any consumer
re-parsing a raw IDEAS.md line itself (rather than using `move()`'s returned
`thread`/`text` fields) must use the same structural approach, not a regex
with `(.*?)`.

## Write durability: every destination write is atomic

Every write this module makes to a real IDEAS.md or ROADMAP.md destination
path goes through a temp-file-plus-rename (the same shape
`state.js`'s `writeStateAtomic` uses for `.now/state.json`): the full new
content is written to a temp file in the SAME directory, then renamed over
the destination, with a retry loop on Windows `EPERM`/`EACCES`/`EEXIST`
(a watcher can transiently hold the destination open at the instant of
rename). A plain `fs.writeFileSync` straight to IDEAS.md/ROADMAP.md is never
used by any verb. This matters specifically for Object Permanence: its
fs-watcher reads these files without holding any of this module's locks, so
a reader must never be able to observe a torn/partial write mid-verb - the
lock protects writers from each other, the atomic rename protects readers
from writers.

## The five verbs

### `append-capture(root, text)`

CLI: `vocab.js append-capture <text...>`

The one verb that carries free text. Appends `text` verbatim as a new line
under IDEAS.md's `## Inbox` heading, tagged with the current timestamp and
the active thread read off NOW.md (`(while: <thread>)`, or `?` if there is
no active thread). Creates IDEAS.md with its standard header if absent.
Empty/whitespace-only text captures nothing (`{ ok: false }`) and creates no
file.

Atomic + locked on `.now/ideas.lock`.

### `move(root, { position, expectedLine, section })`

CLI: `vocab.js move <position> <expectedLine> [Next|Later]`

Promotion: IDEAS.md -> ROADMAP.md, VERBATIM. `position` is the 1-based rank
of the target line among ALL lines under IDEAS.md's `## Inbox` (open,
promoted, or dropped alike, top to bottom) - stable for the file's whole
lifetime, since a line is never physically removed, only its marker flips
in place. `expectedLine` is REQUIRED (see "Optimistic concurrency" above);
omitting it throws before anything is read or written. `section` defaults
to `"Next"`; `"Later"` is the only other accepted value.

The addressed line must match `expectedLine` exactly and currently be open
(`- [ ]`); anything else throws and writes nothing. No text argument
exists - the wording written to ROADMAP.md is read back off the addressed
IDEAS.md line, never taken from the caller.

**Write ordering (deliberate, not incidental):** `move()` writes the
ROADMAP.md side FIRST - validate the destination section exists, insert the
new line, stamp its id - and only marks the source IDEAS.md line promoted
(`[~]`) AFTER that succeeds. A missing or malformed (missing target section)
ROADMAP.md throws before IDEAS.md is ever touched: IDEAS.md stays
byte-untouched on a ROADMAP-side failure, so a failed promotion never
leaves an idea silently marked promoted while its words never actually
landed anywhere. IDEAS.md's line is never deleted either way - once a
promotion does succeed, IDEAS.md keeps its own copy as history.

The new ROADMAP.md line: `- [ ] <exact captured text> (captured: <date>[,
while: <thread>])`, appended as the last item in the target section. The id
is then stamped by the SAME transaction `state.js`'s `issueRoadmapIds()`
performs (read the durable ledger, backfill, persist the grown ledger) -
never invented ad hoc - but composed inline under `move()`'s own lock rather
than by calling `issueRoadmapIds()` itself (that function acquires
`roadmapLockPath` internally, and calling it from inside an already-held
instance of the same lock would self-deadlock). Every other id issuer
(`init.js`, `reconcile.js`) still calls `issueRoadmapIds()` directly; only
`move()` composes the equivalent transaction, and only because it needs a
wider critical section (see below). The returned `id` is read back by the
EXACT physical line index `move()` inserted at (stable across the backfill
pass, which only appends suffixes and never reorders lines), never by
re-matching the item's text - two promotions with byte-identical
wording/date/thread would otherwise be indistinguishable by text alone.

**Cross-verb stability:** the insert, the id-issuance backfill, and the
index-based id read-back ALL happen inside ONE acquisition of
`roadmapLockPath` - the SAME lock `mark(file: "roadmap")`, `reorder()`, and
`park()` use for their own ROADMAP.md writes. Holding it across the whole
sequence, not just the insert, is what keeps the id association correct
even when a `reorder()`/`park()`/another `move()` call races alongside:
none of them can land between this call's insert and its own read-back and
shift the inserted line's physical index out from under it.

Returns `{ ok, id, text, section, capturedAt, thread }`.

### `mark(root, { file, key, expectedLine, state })`

CLI: `vocab.js mark ideas <position> <expectedLine> <state>` or
`vocab.js mark roadmap <id> <state>`

Flips a checkbox marker on an existing line. `file` is `"ideas"` or
`"roadmap"`; `key`'s type depends on `file` (position for ideas, the
item's `r-MMDD-N` id for roadmap). `state` is a closed enum, never free
text - an unrecognized value throws and writes nothing:

| file | accepted `state` values | resulting marker |
|---|---|---|
| `ideas` | `dropped`, `promoted` | `[x]`, `[~]` |
| `roadmap` | `open`, `done` | `[ ]`, `[x]` |

For `file: "ideas"`, `expectedLine` is REQUIRED (same optimistic-concurrency
rule as `move()` - omitting it throws) and the addressed line must match it
exactly and currently be open; this is the triage "drop" action. For `file:
"roadmap"`, no `expectedLine` is needed (see "Optimistic concurrency"
above); the addressed line must be a checkbox item (`- [ ]`/`- [x]`/`- [~]`)
carrying that id - a plain-bullet Shipped/Non-goals entry has no checkbox to
flip.

Locked the same way as `move()` (ideas.lock for the ideas case,
`roadmapLockPath` for the roadmap case).

### `reorder(root, { section, id, position })`

CLI: `vocab.js reorder <Next|Later> <id> <position>`

Moves the ROADMAP.md item carrying `id` to `position` (1-based) within its
OWN section (`Next` or `Later` - cross-section moves are `park()`'s job, not
this one). `position` is clamped to the section's actual item count.
Stable: only the item lines' CONTENT is permuted across their existing
physical slots; headings, blank lines, and every other section are
byte-identical before and after. A no-op call (already at that position)
changes nothing and returns `{ changed: false }`.

Locked on `roadmapLockPath`.

### `park(root, { id, to })`

CLI: `vocab.js park <id> <Next|Later>`

Moves the ROADMAP.md item carrying `id` between the `Next` and `Later`
sections. `to` is the target section; the item is found by scanning both
sections for its id. Reversible: parking an item and then parking it back
restores its exact original line text (the line itself is never rewritten,
only relocated). A no-op call (already in the target section) changes
nothing and returns `{ changed: false }`.

Locked on `roadmapLockPath`.

## What is deliberately NOT a vocabulary verb

**The triage "quick fix" button.** Resolved by the plan's B2 blocker: it
keeps writing through `quick.js`'s existing `## Quick fixes` batch in
NOW.md, unchanged - the same script `/claudhd:quick <text>` has always used.
`quick.js` is not part of `vocab.js` and is not one of the five verbs above;
a caller wiring the "quick fix" tap calls `quick.js` (its `addMode`
behavior, invoked as `node quick.js <text>`) directly, not through
`vocab.js`. `cursor.quickFixCount` in `.now/state.json` is a derived read
(see `docs/STATE-SCHEMA.md`), not something any vocabulary verb sets.

**Triage "skip."** No file write at all - it just advances past the current
card.

**Triage "discuss."** Opens a primed session for rewording before promotion
(design section 9's "lost-context fragment" case: no verb, trivially short
wording that verbatim promotion cannot save). This is the free-text
dispatch path the rule above names explicitly: a card that needs its words
changed is not a vocabulary call.

**Roadmap item wording changes at `/claudhd:start` activation** (design
section 9: "the reconcile writes the cleaned wording back to the roadmap
line" once a vague item gets restated in a design session). That rewrite is
model output landing through the session/reconcile path, not a vocabulary
verb - the vocabulary's own promotion step is verbatim by definition and
never rewords anything.
