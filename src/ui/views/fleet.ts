// The fleet view: provenance header, fleet banner, project cards (quiet ones
// collapse to one row), the untracked shelf. Layout per the locked mockups.

import type { FleetSnapshot, ProjectCard } from "../../core/model.js";
import { routeHash } from "../router.js";
import type { UiState } from "../store.js";
import { debtLabel, esc, flagBlock, freshnessDot, relTime, sevBadge, sevCounts } from "./evidence.js";

export function fleetHeaderHtml(state: UiState, nowMs: number): string {
  const s = state.snapshot;
  const scanned = s != null ? new Date(s.scannedAtMs).toLocaleTimeString() : "";
  const counts = s != null ? `${s.cards.length} projects · ${s.untracked.length} on the shelf` : "";
  return `
    <div class="titlebar">
      <h1>OBJECT PERMANENCE</h1>
      <span class="titlebar-actions">
        <button data-rescan ${state.scanning ? "disabled" : ""}>${state.scanning ? "scanning..." : "rescan"}</button>
        <a href="${esc(routeHash({ view: "settings" }))}" class="quiet-link">settings</a>
      </span>
    </div>
    <div class="provenance">
      ${state.scanError != null ? `<span class="scan-error">${esc(state.scanError)}</span>` : ""}
      ${s == null ? esc(state.dataMode) : `${esc(state.dataMode)} · scanned ${esc(scanned)} · ${esc(counts)}`}
    </div>`;
}

function bannerHtml(s: FleetSnapshot): string {
  if (s.fleetFlags.length === 0) return "";
  return s.fleetFlags
    .map(
      (f) => `
      <div class="fleet-banner sev-${f.severity}">
        ${sevBadge(f.severity)} ${esc(f.summary)}
        <span class="banner-detail">${esc(f.evidence.map((e) => e.replace(": dirty", "")).join(" · "))}</span>
      </div>`
    )
    .join("");
}

// A card is quiet when it carries no crit and no warn; quiet cards collapse
// to a single shared row so the window stays one screen. The most recent
// card always renders full (the re-orientation anchor).
function isQuiet(card: ProjectCard, topName: string | null): boolean {
  if (card.name === topName) return false;
  const c = sevCounts(card);
  return c.crit === 0 && c.warn === 0;
}

export function cardHtml(card: ProjectCard, state: UiState, nowMs: number): string {
  const dot = freshnessDot(card.lastActivityMs, nowMs);
  const when = relTime(card.lastActivityMs, nowMs);
  const branch = card.git?.branch != null ? `${esc(card.git.branch)} · ` : "";

  let body: string;
  if (card.parse.status === "raw-fallback" && card.source === "now.md") {
    const truncated = card.parse.raw.length > 4000;
    body = `
      <div class="raw-fallback">
        <div class="raw-reason">could not parse NOW.md (${esc(card.parse.reason)}), showing raw${truncated ? " (truncated here, detail shows all of it)" : ""}</div>
        <pre class="raw-text">${esc(card.parse.raw.slice(0, 4000))}</pre>
      </div>`;
  } else {
    const thread = card.cursor?.activeThread ?? "(no active thread)";
    const next = card.cursor?.nextAction ?? "(no unchecked next action in the cursor)";
    body = `
      <div class="card-line"><span class="k">now</span> ${esc(thread)}</div>
      <div class="card-line"><span class="k">next</span> ${esc(next)}</div>`;
  }

  const flags = card.flags.map((f) => flagBlock(card.name, f, state.expanded)).join("");

  return `
    <article class="card" data-card="${esc(card.name)}">
      <header class="card-head">
        <button class="card-name" data-nav="${esc(routeHash({ view: "detail", name: card.name }))}">
          <span class="dot">${dot}</span> ${esc(card.name)}
        </button>
        <span class="card-when">${branch}${esc(when)}</span>
      </header>
      ${body}
      ${flags ? `<div class="card-flags">${flags}</div>` : ""}
      <footer class="card-foot">${esc(debtLabel(card))} · shipped ${card.shipped?.total ?? "?"} (last ${esc(card.shipped?.lastEntryDate ?? "none")})</footer>
    </article>`;
}

export function quietRowHtml(cards: ProjectCard[], nowMs: number): string {
  if (cards.length === 0) return "";
  const items = cards
    .map(
      (c) =>
        `<button class="quiet-item" data-nav="${esc(routeHash({ view: "detail", name: c.name }))}">${freshnessDot(
          c.lastActivityMs,
          nowMs
        )} ${esc(c.name)}</button>`
    )
    .join(" · ");
  return `<div class="quiet-row">${items} <span class="quiet-note">(quiet: no warns)</span></div>`;
}

export function shelfHtml(s: FleetSnapshot): string {
  if (s.untracked.length === 0) return "";
  const items = s.untracked
    .map((u) => {
      const bits = [
        u.uncommitted > 0 ? `dirty ${u.uncommitted}` : null,
        u.unpushed != null && u.unpushed > 0 ? `↑${u.unpushed}` : null,
      ]
        .filter(Boolean)
        .join(" ");
      return `<span class="shelf-item">${esc(u.name)}${bits ? ` <span class="shelf-debt">${esc(bits)}</span>` : ""}</span>`;
    })
    .join(" · ");
  return `
    <div class="shelf">
      <div class="shelf-title">untracked (git, no claudhd)</div>
      <div class="shelf-items">${items}</div>
    </div>`;
}

export function splitCards(s: FleetSnapshot): { full: ProjectCard[]; quiet: ProjectCard[] } {
  const topName = s.cards[0]?.name ?? null;
  const full: ProjectCard[] = [];
  const quiet: ProjectCard[] = [];
  for (const c of s.cards) (isQuiet(c, topName) ? quiet : full).push(c);
  return { full, quiet };
}

export function fleetChromeHtml(state: UiState, nowMs: number): { header: string; banner: string; quiet: string; shelf: string } {
  const s = state.snapshot;
  return {
    header: fleetHeaderHtml(state, nowMs),
    banner: s != null ? bannerHtml(s) : "",
    quiet: s != null ? quietRowHtml(splitCards(s).quiet, nowMs) : "",
    shelf: s != null ? shelfHtml(s) : "",
  };
}
