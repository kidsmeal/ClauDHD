# Optional remote routines

Claude Code plugins cannot create scheduled remote agents, so these are set up by hand, once. They are optional. The local hooks already cover continuity; these add proactive nudges that reach you even when you are not in a session.

Both run in the cloud against your **pushed** repo, so they see committed state only. Commit and push semi-regularly and they stay useful. The local `SessionStart` brief is what catches uncommitted drift.

## How to set one up

Use the `/schedule` skill in Claude Code, or go to [claude.ai/code/routines](https://claude.ai/code/routines). Point each routine at your repo, paste the prompt from the matching file, and use the suggested schedule. Suggested allowed tools for both: `Bash`, `Read`, `Glob`, `Grep`, `PushNotification`. They only read files and run git; they never modify the repo.

| Routine | Prompt | Suggested schedule |
|---|---|---|
| Daily drift sweep | [drift-sweep.md](drift-sweep.md) | Once each morning |
| Weekly idea triage | [idea-triage.md](idea-triage.md) | Monday morning |

Schedules are set in UTC. Convert your local morning time to UTC when you create the cron expression.
