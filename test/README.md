# Tests

Zero-dependency tests for the ClauDHD scripts, using Node's built-in test runner. They spin up throwaway git repos in the OS temp dir and run the real scripts against them.

```
node --test      # or: npm test   (run from the repo root)
```

Requires Node 18+ (bundled with Claude Code) and git. Nothing here ships with the installed plugin — the plugin lives in [`../plugins/claudhd`](../plugins/claudhd) and stays dependency-free. Shared test helpers and fixtures live in [`../tools`](../tools), outside `test/`, so the runner doesn't execute them as tests.

- `lock.test.js` — the cross-process lock (`lock.js`) that protects `IDEAS.md`. Deterministically proves two holders never overlap, and that a stale lock is broken. **This is the test with real teeth for the capture-race fix.**
- `idea.test.js` — `/claudhd:idea` capture, plus an end-to-end smoke check that simultaneous captures all land.
- `breadcrumbs.test.js` — branch-aware checkpoints and brief (per-branch breadcrumbs, the brief following the current branch, the drift flag ignoring ClauDHD's own root files but counting nested look-alikes, and the "shipped since you were last here" anchor advancing only on a recorded SessionStart visit — not on `/now`/`/regroup`/`/wrap`).
- `init.test.js` — `/claudhd:init` first-run UX: it reports what it scaffolded without echoing its own new files (`NOW.md`, `IDEAS.md`, `SHIPPED.md`, `.gitignore`) back as uncommitted work, while still surfacing real uncommitted changes (including a nested `docs/NOW.md`).
- `shipped.test.js` — `/claudhd:shipped` first-run behavior (starts tracking from the current `HEAD`) and idempotence (logs only commits after the marker; a re-run with nothing new is a no-op).
- `env.test.js` — the provider-neutral project-dir resolution shared by every script: `CLAUDHD_PROJECT_DIR` wins, then `CLAUDE_PROJECT_DIR`, then the cwd.
- `harvest.test.js` — `/claudhd:harvest` location resolution and scoping: the `~/.claude/projects/<slug>` layout (redirected via `CLAUDE_CONFIG_DIR`), the incremental watermark, `--full`, `--dry-run`, the dedup-file listing, and the folder-name fallback when the exact slug dir is absent.
