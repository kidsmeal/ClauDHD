# <Feature> - Implementation Plan
Source design: <path>
Conventions read: <files, or "inferred from codebase sample">
Verification command(s): <the project's test/build commands the implementer will rely on>

## Summary
<2-3 sentences: what gets built, in how many phases.>

## Blockers / Open Questions
<unresolved design decisions - resolve these before phase 1 starts.>

## Phase 1: <name>
**Status:** pending <!-- pending | built | in review | review failed | ready to commit | committed. Updated by the relay at each transition, never by the implementer. -->
**Goal:** <one sentence.>
**Files:** <concrete paths created/modified, each wrapped in `backticks` (e.g. `src/foo.js`, `test/foo.test.js`), including the test files Verification names. Wrap every path in backticks - the file-list guard's sentinel parses the backticked paths to scope the phase.>
**Verification:** <which test to add/extend, or a manual check with a clear pass condition.>
**Exit criteria:** <what "done" looks like before phase 2 starts.>
**Blockers:** <anything the design left unresolved for this phase, or "none".>

## Phase 2: <name>
...

## Cross-cutting concerns
<each: what changes, what it affects, where in the phase order it must happen, migration/
rollback notes. Anything touching shared global state, a schema/format, or a public
contract MUST be here even if a phase also mentions it.>
