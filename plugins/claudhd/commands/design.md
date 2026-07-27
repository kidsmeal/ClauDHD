---
description: Grill a feature idea to a resolved decision board, write the design doc, and audit it
argument-hint: <feature idea, or a design doc path to audit/re-audit>
---
Arguments: $ARGUMENTS

This command absorbs the grill (turning a rough idea into a resolved decision set) and the design-reviewer audit (turning a draft into a doc ready for `/claudhd:plan`). If `$ARGUMENTS` is a path to an existing `.md` file, enter through the audit path: `node ${CLAUDE_PLUGIN_ROOT}/scripts/thread.js audit-design <path>`. This is the one entry point for both a brand-new audit and a continuation of one already in progress, and it always leaves mode as `design` and clears any active override - a per-emergency escape from an earlier unguarded stretch must never silently carry into a properly-scoped design transition. What differs is whether it is a fresh entry or a continuation, decided for you by comparing `<path>` to whatever design doc is currently active: re-auditing the SAME doc that is already active preserves the accumulated board and `from` byte-for-byte (the settled continuation behavior a multi-pass audit depends on); auditing a different doc, or starting from idle/another mode entirely, starts a fresh board (`resolved`/`open` both empty) and clears `from` (an existing-doc audit never carries a roadmap parent), exactly as `enter-design` would. Do not call `enter-design` here either way; `audit-design` is what handles both branches. Then skip straight to the **Audit** section below. Otherwise treat `$ARGUMENTS` as a feature idea and start at **Enter design mode**.

## Enter design mode

If this design continues an active roadmap item (you got here from `/claudhd:start`), mode is already `design` and `from` is already set. Otherwise, entering design directly from an idea:

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/thread.js enter-design - "<one-line working title>" "<first tiny step>"
```

(pass `-` for the `fromId` argument when this design has no roadmap parent; unplanned design work is legal, just visible as such on the board).

## The grill (the core of this command)

Read the project's convention/style files (`CLAUDE.md`, `AGENTS.md`, `CONVENTIONS.md`, `docs/CONVENTIONS.md`, whichever exist), the codebase map if one exists (`docs/INDEX.md` / `docs/ARCHITECTURE.md`), and spot-check two or three representative files in the area the feature touches with Glob/Grep, so your questions and proposals match how the code actually works.

Propose a one-sentence **intent** and a short **problem statement** as concrete drafts, not blank questions: what is missing or broken today and why it matters, no solution yet. Confirm or correct, then build the **decision tree**: the forks this feature implies, spanning data/model, scope boundary, behavior/UX, contracts touched, and edge cases. Drive them to resolution **one at a time**:

- For each fork, propose the option you would pick and say why, grounded in what you read in the codebase.
- Push: name the tradeoff, the case that breaks it, or the cheaper alternative. Do not let a decision pass with a shrug.
- The grill is done when every material fork is either resolved or explicitly deferred to Open questions (a conscious "decide later", not an overlooked gap).

**Track the board as you go, not at the end.** Every time a fork resolves, record it immediately:

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/thread.js decision resolved "<the resolution, one line>"
```

Every time you consciously defer a fork instead of resolving it:

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/thread.js decision open "<the open question, one line>"
```

If a deferred fork later resolves in the same session:

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/thread.js resolve-decision "<the exact open text>"
```

This is the design board `/claudhd:now` reads: resolved list, open list, doc path. A long design ramble can never end artifactless, because the board is live state, not something you write up afterward.

If the working title or the next physical action changes materially during the grill (a common outcome of resolving the first couple of forks), update the intent lines directly rather than leaving `/claudhd:start`'s original wording stale on the board:

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/thread.js set-intent "<updated thread name>" "<updated next action>"
```

## Write the design doc

Only once the decision tree is resolved (or explicitly deferred), write to `design/<feature-slug>.md` (or the project's existing design directory) using this structure, filled from the resolved decisions:

```
# <Feature> - Design
Status: draft
Intent: <one sentence>

## Problem
## Design
## Contracts touched
## Edge cases
## Out of scope
## Open questions
```

Never overwrite an existing design doc; if the slug is taken, confirm a new one. Then record the path:

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/thread.js set-design-doc <path>
```

## Audit

**Dispatch the design-reviewer to its configured model backend.** Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/role.js resolve design-reviewer`:
- `DISPATCH: native`: spawn the **design-reviewer** subagent (use the model the resolve output names) to audit the draft (with the project's rubric if one exists).
- `DISPATCH: external`: run `node ${CLAUDE_PLUGIN_ROOT}/scripts/role.js run design-reviewer -- <draft> <rubric>` and treat its stdout as the agent's summary. The external reviewer reads the rubric and writes the revised doc itself; do not also spawn the subagent. On failure (CLI missing/unauthed/non-zero), report it and fall back to the native subagent.

The agent writes a revised `<draft-basename>_reviewed.md`, fixing every resolvable violation in place and replacing the rest with `[NEEDS USER DECISION: ...]` markers. Relay its summary (violations found / resolved / needing-decision, plus coherence flags). Then, for each `[NEEDS USER DECISION: ...]` marker in the revised doc, first record the marker itself as an open decision, verbatim:

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/thread.js decision open "<the exact marker text>"
```

This is not a redundant step: `resolve-decision` requires the exact text to already be in `design.open`, and an audit-only session never went through the grill's own "The grill" section where that would normally happen. Only once every marker is recorded as open, walk me through them one at a time. Once I answer one, write the actual resolution into the reviewed doc AND record it as the resolution of that SAME marker - never a marker you have not first recorded as open, which throws rather than silently doing nothing:

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/thread.js resolve-decision "<the exact marker text>" -- "<the real resolution, in your own words>"
```

Once it reads "Ready for phase planning: yes", update `set-design-doc` to point at the `_reviewed.md` path and recommend `/claudhd:plan` on it.

Design mode denies source edits entirely (the guard's own allowlist). If you find yourself wanting to write code during a design session, stop: that work belongs in `/claudhd:build` once a plan exists.
