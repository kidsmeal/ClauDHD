---
description: End-of-session wrap-up - reconcile NOW.md so stopping now costs nothing
allowed-tools: Bash(node:*), Read, Edit
---
!`node "${CLAUDE_PLUGIN_ROOT}/scripts/brief.js" --plain`

A task or unit of work just finished. Using the cursor above AND what actually happened in THIS session, bring NOW.md up to date so stopping right now would lose nothing. Be quick and concrete, no padding:

1. **Check off what's done.** In NOW.md's "## Active thread", tick every "Next physical action" step this session actually completed.
2. **Write the next tiny action.** Replace it with the single next physical action - one concrete step startable in under a minute. If the active thread is fully finished, say so, then either promote the top "## Queue" item to be the new active thread or ask me what's next. Queue items arrive vetted by triage's readiness gate, so promotion is just lifting it in - but if the top item is a spike, the next action is the investigation, not implementation.
3. **Capture loose ends.** Add any small side items that surfaced this session to "## Loose ends". Offer to park bigger tangents with /claudhd:idea so they don't become new threads.
4. **Stamp it.** Set the "Last touched:" line to today's date.

Write the changes straight to NOW.md, then give me a two-line summary: the updated active thread and its next action. If commits landed this session, remind me I can run /claudhd:shipped to log them. Do not start new work - wrap up and stop.
