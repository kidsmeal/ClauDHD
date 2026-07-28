# ROADMAP

The committed, ordered lane between IDEAS.md (someday, unsorted) and NOW.md (the one active thread). It holds what you have decided to do and roughly in what order, before any of it becomes the live cursor.

One cursor still rules: this file orders many intents, NOW.md points at exactly one. The roadmap is the order, not a second active thread. Add to it with `/claudhd:roadmap <intent>`; activation stays one-at-a-time through triage and NOW.md.

## Now

The intent the active thread is currently serving (usually one, sometimes none). NOW.md holds the actual step-by-step; this is just the roadmap's pointer at what is live.

- the two-week kill-criteria trial: use it at session starts, tune thresholds from the fire-rate log, ratify or reverse the section-12 amendment

## Next

Committed and ordered, on-deck after Now. Each is a real intent you mean to build, not a someday-maybe. Carry a one-line "done" so it is ready to activate when its turn comes, not re-litigated.

- [ ] week-two threshold tuning pass from history.jsonl fire rates - done: thresholds re-set from real counts, noisy flags renumbered or retired
- [ ] github remote + first push - done: origin exists, main pushed (user's call on repo visibility)

## Later

Committed but not soon. Things you know you will do, just not next. Promote to Next when they get close.

- [ ] deploy-behind-main flag (needs per-project opt-in config; unwoven is the motivating case)
- [ ] ideas-age + roadmap-age flag promotion (state.json now carries the dates; deferred at design to keep v1's flag set small)
- [ ] roadmap-now vs NOW.md mismatch flag (state.json era)
- [ ] in-place settings editing (v1 reads config at boot; the file is the editor)
- [ ] forgotten-branches surfacing from .now/branches/ (only if his mainline habit changes)

## Shipped

Delivered, newest first. Move an intent here when its work lands, with a one-line note of what shipped.

- v1 (2026-07-12): the whole locked design in one gated momentum session; installer at src-tauri/target/release/bundle/nsis

## Non-goals (decided, not "later")

Directions you have deliberately chosen not to take, each with the one-line why, so they stop coming back as ideas.

- push UI (toasts, always-on-top widget, tray notifications) - why: rejected outright in the founding grill; trust-on-open is the model, the statusline is the only nudge channel
- windows autostart - why: rejected outright; start is always deliberate
- GUI editing of project files (triage/wrap/roadmap buttons) - why: rituals stay in the session; the app is a lens plus one append
- talk-to-claude client inside the app - why: a product of its own with high obsolescence risk; the resume launcher covers the need
- coined vocabulary anywhere on screen - why: mechanism words only (checkpoint, never heartbeat)
