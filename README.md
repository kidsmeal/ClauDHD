# ClauDHD

Focus and drift control for [Claude Code](https://claude.com/claude-code), with a reviewed build pipeline.

ClauDHD keeps track of where you are in a project and enforces the phase boundary while you get there. Work drifts: threads stall half-done and changes ship without review. ClauDHD writes your place down as you go, in a few plain Markdown files at the root of your repo, and holds a hard gate around what you can edit while a phase is in flight. Coming back, you read a file instead of reconstructing your own train of thought, and the docs are already true at every commit.

It has zero dependencies and runs entirely on local files plus ordinary git. There is no ClauDHD account or server, and it makes no network calls beyond normal Claude Code usage (or an external model backend you configure yourself for a review role). It uses the Node.js runtime Claude Code already bundles.

## Three layers

| layer | lives in | guarantee |
|---|---|---|
| enforce + reconcile | Claude Code hooks | hard, cannot be bypassed |
| drive + orient | chat (commands, boards) | the board rides your first reply; `/claudhd:now` on demand |
| glance + dispatch | a companion app (optional, out of this repo) | always visible, live, model-free |

The hooks are the only layer that cannot be talked around: a `PreToolUse` guard denies an edit outside the active mode's allowlist, and a second guard denies `git commit`/`git push` while a phase is mid-review, both fail-open on any hook error so a bug here can never brick your repo. Chat is where you drive: sixteen commands cover capture, triage, design, the phased build, and review. The board renders as a widget when the harness provides one, otherwise as the same board in plain text, which is the acceptance baseline.

## What it gives you

- **A generated NOW cursor** (`NOW.md`). Mode, position, the active thread, and the queue behind it. The facts render from `.now/state.json`; only the active thread's two lines are yours to keep current. It stays a real committed file, so `git checkout` swaps the cursor to that branch's thread and `git log -p NOW.md` is an honest history.
- **Mode-enforced phases.** Design mode allows `*.md` edits only; build mode allows exactly the active phase's file list; idle denies source edits and leaves markdown editable. The guard is deny-by-default once a project opts in, with `/claudhd:override` as a loud, recorded escape hatch for the rare genuinely unscoped edit.
- **A commit-boundary reconcile.** Every `git commit` inside a session regenerates `NOW.md`, the plan's per-phase status, the `SHIPPED.md` entry, and the roadmap item's state, then stages them onto the same commit. There is no `/claudhd:wrap` to remember; the machine does it when you commit.
- **An idea inbox** (`IDEAS.md`) and **tap-card triage**. `/claudhd:idea <text>` captures verbatim, in one line, at zero tokens. `/claudhd:triage` renders each open idea as a card (roadmap / quick fix / drop / skip / discuss) and applies your tap through the plugin's own mechanical write vocabulary. Your wording is preserved verbatim.
- **A roadmap with stable ids** (`ROADMAP.md`). Every item carries a generated `r-MMDD-N` id, rendered beside its text. `/claudhd:start <id>` is the readiness gate: it restates a vague item concretely and activates a design thread.
- **A design grill and review gate.** `/claudhd:design` interrogates the open decisions one fork at a time, tracks a live resolved/open board, writes the design doc, then hands it to a design-reviewer before `/claudhd:plan` turns it into phases.
- **A phased build with a reviewed commit gate.** `/claudhd:build` implements one phase tests-first inside the guard; `/claudhd:review` reviews the diff, relays any required fixes back through a re-review that carries prior rounds as settled context, and opens the commit gate only on a clean verdict (or your explicit overrule, logged). Primary-reviewer-only: there is no second-opinion pass.
- **A quick-fixes lane** (`/claudhd:quick`). Small, self-contained chores go into a capped batch and clear in one focused pass, under the same guard as any other source edit, via a sentinel scoped to just that batch.

## Quick start

### 1. Install

```
/plugin marketplace add kidsmeal/ClauDHD
/plugin install claudhd@claudhd
```

If you install during an existing Claude Code session, run `/reload-plugins` to activate it. No restart is needed.

### 2. Verify the install

```
/claudhd:version
```

You should see a line like `ClauDHD v1.0.0`. If the command is not recognized, the plugin did not load. Run `/reload-plugins` (or restart Claude Code) and try again.

### 3. Initialize a project

ClauDHD does nothing in a project until you opt in. In the project you want to manage:

```
/claudhd:init
```

That scaffolds `NOW.md`, `IDEAS.md`, `SHIPPED.md`, `ROADMAP.md` (without overwriting any you already have), the two living pipeline docs, `.gantry/models.json`, and the `.gitignore` entries for the plugin's own local state. Claude then reads the repo, proposes your one active thread and its next step, and you confirm or correct it. It also asks, plainly, whether to enable the enforcement hooks; say yes to make mode enforcement mechanical rather than a promise, or no to keep everything at prompt level for now (you can re-run the opt-in step later).

In every other repo, ClauDHD stays silent.

## Commands

| Command | What it does |
|---|---|
| `/claudhd:now` | The mode-aware board: phases in build mode, decisions in design mode, the cursor and drift flags otherwise. |
| `/claudhd:idea <text>` | Capture an idea to `IDEAS.md`, verbatim, without breaking your current thread. |
| `/claudhd:harvest` | Mine past sessions for ideas that were raised but never captured. |
| `/claudhd:triage` | Tap-card triage of the idea inbox: promote, quick-fix, drop, skip, or discuss each one. |
| `/claudhd:roadmap [intent]` | View the roadmap, or add a committed intent to it. |
| `/claudhd:start <id>` | Activate a roadmap item: the readiness gate, restating it concretely and entering design mode. |
| `/claudhd:design` | Grill an idea to a resolved decision set, write the design doc, and audit it. |
| `/claudhd:plan` | Turn a finalized design doc into a phased implementation plan. |
| `/claudhd:build <plan> <phase>` | Implement exactly one phase, tests-first, inside the mode guard. |
| `/claudhd:review <plan> <phase>` | Review the phase's diff, relay fixes with settled re-review context, open the commit gate. |
| `/claudhd:quick [text]` | Add a chore to the quick-fixes batch, or (no argument) clear the batch under a scoped sentinel. |
| `/claudhd:override` | A loud, recorded escape hatch for a genuinely unscoped edit. |
| `/claudhd:audit` | Reconcile the currentness audit and the runtime verification queue against real code and commits. |
| `/claudhd:init` | Scaffold the file set, the pipeline docs, and the enforcement opt-in. |
| `/claudhd:models` | View or change which model backend each pipeline role runs on. |
| `/claudhd:version` | Print the installed version, to confirm the plugin is active. |

## Modes

| mode | source edits | doc/design edits | entered by |
|---|---|---|---|
| build (sentinel present) | only the active phase's file list | only if in the phase's file/allow list (plan, audit docs, ROADMAP.md, NOW.md for `/claudhd:quick`); there is no generic `*.md` allowance in build mode | `/claudhd:build`, `/claudhd:quick` |
| design | denied, with reason | allowed (`*.md` generally) | `/claudhd:start`, `/claudhd:design` |
| idle (neither) | denied | allowed (`*.md` generally) | pick a mode |

Mode lives only in `.now/state.json`; there is no sibling marker file. A repo without the activation marker (`.now/enabled`, written by `/claudhd:init`'s explicit opt-in) is entirely inert: the guards never deny anything there, and the commit-boundary reconcile never touches it.

## The mechanical write vocabulary

Triage and roadmap decisions run as scripts, with no model involved. Five verbs (`append-capture`, `move`, `mark`, `reorder`, `park`) live in `plugins/claudhd/scripts/vocab.js`, both as an importable module and a CLI, and are the only write path chat's `/claudhd:triage` uses for a mechanical decision. The only verb that accepts free text is `append-capture`, defined to carry a capture through unchanged. Promotion is verbatim: the idea reaches the roadmap in your exact words. The full contract, including the optimistic-concurrency rule that protects a tap against a capture landing mid-render, lives in `docs/SCRIPT-VOCABULARY.md`. `docs/STATE-SCHEMA.md` is the matching contract for `.now/state.json` itself.

## What runs automatically

Once `/claudhd:init` has set up a marked `NOW.md`:

- **On every turn (`Stop` hook):** a silent checkpoint is written to `.now/last-session.md`, plus a per-branch copy at `.now/branches/<branch>.md`, and `.now/state.json` is regenerated. Local script, no tokens.
- **When you return (`SessionStart` hook):** a short brief is injected into Claude's context, without being printed to you: your active thread and next action, what shipped on this branch since you were last here, and drift flags. This is the only automatic piece that adds tokens, a few hundred once per session.
- **Before every `Edit`/`Write`/`MultiEdit` (`PreToolUse` guard, opt-in only):** the path is checked against the active mode's allowlist. A denial explains why and names the remedy command.
- **Before every `git commit`/`git push` (`PreToolUse` guard, opt-in only):** a commit mid-build without a clean review is denied. A commit the guard allows also triggers the reconcile: `NOW.md`, the plan's phase status, `SHIPPED.md`, and the roadmap item's state all regenerate and stage onto the same commit.

## Branch switching

`NOW.md` is committed, so git handles the swap: `git checkout feature-x` brings up that branch's cursor, and switching back restores the previous one. The breadcrumbs follow too, since the `Stop` checkpoint is written per branch. Each feature branch keeps its own cursor with no manual tracking.

The drift check ignores ClauDHD's own files (`NOW.md`, `IDEAS.md`, `SHIPPED.md`, `ROADMAP.md`), since the cursor is meant to stay live and uncommitted between commits. Only your real changes trip the "uncommitted work piling up" flag.

## Token cost

The hooks are nearly free. The `Stop` hook is a local script that costs no tokens, and the `SessionStart` brief adds a few hundred tokens once per session. `/claudhd:idea`, `/claudhd:quick <text>`, and idea capture through `/claudhd:triage` run a local script; the model only confirms in a line. `/claudhd:build`, `/claudhd:review`, `/claudhd:design`, and `/claudhd:plan` dispatch to a subagent or an external reviewer CLI (`/claudhd:models` controls which); their cost scales with the work itself; ClauDHD's bookkeeping adds nothing to it. `/claudhd:harvest` reads your past chat transcripts, greps for idea signals rather than reading whole transcripts, and keeps an incremental watermark so routine runs stay small.

One privacy note on `/claudhd:harvest`: it is the only command that reads your past session transcripts. Every other command only touches files in the repo and the session in front of you. Use `/claudhd:harvest --dry-run` to preview what it would inspect before it writes anything.

## Optional: scheduled reminders

Claude Code plugins cannot create scheduled remote agents, but ClauDHD ships two ready-to-use routine prompts in [`routines/`](routines/): a daily drift check and a weekly idea-triage reminder. Set them up with the `/schedule` skill or at [claude.ai/code/routines](https://claude.ai/code/routines). See [routines/README.md](routines/README.md).

## How it stays out of your way

- It is silent in any project without a ClauDHD-marked `NOW.md`. The hooks gate on a marker that `/claudhd:init` writes, so an unrelated `NOW.md` in another repo never triggers them. You can install it globally without noise.
- Enforcement itself is a second, explicit opt-in on top of that (`.now/enabled`), so a project can adopt the file set at prompt level before ever turning the guard on.
- The `Stop` hook prints nothing and never blocks. Every guard fails open on a crash, malformed input, or an unresolvable project root.
- Everything it writes is local files and git. It calls no external services of its own.

## Non-goals

These are deliberate design limits:

- **No cross-repo workspace cursor.** A feature that spans several repos gets one cursor per repo, each scoped to its local slice.
- **No commits on your behalf.** Every guard and every reviewer stops short of the commit itself. You always gate the commit.
- **One active thread per repo (or per branch).** The single-cursor limit is what keeps you finishing things instead of accumulating half-done threads.

## Requirements

- Claude Code (provides Node).
- git, for checkpoints, the commit-boundary reconcile, and logging shipped commits.
- Optionally, the `codex` CLI on PATH as an alternative backend for both review roles; `/claudhd:init` detects it and offers to route them through it instead of native.

## Development

Zero-dependency tests run on Node's built-in test runner:

```
npm test        # or: node --test   (from the repo root)
```

They spin up throwaway git repos and exercise the real scripts. See [test/](test/). Nothing under `test/` or `tools/` ships with the installed plugin.

## License

MIT. See [LICENSE](LICENSE).
