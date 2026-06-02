# ClauDHD

Focus and drift control for [Claude Code](https://claude.com/claude-code).

ClauDHD is a small Claude Code plugin that remembers where you are in a project, so ending a session mid-thought doesn't lose you the thread. It's easy to wander off a task: you chase a new idea, switch branches, or close the tab and come back days later unsure where you were. Rather than trying to stop that, it writes your place down as you go, into a few plain Markdown files at the root of your repo, so picking the work back up means reading a file instead of reconstructing your own train of thought.

It has zero dependencies and runs on local files: no ClauDHD account, no ClauDHD server, and no network calls beyond normal Claude Code usage. It uses the Node.js runtime that Claude Code already bundles, plus ordinary git.

## What it gives you

- **A NOW cursor** (`NOW.md`). One active thread at a time, the next physical action, and an ordered queue behind it.
- **Session breadcrumbs.** A `Stop` hook writes a checkpoint after every turn, and a `SessionStart` hook greets your next session with "where you left off, what shipped, what is drifting." You never have to remember to checkpoint.
- **An idea inbox** (`IDEAS.md`). When an idea hits mid-task, `/claudhd:idea <it>` parks it in one line so you keep going instead of opening a new chat. Triage later with `/claudhd:triage`.
- **A trophy case** (`SHIPPED.md`). `/claudhd:shipped` pulls your finished commits into a visible, growing list.

## Quick Start

### 1. Install

```
/plugin marketplace add kidsmeal/ClauDHD
/plugin install claudhd@claudhd
```

If you install during an existing Claude Code session, run `/reload-plugins` to activate it. No restart is needed.

### 2. Verify installation

Confirm the plugin loaded and check which version you're on:

```
/claudhd:version
```

You should see a line like `ClauDHD v0.5.3`. If the command isn't recognized, the plugin didn't load — run `/reload-plugins` (or restart Claude Code) and try again.

### 3. Initialize a project

ClauDHD does nothing in a project until you opt in. In the project you want to manage:

```
/claudhd:init
```

That scaffolds `NOW.md`, `IDEAS.md`, and `SHIPPED.md` (without overwriting any you already have) and adds `.now/` to your `.gitignore`. Then Claude reads the repo, proposes your one active thread and its next tiny step, and you confirm or correct it. That is it.

Scope the cursor to the **work you're doing**, not the repo. If a feature spans several repos, run `/claudhd:init` in each and let each repo's `NOW.md` hold that repo's slice of it — there is no cross-repo cursor, by design (see [Non-goals](#non-goals)).

In every other repo, ClauDHD stays completely silent.

## Usage Flow

A normal day with ClauDHD is mostly the automatic hooks, plus a few commands when you need them. Once a project is initialized, the loop looks like this:

1. **Start where you left off.** Opening a session fires the `SessionStart` brief — your active thread, the next action, what shipped on this branch, and any drift flags. No command needed; read it and go.
2. **Work the one active thread.** `NOW.md` holds a single cursor: the thread, the next physical step, and the queue behind it. Lost the plot mid-session? `/claudhd:now` reprints the cursor.
3. **Park ideas instead of chasing them.** When something unrelated pops up, `/claudhd:idea <it>` drops it into `IDEAS.md` in one line so you keep moving.
4. **Snap back when you drift.** `/claudhd:regroup` names the drift, parks side-quests, and points you back at the active thread.
5. **Wrap up a chunk.** `/claudhd:wrap` reconciles `NOW.md` — checks off done steps, writes the next action, sweeps loose ends — so stopping now costs nothing later.
6. **Bank the wins.** After you commit, `/claudhd:shipped` pulls finished commits into `SHIPPED.md`.
7. **Tend the inbox.** Now and then, `/claudhd:triage` walks the idea inbox (promote / park / kill), and `/claudhd:harvest` backfills ideas you mentioned in past chats but never wrote down.

Through all of it, the `Stop` hook quietly checkpoints after every turn, so however a session ends your place is at most one turn stale.

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
| `/claudhd:version` | Print the installed version — confirms the plugin is active. |

## What runs automatically

Once `/claudhd:init` has set up a marked `NOW.md`:

- **On every turn (`Stop` hook):** a silent checkpoint is written to `.now/last-session.md`, plus a per-branch copy at `.now/branches/<branch>.md` (timestamp, branch, uncommitted files, recent commits, active thread). Costs zero tokens; it is a local script. So however a session ends, the breadcrumb is at most one turn stale — and it follows the branch you were on.
- **When you return (`SessionStart` hook):** a short brief is injected into the session: your active thread and next action, what shipped **on this branch** since you were last here, and drift flags (real uncommitted work piling up, a stale cursor). This is the only *automatic* piece that adds tokens, and only a few hundred, once per session.

## Your cursor follows the branch

If you switch branches a lot, your place in the work usually gets stashed and lost. ClauDHD fixes that without any new machinery, because `NOW.md` is committed and git does the hard part: `git checkout feature-x` swaps `NOW.md` to that branch's cursor, and switching back restores it. The breadcrumbs follow too — the `Stop` checkpoint is written per-branch, and the return brief shows where you left off **on this branch** and what shipped **on this branch**. Many small features in one repo, each on its own branch, each keeping its own cursor — no thread-juggling.

Because the cursor is meant to stay live and uncommitted between commits, the drift check ignores ClauDHD's own files (`NOW.md`, `IDEAS.md`, `SHIPPED.md`) — only your real changes trip the "uncommitted work piling up" flag.

**Solo vs. shared repos.** On your own repos, committing `NOW.md` is the whole trick and costs nothing. On a shared team repo you have a choice: commit `NOW.md` (it rides the branch, but your personal cursor shows up in diffs and PRs), or add `NOW.md` to `.gitignore` (no diff noise, but the active-thread cursor no longer auto-swaps on checkout — the per-branch breadcrumb under `.now/` still tracks where you stopped on each branch). ClauDHD commits `NOW.md` by default because that is what makes branch-tracking free.

## What it costs you

The engine is nearly free: the `Stop` hook is a pure local script (zero tokens), and the `SessionStart` brief adds only a few hundred tokens once per session (see above). The commands fall into three tiers:

- **Effectively zero** - `/claudhd:idea` and `/claudhd:shipped` run a local script and the model just confirms in a line.
- **Bounded** - `/claudhd:init`, `/claudhd:now`, `/claudhd:regroup`, `/claudhd:wrap`, and `/claudhd:triage` reason over a small, known scope (your cursor, the session already in context, repo signals, or one file) and edit. Cheap and predictable.
- **Scales with your history - `/claudhd:harvest`** is the deliberate exception, and the first command that reaches *outside* the current session: it reads your past chat transcripts, so its cost grows with how much history it scans. It is built to stay cheap anyway - it greps for idea signals instead of reading whole transcripts, and an incremental watermark means each run only sees sessions newer than the last harvest. A first run (or `--full`) over a long history is the one time ClauDHD spends real tokens; routine runs stay small. Use `/claudhd:harvest --dry-run` to preview what it would capture without writing anything.

ClauDHD itself makes no network calls. The command worth calling out is `/claudhd:harvest`, for *what it reads*: it reaches into your **past** session transcripts, where every other command only touches files you can already see and the session in front of you. Harvest has Claude read narrow snippets of those transcripts, so — like anything Claude reads — they enter the normal Claude Code model context. Use `--dry-run` first to preview what it would inspect before it writes.

## Optional: remote nudges

Claude Code plugins cannot create scheduled remote agents, but ClauDHD ships two ready-to-use routine prompts in [`routines/`](routines/): a daily drift sweep and a weekly idea-triage nudge. Set them up with the `/schedule` skill or at [claude.ai/code/routines](https://claude.ai/code/routines). See [routines/README.md](routines/README.md).

## How it stays out of your way

- Silent in any project without a ClauDHD-marked `NOW.md`. The hooks gate on a marker `/claudhd:init` writes, so an unrelated `NOW.md` in some other repo never triggers them. Install it globally without worrying about noise.
- The `Stop` hook prints nothing and never blocks. It physically cannot loop or delay you.
- Everything ClauDHD writes is local files and git. It does not call external services of its own.

## Non-goals

ClauDHD is single-cursor and single-checkout *by design*. These are deliberate "no"s, not unbuilt features:

- **No cross-repo / multi-repo "workspace" cursor.** A feature that spans several repos gets one cursor per repo, each scoped to its local slice. A global workspace view would mean cross-repo state and a sync layer — a heavier, different tool. You only ever type in one repo at a time, so the per-repo cursor already covers it.
- **No multi-agent orchestration.** It is a continuity and anti-drift tool, not a task runner or workflow harness.
- **One active thread per repo (or per branch).** The single-cursor constraint is the point — that limit is what keeps you finishing things instead of accumulating half-done threads.

## Requirements

- Claude Code (provides Node).
- git, for checkpoints and logging shipped commits.

## Development

Zero-dependency tests run on Node's built-in test runner:

```
npm test        # or: node --test   (from the repo root)
```

They spin up throwaway git repos and exercise the real scripts. See [test/](test/). Nothing under `test/` or `tools/` ships with the installed plugin.

## License

MIT. See [LICENSE](LICENSE).

Built by a developer who kept losing the thread.
