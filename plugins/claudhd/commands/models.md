---
description: View or change which model backend each pipeline role runs on
argument-hint: '[role backend [model]]  (e.g. "phase-reviewer codex gpt-5.5")'
---
!`node "${CLAUDE_PLUGIN_ROOT}/scripts/role.js" show`
!`node "${CLAUDE_PLUGIN_ROOT}/scripts/role.js" detect`

Arguments: $ARGUMENTS

The current role-to-backend assignments and the available external CLIs are printed above. `.gantry/models.json` is the source of truth (the file keeps this path in 1.0; it is not tidied into `.now/`). Each role names a `backend`, and each backend names how to run it.

**Backend types**
- `native`: the in-session Claude Code subagent (the default). Hooks fire.
- `claude-headless`: a `claude -p` subprocess. Same harness, so hooks fire. Add `base_url` + `env_key` to swap in any Anthropic-compatible brain while keeping the Claude Code harness.
- `cli`: a first-party external agent CLI (e.g. `codex`). Brings its own tools.
- `openai-compat`: reach any OpenAI-compatible model through Codex by selecting a provider defined once in `~/.codex/config.toml` under `[model_providers.<name>]`.

**The one hard rule:** the **implementer** must use `native` or `claude-headless`. Those run inside the Claude Code harness, so the phase-enforcement hooks (file-list guard, commit guard) fire. `role.js` refuses any other implementer backend; it would void the hooks. Reviewers and the planner have no such restriction.

claudhd 1.0 ships primary-reviewer-only: each role runs on exactly one configured backend, with no second-opinion pass.

**If `$ARGUMENTS` names a change** (a role plus a backend, optionally a model):
1. Ensure the config exists: run `node "${CLAUDE_PLUGIN_ROOT}/scripts/role.js" write-default` (no-op if present).
2. Read `.gantry/models.json`, set that role's `backend` (and `model` if given). If the named backend is not defined yet, add it; ask me for the missing pieces (`cmd`/`sandbox` for a `cli`, `base_url`+`env_key` for a brain-swap `claude-headless`, `provider` for `openai-compat`) rather than guessing. Examples:
   - `"codex": { "type": "cli", "cmd": "codex exec --model {model} --sandbox {sandbox} --skip-git-repo-check", "promptVia": "stdin", "sandbox": "workspace-write" }`
   - `"kimi": { "type": "claude-headless", "base_url": "https://api.moonshot.ai/anthropic", "env_key": "MOONSHOT_API_KEY" }` (implementer-eligible)
   - `"deepseek": { "type": "openai-compat", "provider": "deepseek", "sandbox": "workspace-write" }`
3. Re-run `node "${CLAUDE_PLUGIN_ROOT}/scripts/role.js" show` and relay the result. If it reports an ERROR for any role (e.g. an implementer routed off-harness), the change is invalid; revert that role and tell me why.
4. If the chosen backend needs an API key (`env_key`), remind me to export it; if it is a `cli`/`openai-compat`, remind me the CLI must be installed and authed (`codex login`).

**If `$ARGUMENTS` is empty**, just explain the current setup shown above and how to change it. Do not edit anything.

Never route the implementer off the Claude Code harness. Never invent a backend's connection details.
