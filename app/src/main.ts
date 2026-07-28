// App entry. Tauri shell: live scans through the courier, resident watch,
// focus revalidation, blur-save, since-last-open on boot. Plain browser
// (vite dev): the frozen fixture snapshot, labeled as such.

import "./ui/styles.css";
import { substituteTemplate, tokenizeCommand } from "./core/capture.js";
import { DEFAULT_CONFIG, parseConfigText, type Config, type LauncherTemplates } from "./core/config.js";
import { gapLabel, sinceLastOpen } from "./core/diff.js";
import { appendTransitions, computeTransitions, readTransitions } from "./core/history.js";
import { CONFIG_FILE, loadSnapshot, saveSnapshot } from "./core/persistence.js";
import { revalidate } from "./core/revalidate.js";
import { scanFleet, scanOneProject, withCard } from "./core/scan.js";
import { loadFixtureSnapshot } from "./adapters/fixture.js";
import { isTauri, launchDetached, startWatch, tauriClock, tauriFs, tauriGit, tauriStore } from "./adapters/tauri.js";
import { bootCaptureWindow, CAPTURE_TARGETS_FILE } from "./ui/capture-window.js";
import { parseHash } from "./ui/router.js";
import { initRender, paint } from "./ui/render.js";
import { onPaint, seedExpandedCrit, store, update } from "./ui/store.js";

const app = document.getElementById("app");
if (app == null) throw new Error("#app missing");

let cfg: Config = DEFAULT_CONFIG;
const deps = { fs: tauriFs, git: tauriGit, clock: tauriClock };

// Every snapshot adoption records flag transitions to the fire-rate log,
// with the evidence they fired on. Standing state records nothing; only
// change does, so boot does not inflate the counts.
function recordTransitions(prev: typeof store.snapshot, next: NonNullable<typeof store.snapshot>): void {
  if (!isTauri() || prev == null) return;
  const transitions = computeTransitions(prev, next, Date.now());
  if (transitions.length === 0) return;
  void appendTransitions(tauriStore, transitions);
  if (store.history != null) {
    update((s) => {
      s.history = [...(s.history ?? []), ...transitions];
    });
  }
}

async function loadHistoryIfNeeded(): Promise<void> {
  if (!isTauri()) return;
  if (store.route.view !== "history" || store.history != null) return;
  const transitions = await readTransitions(tauriStore);
  update((s) => {
    s.history = transitions;
  });
}

// The launcher: substitute {path}, tokenize, spawn detached through the
// courier. A failed spawn (missing executable, bad path) is reported on the
// page, never a silent no-op.
async function launch(action: string, projectName: string): Promise<void> {
  const card = store.snapshot?.cards.find((c) => c.name === projectName);
  const template = cfg.launcher[action as keyof LauncherTemplates];
  if (card == null || template == null) {
    update((s) => {
      s.launchError = `launch failed: no ${card == null ? "project" : "template"} for ${projectName}/${action}`;
    });
    return;
  }
  const tokens = tokenizeCommand(substituteTemplate(template, card.path));
  if (tokens == null) {
    update((s) => {
      s.launchError = `launch failed: empty template for ${action}`;
    });
    return;
  }
  const ok = await launchDetached(tokens.exe, tokens.args);
  update((s) => {
    s.launchError = ok ? null : `launch failed: could not start ${tokens.exe} (missing executable or bad path)`;
  });
}

async function openDataFolder(): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  const dir = await invoke<string | null>("data_dir_path");
  if (dir != null) {
    const ok = await launchDetached("explorer", [dir]);
    update((s) => {
      s.launchError = ok ? null : "launch failed: could not start explorer";
    });
  }
}

onPaint(paint);
initRender(app, {
  rescan: () => void fullRescan("manual rescan"),
  launch: (action, project) => void launch(action, project),
  openDataFolder: () => void openDataFolder(),
});
store.route = parseHash(location.hash);

async function fullRescan(reason: "boot" | "focus" | "poll" | "manual rescan"): Promise<void> {
  if (store.scanning) return;
  update((s) => {
    s.scanning = true;
    s.scanError = null;
  });
  try {
    if (isTauri()) {
      const fresh = await scanFleet(deps, cfg);
      const prev = store.snapshot;
      update((s) => {
        // Focus is the designed reconcile point for events the watcher
        // dropped; the provenance line reports what it found.
        if (reason === "focus" && prev != null) {
          s.lastRevalidation = revalidate(prev, fresh, Date.now());
        }
        s.snapshot = fresh;
        s.dataMode = "live scan (tauri)";
        seedExpandedCrit(fresh);
      });
      recordTransitions(prev, fresh);
      // The capture popover reads its target list from the store, so it
      // never needs a scan of its own. Recency order = picker order.
      void tauriStore.write(
        CAPTURE_TARGETS_FILE,
        JSON.stringify(fresh.cards.map((c) => ({ name: c.name, path: c.path })))
      );
    } else {
      const snap = await loadFixtureSnapshot();
      update((s) => {
        if (snap != null) {
          s.snapshot = snap;
          s.dataMode = "frozen scan (dev fixture, npm run snapshot to refresh)";
          seedExpandedCrit(snap);
        } else {
          s.scanError = "no dev fixture: run npm run snapshot first";
        }
      });
    }
  } catch (err) {
    update((s) => {
      s.scanError = `scan failed: ${err instanceof Error ? err.message : String(err)}`;
    });
  } finally {
    update((s) => {
      s.scanning = false;
    });
  }
}

