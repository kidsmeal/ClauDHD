// The fire-rate view: per-flag fire counts on top (the tuning pass's raw
// material), the transition feed under it, newest first. Optionally filtered
// to one project. Data comes from history.jsonl through the AppStore, so the
// browser fixture mode states plainly that it has no shell to read from.

import { fireRates, type Transition } from "../../core/history.js";
import { routeHash } from "../router.js";
import type { UiState } from "../store.js";
import { esc, sevBadge } from "./evidence.js";
import { FLEET_NAV } from "./detail.js";

export function historyHtml(state: UiState, project: string | null): string {
  let body: string;
  if (state.dataMode.startsWith("frozen scan")) {
    body = `<div class="dim">the fire-rate log lives in %APPDATA%\\object-permanence\\history.jsonl and needs the shell to read; this is the browser fixture mode</div>`;
  } else if (state.history == null) {
    body = `<div class="dim">loading history.jsonl</div>`;
  } else {
    const all = project == null ? state.history : state.history.filter((t) => t.project === project);
    if (all.length === 0) {
      body = `<div class="dim">no flag transitions recorded${project != null ? ` for ${esc(project)}` : ""} yet. transitions land here as flags raise, clear, or change severity.</div>`;
    } else {
      const rates = fireRates(all)
        .slice(0, 20)
        .map(
          (r) =>
            `<div class="card-line"><span class="k">${esc(String(r.raised + r.severityMoves))}x</span> ${esc(r.project)} · ${esc(r.flagId)} (${r.raised} raised, ${r.cleared} cleared, ${r.severityMoves} severity)</div>`
        )
        .join("");
      const feed = [...all]
        .sort((a, b) => b.atMs - a.atMs)
        .slice(0, 200)
        .map(
          (t) => `
          <div class="transition">
            <div class="card-line">
              <span class="k">${esc(new Date(t.atMs).toLocaleString())}</span>
              ${t.to != null ? sevBadge(t.to) : ""} ${esc(t.project)} · ${esc(t.flagId)} ${esc(t.kind)}${t.kind === "severity" ? ` ${esc(t.from ?? "?")} -> ${esc(t.to ?? "?")}` : ""}
            </div>
            <div class="ev-line">${esc(t.summary)}</div>
          </div>`
        )
        .join("");
      body = `
        <section class="detail-section"><div class="section-title">fire rates${project != null ? ` (${esc(project)})` : ""}</div>${rates}</section>
        <section class="detail-section"><div class="section-title">transitions, newest first</div>${feed}</section>`;
    }
  }

  return `
    <div class="detail">
      <div class="titlebar">
        <span>
          <button data-nav="${esc(FLEET_NAV)}" class="back">← fleet</button>
          <h1 class="detail-name">flag history${project != null ? ` · ${esc(project)}` : ""}</h1>
        </span>
        <span class="titlebar-actions">
          ${project != null ? `<button data-nav="${esc(routeHash({ view: "history", project: null }))}">all projects</button>` : ""}
        </span>
      </div>
      <div class="provenance">append-only jsonl, %APPDATA%\\object-permanence\\history.jsonl · every line carries the evidence it fired on</div>
      ${body}
    </div>`;
}
