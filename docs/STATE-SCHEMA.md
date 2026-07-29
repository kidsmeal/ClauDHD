# STATE-SCHEMA.md - `.now/state.json`, schema v2

This is the frozen contract for `.now/state.json`. It describes what the code
does, not what it is planned to do. If a field below is marked "reserved,"
no script writes it yet.

`.now/` is gitignored. `state.json` never rides a commit; it is a local,
regenerated snapshot, not a source of truth for anything a second machine
needs. The generated documents (NOW.md, ROADMAP.md) are the shareable
projection of it.

## Reading the file

Call `readState(nowDir)` (`plugins/claudhd/scripts/state.js`). Never read
`state.json` off disk directly.

- Returns `null` if the file is absent, unreadable, or not a JSON object.
  Never throws.
- Accepts both schema v1 (pre-1.0 ClauDHD) and v2 files.
- Normalizes six fields to `null` when the raw JSON omits them: `mode`,
  `from`, `build`, `design`, `intent`, `roadmapIds`. A v1 file and a v2 file
  with those fields genuinely absent are indistinguishable to a reader that
  only checks presence.
- `override` is NOT included in that normalization. If the raw JSON has no
  `override` key, the returned object has no `override` key either (`.override`
  reads as `undefined`, not `null`). Check with `state.override` (falsy for
  both "absent" and "unset"), not `"override" in state`.
- Every other top-level key in the file (including one a future writer adds
  that this doc does not yet know about) passes through unchanged.

## Writing the file

Call `writeStateAtomic(nowDir, patch, ownedKeys)`. Never call
`fs.writeFileSync` on `state.json` directly - see cross-cutting concern 5 in
the implementation plan.

- Merge-preserving: reads the existing file, replaces only the keys named in
  `ownedKeys` (or `Object.keys(patch)` if `ownedKeys` is omitted), leaves
  every other top-level key untouched.
- Locked: wrapped in `withLock(stateLockPath(nowDir), ...)` (`lock.js`'s
  mkdir mutex), so two writers can never observe or write a half-merged file.
- Atomic: writes a temp file, then renames over the destination. Retries on
  Windows `EPERM`/`EACCES`/`EEXIST` for up to 2 seconds before giving up.
- Always stamps `schemaVersion` to the current value (2), regardless of what
  `patch` carries.

Every current writer, its owned keys, and the lock it uses:

| writer | owned keys | lock |
|---|---|---|
| `checkpoint.js` (Stop hook) | `schemaVersion, generatedAt, branch, cursor, ideas, shipped, roadmap, git` | `stateLockPath` (inside `writeStateAtomic`) |
| `reconcile.js` (commit boundary) | same facts-only set as checkpoint.js | `stateLockPath` |
| `sentinel.js` (`write`/`clear`/`add-files`/`write-files`, of which `write` and `write-files` also CLEAR `override` - establishing a new scope ends the emergency, same as `thread.js` below; `clear`/`add-files` do not touch `override`) | `build` (plus `override` on `write`/`write-files`) | `clear`/`add-files`: `stateLockPath` only. `write`/`write-files`: `override.lock` (the SAME lock `override.js` holds below), then `stateLockPath` inside the write - matching `override.js`'s own established order, since these two calls touch `override` and must serialize against `recordOverride()`/`noteOverrideFile()`'s read-modify-write of that exact key, not just race it at the file level (sol review fix: without this, an unfixed `write`/`write-files` call could interleave inside `noteOverrideFile()`'s own read-modify-write and resurrect an override it had just cleared - see `test/sentinel.test.js`'s RACE test) |
| `override.js` (`recordOverride`/`noteOverrideFile`/`clearOverride`) | `override` | `override.lock`, then `stateLockPath` inside the write |
| `thread.js` (`enterDesign`/`enterBuild`/`setDesignDoc`/`auditDesign`, which also CLEAR `override`; `setIntent`/`addDecision`/`resolveDecision`/`clearMode` do not touch `override`) | `mode`, `from`, `intent`, `design`, `override` | `design.lock` (only for the `design`-mutating calls), then `stateLockPath` inside the write |
| `state.js`'s `issueRoadmapIds()` (called by `init.js`, `reconcile.js`) | `roadmapIds` | `roadmapLockPath`, then `stateLockPath` inside the write |
| `vocab.js` (`move`) | `roadmapIds` (the identical read-ledger/backfill/persist-ledger transaction, composed inline under `move()`'s own already-held `roadmapLockPath` instead of calling `issueRoadmapIds()` - see `docs/SCRIPT-VOCABULARY.md`'s cross-verb stability note) | `roadmapLockPath`, then `stateLockPath` inside the write |

