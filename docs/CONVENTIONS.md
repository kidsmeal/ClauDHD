# Conventions

The build contract is `design/object_permanence_v1_reviewed.md` (LOCKED); the plan is `design/object_permanence_v1_reviewed-plan.md`. This file records how code in this repo is written. Reviewers gate on it.

## Stack

Tauri 2 shell, Vite + vanilla TypeScript frontend, no framework. Test runner is vitest, on node, headless. `tsx` runs the live-fleet acceptance script. The Rust side is a courier only: fs watch, git shell-out, tray, global shortcut, window management. All logic lives in TypeScript.

## Layout

- `src/core/` pure logic: discovery, parsers, git facts, flags, scan. Platform-free.
- `src/adapters/` fills the core's ports: `node.ts` (vitest + acceptance), `tauri.ts` (the app).
- `src/ui/` store, render, router, views. DOM only here.
- `src-tauri/` the Rust courier (phase 2+).
- `scripts/acceptance.ts` live scan of the real fleet, manual hand-check surface.
- `test/` vitest suites + `test/fixtures/` frozen real-file-derived fixtures.

## The seam rule

`src/core/` imports nothing from `@tauri-apps/*`, nothing from `node:*`, and touches no globals (`Date.now`, `process`, `fs`). Everything environmental comes through the ports in `src/core/ports.ts` (`GitRunner`, `FileSystem`, `Clock`, `DataDir`). A core module importing an adapter or a platform API is a review FAIL.

## Render discipline (the unwoven rule)

One plain store object. Events mutate it and call `render()`. `render()` rebuilds a card's DOM only when that card's data changed. Event delegation on the container. Transient UI lives outside the rebuilt containers. No per-tick full rebuilds.

## Trust rules are code, not copy

Parse failure returns a `raw-fallback` result, never a throw, never a stale parse shown as current. Every displayed number carries the evidence it was computed from. Launcher and hotkey failures are reported, never swallowed. These surfaces are review items, not polish.

## Prose rules (all UI strings, docs, commits)

No em-dashes. No "not X but Y". No three-beat rhetorical lists. No tagline closers. No emoji. Lowercase-friendly, terse, technical. Vocabulary coins zero new terms: cursor, thread, wrap, triage, checkpoint (never heartbeat), plan, phase, audit, dirty, unpushed. Remedies shown to the user are ClauDHD/Gantry commands, never in-app buttons.

## Commands

- `npm test` vitest run (reviewer gate, every phase)
- `npm run typecheck` tsc --noEmit (reviewer gate, every phase)
- `npm run acceptance` live fleet scan, manual hand-check
- `npm run tauri:dev` app smoke (phase 2+)
- `npm run tauri:build` NSIS bundle (phase 5)

## Git

Solo repo, linear history, commit straight to `main`, no branches, no PRs. Lowercase commit subjects, `area: what changed` shape.
