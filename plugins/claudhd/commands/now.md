---
description: Show the mode-aware board - phases in build, decisions in design, the cursor and drift flags otherwise
allowed-tools: Bash(node:*), Read
---
!`node "${CLAUDE_PLUGIN_ROOT}/scripts/brief.js" --plain`

Read `.now/state.json` (absent or unreadable reads as idle, no build, no design; never treat that as an error). Render as a widget when the harness provides one, else the text board below; text is the acceptance baseline, never a fallback of last resort.

**Always show first:** `mode` (build / design / idle) and, if `from` is set, the parent roadmap id it traces to.

**If `mode` is `build`:** show the phase board from `state.build`: the plan path, `phase X` (name it from the plan file if you can read it quickly), and the file list currently in scope. If `state.build` is null despite mode reading build, say the sentinel was cleared and the board is stale; recommend `/claudhd:build` or `/claudhd:review` to see where the phase stands.

**If `mode` is `design`:** show the decision board from `state.design`: the doc path (or "no doc yet"), the resolved decisions list, and the open decisions list. An empty open list with a doc path set reads as ready for `/claudhd:design`'s audit step. Exit criterion for this board: "doc passes design review, ready to plan."

**If `mode` is idle:** just show the brief above; there is no phase or decision board to render.

**Always show, regardless of mode:** the brief's active thread, drift flags, and shipped-since-last-here. If `state.override` is present and its `session` still matches the current session (or you cannot tell), say so plainly: an unguarded session is in effect.

Relay all of this as my current focus and orient me on the next physical action. Do not start new work.