`thread.js` is `mode`/`from`/`intent`/`design`'s writer (wired by
`/claudhd:start` and `/claudhd:design`, phase 7): `enterDesign()` sets
`mode`, `from`, and seeds `intent`, and always starts `design` fresh
(`{doc:null,resolved:[],open:[]}` - a completed or abandoned prior design's
lists never leak into a new session); `enterBuild()` sets `mode` only
(display, since the guards enforce off the sentinel's presence, not this
field); `setIntent()`/`setDesignDoc()`/`addDecision()`/`resolveDecision()`
update their one field each; `clearMode()` resets `mode` to `null`;
`auditDesign(docPath)` is `/claudhd:design`'s existing-doc entry point (sol
round seven), choosing fresh-entry vs. continuation semantics by comparing
`docPath` to the currently-active `design.doc` under `design.lock` - see the
`design`/`override` sections below for exactly what it sets on each branch.
See the per-field sections below for exact detail.

## Top-level fields

### `schemaVersion` (number)

Always `2` after any v2 write. `1` (or absent, read as `1` by v1 consumers)
on a file no v2 writer has touched yet.

### `generatedAt` (string, ISO 8601, or `null`)

Stamped by the facts writer (checkpoint.js / reconcile.js) at write time.

### `branch` (string, or `null`)

Current git branch. `null` when detached or unknown (`HEAD`, or git not
resolvable).

### `cursor` (object, or `null`)

`null` when there is no NOW.md to read facts from. Otherwise:

| field | type | meaning |
|---|---|---|
| `activeThread` | string or `null` | first `**bold**` span under `## Active thread`, capped at 200 chars |
| `activeThreadLineCount` | number | line count of the `## Active thread` section, heading included |
| `nextAction` | string or `null` | first unchecked `- [ ]` line in `## Active thread`, capped at 200 chars |
| `lastTouched` | string (`YYYY-MM-DD`) or `null` | date on the `Last touched:` line |
| `queueCount` | number | list item count in `## Queue` |
| `quickFixCount` | number | open (`- [ ]`) item count in `## Quick fixes` |

### `ideas` (object, or `null`)

`null` when IDEAS.md is absent. Otherwise `{ total, untriaged,
oldestUntriagedDate }`: `total` counts every `[ ]`/`[x]`/`[~]` line,
`untriaged` counts only `[ ]` lines, `oldestUntriagedDate` is the earliest
`YYYY-MM-DD` among the untriaged lines (or `null` if none).

### `shipped` (object, or `null`)

`null` when SHIPPED.md is absent. Otherwise `{ total, lastEntryDate }`:
`total` counts bullet lines, `lastEntryDate` is the first `### YYYY-MM-DD`
heading found (SHIPPED.md is newest-first, so this is the most recent).

### `roadmap` (object, or `null`)

`null` when ROADMAP.md is absent. Otherwise `{ count, topItem }`: `count` is
the number of open (`[ ]`) items across `## Next` and `## Later`; `topItem`
is the first open item's text in `## Next` (capped at 200 chars), or `null`.

### `git` (object)

Never `null` itself; its fields are `null` individually when unknown.
`{ uncommitted, unpushed, lastCommitAt, lastCommitMsg }`. `uncommitted` is a
count of dirty/untracked paths, excluding NOW.md/IDEAS.md/SHIPPED.md/
ROADMAP.md (the plugin's own generated files are never "your work").
`unpushed` is `null` when there is no upstream tracking branch (distinct
from `0`, a real clean count). `lastCommitMsg` is capped at 200 chars.

### `mode` (string enum, or `null`)

One of `"build"`, `"design"`, or `null` (idle - no active mode). Read by
`modes.js`'s `decide()` for the guards' deny-by-default allowlist ONLY when
the `build` sentinel is absent - a live sentinel makes the guard enforce
`"build"` unconditionally regardless of this field's value (`file-list-guard.js`
hardcodes it), so `mode` here is mainly a display fact for `nowrender.js`'s
Position line once a sentinel exists. Written by `thread.js`: `enterDesign()`
sets `"design"`, `enterBuild()` sets `"build"` (paired with `/claudhd:build`'s
own `sentinel.js write` call, which is what the guard actually enforces
against), `clearMode()` resets it to `null`, `auditDesign()` sets `"design"`
on both its fresh-entry and continuation branches (a re-audit reaffirms the
mode even though the board itself is left untouched).

