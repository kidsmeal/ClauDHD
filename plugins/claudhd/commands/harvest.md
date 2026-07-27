---
description: Harvest unimplemented ideas from this project's past sessions into IDEAS.md
argument-hint: "[--dry-run] [--full]"
allowed-tools: Bash(node:*), Grep, Read, Edit, Write
---
!`node "${CLAUDE_PLUGIN_ROOT}/scripts/harvest.js" "$ARGUMENTS"`

The script above located this project's past session transcripts and the files to dedup against. Harvest the ideas that were raised but never captured or built - both mine and yours. Work efficiently; do NOT slurp whole transcripts:

1. **Grep first, read narrowly.** Grep the in-scope session files for idea signals, then read only the surrounding lines. Look for:
   - mine (the user): "we should also", "would be nice", "later", "TODO", "what if", "eventually", "out of scope", "don't forget", "note to self".
   - yours (the assistant): deferred suggestions and offers - "one thing worth flagging", "you might also want", "a follow-up could be", "out of scope but", and unanswered "Want me to ...?" offers I made that were never taken up.
2. **Drop anything already handled.** Skip ideas already in IDEAS.md, already promoted to ROADMAP.md, or already shipped in SHIPPED.md. Also skip ideas that were raised and then explicitly rejected or abandoned later in the conversation.
3. **When unsure, keep it but flag it.** A low-confidence parked idea is cheap; a lost one is the whole problem. Mark shaky ones.
4. **Append survivors to IDEAS.md.** Add each under "## Inbox" as `- [ ] {today} (harvested from {session date}) {one-line idea}`, appending `, low-confidence` to the tag for shaky ones. One line each.

**If the script printed DRY RUN:** do all the scanning and judging above, but instead of writing, just show me the list of ideas you *would* harvest (each with its source and any low-confidence flag). Append nothing to IDEAS.md and do not record a watermark. Then stop.

Otherwise, give me a short summary: how many you harvested and what they are, plus a note of anything notable you skipped as already-tracked. Finally, record the watermark exactly as the script instructed (write its printed value to .now/last-harvest) so the next harvest only sees new sessions. Do not start working on any harvested idea; they land in IDEAS.md as ordinary captures and surface as tap cards next time you run /claudhd:triage.
