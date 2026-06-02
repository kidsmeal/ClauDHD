# ClauDHD

Focus and drift control for [Claude Code](https://claude.com/claude-code).

ClauDHD is built on one idea: **stop trying to finish sessions, and make stopping safe instead.** Real work gets interrupted — you chase a new lead, switch context, or close a chat mid-thought and lose your place. Instead of fighting that, ClauDHD externalizes where you are in the work and automates the remembering, so an abruptly-closed session never costs you anything.

It is a small, zero-dependency plugin. No accounts, no servers, no data leaves your machine. Just Node (which Claude Code already ships with) and git.

## What it gives you

- **A NOW cursor** (`NOW.md`). One active thread at a time, the next physical action, and an ordered queue behind it. The first thing you read, the last thing you touch.
- **Session breadcrumbs.** A `Stop` hook writes a checkpoint after every turn, and a `SessionStart` hook greets your next session with "where you left off, what shipped, what is drifting." You never have to remember to checkpoint.
- **An idea inbox** (`IDEAS.md`). When an idea hits mid-task, `/claudhd:idea <it>` parks it in one line so you keep going instead of opening a new chat. Triage later with `/claudhd:triage`.
- **A trophy case** (`SHIPPED.md`). `/claudhd:shipped` pulls your finished commits into a visible, growing list. Finishing should feel like something.

## Install

```
/plugin marketplace add kidsmeal/ClauDHD
/plugin install claudhd@claudhd
```

Hooks and commands activate immediately, no restart needed.

## Set it up in a project

ClauDHD does nothing in a project until you opt in. In the project you want to manage:

```
/claudhd:init
```

That scaffolds `NOW.md`, `IDEAS.md`, and `SHIPPED.md` (without overwriting any you already have) and adds `.now/` to your `.gitignore`. Then name your one active thread and its next tiny step. That is it.

In every other repo, ClauDHD stays completely silent.

## Commands

| Command | What it does |
|---|---|
| `/claudhd:init` | Scaffold the files into the current project and opt it in. |
| `/claudhd:now` | Show the cursor: active thread, recent wins, drift flags. |
| `/claudhd:regroup` | Mid-session reset: name the drift, park side-quests, snap back to the active thread. |
| `/claudhd:idea <text>` | Park an idea in `IDEAS.md` without breaking your current thread. |
| `/claudhd:triage` | Walk the inbox and promote, park, or kill each idea. |
| `/claudhd:shipped` | Pull finished commits into `SHIPPED.md` and show the wins. |

## What runs automatically

Once a project has a `NOW.md`:

- **On every turn (`Stop` hook):** a silent checkpoint is written to `.now/last-session.md` (timestamp, branch, uncommitted files, recent commits, active thread). Costs zero tokens; it is a local script. So however a session ends, the breadcrumb is at most one turn stale.
- **When you return (`SessionStart` hook):** a short brief is injected into the session: your active thread and next action, what shipped since you were last here, and drift flags (uncommitted work piling up, a stale cursor). This is the only piece that adds tokens, and only a few hundred, once per session.

## Optional: remote nudges

Claude Code plugins cannot create scheduled remote agents, but ClauDHD ships two ready-to-use routine prompts in [`routines/`](routines/): a daily drift sweep and a weekly idea-triage nudge. Set them up with the `/schedule` skill or at [claude.ai/code/routines](https://claude.ai/code/routines). See [routines/README.md](routines/README.md).

## How it stays out of your way

- Silent in any project without a `NOW.md`. Install it globally without worrying about noise.
- The `Stop` hook prints nothing and never blocks. It physically cannot loop or delay you.
- Everything is local files and git. Nothing is sent anywhere.

## Requirements

- Claude Code (provides Node).
- git, for the checkpoint and trophy-case features.

## License

MIT. See [LICENSE](LICENSE).

Built by a developer who kept losing the thread.
