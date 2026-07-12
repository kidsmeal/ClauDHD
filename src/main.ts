// App entry. Tauri shell: live scan through the courier. Plain browser (vite
// dev): the frozen fixture snapshot, labeled as such. One store, one paint.

import "./ui/styles.css";
import { DEFAULT_CONFIG } from "./core/config.js";
import { scanFleet } from "./core/scan.js";
import { loadFixtureSnapshot } from "./adapters/fixture.js";
import { isTauri, tauriClock, tauriFs, tauriGit } from "./adapters/tauri.js";
import { parseHash } from "./ui/router.js";
import { initRender, paint } from "./ui/render.js";
import { onPaint, seedExpandedCrit, store, update } from "./ui/store.js";

const app = document.getElementById("app");
if (app == null) throw new Error("#app missing");

onPaint(paint);
initRender(app, { rescan: () => void rescan() });
store.route = parseHash(location.hash);

async function rescan(): Promise<void> {
  if (store.scanning) return;
  update((s) => {
    s.scanning = true;
    s.scanError = null;
  });
  try {
    if (isTauri()) {
      const snap = await scanFleet({ fs: tauriFs, git: tauriGit, clock: tauriClock }, DEFAULT_CONFIG);
      update((s) => {
        s.snapshot = snap;
        s.dataMode = "live scan (tauri)";
        seedExpandedCrit(snap);
      });
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

paint();
void rescan();