### `from` (string, or `null`)

The active thread's parent roadmap id (e.g. `"r-0725-1"`), or `null` for
unplanned work. Rendered into NOW.md as the `from:` line by `nowrender.js`.
Written by `thread.js`'s `enterDesign()` (the `fromId` argument, or `null`
for unplanned design work) and `auditDesign()`'s fresh-entry branch (always
`null` - an existing-doc audit never carries a roadmap parent, since it did
not arrive via `/claudhd:start`); `auditDesign()`'s continuation branch
leaves it untouched. No other writer sets it.

### `build` (object, or `null`)

Gantry's sentinel, folded into state.json (phase 2). `null` means no active
build phase. Otherwise, the plan-backed shape (`sentinel.js write`):

```
{
  plan: string,      // repo-relative POSIX path to the plan file
  phase: number,      // the active phase number
  files: string[],    // repo-relative POSIX paths the phase may edit
  allow: string[],     // paths always allowed regardless of files[] (plan itself, audit docs, ROADMAP.md)
  started: string,     // ISO 8601 timestamp
  session: string,     // the session id that started this phase
  originalFiles: string[], // files[] as first parsed for this phase, frozen -
                            // a same-plan+phase re-write (fix-relay) carries
                            // this forward unchanged even as files[] widens
                            // via add-files; see .now/review-log.jsonl below
}
```

Written by `sentinel.js`'s `write`/`clear`/`add-files`/`write-files`
subcommands, via `readSentinel(root)` (`sentinel-core.js`) on the read side.
A sentinel is "stale" (see `isStale()`) when its `session` differs from the
current session AND `started` is more than 6 hours old - staleness is a
read-time judgment, not a stored field. On first read after upgrading a
project that never re-ran `/claudhd:build`, a legacy
`.gantry/active-phase.json` is imported into this field once, then the
legacy file is deleted.

**The planless quick-sentinel shape** (`sentinel.js write-files`, phase 7,
`/claudhd:quick`'s clearing pass): the same object shape, but with no plan
or phase number to parse Files from:

```
{
  plan: null,
  phase: "quick",     // a string, not a number - there is no real phase
  files: string[],    // the batch's own files, named explicitly by the caller
  allow: ["NOW.md"],  // always includes NOW.md, since the clearing pass
                       // checks off batch items there and a live sentinel's
                       // build-mode allowlist has no generic *.md allowance
  started: string,
  session: string,
  originalFiles: string[], // == files[] at write-files time; write-files never
                            // widens across calls the way write's fix-relay
                            // path does, so this is always a fresh copy
}
```

`reconcile.js`'s plan-Status-line step reads `build.plan` and no-ops when it
is `null`, so a quick sentinel never tries to flip a nonexistent phase's
status; `moveRoadmapItemToShipped` is likewise never reached for it (that
path is gated on `build.plan` truthiness too).

## `.now/review-log.jsonl` - the persistent review-round log

Not part of `state.json` - a separate, append-only, newline-delimited JSON
file. `.now/` is gitignored, so this log never rides a commit either; it is
a local record of what review rounds actually happened, since `build`'s
rounds (via `.gantry/review-round.json`) die with the phase the moment it
clears - before this log existed, a phase's review history left no trace at
all once the phase closed.

Written by `sentinel.js` only, immediately before it destroys a phase's
recorded rounds: in `clear` (unconditionally, whenever a sentinel was
active - even one with zero recorded rounds, since the scope record itself
is worth keeping), and in `write`/`write-files` whenever they discard
another phase's rounds (a `write` for a different plan/phase; a `write-files`
call, which always overwrites whatever sentinel preceded it). Appended with
a single `fs.appendFileSync` call - no lock, no temp+rename: an append-only
line write does not need the merge-preserving discipline `state.json` does,
and this file is never read by anything that would notice a race. A write
failure (disk full, `.now/` unwritable, ...) is reported to stderr and
swallowed - logging can never block a phase from clearing.

