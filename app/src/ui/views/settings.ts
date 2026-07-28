// Settings: the config surface. v1 displays the live values and opens the
// data folder for editing; it never pretends a field is editable in-place,
// and it reports the capture channel's armed state honestly.

import type { Config } from "../../core/config.js";
import { routeHash } from "../router.js";
import type { UiState } from "../store.js";
import { FLEET_NAV } from "./detail.js";
import { esc } from "./evidence.js";

function section(title: string, inner: string): string {
  return `<section class="detail-section"><div class="section-title">${esc(title)}</div>${inner}</section>`;
}

function line(k: string, v: string): string {
  return `<div class="card-line"><span class="k">${esc(k)}</span> ${esc(v)}</div>`;
}

export function settingsHtml(state: UiState, cfg: Config | null): string {
  const armed = state.hotkeyArmed;
  const capture =
    armed == null
      ? "unknown (browser fixture mode has no hotkey)"
      : armed.armed
        ? `armed: ${armed.combo}`
        : `NOT armed (${armed.combo}): ${armed.reason ?? "registration failed"}. the capture channel is down until this is fixed.`;

  const body =
    cfg == null
      ? `<div class="dim">config not loaded</div>`
      : section("discovery", line("roots", cfg.roots.join(" · ")) + line("scan depth", String(cfg.scanDepth)) + line("ignore", cfg.ignore.length > 0 ? cfg.ignore.join(", ") : "(empty)")) +
        section("capture", line("hotkey", cfg.hotkey) + line("channel", capture)) +
        section(
          "launcher templates",
          line("resume", cfg.launcher.resume) +
            line("continue", cfg.launcher.continueLast) +
            line("terminal", cfg.launcher.terminalOnly) +
            line("folder", cfg.launcher.openFolder)
        ) +
        section(
          "thresholds",
          Object.entries(cfg.thresholds)
            .map(([k, v]) => line(k, String(v)))
            .join("")
        ) +
        section(
          "editing",
          `<div class="card-line">values live in config.json in the data folder; edit the file, then quit and relaunch (config reads at boot).</div>
           <div class="card-line"><button data-open-data-folder>open the data folder</button></div>`
        );

  return `
    <div class="detail">
      <div class="titlebar">
        <span>
          <button data-nav="${esc(FLEET_NAV)}" class="back">← fleet</button>
          <h1 class="detail-name">settings</h1>
        </span>
        <span class="titlebar-actions">
          <a href="${esc(routeHash({ view: "history", project: null }))}" class="quiet-link">history</a>
        </span>
      </div>
      <div class="provenance">data mode: ${esc(state.dataMode)} · everything the app owns lives in %APPDATA%\\object-permanence</div>
      ${state.launchError != null ? `<div class="provenance"><span class="scan-error">${esc(state.launchError)}</span></div>` : ""}
      ${body}
    </div>`;
}
