---
description: Wire the ClauDHD cursor into the Claude Code status bar for this project
allowed-tools: Bash(node:*), Read, Edit, Write
---
!`node -e "console.log(process.env.CLAUDE_PLUGIN_ROOT)"`

The output above is the current plugin root. Merge a `statusLine` entry into this project's `.claude/settings.json`:

1. Read `.claude/settings.json` (treat as `{}` if absent; create `.claude/` if needed).
2. Set `"statusLine"` to `node "<root>/scripts/statusline.js"`, where `<root>` is the printed path above. Preserve all other keys.
3. Write the updated JSON back to `.claude/settings.json`.

Note: the plugin cache path embeds the installed version. If ClauDHD updates and the path changes, re-running this command repairs the entry.
