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
| `sentinel.js` (`write`/`clear`/`add-files`) | `build` | `stateLockPath` |
| `override.js` (`recordOverride`/`noteOverrideFile`) | `override` | `override.lock`, then `stateLockPath` inside the write |
| `state.js`'s `issueRoadmapIds()` (called by `init.js`, `reconcile.js`) | `roadmapIds` | `roadmapLockPath`, then `stateLockPath` inside the write |
| `vocab.js` (`move`) | `roadmapIds` (the identical read-ledger/backfill/persist-ledger transaction, composed inline under `move()`'s own already-held `roadmapLockPath` instead of calling `issueRoadmapIds()` - see `docs/SCRIPT-VOCABULARY.md`'s cross-verb stability note) | `roadmapLockPath`, then `stateLockPath` inside the write |

No writer ever sets `mode`, `from`, `design`, or `intent` as of this phase;
those fields are written by hand today (or not at all) and read by the
renderer/guards. Their write paths land in a later phase (`/claudhd:start`,
`/claudhd:design`) - see "reserved" notes below.

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
`modes.js`'s `decide()` for the guards' deny-by-default allowlist. No script
writes this field as of this phase; it is set by hand or by a future
`/claudhd:start`/`/claudhd:design` writer (reserved).

### `from` (string, or `null`)

The active thread's parent roadmap id (e.g. `"r-0725-1"`), or `null` for
unplanned work. Rendered into NOW.md as the `from:` line by `nowrender.js`.
Reserved: no script in this phase writes it.

### `build` (object, or `null`)

Gantry's sentinel, folded into state.json (phase 2). `null` means no active
build phase. Otherwise:

```
{
  plan: string,      // repo-relative POSIX path to the plan file
  phase: number,      // the active phase number
  files: string[],    // repo-relative POSIX paths the phase may edit
  allow: string[],     // paths always allowed regardless of files[] (plan itself, audit docs, ROADMAP.md)
  started: string,     // ISO 8601 timestamp
  session: string,     // the session id that started this phase
}
```

Written only by `sentinel.js`'s `write`/`clear`/`add-files` subcommands, via
`readSentinel(root)` (`sentinel-core.js`) on the read side. A sentinel is
"stale" (see `isStale()`) when its `session` differs from the current
session AND `started` is more than 6 hours old - staleness is a read-time
judgment, not a stored field. On first read after upgrading a project that
never re-ran `/claudhd:build`, a legacy `.gantry/active-phase.json` is
imported into this field once, then the legacy file is deleted.

### `design` (object, or `null`)

Declared shape (phase 2's goal: doc path, resolved/open decision lists).
`nowrender.js` reads `design.doc` today (falls back to `"(no doc yet)"` when
`design` is `null` or `design.doc` is unset). `design.resolved` and
`design.open` are RESERVED - no script reads or writes them yet; they land
with `/claudhd:design` in a later phase.

### `intent` (object, or `null`)

`{ thread, next }` - NOW.md's Active-thread two human lines (B3). This field
is the ONLY source for them: `nowrender.js` never parses NOW.md to recover
them, so there is no second source of truth. `thread` is the bold thread
name; `next` is the next physical action. Deliberately excluded from
`checkpoint.js`'s owned keys, so a Stop-hook write (which never claims
`intent`) can never erase it. Reserved for writing: today it is set by hand
or not at all; a future boundary-prompt writer lands later.

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
an active override) in a project's lifetime; never explicitly reset to
`null` afterward - one project carries at most one override record.

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
