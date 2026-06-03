---
description: Review the IDEAS.md inbox and promote, park, or delete each idea
allowed-tools: Read, Edit
---
Read IDEAS.md in the current project. List every `[ ]` (untriaged) item in the Inbox compactly, numbered. For each, give a one-line recommendation: promote to the NOW.md Queue, keep parked, or drop. Then let me decide each one.

**Promotion runs a readiness gate.** An idea does not enter the NOW Queue as a bare one-liner — it has to be ready to act on. Before promoting, check three things:

1. **Done** — can you say in one line what "done" looks like?
2. **First action** — is there a concrete first physical step?
3. **Unknowns** — is there anything you'd have to figure out before you could even start?

Route each promotion by the result:

- **Ready** (clears all three): promote it. Add it to the `## Queue` in NOW.md carrying its one-line "done" and first action — not just the title — so when it goes active it is ready to run, not re-litigated.
- **Has an unknown** (fails 3): do not queue it as implementation. Promote the *thinking* instead — add a spike to the Queue phrased as the decision to resolve (e.g. "decide whether/how to X"), whose first action is to investigate. The implementation waits behind it.
- **Not ready and not worth thinking about yet**: keep it parked.

Apply decisions by editing IDEAS.md: mark promoted items `[~]` and dropped items `[x]`. For each promoted item, add the corresponding entry — vetted task or spike — to the `## Queue` section of NOW.md.

Do not start working on any idea now. The active thread stays exactly as it is. Triage only decides what is eligible to become active later, one at a time.
