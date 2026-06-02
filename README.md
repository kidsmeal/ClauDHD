# ClauDHD

Focus and drift control for [Claude Code](https://claude.com/claude-code).

Most coding sessions don't get finished. You chase a new lead, switch context, or close the chat mid-thought, and your place in the work is gone. ClauDHD doesn't try to stop that. It keeps your place in a few plain files at the repo root and updates them as you go, so a session that ends abruptly is cheap to pick back up.

It is a small, zero-dependency plugin. No accounts, no servers, no data leaves your machine. Just Node (which Claude Code already ships with) and git.

## What it gives you

- **A NOW cursor** (`NOW.md`). One active thread at a time, the next physical action, and an ordered queue behind it.
- **Session breadcrumbs.** A `Stop` hook writes a checkpoint after every turn, and a `SessionStart` hook greets your next session with "where you left off, what shipped, what is drifting." You never have to remember to checkpoint.
- **An idea inbox** (`IDEAS.md`). When an idea hits mid-task, `/claudhd:idea <it>` parks it in one line so you keep going instead of opening a new chat. Triage later with `/claudhd:triage`.
- **A trophy case** (`SHIPPED.md`). `/claudhd:shipped` pulls your finished commits into a visible, growing list.

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

That scaffolds `NOW.md`, `IDEAS.md`, and `SHIPPED.md` (without overwriting any you already have) and adds `.now/` to your `.gitignore`. Then Claude reads the repo, proposes your one active thread and its next tiny step, and you confirm or correct it. That is it.

In every other repo, ClauDHD stays completely silent.

## Commands

| Command | What it does |
|---|---|
| `/claudhd:init` | Scaffold the files, opt the project in, and propose your first active thread to confirm. |
| `/claudhd:now` | Show the cursor: active thread, recent wins, drift flags. |
| `/claudhd:regroup` | Mid-session reset: name the drift, park side-quests, snap back to the active thread. |
| `/claudhd:wrap` | End-of-chunk wrap-up: reconcile `NOW.md` - check off done steps, write the next action, sweep loose ends. |
| `/claudhd:idea <text>` | Park an idea in `IDEAS.md` without breaking your current thread. |
| `/claudhd:harvest` | Scan this project's past chats and backfill un-captured ideas into `IDEAS.md`. |
| `/claudhd:triage` | Walk the inbox and promote, park, or kill each idea. |
| `/claudhd:shipped` | Pull finished commits into `SHIPPED.md` and show the wins. |

## What runs automatically

Once `/claudhd:init` has set up a marked `NOW.md`:

- **On every turn (`Stop` hook):** a silent checkpoint is written to `.now/last-session.md` (timestamp, branch, uncommitted files, recent commits, active thread). Costs zero tokens; it is a local script. So however a session ends, the breadcrumb is at most one turn stale.
- **When you return (`SessionStart` hook):** a short brief is injected into the session: your active thread and next action, what shipped since you were last here, and drift flags (uncommitted work piling up, a stale cursor). This is the only *automatic* piece that adds tokens, and only a few hundred, once per session.

## What it costs you

The engine is nearly free: the `Stop` hook is a pure local script (zero tokens), and the `SessionStart` brief adds only a few hundred tokens once per session (see above). The commands fall into three tiers:

- **Effectively zero** - `/claudhd:idea` and `/claudhd:shipped` run a local script and the model just confirms in a line.
- **Bounded** - `/claudhd:init`, `/claudhd:now`, `/claudhd:regroup`, `/claudhd:wrap`, and `/claudhd:triage` reason over a small, known scope (your cursor, the session already in context, repo signals, or one file) and edit. Cheap and predictable.
- **Scales with your history - `/claudhd:harvest`** is the deliberate exception, and the first command that reaches *outside* the current session: it reads your past chat transcripts, so its cost grows with how much history it scans. It is built to stay cheap anyway - it greps for idea signals instead of reading whole transcripts, and an incremental watermark means each run only sees sessions newer than the last harvest. A first run (or `--full`) over a long history is the one time ClauDHD spends real tokens; routine runs stay small. Use `/claudhd:harvest --dry-run` to preview what it would capture without writing anything.

Either way nothing leaves your machine - `/claudhd:harvest` reads transcript files already on disk and sends nothing anywhere.

## Optional: remote nudges

Claude Code plugins cannot create scheduled remote agents, but ClauDHD ships two ready-to-use routine prompts in [`routines/`](routines/): a daily drift sweep and a weekly idea-triage nudge. Set them up with the `/schedule` skill or at [claude.ai/code/routines](https://claude.ai/code/routines). See [routines/README.md](routines/README.md).

## How it stays out of your way

- Silent in any project without a ClauDHD-marked `NOW.md`. The hooks gate on a marker `/claudhd:init` writes, so an unrelated `NOW.md` in some other repo never triggers them. Install it globally without worrying about noise.
- The `Stop` hook prints nothing and never blocks. It physically cannot loop or delay you.
- Everything is local files and git. Nothing is sent anywhere.

## Requirements

- Claude Code (provides Node).
- git, for checkpoints and logging shipped commits.

## License

MIT. See [LICENSE](LICENSE).

Built by a developer who kept losing the thread.
