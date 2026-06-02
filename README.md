# ClauDHD

Focus and drift control for [Claude Code](https://claude.com/claude-code).

ClauDHD is a small Claude Code plugin that remembers where you are in a project, so ending a session mid-thought doesn't lose you the thread. It's easy to wander off a task: you chase a new idea, switch branches, or close the tab and come back days later unsure where you were. Rather than trying to stop that, it writes your place down as you go, into a few plain Markdown files at the root of your repo, so picking the work back up means reading a file instead of reconstructing your own train of thought.

It has zero dependencies and runs on local files: no ClauDHD account, no ClauDHD server, and no network calls beyond normal Claude Code usage. It uses the Node.js runtime that Claude Code already bundles, plus ordinary git.

## What it gives you

- **A NOW cursor** (`NOW.md`). One active thread at a time, the next physical action, and an ordered queue behind it.
- **Session breadcrumbs.** A `Stop` hook writes a checkpoint after every turn, and a `SessionStart` hook opens your next session with a summary: where you left off, what shipped, and what is drifting. You never have to remember to checkpoint.
- **An idea inbox** (`IDEAS.md`). When an idea comes up mid-task, `/claudhd:idea <text>` records it in one line so you can keep working instead of opening a new chat. Review it later with `/claudhd:triage`.
- **A shipped log** (`SHIPPED.md`). `/claudhd:shipped` adds your finished commits to a running list.

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

You should see a line like `ClauDHD v0.5.4`. If the command isn't recognized, the plugin didn't load — run `/reload-plugins` (or restart Claude Code) and try again.

### 3. Initialize a project

ClauDHD does nothing in a project until you opt in. In the project you want to manage:

```
/claudhd:init
```

That scaffolds `NOW.md`, `IDEAS.md`, and `SHIPPED.md` (without overwriting any you already have) and adds `.now/` to your `.gitignore`. Then Claude reads the repo, proposes your one active thread and its next tiny step, and you confirm or correct it. That is it.

Scope the cursor to the **work you're doing**, not the repo. If a feature spans several repos, run `/claudhd:init` in each and let each repo's `NOW.md` hold that repo's slice of it — there is no cross-repo cursor, by design (see [Non-goals](#non-goals)).

In every other repo, ClauDHD stays completely silent.

## Usage Flow

Once a project is initialized, most of ClauDHD runs through the automatic hooks; the commands cover the points where you act explicitly. A typical session:

1. **Resume a session.** Starting a session triggers the `SessionStart` hook, which injects a brief: your active thread, the next action, what shipped on this branch, and any drift flags. No command required.
2. **Check the current cursor.** `NOW.md` holds one cursor — the active thread, the next physical step, and the queue behind it. Run `/claudhd:now` to reprint it mid-session.
3. **Capture an idea.** `/claudhd:idea <text>` appends an unrelated idea to `IDEAS.md` as a single line, without changing the active thread.
4. **Refocus after drift.** `/claudhd:regroup` identifies the current drift, sets aside any side tasks, and returns you to the active thread.
5. **Reconcile before stopping.** `/claudhd:wrap` updates `NOW.md`: marks completed steps, records the next action, and closes out loose ends so the next session starts clean.
6. **Record shipped work.** After a commit, `/claudhd:shipped` adds the finished commits to `SHIPPED.md`.
7. **Process the idea inbox.** Periodically, `/claudhd:triage` reviews `IDEAS.md` (promote, park, or delete each entry), and `/claudhd:harvest` backfills ideas mentioned in past sessions that were never recorded.

Independent of the commands, the `Stop` hook writes a checkpoint after every turn, so the recorded position is never more than one turn behind, regardless of how a session ends.

## Commands

| Command | What it does |
|---|---|
| `/claudhd:init` | Scaffold the files, opt the project in, and propose your first active thread to confirm. |
| `/claudhd:now` | Show the cursor: active thread, recent shipped work, drift flags. |
| `/claudhd:regroup` | Mid-session reset: name the drift, set aside side tasks, and return to the active thread. |
| `/claudhd:wrap` | End-of-session wrap-up: reconcile `NOW.md` — mark completed steps, write the next action, close out loose ends. |
| `/claudhd:idea <text>` | Record an idea in `IDEAS.md` without interrupting your current thread. |
| `/claudhd:harvest` | Scan this project's past sessions and backfill uncaptured ideas into `IDEAS.md`. |
| `/claudhd:triage` | Review the inbox and promote, park, or delete each idea. |
| `/claudhd:shipped` | Add finished commits to `SHIPPED.md`. |
| `/claudhd:version` | Print the installed version — confirms the plugin is active. |

## What runs automatically

Once `/claudhd:init` has set up a marked `NOW.md`:

- **On every turn (`Stop` hook):** a silent checkpoint is written to `.now/last-session.md`, plus a per-branch copy at `.now/branches/<branch>.md` (timestamp, branch, uncommitted files, recent commits, active thread). Costs zero tokens; it is a local script. So however a session ends, the breadcrumb is at most one turn stale — and it follows the branch you were on.
- **When you return (`SessionStart` hook):** a short brief is injected into the session: your active thread and next action, what shipped **on this branch** since you were last here, and drift flags (real uncommitted work piling up, a stale cursor). This is the only *automatic* piece that adds tokens, and only a few hundred, once per session.

## Your cursor follows the branch

If you switch branches a lot, your place in the work usually gets stashed and lost. ClauDHD fixes that without any new machinery, because `NOW.md` is committed and git handles the swap: `git checkout feature-x` swaps `NOW.md` to that branch's cursor, and switching back restores it. The breadcrumbs follow too — the `Stop` checkpoint is written per-branch, and the return brief shows where you left off **on this branch** and what shipped **on this branch**. Many small features in one repo, each on its own branch, each keeping its own cursor, with no manual thread-tracking.

Because the cursor is meant to stay live and uncommitted between commits, the drift check ignores ClauDHD's own files (`NOW.md`, `IDEAS.md`, `SHIPPED.md`) — only your real changes trip the "uncommitted work piling up" flag.

**Solo vs. shared repos.** On your own repos, committing `NOW.md` is all that's required and costs nothing. On a shared team repo you have a choice: commit `NOW.md` (it follows the branch, but your personal cursor shows up in diffs and PRs), or add `NOW.md` to `.gitignore` (no diff noise, but the active-thread cursor no longer auto-swaps on checkout — the per-branch breadcrumb under `.now/` still tracks where you stopped on each branch). ClauDHD commits `NOW.md` by default because that is what makes branch-tracking free.

## What it costs you

The engine is nearly free: the `Stop` hook is a pure local script (zero tokens), and the `SessionStart` brief adds only a few hundred tokens once per session (see above). The commands fall into three tiers:

- **Effectively zero** - `/claudhd:idea` and `/claudhd:shipped` run a local script and the model just confirms in a line.
- **Bounded** - `/claudhd:init`, `/claudhd:now`, `/claudhd:regroup`, `/claudhd:wrap`, and `/claudhd:triage` reason over a small, known scope (your cursor, the session already in context, repo signals, or one file) and edit. Cheap and predictable.
- **Scales with your history - `/claudhd:harvest`** is the deliberate exception, and the first command that reaches *outside* the current session: it reads your past chat transcripts, so its cost grows with how much history it scans. It is built to stay cheap anyway - it greps for idea signals instead of reading whole transcripts, and an incremental watermark means each run only sees sessions newer than the last harvest. A first run (or `--full`) over a long history is the one time ClauDHD spends real tokens; routine runs stay small. Use `/claudhd:harvest --dry-run` to preview what it would capture without writing anything.

ClauDHD itself makes no network calls. The command worth calling out is `/claudhd:harvest`, for *what it reads*: it reaches into your **past** session transcripts, where every other command only touches files you can already see and the session in front of you. Harvest has Claude read narrow snippets of those transcripts, so — like anything Claude reads — they enter the normal Claude Code model context. Use `--dry-run` first to preview what it would inspect before it writes.

## Optional: scheduled reminders

Claude Code plugins cannot create scheduled remote agents, but ClauDHD ships two ready-to-use routine prompts in [`routines/`](routines/): a daily drift check and a weekly idea-triage reminder. Set them up with the `/schedule` skill or at [claude.ai/code/routines](https://claude.ai/code/routines). See [routines/README.md](routines/README.md).

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
