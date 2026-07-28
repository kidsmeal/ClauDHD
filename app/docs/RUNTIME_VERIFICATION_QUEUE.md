# Runtime Verification Queue

Last updated: 2026-07-12 (end of the v1 build session)

The live list of systems that are code-complete or mostly shipped but still need real-run
confidence. Keep code/test facts separate from the manual check still owed, so stale TODOs
are easy to retire. Curate with `/gantry:verify`.

---

## Active checks

### 1. Resume launcher, the two claude templates

**Why:** the build session live-proved the launcher's spawn path only through capture and the shared courier command; resume and continueLast were deliberately not clicked because they open real claude sessions (token cost, real windows).

**Code checks already done:**
- template substitution + quote-honoring tokenizer unit-tested (`test/capture.test.ts`).
- `launch_detached` spawn-no-shell wired from the detail split menu (`src-tauri/src/lib.rs`, `src/main.ts`); a failed spawn reports on the page.
- `wt` and `claude` verified on PATH on this machine during the build.

**Manual check:**
- open any project's detail, click resume. a windows terminal opens at that repo with claude starting, and the claudhd brief orients it.
- from the split menu, click continue last conversation. same, with `claude -c`.

**Close when:** both templates have launched once from the real app. no doc archives; retire this item.

### 2. NSIS installer, install + first run

**Why:** the bundle built clean (`Object Permanence_0.1.0_x64-setup.exe`) but was never executed; per-user install, start-menu entry, and tray behavior from an installed (non-dev) binary are unobserved.

**Code checks already done:**
- `tauri.conf.json` bundle block: nsis target, `installMode: currentUser`.
- the same binary logic ran repeatedly under `tauri dev` during the phase proofs (resident tray, watcher, capture).

**Manual check:**
- run the setup exe. no admin prompt appears; it installs per-user with a start menu entry.
- launch it, close the window. the tray icon stays; quit from the tray menu exits.

**Close when:** one installed run passes both checks; retire this item.

---

## Closed / stale items

- capture hotkey end-to-end - closed: live keystroke proof 2026-07-12 (popover focused, exact idea.js line landed newest-first, revert clean).
- fs-event -> flag transition -> history.jsonl - closed: live proof 2026-07-12 (queue stuffed to 6 raised section-budgets with evidence, revert cleared it).
- resident baseline anchor - closed: headless proof 2026-07-12 (boot seeds once, byte-identical across scans/polls, unfocused hide leaves it alone).
- close-to-tray residency - closed: graceful WM_CLOSE left the process tray-resident, twice.
