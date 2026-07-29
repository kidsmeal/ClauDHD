---
description: Set up ClauDHD in the current project - the file set, the pipeline docs, and the enforcement opt-in
allowed-tools: Bash(node:*), Read, Edit
---
!`node "${CLAUDE_PLUGIN_ROOT}/scripts/init.js"`

ClauDHD is now scaffolded: `NOW.md`, `IDEAS.md`, `SHIPPED.md`, `ROADMAP.md` (any existing ones kept, never overwritten), the two living pipeline docs, `.gantry/models.json`, and the `.gitignore` entries for the plugin's own local state. Use the repo signals printed above (branch, recent commits, uncommitted files) to set up my first active thread. Do not make me name it cold:

1. **Propose one active thread.** From what looks in-flight in the repo, name the single most likely thing I'm working on, in a few words.
2. **Propose its next physical action.** One concrete step I could start in under a minute.
3. **Ask me to confirm or correct** both, in one short prompt. If the repo signals are empty (fresh project), skip the guess and just ask me what I'm focusing on.

Once I confirm, set the cursor through the state writer, not a hand-edit, so NOW.md's generated shape and `.now/state.json` never disagree: `node ${CLAUDE_PLUGIN_ROOT}/scripts/thread.js set-intent "<thread name>" "<next action>"`.

## Enable enforcement (explicit opt-in, do not skip past this)

Ask me directly, do not assume the answer: **"Enable ClauDHD's enforcement hooks for this project? (blocks out-of-phase edits and mid-build commits; opt-in, fail-open)"**

- If I say yes: run `node "${CLAUDE_PLUGIN_ROOT}/scripts/init.js" --enable-hooks`. This writes `.now/enabled`, the marker both guards AND the commit-boundary reconcile gate on. A project without this marker (or the legacy `.gantry/enabled`) is entirely inert; nothing below fires in it.
- If I say no or do not answer: do nothing further here. The hooks stay inert, and the pipeline commands below still work at prompt level, just without the mechanical guard.

## Finish wiring the pipeline

1. From the printed "Convention/style files found" and "Detected stack(s)", confirm with me the single **test** command and the single **build/lint** command the agents should rely on. If detection found nothing, ask me for them.
2. If no convention file was found, tell me the agents will fall back to matching the surrounding code, and offer to help write a short `CONVENTIONS.md` later (do not write it now). Separately, offer a short `docs/ARCHITECTURE.md`: a coarse map of the main modules plus the gotchas grep cannot surface. The planner reads it before decomposing a feature. Offer it, do not write it now, and never generate an exhaustive file inventory; coarse and true, or skip it.
3. From the printed "Model backends" section, mention it in one line: both reviewers route to `codex` when the codex CLI showed `[found]` (otherwise native fallback), every other role is the native in-session Claude subagent, and `/claudhd:models` can change any of it. The implementer stays on the Claude Code harness so the enforcement hooks always fire. Do not change any backend now unless I ask.
4. Tell me the loop I now have, one line each: `/claudhd:idea` / `/claudhd:harvest` / `/claudhd:triage` to build the roadmap, `/claudhd:start <id>` to activate one, `/claudhd:design` then `/claudhd:plan` to get a phased plan, `/claudhd:build` then `/claudhd:review` per phase, plus `/claudhd:quick` for small stuff and `/claudhd:audit` for keeping the docs honest.

Do not start any work. This command only sets up the pipeline.
