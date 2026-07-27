---
description: Capture an idea to IDEAS.md without breaking your current thread
argument-hint: <your idea in a few words>
allowed-tools: Bash(node:*)
---
!`node "${CLAUDE_PLUGIN_ROOT}/scripts/idea.js" "$ARGUMENTS"`

The idea above was just captured verbatim (idea.js routes through `vocab.js`'s `append-capture`, the same mechanical write path `/claudhd:triage`'s promotion taps use, so your exact wording is never rewritten). Confirm it in one short line. Do not start working on it now; it is parked for triage. Keep the active thread exactly as it is.
