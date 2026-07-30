---
description: Catch up bypassed commits in SHIPPED.md, reconcile the currentness audit, and refresh the runtime verification queue
argument-hint: "[feature or area to add to the verification queue] | (none = full sweep)"
allowed-tools: Bash(node:*), Bash(git log:*), Read, Edit, Write, Glob, Grep
---
!`node "${CLAUDE_PLUGIN_ROOT}/scripts/shipped.js"`

The line above is the catch-up scan: commits made outside a Claude Code session bypass the commit-boundary guard, so they never trigger the automatic `SHIPPED.md` entry. This is the documented way to close that gap; relay its one-line result, then continue.

Two living docs, one command otherwise, since both exist to keep a cold session from trusting a stale doc. The file names below live at the project root or in `docs/`; find them, and if either is missing, run `/claudhd:init` first or create it from the template.

## Part 1: CURRENTNESS_AUDIT.md

This is an audit snapshot, not a reorganization. Do not move or rewrite the old docs; correct the audit file instead.

1. **Reconcile open doc flags.** Find `## Open doc flags`. For each `- [ ]` entry, check whether the cited doc still lags the change that flagged it: grep the doc for the invalidated claim or check git history. If refreshed since, tick it (`[x]`). Report how many cleared and how many remain open.
2. Gather the signals. Read `ROADMAP.md`/`NOW.md` if present, skim plan files (`plans/*.md`, `docs/plan_*.md`, `design/*.md`), and read recent history: `git log --oneline -40`. For a large doc set, do not read every file inline: Grep first for the plan-file's own status markers (`**Status:**` lines, `## Summary` headings, phase headings) to triage which plans are worth a full read, then Read only the ones that look live or ambiguous.
3. For each significant plan or system, decide its real state from code evidence (Glob/Grep the files it claims), not from the doc's own language: **Trust First** (a current anchor), **Needs Reconciliation** (mixed signals; say exactly which claims are stale and what the code shows instead), or **Likely Shipped / Historical** (done; should not pull attention).
4. Rewrite `CURRENTNESS_AUDIT.md` from the template's structure, set its "Last updated" line to today, keep entries terse (one or two lines each, file path plus the one-line read).

## Part 2: RUNTIME_VERIFICATION_QUEUE.md

The gap between "passes the test suite" and "confirmed working in a real run, on a real device or browser." Each entry separates what the code/tests already prove from the manual check still owed, and names an explicit **Close when** condition.

- **With an argument** (`$ARGUMENTS` names a feature or area): add or update one entry for it. Read the relevant code to fill in "Code checks already done" (what is provably wired) and write the precise "Manual check" steps with pass conditions, plus a "Close when". Do not invent checks the feature does not need.
- **No argument**: sweep recently shipped work (`git log --oneline -25`) for features that landed code-complete but whose behavior only a real run can confirm: sync/migration on real data, cross-platform or cross-browser rendering, device-only paths, anything behind a flag. Propose new queue entries for the ones not already listed, and flag any existing entry whose "Close when" now looks satisfied so I can retire it.

Keep entries terse and update the file's "Last updated" line.

## Report

Report in three lines: the bucket counts (audit plans landed in each of Trust First / Needs Reconciliation / Likely Shipped); the top 1-3 "Needs Reconciliation" items the next session should resolve; what changed in the verification queue (added, updated, marked closeable). Do not perform the manual checks yourself; this command curates both queues, the human (or a preview/device run) closes the items. Do not change any plan or code file.
