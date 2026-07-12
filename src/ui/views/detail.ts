// The project detail view: git line, cursor panel, flags with evidence,
// gantry pipeline, recent shipped feed, backlog. Remedies are commands for
// the session, never in-app actions; resume/capture are phase-5 and render
// inert here, labeled as such.

import type { ProjectCard } from "../../core/model.js";
import { routeHash } from "../router.js";
import type { UiState } from "../store.js";
import { debtLabel, esc, flagBlock, relTime } from "./evidence.js";

export const FLEET_NAV = routeHash({ view: "fleet" });

function section(title: string, inner: string): string {
  return `<section class="detail-section"><div class="section-title">${esc(title)}</div>${inner}</section>`;
}

export function detailHtml(card: ProjectCard, state: UiState, nowMs: number): string {
  const title = card.title != null ? ` <span class="human-title">(${esc(card.title)})</span>` : "";
  const git = card.git;
  const gitLine =
    git == null
      ? "no git facts"
      : `${esc(git.branch ?? "?")} · ${esc(debtLabel(card))} · last commit ${esc(relTime(git.lastCommitAt != null ? Date.parse(git.lastCommitAt) : 0, nowMs))} ${esc(git.lastCommitMsg ?? "")}`;

  let cursor: string;
  if (card.parse.status === "raw-fallback" && card.source === "now.md") {
    cursor = `
      <div class="raw-fallback">
        <div class="raw-reason">could not parse NOW.md (${esc(card.parse.reason)}), showing raw</div>
        <pre class="raw-text">${esc(card.parse.raw)}</pre>
      </div>`;
  } else {
    const c = card.cursor;
    cursor = `
      <div class="card-line"><span class="k">now</span> ${esc(c?.activeThread ?? "(none)")}</div>
      <div class="card-line"><span class="k">next</span> ${esc(c?.nextAction ?? "(no unchecked next action)")}</div>
      <div class="card-line dim">queue ${c?.queueCount ?? "?"} · quick fixes ${c?.quickFixCount ?? "?"}/${c?.quickFixCap ?? "cfg"} · loose ends ${c?.looseEndsCount ?? "?"} · touched ${esc(c?.lastTouched ?? "?")}</div>`;
  }

  const flags =
    card.flags.length > 0
      ? card.flags.map((f) => flagBlock(card.name, f, state.expanded)).join("")
      : `<div class="dim">no flags</div>`;

  const sentinel =
    card.sentinel != null
      ? `<div class="card-line">sentinel: phase ${esc(card.sentinel.phase)} of ${esc(card.sentinel.plan)} (started ${esc(card.sentinel.started ?? "?")})</div>`
      : "";
  const plans =
    card.plans.length > 0
      ? card.plans
          .map(
            (p) =>
              `<div class="card-line">plan ${esc(p.file)} · ${p.phasesDone}/${p.phasesTotal} phases (${esc(p.basis)}) · touched ${esc(relTime(p.mtimeMs, nowMs))}${p.commitsSinceMtime != null ? ` · ${p.commitsSinceMtime} commits since` : ""}</div>`
          )
          .join("")
      : "";
  const audit =
    card.auditMtimeMs != null
      ? `<div class="card-line dim">audit ${esc(relTime(card.auditMtimeMs, nowMs))}</div>`
      : "";
  const pipeline = sentinel + plans + audit;

  const shippedFeed =
    card.shippedRecent.length > 0
      ? card.shippedRecent
          .map((e) => `<div class="card-line"><span class="k">${esc(e.date ?? "??")}</span> ${esc(e.text)}</div>`)
          .join("")
      : `<div class="dim">no SHIPPED.md entries</div>`;

  const backlog = `
    <div class="card-line">ideas ${card.ideas?.untriaged ?? "?"} untriaged of ${card.ideas?.total ?? "?"}${card.ideas?.oldestUntriagedDate != null ? ` (oldest ${esc(card.ideas.oldestUntriagedDate)})` : ""}</div>
    <div class="card-line">roadmap ${card.roadmap?.count ?? "?"} open${card.roadmap?.topItem != null ? ` · top: ${esc(card.roadmap.topItem)}` : ""}</div>`;

  const sourceNote =
    card.source === "state.json"
      ? `state.json (generated ${esc(card.stateJson?.generatedAt ?? "?")})`
      : "lenient NOW.md parse" + (card.stateJson == null ? " (no state.json on disk yet)" : " (state.json stale, superseded)");

  return `
    <div class="detail">
      <div class="titlebar">
        <span>
          <button data-nav="${esc(FLEET_NAV)}" class="back">← fleet</button>
          <h1 class="detail-name">${esc(card.name)}${title}</h1>
        </span>
        <span class="titlebar-actions">
          <button disabled title="launcher lands in phase 5">resume ▾</button>
          <button disabled title="launcher lands in phase 5">open folder</button>
        </span>
      </div>
      <div class="provenance">source: ${sourceNote} · ${esc(gitLine)}</div>
      ${section("cursor (NOW.md)", cursor)}
      ${section("flags", flags)}
      ${pipeline ? section("pipeline (gantry)", pipeline) : ""}
      ${section("recent shipped", shippedFeed)}
      ${section("backlog", backlog)}
    </div>`;
}