**Orphaned round data:** `clear` can be reached with a round file present but
no readable sentinel (e.g. `state.json`'s `build` section was reset out from
under an in-flight review by something other than `sentinel.js`). Rather than
destroying that round data with no trace at all, `clear` falls back to a
closing record built from the round file's OWN `plan`/`phase` fields (it
always carries them) with `started: null` and `originalFiles`/`finalFiles`
both `[]` - the scope fields are genuinely unknown in this case, but the
round history itself is not lost.

One line per closed phase:

```
{
  plan: string | null,      // the closed phase's plan path (null for a quick sentinel)
  phase: number | "quick",  // the closed phase's number
  rounds: [                 // every round.js record-round call recorded for
                             // this phase, verbatim, in order (empty array
                             // if none were ever recorded)
    { round: number, verdict: string, fixes: string, recorded: string }
  ],
  started: string | null,   // the closed sentinel's `started` timestamp
  cleared: string,          // ISO 8601 timestamp of this log line itself
  originalFiles: string[],  // the phase's build.files list as FIRST written
                             // (falls back to finalFiles for a closing phase
                             // whose original sentinel is unavailable)
  finalFiles: string[],     // build.files at clear/replace time - compare
                             // against originalFiles to see add-files widening
  changedFiles: string[],   // `git status --porcelain -z` at clear/replace
                             // time, repo-relative POSIX paths, VERBATIM (the
                             // -z form disables git's quoting/escaping of
                             // special characters), renames resolved to their
                             // new path - the actual diff, independent of
                             // what the plan scoped or the reviewer saw;
                             // empty array (never a failure) if git is
                             // unavailable or the directory is not a repo
}
```

### `design` (object, or `null`)

`{ doc, resolved, open }`: `doc` is the design doc's path (or `null`);
`resolved` and `open` are flat arrays of decision-text strings, the design
board `/claudhd:now` renders and `/claudhd:design`'s grill maintains.
`nowrender.js` reads `design.doc` (falls back to `"(no doc yet)"` when
`design` is `null` or `design.doc` is unset). Written by `thread.js`:
`enterDesign()` always resets it to a fresh `{doc:null,resolved:[],open:[]}`
(entering design starts a new session, never resumes a completed or
abandoned prior one's lists); `setDesignDoc()` sets `doc`, preserving
`resolved`/`open`; `addDecision(kind, text)` appends `text` to
`design.resolved` or `design.open`; `resolveDecision(openText, resolutionText)`
removes the exact-match `openText` from `open`, then appends `resolutionText`
to `resolved` - or `openText` itself when `resolutionText` is omitted (the
grill's own resolve-in-place flow, where the resolution IS the deferred
text). The two-argument form is what `/claudhd:design`'s existing-doc audit
path needs: a design-reviewer's `[NEEDS USER DECISION: ...]` marker is
recorded as the open text, but the real resolution the user picks is a
different string. Throws, writing nothing, if `openText` was never recorded
as open. `auditDesign(docPath)` (sol round seven) is `/claudhd:design`'s
existing-doc entry point, and is itself the one that decides which of two
behaviors applies to `design`: comparing `docPath` to the currently-active
`design.doc` under `design.lock`, a DIFFERENT doc (or no active design
thread at all) resets it to a fresh `{doc:docPath,resolved:[],open:[]}`,
exactly like `enterDesign()` - a stale board from an unrelated prior thread
must never leak into a brand-new doc's audit; the SAME doc currently active
is a continuation, and `design` (along with `from`/`intent`) is left
completely untouched, preserving whatever the in-progress audit has already
accumulated. All the mutators (`setDesignDoc`/`addDecision`/
`resolveDecision`/`auditDesign`) are
serialized under a dedicated `design.lock` (`designLockPath`) spanning their
whole read-modify-write, the same discipline `issueRoadmapIds()` uses for
the `roadmapIds` ledger, so two concurrent decisions can never have the
second write silently drop the first's addition.

### `intent` (object, or `null`)

`{ thread, next }` - NOW.md's Active-thread two human lines (B3). This field
is the ONLY source for them: `nowrender.js` never parses NOW.md to recover
them, so there is no second source of truth. `thread` is the bold thread
name; `next` is the next physical action. Deliberately excluded from
`checkpoint.js`'s owned keys, so a Stop-hook write (which never claims
`intent`) can never erase it. Written by `thread.js`: `enterDesign()` seeds
it from the `thread`/`next` arguments (falling back to whatever was already
there for an argument not given); `setIntent(thread, next)` overwrites both
fields directly, independent of `mode`/`from`/`design`.

