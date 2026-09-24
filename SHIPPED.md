# SHIPPED

Finished work, newest first. Written automatically at the commit boundary; run `/claudhd:audit` to catch up any commit that bypassed the guard. This file records completed work so progress stays visible.

<!-- last-sha: e3cd759a406e879065901db2f1e6bd1d072133c4 -->

### 2026-09-24
- docs: log state-dir and codex commits in SHIPPED.md `e3cd759`
- docs: add parallel lanes design seed (`97633d3`)
- feat: init gitignores the two codex .gantry files (`623ea8c`)
- feat: add build-codex-plugin.js and the codex adapter (`2197ef5`)
- feat: add codex-role.js mapping roles to spawn_agent settings (`1c14d65`)

### 2026-09-23
- feat: add relocate --exclude to skip history logs (`fba8c7b`)
- docs: document configurable state file locations (`3d3229c`)
- feat: add init --relocate to move state files and write config (`4bd008d`)
- feat: commands read state-file paths from paths.js (`4f8a6c9`)
- feat: route remaining scripts through paths.js (`7ab9c7f`)
- feat: route hooks and the commit path through paths.js (`2d44d4b`)
- feat: add paths.js resolver for configurable state locations (`dbf50f1`)

### 2026-09-21
- ci: add github action mirroring every push to gitlab (`3d0f433`)

### 2026-09-09
- docs: log v1.0.12 in SHIPPED.md (`a1437e3`)
- chore: release v1.0.12 (`2162d4c`)
- docs: log v1.0.11 in SHIPPED.md (`54f42bd`)

### 2026-09-09
- test: every hook script and scripts/ module must pass node --check
- chore: release v1.0.11 (`2816ba4`)
- feat: drop the file-list guard, verify commits post-hoc, per-plan auto-commit grant (`ed24b14`)
- fix: commit-guard expands ~, $HOME and /c/ paths before resolving the commit's repo (`a3eff11`)
- feat: pipeline skill preflights the harness and refuses outside Claude Code (`e04d91d`)
- docs: log v1.0.10 in SHIPPED.md (`c44db77`)

### 2026-09-09
- chore: release v1.0.10 (`dfe1220`)
- fix: role.js exits after stdout flushes so relayed reports are not truncated on macOS (`c226e5e`)
- test: echo backend copies stdin synchronously so macOS Node 20 sees the whole prompt (`ded0746`)
- fix: npm test runs on Node 20 through an explicit file list (`e197e01`)
- docs: log v1.0.9 in SHIPPED.md (`7866697`)

### 2026-09-09
- chore: release v1.0.9 (`1f0fbc5`)
- feat: phase-planner caps phases at 10 source files, one subsystem each (`280483f`)

### 2026-07-31
- docs: log v1.0.8 in SHIPPED.md (`a830748`)

### 2026-07-31
- docs: drop resolved ideas, record r-0729-1 half-shipped
- chore: release v1.0.8 (`dea0d2d`)
- feat: surface the out-of-scope log in the SessionStart brief (`695c873`)
- fix: two bookkeeping bugs that acted on intent instead of outcome (`026759e`)
- docs: log v1.0.7 in SHIPPED.md (`0ecf3e6`)

### 2026-07-31
- chore: release v1.0.7 (`749a48a`)
- fix: release logs itself to SHIPPED.md and bumps the skill version (`d814711`)
- feat: log out-of-scope work instead of denying it (r-0729-1) (`d0a76d9`)

### 2026-07-31
- docs: merge the mode-rule and command-surface work into one thread

### 2026-07-30
- chore: release v1.0.6 (`ea9f832`)
- fix: quote argument-hint so command frontmatter parses
- fix: release gate runs the plugin suite, not the app's vitest files
- fix: commit-guard recognizes the gate command behind any prefix
- feat: state.js read --json, the plugin-owned read path for schema v2

### 2026-07-29
- design: object permanence v2 - the app onto the 1.0 contracts (`7e48c23`)

### 2026-07-28
- seed
