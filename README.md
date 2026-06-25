# ClauDHD

Focus and drift control for [Claude Code](https://claude.com/claude-code).

ClauDHD is a small Claude Code plugin that keeps track of where you are in a
project. It is easy to wander off a task: you chase a new idea, switch
branches, or close the tab and come back days later unsure where you were.
ClauDHD writes your place down as you go, in a few plain Markdown files at the
root of your repo. When you come back, you read a file instead of
reconstructing your own train of thought.

It has zero dependencies and runs entirely on local files. There is no ClauDHD
account or server, and it makes no network calls beyond normal Claude Code
usage. It uses the Node.js runtime that Claude Code already bundles, plus
ordinary git.

## What it gives you

- **A NOW cursor** (`NOW.md`). One active thread at a time, the next physical
  action, and an ordered queue behind it.
- **Session breadcrumbs.** A `Stop` hook writes a checkpoint after every turn,
  and a `SessionStart` hook hands Claude a brief before your first message:
  where you left off, what shipped, and what is drifting. The brief goes into
  Claude's context, so nothing prints on screen, but Claude starts the session
  knowing where you were. Run `/claudhd:now` to read the same brief yourself.
- **An idea inbox** (`IDEAS.md`). When an idea comes up mid-task,
  `/claudhd:idea <text>` records it in one line so you can keep working
  instead of opening a new chat. Review it later with `/claudhd:triage`.
- **A roadmap** (`ROADMAP.md`). The committed, ordered lane between the idea
  inbox and the active cursor: what you have decided to do and in what order,
  before any of it goes live. `/claudhd:roadmap` shows it or adds an intent.
  One cursor still rules; the roadmap orders many, `NOW.md` points at one.
- **A quick-fixes lane** (`/claudhd:quick`). Small self-contained chores go
  into a capped batch in `NOW.md` and get cleared in one focused pass, so they
  skip the queue without turning into a second backlog.
- **A shipped log** (`SHIPPED.md`). `/claudhd:shipped` adds your finished
  commits to a running list.

## Quick start

### 1. Install

```
/plugin marketplace add kidsmeal/ClauDHD
/plugin install claudhd@claudhd
```

If you install during an existing Claude Code session, run `/reload-plugins`
to activate it. No restart is needed.

### 2. Verify the install

```
/claudhd:version
```

You should see a line like `ClauDHD v0.7.0`. If the command isn't recognized,
the plugin didn't load. Run `/reload-plugins` (or restart Claude Code) and try
again.

### 3. Initialize a project

ClauDHD does nothing in a project until you opt in. In the project you want to
manage:

```
/claudhd:init
```

That scaffolds `NOW.md`, `IDEAS.md`, `SHIPPED.md`, and `ROADMAP.md` (without
overwriting any you already have) and adds `.now/` to your `.gitignore`. Claude then reads the
repo, proposes your one active thread and its next step, and you confirm or
correct it.

The cursor tracks one piece of work. If a feature spans several repos, run
`/claudhd:init` in each repo so each `NOW.md` holds that repo's slice of the
work. There is no cross-repo cursor (see [Non-goals](#non-goals)).

In every other repo, ClauDHD stays silent.

## Usage flow

Once a project is initialized, most of ClauDHD runs through the automatic
hooks. The commands cover the points where you act explicitly. A typical
session:

1. **Resume.** Starting a session fires the `SessionStart` hook, which gives
   Claude your active thread, the next action, what shipped on this branch,
   and any drift flags. Nothing prints to the screen; the brief goes straight
   into Claude's context, so the session looks empty until you speak, but
   Claude's first reply already knows where you left off. Run `/claudhd:now`
   if you want to read the brief yourself.
2. **Check the cursor.** `NOW.md` holds the active thread, the next physical
   step, and the queue behind it. Run `/claudhd:now` to reprint it
   mid-session.
3. **Capture an idea.** `/claudhd:idea <text>` appends an unrelated idea to
   `IDEAS.md` as a single line, without changing the active thread.
4. **Refocus after drift.** `/claudhd:regroup` names the current drift, sets
   aside any side tasks, and returns you to the active thread.
5. **Reconcile before stopping.** `/claudhd:wrap` updates `NOW.md`: it marks
   completed steps, records the next action, and closes out loose ends so the
   next session starts clean.
6. **Record shipped work.** After a commit, `/claudhd:shipped` adds the
   finished commits to `SHIPPED.md`.
7. **Process the idea inbox.** Periodically, run `/claudhd:triage` to review
   `IDEAS.md` and promote, park, or delete each entry. Promotion runs a
   readiness gate so half-formed ideas don't reach the cursor, and small
   chores get routed to the quick-fixes batch. `/claudhd:harvest` backfills
   ideas mentioned in past sessions that were never recorded.

Small self-contained chores don't need the full loop. `/claudhd:quick <text>`
adds one to a capped batch in `NOW.md` with a single local write that costs no
tokens. Run `/claudhd:quick` with no argument to clear the batch in one pass;
anything that turns out to need real thinking gets kicked back to `IDEAS.md`.
The batch is a list of chores rather than a second active thread, so the
single-cursor rule still holds.

Independent of the commands, the `Stop` hook writes a checkpoint after every
turn, so the recorded position is never more than one turn behind, regardless
of how a session ends.

## Commands

| Command | What it does |
|---|---|
| `/claudhd:init` | Scaffold the files, opt the project in, and propose your first active thread to confirm. |
| `/claudhd:now` | Show the cursor: active thread, recent shipped work, drift flags. |
| `/claudhd:regroup` | Mid-session reset: name the drift, set aside side tasks, and return to the active thread. |
| `/claudhd:wrap` | End-of-session wrap-up: mark completed steps, write the next action, close out loose ends. |
| `/claudhd:idea <text>` | Record an idea in `IDEAS.md` without interrupting your current thread. |
| `/claudhd:harvest` | Scan this project's past sessions and backfill uncaptured ideas into `IDEAS.md`. |
| `/claudhd:triage` | Review the inbox and promote, park, or delete each idea (or route a small one to quick fixes). |
| `/claudhd:roadmap [intent]` | Show the project roadmap, or add a committed intent to it (the ordered lane between the idea inbox and the active cursor). |
| `/claudhd:quick [text]` | Add a small chore to the quick-fixes batch, or (no argument) clear the batch in one focused pass. |
| `/claudhd:shipped` | Add finished commits to `SHIPPED.md`. |
| `/claudhd:version` | Print the installed version to confirm the plugin is active. |

## What runs automatically

Once `/claudhd:init` has set up a marked `NOW.md`:

- **On every turn (`Stop` hook):** a silent checkpoint is written to
  `.now/last-session.md`, plus a per-branch copy at
  `.now/branches/<branch>.md` with the timestamp, branch, uncommitted files,
  recent commits, and active thread. It is a local script and costs no tokens.
  The breadcrumb is at most one turn old no matter how the session ends.
- **When you return (`SessionStart` hook):** a short brief is injected into
  Claude's context, without being printed to you: your active thread and next
  action, what shipped on this branch since you were last here, and drift
  flags (uncommitted work piling up, or a cursor untouched for more than 72
  hours). This is the only automatic piece that adds tokens, a few hundred
  once per session.

## Optional: statusline

Claude Code can run a script every time the status bar updates and show its
output as a one-line indicator. `/claudhd:statusline` wires ClauDHD into that
slot. It prints the active thread name, a quick-fixes count (`q:<n>`) when the
batch is non-empty, and `[stale]` when the cursor hasn't been touched in over
72 hours.

The command writes a `statusLine` entry into the project's
`.claude/settings.json`. The path it writes is the installed plugin's current
cache location, which changes when the plugin updates. Re-running the command
after an update repairs it.

The script reads only local files and makes no git calls, so it runs in well
under a second and is safe to call on every status bar tick.

## Branch switching

If you switch branches a lot, your place in the work usually gets lost along
with your stash. ClauDHD avoids that without any new machinery, because
`NOW.md` is committed and git handles the swap: `git checkout feature-x`
brings up that branch's cursor, and switching back restores the previous one.
The breadcrumbs follow too, since the `Stop` checkpoint is written per branch
and the return brief reports what happened on the current branch. Each feature
branch keeps its own cursor with no manual tracking.

The drift check ignores ClauDHD's own files (`NOW.md`, `IDEAS.md`,
`SHIPPED.md`, `ROADMAP.md`), since the cursor is meant to stay live and uncommitted between
commits. Only your real changes trip the "uncommitted work piling up" flag.

On your own repos, committing `NOW.md` is all you need. On a shared team repo
you have a choice. Commit `NOW.md` and the cursor follows branches, but your
personal cursor shows up in diffs and PRs. Or add it to `.gitignore` for no
diff noise, at the cost of the cursor no longer swapping on checkout (the
per-branch breadcrumb under `.now/` still tracks where you stopped on each
branch). The default is to commit it, because that is what makes branch
tracking free.

## Token cost

The hooks are nearly free. The `Stop` hook is a local script that costs no
tokens, and the `SessionStart` brief adds a few hundred tokens once per
session. The commands fall into three tiers:

- **Effectively zero.** `/claudhd:idea`, `/claudhd:quick <text>`, and
  `/claudhd:shipped` run a local script; the model only confirms in a line.
  (Clearing the batch with bare `/claudhd:quick` costs as much as making the
  small fixes themselves.)
- **Bounded.** `/claudhd:init`, `/claudhd:now`, `/claudhd:regroup`,
  `/claudhd:wrap`, and `/claudhd:triage` reason over a small known scope (your
  cursor, the current session, repo signals, or one file) and edit, so the
  cost stays small and predictable.
- **Scales with your history.** `/claudhd:harvest` reads your past chat
  transcripts, so its cost grows with how much history it scans. It greps for
  idea signals instead of reading whole transcripts, and an incremental
  watermark means each run only sees sessions newer than the last harvest. A
  first run (or `--full`) over a long history is the one time ClauDHD spends
  real tokens; routine runs stay small.

One privacy note on `/claudhd:harvest`: it is the only command that reads your
past session transcripts. The snippets it reads enter the normal Claude Code
model context, like anything else Claude reads. Every other command only
touches files in the repo and the session in front of you. Use
`/claudhd:harvest --dry-run` to preview what it would inspect before it writes
anything.

## Optional: scheduled reminders

Claude Code plugins cannot create scheduled remote agents, but ClauDHD ships
two ready-to-use routine prompts in [`routines/`](routines/): a daily drift
check and a weekly idea-triage reminder. Set them up with the `/schedule`
skill or at [claude.ai/code/routines](https://claude.ai/code/routines). See
[routines/README.md](routines/README.md).

## How it stays out of your way

- It is silent in any project without a ClauDHD-marked `NOW.md`. The hooks
  gate on a marker that `/claudhd:init` writes, so an unrelated `NOW.md` in
  another repo never triggers them. You can install it globally without noise.
- The `Stop` hook prints nothing and never blocks.
- Everything it writes is local files and git. It calls no external services
  of its own.

## Non-goals

These are deliberate design limits:

- **No cross-repo workspace cursor.** A feature that spans several repos gets
  one cursor per repo, each scoped to its local slice. A global workspace view
  would require cross-repo state and a sync layer, which would be a heavier
  and different tool. You only type in one repo at a time, so the per-repo
  cursor covers it.
- **No multi-agent orchestration.** ClauDHD is a continuity tool; it does not
  run tasks or orchestrate workflows.
- **One active thread per repo (or per branch).** The single-cursor limit is
  what keeps you finishing things instead of accumulating half-done threads.

## Requirements

- Claude Code (provides Node).
- git, for checkpoints and logging shipped commits.

## Development

Zero-dependency tests run on Node's built-in test runner:

```
npm test        # or: node --test   (from the repo root)
```

They spin up throwaway git repos and exercise the real scripts. See
[test/](test/). Nothing under `test/` or `tools/` ships with the installed
plugin.

## License

MIT. See [LICENSE](LICENSE).
