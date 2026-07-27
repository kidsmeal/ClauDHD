# Currentness Audit

Last updated: <DATE>

Purpose: help a future session answer "what is actually current?" before touching an old
plan. This is an audit snapshot, not a reorganization. Prefer correcting this file over
rewriting or moving the older docs. Refresh it with `/claudhd:audit`.

## Trust First

The best current anchors. A session can rely on these.

| Area | Current anchor | Current read |
|---|---|---|
| Active implementation | `<path>` | <what is live, which phases landed, what is in flight> |
| Codebase lookup | `<path>` | <the map that is most current; may lag on fine detail> |
| Conventions / rules | `<path>` | <the authoritative style/design rules - reference, not a task queue> |
| Runtime verification | `RUNTIME_VERIFICATION_QUEUE.md` | <live list of shipped-but-unverified systems> |
| Durable memory | `<path>` | <preferences / long-range intent - not a build queue> |

## Needs Reconciliation

Docs or systems with mixed signals. Name the stale claim and what the code actually shows.

### <Doc or system>
<what it claims> vs <what the code evidence shows>. Read as: <how to treat it until reconciled>.

## Likely Shipped / Historical

Should not pull attention unless a bug points back here.

| Area | Read |
|---|---|
| <area> | <shipped / archived - keep as history> |

## Open doc flags

Written by the review relay when a phase diff made a standing doc stale. Cleared by `/claudhd:audit`.
Format: `- [ ] <doc path>: <one line, what the diff invalidated> (phase N, <feature or plan name>)`.

(empty)

## Deferred review notes

- [x] RESOLVED post-1.0 copy pass: README.md garbled idle-mode summary disagrees with the authoritative table at ~82-88; S3 prose, post-1.0 README copy pass (phase 7, claudhd 1.0)
- [x] RESOLVED post-1.0 copy pass: init.js:13 comment said three local/transient .gantry/* files, there are four; S3 comment-only, post-1.0 sweep (phase 7, claudhd 1.0)

Written by the review relay at the commit gate, one line per Deferred note the phase-reviewer
chose not to fix this phase (pending external API, plan-blessed placeholder, later-phase consumer).
A deferred note is not a dropped note - it lives here until someone clears it. Retire a line when
the work lands or the reason expires; `/claudhd:audit` prunes stale ones.
Format: `- [ ] <note, with file:line>: <why deferred> (phase N, <feature or plan name>)`.

- [x] RESOLVED by phase 5 (bba22f6): .now/enabled writer + computeGate honoring it (plugins/claudhd/scripts/init.js, hooks): sol round-5 finding, DEFERRED by the user's valve ruling to phase 5, whose B1 scope owns the activation gate. Until then the reconcile is inert in-repo (no writer exists), proven working by the phase-4 smoke when the marker is present. (phase 4, claudhd 1.0)
- [x] RESOLVED at the 1.0.0 release gate: real harness load via claude -p --plugin-dir, /claudhd:version printed ClauDHD v1.0.0, zero stderr, zero hook errors. Original note: duplicate-hooks session-load smoke (plugins/claudhd/hooks/hooks.json): only observable with the plugin installed from a release; the installed claudhd is still 0.9.0, so this lands in phase 7's release verification. Hook firing itself was proven by the user's 15-scenario harness (scratchpad/hooktest.sh), 2026-07-25. (phase 1, claudhd 1.0)

## Rule of thumb
- Roadmap says what to do next.
- Plans say how to do it.
- Design says why it exists and what constraints it obeys.
- Archive says what happened.
- Memory says what must not be forgotten.
