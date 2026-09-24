# ClauDHD Codex adapter

`tools/build-codex-plugin.js` copies this adapter and the shared ClauDHD runtime into a standalone `claudhd-codex` plugin.

- Codex discovers `hooks/hooks.json` by default because the compatibility manifest does not declare a `hooks` key.
- Run `/hooks` after install and trust the listed plugin hooks before relying on lifecycle or guard behavior.
- Verify one `git commit` attempt in an opted-in test project. `commit-guard.js` reconciles before the commit and `commit-verify.js` records the result after it lands.
- Verify the Windows `commandWindows` entries resolve `PLUGIN_ROOT` before enabling workflow use on a Windows host.
- `.gantry/codex-run.json` is project-local orchestration state. It records role ownership and is ignored by git.
