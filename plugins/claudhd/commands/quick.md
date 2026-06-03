---
description: Quick fixes - add a small self-contained chore to the capped batch, or clear the batch in one focused pass
argument-hint: [a quick fix to add; omit to clear the batch]
allowed-tools: Bash(node:*), Read, Edit
---
!`node "${CLAUDE_PLUGIN_ROOT}/scripts/quick.js" "$ARGUMENTS"`

The output above is from the quick-fixes lane in `NOW.md` (the `## Quick fixes` batch).

**Hard limits — keep the lane honest.** A quick fix is **one file** (rarely two) and **one sitting**, with **no** schema/API/public-contract change and **no** broad refactor. The batch is capped (3); overflow means clear some or promote one out. Anything bigger is not a quick fix — send it to `/claudhd:idea` for triage (it belongs in the Queue or a design). A fix that *fails its check* when you make it gets kicked back to `/claudhd:idea`, never patched around.

- **If I gave you a quick fix** (the line says "added"): it is captured. Confirm in one short line and keep the active thread exactly as it is — do not start working on it now. If the line warns the batch is at or over its cap, tell me to clear it or promote one out.
- **If I gave you nothing** (the batch is listed above, or empty): clear it in one focused pass.
  1. Note the current active thread and its next action, so we return to it cleanly. This pass is itself the temporary thread — do not lose the real one.
  2. Work the batch top to bottom. For each item, make the change. If one turns out to need a decision, a test, touches shared state, spans more than a file, or fails its check — i.e. it breaks a hard limit above — stop: kick it back out with `/claudhd:idea <it>` for triage and remove it from the batch. Never let a quick fix quietly grow into real work.
  3. Check off each cleared item in `NOW.md`, then restore the original active thread and next action as the focus.
  4. If I keep clearing quick fixes while the active thread has not moved, say so plainly — that is drift wearing a productive disguise.

Do not commit for me. The active thread has right of way: quick fixes are cleared between threads or while the active thread is blocked, never interleaved mid-thread.
