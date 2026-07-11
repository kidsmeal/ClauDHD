---
description: End-of-session wrap-up - reconcile NOW.md so stopping now costs nothing
allowed-tools: Bash(node:*), Read, Edit
---
!`node "${CLAUDE_PLUGIN_ROOT}/scripts/brief.js" --plain`
!`node "${CLAUDE_PLUGIN_ROOT}/scripts/budget.js"`

A task or unit of work just finished. Using the cursor above AND what actually happened in THIS session, bring NOW.md up to date so stopping right now would lose nothing. Be quick and concrete, no padding.

**If the CURSOR BUDGET line above says the Active thread is over budget, run a migrate pass first.** (If it is within budget, skip straight to reconcile.) The section has accumulated more than a cursor should hold; move everything that is not live out of it so it reads as summary plus live state plus next action:

- **Fully shipped and committed work** goes to SHIPPED.md. Add a concise dated entry (a `### YYYY-MM-DD` header when the date is new, then one `- ` line per bundle) and delete the verbose version from the thread. The commits already live in git; the thread does not need to re-narrate them.
- **Parked, deferred, or "future, noted not built" material** goes to ROADMAP.md as a committed intent under `## Next` or `## Later`, each carrying a one-line `done:` so it is ready to reactivate later.
- **Loose someday-maybe ideas** go to IDEAS.md, one line each (or tell me to run /claudhd:idea).
- **Keep in the Active thread only** its one-line headline, the live sub-state (what is genuinely mid-flight right now, including any pending push or deploy), and the single next physical action.
- **Collapse `Last touched:` to one line**: today's date and at most a short clause. Any historical narrative there moves to SHIPPED.md or is dropped.

Do not shred genuinely live state to hit the number. The budget is a trigger to migrate settled material, not a line quota.

Then reconcile (always, whether or not a migrate pass ran):

1. **Check off what's done.** In NOW.md's "## Active thread", tick every "Next physical action" step this session actually completed.
2. **Write the next tiny action.** Replace it with the single next physical action - one concrete step startable in under a minute. If the active thread is fully finished, say so, then either promote the top "## Queue" item to be the new active thread or ask me what's next. Queue items arrive vetted by triage's readiness gate, so promotion is just lifting it in - but if the top item is a spike, the next action is the investigation, not implementation.
3. **Capture loose ends.** Add any small side items that surfaced this session to "## Loose ends". Offer to park bigger tangents with /claudhd:idea so they don't become new threads.
4. **Stamp it.** Set the "Last touched:" line to today's date, kept to one line.

Write the changes straight to NOW.md (and to SHIPPED.md, ROADMAP.md, or IDEAS.md if you migrated anything), then give me a two-line summary: the updated active thread and its next action. If commits landed this session, remind me I can run /claudhd:shipped to log them. Do not start new work - wrap up and stop.
