---
description: Activate a roadmap item, the readiness gate that turns vague intent into something to design
argument-hint: <roadmap-id, e.g. r-0725-1>
---
Arguments: $ARGUMENTS

Vague wording is legal on the roadmap; the readiness gate lives here, at activation, not at capture. If `$ARGUMENTS` is empty, show me `ROADMAP.md`'s `## Next` section (numbered) and ask which id to activate.

1. **Find the item.** Read `ROADMAP.md` and locate the checkbox line ending in the given `` `r-MMDD-N` `` id, in `## Next` or `## Later`. If no line carries that id, say so and stop; do not guess which item was meant. If the item has no id yet (added since the last commit or init, before ids were backfilled), tell me to run `/claudhd:init` or make a commit first (either backfills ids via the reconcile), since activation needs a stable id to set `from`.

2. **Restate it concretely.** An item does not activate as a bare one-liner; it has to be ready to design against. Walk through the same three checks triage's old readiness gate used, now moved here:
   - **Done**: can you say in one line what "done" looks like?
   - **First action**: is there a concrete first physical step (for design work, that is usually "read X and grill the open forks")?
   - **Unknowns**: is there anything you would have to figure out before you could even start?
   Propose a restated version (tightened, not reinterpreted; keep the original intent) and confirm it with me.

3. **Write the cleaned wording back to ROADMAP.md.** Edit the item's line in place: replace its text between the checkbox and its trailing `(captured: ...)`/id markers with the restated wording, leaving the `(captured: ...)` context and the trailing `` `r-MMDD-N` `` id byte-identical. This is model output landing through a plain text edit, not one of `vocab.js`'s mechanical verbs (see `docs/SCRIPT-VOCABULARY.md`), so use the Edit tool directly. Design mode's own allowlist covers this (`*.md` edits are always allowed), and mode is not yet entered at this exact instant, so idle mode's `*.md` allowance covers it too either way.

4. **Enter design mode.** Run:

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/thread.js enter-design <id> "<restated wording, short>" "<first physical action>"
```

This sets `mode: design`, `from: <id>` (the parent link `/claudhd:now` and the reconcile both read), and seeds `intent` so the board's Active thread reflects the activation immediately, before any design doc exists.

5. **Hand off.** Tell me the activation is set and recommend `/claudhd:design` to run the grill and produce the design doc. Do not start designing inline here; this command's job is the readiness gate and the mode switch, nothing past it.