### `roadmapIds` (array of strings, or `null`)

The durable ledger of every `r-MMDD-N` id ever issued, whether or not its
line still exists in ROADMAP.md. Never shrinks. `state.js`'s
`issueRoadmapIds(nowDir, roadmapPath, date)` is the entry point that reads
AND writes this field for `init.js` and `reconcile.js`: they must call it
rather than composing a backfill + a raw ROADMAP.md write + a raw ledger
write by hand, since those three steps are only race-safe together, under
one lock covering all of them. `vocab.js`'s `move()` is the one deliberate
exception: it performs the identical read-ledger/backfill/persist-ledger
transaction inline, because it needs the ROADMAP.md insert, the id
backfill, and reading the stamped id back to all happen under ONE wider
lock acquisition than `issueRoadmapIds()` itself takes (calling
`issueRoadmapIds()` from inside an already-held `roadmapLockPath` would
self-deadlock - a directory-mkdir mutex is not reentrant). See
`docs/SCRIPT-VOCABULARY.md`'s cross-verb stability note for why that wider
lock is required.

### `override` (object, or absent)

Written by `override.js`'s `recordOverride`/`noteOverrideFile`. Absent until
the first `/claudhd:override` call (or the first guard-permitted edit under
an active override) in a project's lifetime. One project carries at most one
override record. It is explicitly cleared (set to absent) by `thread.js`'s
`enterDesign()`/`enterBuild()`/`setDesignDoc()`/`auditDesign()`: a mode
transition invalidates the override, since it is a per-emergency escape for
the CURRENT unguarded stretch, never a standing permit that should keep
applying once a new, properly-scoped mode begins (sol round-one finding 1,
widened to `setDesignDoc()` in round six, then consolidated into
`auditDesign()` in round seven - `auditDesign()` is now `/claudhd:design`'s
one existing-doc entry point, and clears the override on BOTH its branches,
whether the board itself resets (fresh entry) or is left untouched
(continuation), since a properly-scoped transition invalidates a stale
override either way). The rendered "unguarded session ..." line in NOW.md's
`## Loose ends` section is stripped at the same time (`override.js`'s
`clearOverrideLine()`), so the board never shows a permit that no longer
applies.

1.0.4 fix (item 2): the override previously had no way to be cleared on its
own, and survived unchanged into a scope established by `sentinel.js`
(`write`/`write-files`), which never cleared it - an override recorded before
a build phase (or the quick lane) started kept permitting out-of-scope edits
under that phase's own sentinel. Two fixes: `override.js` gains
`clearOverride(root)` (and `/claudhd:override --clear`), which removes this
key and strips the rendered line, the same two steps as the mode-transition
clears above, reachable directly rather than only as their side effect.
`sentinel.js`'s `write` and `write-files` now also clear `override` as part of
writing the new `build` sentinel (same atomic write, see the writer table
above) - establishing ANY scoped state ends the emergency, matching
`enterBuild()`/`enterDesign()`/`auditDesign()`'s own rule. `clear` and
`add-files` do not touch it: clearing a sentinel exits a scope rather than
entering one, and `add-files` only widens an already-active phase's scope.

```
{
  session: string,   // the session id the override is active for
  files: string[],   // repo-relative paths edited under the override, deduped
  startedAt: string, // ISO 8601 timestamp
}
```

An override is "active" for a given session only when `override.session`
equals that session's id (`overrideActiveFor()`); a different session's
override record does not apply to the current one. Rendered into NOW.md's
`## Loose ends` section by `override.js`'s own renderer, never left as a
silent state-only fact.

## Fields NOT in this file

`quickFixCount` is a derived count under `cursor`, not its own top-level
key - the batch's item TEXT lives only in NOW.md's `## Quick fixes` section
(quick.js writes it directly; see `docs/SCRIPT-VOCABULARY.md`). Queue and
Loose-ends item text are the same: state.json carries counts, never prose.
