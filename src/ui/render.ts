// The paint loop, unwoven-style: paint() rebuilds chrome regions cheaply and
// reconciles project cards by key, so a card's DOM is rebuilt only when that
// card's data changed. Event delegation on #app handles every click.

import type { ProjectCard } from "../core/model.js";
import { store, update, type UiState } from "./store.js";
import { parseHash } from "./router.js";
import { detailHtml, FLEET_NAV } from "./views/detail.js";
import { cardHtml, fleetChromeHtml, splitCards } from "./views/fleet.js";
import { historyHtml } from "./views/history.js";
import { settingsHtml } from "./views/settings.js";

let root: HTMLElement | null = null;
let mountedView = "";
let nowMs = () => Date.now();
let onRescan: (() => void) | null = null;
let onLaunch: ((action: string, project: string) => void) | null = null;
let onOpenDataFolder: (() => void) | null = null;

// Per-card memo: rebuild a card's DOM only when its data hash changed. The
// hash also covers the expanded-set entries that card renders.
const cardHash = new Map<string, string>();

function hashCard(card: ProjectCard, state: UiState): string {
  let expandedBits = "";
  for (const f of card.flags) {
    if (state.expanded.has(`${card.name}/${f.id}`)) expandedBits += f.id + ";";
  }
  return JSON.stringify(card) + "|" + expandedBits;
}

export function initRender(
  el: HTMLElement,
  opts: {
    now?: () => number;
    rescan?: () => void;
    launch?: (action: string, project: string) => void;
    openDataFolder?: () => void;
  } = {}
): void {
  root = el;
  // A fresh mount owns none of the previous mount's memory; without this a
  // re-init paints into an empty root believing the skeleton already exists.
  mountedView = "";
  cardHash.clear();
  if (opts.now) nowMs = opts.now;
  onRescan = opts.rescan ?? null;
  onLaunch = opts.launch ?? null;
  onOpenDataFolder = opts.openDataFolder ?? null;
  el.addEventListener("click", onClick);
  window.addEventListener("hashchange", () => {
    update((s) => {
      s.route = parseHash(location.hash);
    });
  });
}

function onClick(ev: Event): void {
  const target = (ev.target as HTMLElement).closest(
    "[data-nav],[data-toggle-flag],[data-rescan],[data-launch],[data-launch-menu],[data-open-data-folder]"
  );
  if (target == null) return;
  const nav = target.getAttribute("data-nav");
  if (nav != null) {
    location.hash = nav;
    return;
  }
  const key = target.getAttribute("data-toggle-flag");
  if (key != null) {
    update((s) => {
      if (s.expanded.has(key)) s.expanded.delete(key);
      else s.expanded.add(key);
    });
    return;
  }
  const launchAction = target.getAttribute("data-launch");
  if (launchAction != null) {
    const project = target.getAttribute("data-project") ?? "";
    update((s) => {
      s.launchMenuFor = null;
    });
    onLaunch?.(launchAction, project);
    return;
  }
  const menuFor = target.getAttribute("data-launch-menu");
  if (menuFor != null) {
    update((s) => {
      s.launchMenuFor = s.launchMenuFor === menuFor ? null : menuFor;
    });
    return;
  }
  if (target.hasAttribute("data-open-data-folder")) {
    onOpenDataFolder?.();
    return;
  }
  if (target.hasAttribute("data-rescan")) onRescan?.();
}

export function paint(): void {
  if (root == null) return;
  const state = store;
  const view = state.route.view;

  if (view !== mountedView) {
    cardHash.clear();
    if (view === "fleet") {
      root.innerHTML = `
        <div id="chrome"></div>
        <div id="since"></div>
        <div id="banner"></div>
        <div id="cards"></div>
        <div id="quiet"></div>
        <div id="shelf"></div>`;
    } else {
      root.innerHTML = `<div id="page"></div>`;
    }
    mountedView = view;
  }

  if (view === "fleet") {
    paintFleet(state);
  } else if (view === "history" && state.route.view === "history") {
    byId("page").innerHTML = historyHtml(state, state.route.project);
  } else if (view === "detail" && state.route.view === "detail") {
    const name = state.route.name;
    const card = state.snapshot?.cards.find((c) => c.name === name);
    byId("page").innerHTML =
      card != null
        ? detailHtml(card, state, nowMs())
        : `<div class="detail"><div class="titlebar"><span><button data-nav="${FLEET_NAV}" class="back">← fleet</button><h1 class="detail-name">${name}</h1></span></div><div class="provenance">no card with that name in the snapshot</div></div>`;
  } else {
    byId("page").innerHTML = settingsHtml(state, state.config);
  }
}

function byId(id: string): HTMLElement {
  const el = root?.querySelector("#" + id);
  if (el == null) throw new Error(`render region #${id} missing`);
  return el as HTMLElement;
}

function paintFleet(state: UiState): void {
  const chrome = fleetChromeHtml(state, nowMs());
  byId("chrome").innerHTML = chrome.header;
  byId("since").innerHTML = chrome.since;
  byId("banner").innerHTML = chrome.banner;
  byId("quiet").innerHTML = chrome.quiet;
  byId("shelf").innerHTML = chrome.shelf;

  const cardsEl = byId("cards");
  const s = state.snapshot;
  if (s == null) {
    cardsEl.innerHTML = `<div class="dim empty-note">${state.scanning ? "first scan running" : "no snapshot"}</div>`;
    return;
  }
  const { full } = splitCards(s);

  // Keyed reconcile: reuse the existing element when the hash is unchanged.
  const existing = new Map<string, Element>();
  for (const el of Array.from(cardsEl.children)) {
    const key = el.getAttribute("data-card");
    if (key != null) existing.set(key, el);
  }
  const next: Element[] = [];
  for (const card of full) {
    const h = hashCard(card, state);
    const prev = existing.get(card.name);
    if (prev != null && cardHash.get(card.name) === h) {
      next.push(prev);
    } else {
      const holder = document.createElement("div");
      holder.innerHTML = cardHtml(card, state, nowMs());
      const el = holder.firstElementChild;
      if (el != null) next.push(el);
      cardHash.set(card.name, h);
    }
  }
  cardsEl.replaceChildren(...next);
}
