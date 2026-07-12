// Settings is a phase-5 surface. Until then this page states what exists and
// where the config lives, so nothing here pretends to be editable yet.

import type { UiState } from "../store.js";
import { FLEET_NAV } from "./detail.js";
import { esc } from "./evidence.js";

export function settingsHtml(state: UiState): string {
  return `
    <div class="detail">
      <div class="titlebar">
        <span>
          <button data-nav="${esc(FLEET_NAV)}" class="back">← fleet</button>
          <h1 class="detail-name">settings</h1>
        </span>
      </div>
      <section class="detail-section">
        <div class="section-title">phase 5 surface</div>
        <div class="card-line">editable settings (roots, ignore list, thresholds, hotkey, launcher templates) land in phase 5.</div>
        <div class="card-line">config file: %APPDATA%\\object-permanence\\config.json (defaults apply when absent)</div>
        <div class="card-line">data mode: ${esc(state.dataMode)}</div>
      </section>
    </div>`;
}
