// The fleet view: provenance header, fleet banner, project cards (quiet ones
// collapse to one row), the untracked shelf. Layout per the locked mockups.

import type { FleetSnapshot, ProjectCard } from "../../core/model.js";
import { revalidationLabel } from "../../core/revalidate.js";
import { routeHash } from "../router.js";
import type { UiState } from "../store.js";
import { debtLabel, esc, flagBlock, freshnessDot, relTime, sevBadge, sevCounts } from "./evidence.js";

// "session active: X (checkpoint 2m ago)" when some project's checkpoint is
// minutes old, else the newest checkpoint stamp. The checkpoint is the fact;
// the label never claims more than the file shows.
function sessionLabel(s: FleetSnapshot, nowMs: number): string {
  let best: { name: string; ms: number } | null = null;
  for (const c of s.cards) {
    const ms = c.checkpoint?.mtimeMs ?? null;
    if (ms != null && (best == null || ms > best.ms)) best = { name: c.name, ms };
  }
  if (best == null) return "no checkpoints seen";
  if (nowMs - best.ms <= 10 * 60_000) return `session active: ${best.name} (checkpoint ${relTime(best.ms, nowMs)})`;
  return `no session active · last checkpoint ${relTime(best.ms, nowMs)} (${best.name})`;
}

export function fleetHeaderHtml(state: UiState, nowMs: number): string {
  const s = state.snapshot;
  const scanned = s != null ? new Date(s.scannedAtMs).toLocaleTimeString() : "";
  const counts = s != null ? `${s.cards.length} projects · ${s.untracked.length} shelf` : "";
  const watcherBits: string[] = [];
  if (s != null) {
    watcherBits.push(sessionLabel(s, nowMs));
    if (state.watching && state.watcherStartedMs != null) {
      watcherBits.push(`watcher up since ${new Date(state.watcherStartedMs).toLocaleTimeString()}`);
      if (state.lastEventMs != null) watcherBits.push(`last event ${relTime(state.lastEventMs, nowMs)}`);
      watcherBits.push(revalidationLabel(state.lastRevalidation));
    }
  }
  return `
    <div class="titlebar">
      <h1>OBJECT PERMANENCE</h1>
      <span class="titlebar-actions">
        <button data-rescan ${state.scanning ? "disabled" : ""}>${state.scanning ? "scanning..." : "rescan"}</button>
        <a href="${esc(routeHash({ view: "history", project: null }))}" class="quiet-link">history</a>
        <a href="${esc(routeHash({ view: "settings" }))}" class="quiet-link">settings</a>
      </span>
    </div>
    <div class="provenance">
      ${state.scanError != null ? `<span class="scan-error">${esc(state.scanError)}</span>` : ""}
      ${s == null ? esc(state.dataMode) : `${esc(state.dataMode)} · scanned ${esc(scanned)} · ${esc(counts)}`}
      ${watcherBits.length > 0 ? `<br>${esc(watcherBits.join(" · "))}` : ""}
    </div>`;
}

export function sinceLastOpenHtml(state: UiState): string {
  const slo = state.sinceLastOpen;
  if (slo == null) return "";
  const when = new Date(slo.savedAtMs).toLocaleString();
  const lines =
    slo.lines.length === 0
      ? `<div class="ev-line">nothing changed while you were away</div>`
      : slo.lines
          .slice(0, 12)
          .map(
            (l) =>
              `<div class="ev-line"><button class="slo-project" data-nav="${esc(routeHash({ view: "detail", name: l.project }))}">${esc(l.project)}</button> ${esc(l.kind)} ${esc(l.text)}</div>`
          )
          .join("") + (slo.lines.length > 12 ? `<div class="ev-line">(+${slo.lines.length - 12} more)</div>` : "");
  return `
    <div class="since-open">
      <div class="shelf-title">SINCE LAST OPEN (${esc(when)}, ${esc(slo.gap)})</div>
      ${lines}
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

export function fleetChromeHtml(
  state: UiState,
  nowMs: number
): { header: string; since: string; banner: string; quiet: string; shelf: string } {
  const s = state.snapshot;
  return {
    header: fleetHeaderHtml(state, nowMs),
    since: sinceLastOpenHtml(state),
    banner: s != null ? bannerHtml(s) : "",
    quiet: s != null ? quietRowHtml(splitCards(s).quiet, nowMs) : "",
    shelf: s != null ? shelfHtml(s) : "",
  };
}
