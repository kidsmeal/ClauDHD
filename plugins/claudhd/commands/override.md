---
description: Loud escape hatch - record an unguarded session so mode enforcement stops denying your edits, or clear one with --clear
argument-hint: "[--clear]"
allowed-tools: Bash(node:*)
---
!`node "${CLAUDE_PLUGIN_ROOT}/scripts/override.js" "$ARGUMENTS"`

If `$ARGUMENTS` was empty, the line above just recorded (or re-affirmed) an unguarded session in `.now/state.json`'s `override` key, and rendered it into NOW.md's `## Loose ends` section so it is visible, never a silent bypass. From now on in this session, an edit outside the active phase's file list (or outside any mode's allowlist entirely) is permitted and counted, not denied.

If `$ARGUMENTS` was `--clear`, the line above removed the `override` key and stripped its rendered line out of NOW.md instead - mode enforcement is back to denying out-of-scope edits as normal. Entering `/claudhd:build`, `/claudhd:design`, or a fresh override session already clears it automatically; `--clear` is for ending the emergency explicitly, without waiting for one of those.

Relay the line above to me verbatim. Then say plainly what this means: every file the override lets through gets logged (the count grows as you go), and the record stays visible in NOW.md until the next `/claudhd:build`, `/claudhd:design`, `/claudhd:override --clear`, or a fresh override session replaces it. This is not a way to skip review; it is a way to say out loud "I am working outside any phase right now, on purpose." If you did not mean to run this, tell me and stop working outside the active phase's scope instead.