// fs events: filter to paths inside a known project that look load-bearing,
// debounce per project, rebuild just that card.
const IGNORE_SEGMENTS = /[\\/](node_modules|\.git|dist|target)[\\/]/i;
const INTERESTING = /\.(md|json)$/i;
const pending = new Map<string, ReturnType<typeof setTimeout>>();

function onFsEvent(path: string): void {
  const s = store.snapshot;
  if (s == null || IGNORE_SEGMENTS.test(path) || !INTERESTING.test(path)) return;
  const norm = path.replace(/\\/g, "/");
  const card = s.cards.find((c) => norm.startsWith(c.path.replace(/\\/g, "/") + "/"));
  if (card == null) return;
  update((st) => {
    st.lastEventMs = Date.now();
  });
  const existing = pending.get(card.name);
  if (existing != null) clearTimeout(existing);
  pending.set(
    card.name,
    setTimeout(() => {
      pending.delete(card.name);
      void (async () => {
        const rebuilt = await scanOneProject(deps, cfg, card.path, card.name);
        if (rebuilt == null) return; // project stopped qualifying; next full rescan handles it
        const prev = store.snapshot;
        update((st) => {
          if (st.snapshot != null) st.snapshot = withCard(st.snapshot, rebuilt, cfg);
        });
        if (store.snapshot != null) recordTransitions(prev, store.snapshot);
      })();
    }, 800)
  );
}

async function registerCaptureHotkey(): Promise<void> {
  try {
    const { register } = await import("@tauri-apps/plugin-global-shortcut");
    await register(cfg.hotkey, (event) => {
      if (event.state !== "Pressed") return;
      void (async () => {
        const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
        const capture = await WebviewWindow.getByLabel("capture");
        if (capture != null) {
          await capture.center();
          await capture.show();
          await capture.setFocus();
        }
      })();
    });
    update((s) => {
      s.hotkeyArmed = { armed: true, combo: cfg.hotkey, reason: null };
    });
  } catch (err) {
    // The app never pretends a capture channel is armed when it is not.
    update((s) => {
      s.hotkeyArmed = {
        armed: false,
        combo: cfg.hotkey,
        reason: err instanceof Error ? err.message : String(err),
      };
    });
  }
}

async function bootTauri(): Promise<void> {
  // config: first run writes the defaults so the file exists to edit
  const configText = await tauriStore.read(CONFIG_FILE);
  cfg = parseConfigText(configText);
  if (configText == null) {
    await tauriStore.write(CONFIG_FILE, JSON.stringify(cfg, null, 2));
  }
  update((s) => {
    s.config = cfg;
  });
  void registerCaptureHotkey();

  // The baseline is "what you last looked at", nothing else. It persists on
  // focus LOSS only (blur; close-to-tray hides and therefore blurs), so
  // polls and fs events can never fold unseen drift into it. Boot seeds it
  // exactly once when no baseline exists at all (first run), because a diff
  // against nothing is not a lie, it is just empty.
  const saved = await loadSnapshot(tauriStore);
  await fullRescan("boot");

  if (saved != null && store.snapshot != null) {
    const lines = sinceLastOpen(saved.snapshot, store.snapshot);
    update((s) => {
      s.sinceLastOpen = { gap: gapLabel(saved.savedAtMs, Date.now()), savedAtMs: saved.savedAtMs, lines };
    });
  } else if (saved == null && store.snapshot != null) {
    void saveSnapshot(tauriStore, store.snapshot, Date.now());
  }

  const watching = await startWatch(cfg.roots);
  update((s) => {
    s.watching = watching;
    s.watcherStartedMs = Date.now();
    if (!watching) s.scanError = "watcher failed to start: live updates off, rescan by hand";
  });

  const { listen } = await import("@tauri-apps/api/event");
  await listen<string>("fs-change", (e) => onFsEvent(e.payload));

  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const win = getCurrentWindow();
  await win.onFocusChanged(({ payload: focused }) => {
    if (focused) {
      // Every focus gain is an "open": rescan, then recompute since-last-open
      // against the persisted baseline (the last blur's save), so opening
      // from the tray shows changes since you last looked, not since boot.
      void (async () => {
        const baseline = await loadSnapshot(tauriStore);
        await fullRescan("focus");
        if (baseline != null && store.snapshot != null) {
          const lines = sinceLastOpen(baseline.snapshot, store.snapshot);
          update((s) => {
            s.sinceLastOpen = { gap: gapLabel(baseline.savedAtMs, Date.now()), savedAtMs: baseline.savedAtMs, lines };
          });
        }
      })();
    } else if (store.snapshot != null) {
      // Focus loss is the ONLY baseline writer after the boot seed: the hide
      // on close-to-tray lands here too, so the baseline is always the last
      // state you actually saw. A quit while focused skips this write, which
      // over-reports on the next open (shows things you already saw); the
      // dishonest direction would be under-reporting, and this can never do
      // that.
      void saveSnapshot(tauriStore, store.snapshot, Date.now());
    }
  });

  // the light poll covers what fs events cannot see (unpushed counts move
  // when remotes change, commits made outside any watched file write)
  setInterval(() => void fullRescan("poll"), 120_000);
}

window.addEventListener("hashchange", () => void loadHistoryIfNeeded());

async function boot(): Promise<void> {
  if (isTauri()) {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    if (getCurrentWindow().label === "capture") {
      // The popover window runs only the capture surface, no scans, no store.
      document.body.classList.add("capture-body");
      await bootCaptureWindow(app!);
      return;
    }
    paint();
    void bootTauri();
    void loadHistoryIfNeeded();
  } else {
    update((s) => {
      s.config = DEFAULT_CONFIG;
    });
    paint();
    void fullRescan("boot");
  }
}

void boot();
