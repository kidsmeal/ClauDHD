# ROADMAP

ClauDHD's own backlog and decision log — kept the way the plugin asks you to keep `NOW.md`: one thing at a time, decisions written down so they don't evaporate. Newest decisions first.

## Now

- Nothing in flight. Branch-aware cursor shipped (see below).

## Next (candidates, not commitments)

- [ ] `ROADMAP.md` template + `/claudhd:roadmap` — an optional project-level backlog above the `NOW.md` cursor. Only if it stays dumb (checkboxes); drop it the moment it grows into a planner.
- [ ] Worktree fleet view (`/claudhd:fleet`) — list each worktree's active thread + checkpoint age. **Deferred:** only build once worktrees are part of an actual workflow we use.

## Shipped

- **Branch-aware cursor (v0.5.0).** The committed `NOW.md` already rode the branch via git; the local `.now/` breadcrumbs were branch-blind. Now the `Stop` checkpoint also writes `.now/branches/<branch>.md` and the `SessionStart` brief reads the current branch's checkpoint and a per-branch "shipped since last visit" anchor (`.now/branches/<branch>.head`). The brief no longer flags ClauDHD's own live files (`NOW.md`, `IDEAS.md`, `SHIPPED.md`) as uncommitted drift. Serves the "I switch branches too often and lose my place" workflow with no new machinery — git swaps the cursor, ClauDHD swaps the breadcrumb.
- **Feature-scoped init doctrine.** `/claudhd:init` scopes the cursor to the *work*, not the repo. A feature spanning several repos gets one cursor per repo, each holding that repo's slice.

## Non-goals (decided, not "later" — see README)

- **No cross-repo / multi-repo "workspace" cursor.** A feature that spans repos gets one cursor per repo. A global workspace cursor would mean cross-repo state, a sync layer, and a global index — a second, heavier product. Killed deliberately to keep ClauDHD lightweight and zero-dependency. The per-repo, feature-scoped cursor already covers the common case (you only ever type in one repo at a time).
- **No multi-agent orchestration.** ClauDHD is a continuity / anti-drift tool, not a task runner or workflow harness.
- **One active thread per repo (or per branch).** The single-cursor constraint is the point, not a limitation to engineer around.

## Why this file exists

Eating our own dog food: the design conversation that produced v0.5.0 generated a pile of ideas, and a tool about resisting scope-drift has no business letting its *own* good ideas evaporate or quietly become scope creep. Capture, then triage: build the smallest real thing, write down what you killed and why.
