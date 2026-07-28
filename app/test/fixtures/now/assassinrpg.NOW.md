# NOW (read me first)

<!-- claudhd: opt-in marker (do not remove) - ClauDHD's hooks only act on a NOW.md that has this line -->

One active thread at a time. This file is the cursor: what is live, the next physical action, and what is queued behind it. Read it first, update it as you go.

_Committed, so it follows your branch: `git checkout` swaps this cursor to that branch's thread._

Last touched: 2026-07-08 (prose style guide shipped + pushed: `design/prose_style_guide.md`, 938 lines, Parts I-VIII, now wired into CLAUDE.md + the loom keeper; corpus audit swept data text against the writer bans, fixed 2 hits; ROADMAP carries the Spindle. No game-code build in that stretch — all design/docs. Prior, 2026-07-06 living-world design session, no build: `design/living_world.md` parts I-VI (the Spindle) + `design/godot_transition.md`, captured in IDEAS.md and parked BEHIND the active thread; "other knives" cut by user call, doc §33; **TIME DECIDED, user call: one life = the entire 50+ hour game, rebirth = extender never the main loop**, doc Part VI, contract pacing goes completion-plus-time when that build comes)

## Active thread (only one)

**PIVOT (2026-07-01, user call): the Loom — the living lore engine.** Design locked in chat (`design/lore_engine.md` is the contract): a machine-readable canon store (`data/lore.json`), a keeper script (`loom.mjs`) that lints all data against locked canon + tone rules, a runtime (`src/systems/lore.js`) that reveals facts through play (acts/places/talk), the real named-knowledge `accessGate`, a Journal tab (Lore codex + Chronicle), and the act-7 late-truth rewrite. Runtime LLM is OUT (locked); ceiling is seeded sim + grammars. Includes the owed canon reconciliation pass (npcs/contracts/politics/locations still tell the pre-2026-06-15 story: wynter-as-handler, king-as-father, the Verdant Hand, the Wall). Build phases 1-7 in the design doc; ids never change, display strings do.

### The Loom build (2026-07-01): v1 SHIPPED LOCAL, all 7 phases, browser-verified
- [x] Phase 1: design doc (`design/lore_engine.md`) + the pivot
- [x] Phase 2: seed `data/lore.json` (73 facts, source-cited, tone-clean; ~34 known at start)
- [x] Phase 3: keeper `loom.mjs` + generated `design/story/LORE_INDEX.md` (52 errors found on first run)
- [x] Phase 4: reconciliation pass, loom exits CLEAN across 493 surfaces (act 6 -> the Purge, grandfather, Edda as the order conduit on every act, Dunstan/Vael-Repose displays, Wardhold/Cordon/March Edge, deep_marked factions, nerys/caderyn/cobb/merrick added, intro.js beats to canon, 5 AI-tell fixes in shipped study/furniture text)
- [x] Phase 5: runtime `lore.js` (reveals via start/act/flag + `place:arrived` + Talk `knownBy`), `state.lore` back-fill, the REAL named-knowledge accessGate in `places.js`, `teachFromTalk` in `social.js`
- [x] Phase 6: the Journal tab (Chronicle + Lore codex by kind, [rewritten] markers, "what I know now" re-reads) + `lore:learned` journal lines
- [x] Phase 7: `navigator.storage.persist()` at boot, `TC.saveSize()` meter, docs synced (INDEX/GLOSSARY/ROADMAP/RUNTIME_VERIFICATION_QUEUE)

**Browser-verified** (hard reload, fresh + existing save): clean boot no console errors; 34 start facts; Journal renders grouped counts; Wardhold blocks on "knowledge: husk recognition" then opens on learn; travel fires `place:arrived` -> fact learns via "arriving"; Talk with wenna teaches `wenna_brother` via "talk"; `late_truth` flips the maelor entry to its variant with the [rewritten] marker and the Chronicle grows the "what I know now" line; new-canon intro on fresh save; save 6.3KB total. **NOT yet verified live: the real `contract:done` path (needs an actual act-1 kill; queued in RUNTIME_VERIFICATION_QUEUE #1).** Save-compat: ids never changed, only display strings; `state.lore` is additive via `ensureShape` (no migration needed).

**Previous thread (Broodhall) parked at its clean seam: rebuild live + tested, arena/races queued below.**

### The Broodhall: REBUILT as standalone dragon breeding 2026-06-17 (rebuild commit `d258333`, PUSHED + DEPLOYED)
**User tested the first build and it missed** (assassin-coupled Reading/Nerve felt like busywork; stats had no payoff; the page was a long list). Rebuilt around real, visible, purposeful stats. The old chunks (`b6b5024`..`660a672`, the genotype/Reading/soak-casing/taint/candle model) are SUPERSEDED by the rebuild `d258333`, which is now pushed + deployed (live).
- **Dragon model** (`data/wyrms.json` + `state.dragons`): plain VISIBLE stats grouped by purpose - Combat (attack/health/attackSpeed), Racing (speed/stamina), Production (production) - plus `element` (look + collection axis: ember/frost/storm/venom/stone) and `rarity` (common..legendary). No hidden genes, no Reading. 3 starters lean fighter/racer/producer.
- **Meaning = production** (the user's pick): each dragon adds gold to `state.broodhall.gold` every phase (`broodhallTick` on `clock:advance`) = production stat x rarity mult. Gold buys habitat tiers (more dragons). The combat + racing stats are bred now; their **arenas/races are future** (noted, not built).
- **Breeding** (`broodhall.js`): pick two -> an **egg** whose stats blend the parents with a ratchet (chance to exceed) + mutation; element/rarity/sprite inherit with a bump/mutate chance. Egg -> hatch -> dragon. No Reading.
- **Page** (`ui.js` broodhallHtml): hoard + production-rate header; the **Hall** (gold-cost tiers Pen/Roost/Broodhall + opt-in auto-hatch / auto-breed plan); **two selected dragons side by side** with grouped stats + Breed; a compact dragon **INVENTORY grid + selector** (not a list); eggs; the 124-sprite **compendium**. Tutorial line + Wyrm/lore framing removed.
- **Assets:** 124 sprites in `assets/dragons/` (masuone, itch.io; attribution `SOURCE.md`; `build.mjs` ships `assets/`).
- **Verified in-browser:** starters show grouped stats + production; select two -> side-by-side -> breed -> egg -> hatch -> adult; gold accrues each phase + buys tier upgrades; compendium fills on hatch; old-shape saves migrate to the new model; no console errors.
- **FUTURE (noted, not built):** hide the Broodhall until a real home (out of the keep / big enough) + your first FOUND egg (gates later); the **combat arena + races** that consume those stats; lineage/prestige; balance pass on all placeholder numbers; mereling-style idle foraging if wanted. `design/wyrm_breeding.md` is the OLD assassin-coupled design; this standalone model supersedes it (doc not yet rewritten).

### Places & Access slice 1: SHIPPED + DEPLOYED 2026-06-17, all 6 phases through Gantry (commits `670dba1`..`a118953`)
Full gate run: harvested design (`places_access_reviewed.md`, consolidated from `locations.json` + `core_loop_redesign.md`, NOT invented) -> plan -> 6 build/review phases, every behavior-changing phase browser-verified (incl. real travel clicks). The keep is now a place you move through: `state.location` (starts undercroft) + a `travel` verb (1h/move within the keep, `src/systems/places.js`); presence is PLACE-SCOPED off the NPC-side `location`/`alsoAt` (Source B - the locations' `presentNpcs` is now unread, slated for a cleanup data-pass); `accessGate` enforced (standing + item real; faction-rep + named-knowledge PERMISSIVE fallback until their backing systems exist); `heatProfile` surfaced + a Heat tie-in (can't enter guarded/sealed at Hunted, reusing `heatTier`). The Day UI shows a location header + travel control + place-coherent In-Reach. A latent cut-panel bug was fixed (presence check was Hunted-only). Bootstrap verified: act_1/hewet reachable at the open almsgate, spine not bricked. **Keystone decision (place-based + travel) and source-of-truth (Source B) locked by the user.** DEFERRED to later slices: the Explore verb, faction-controls-location, named-knowledge gates, cross-region travel, location-binding jobs/Working, deep Heat x room coupling, the `presentNpcs` cleanup, and all magnitudes (balance pass).

### Heat redesign: SHIPPED + DEPLOYED 2026-06-17, all 6 phases through Gantry (commits `30e7620`..`6b9b256`)
Full gate run: design (`heat_redesign_reviewed.md`) -> plan (`heat_redesign_reviewed-plan.md`) -> 6 build/review
phases, every phase reviewer-passed (phase 2 caught + fixed a single-derivation leak), every behavior-changing
phase browser-verified. Heat is now a four-tier dial off `heatTier()` in `heat.js` (the one derivation point),
each tier biting a different real system: Calm (nothing) / Noticed (`social.talk` Charisma penalty) /
Suspected (1.5x read+Working tax re-keyed off the tier from the retired `manhunt` flag, + bounded
get-caught-chance rise) / Hunted (the active contract target's `isPresent()` + `cut` go to ground, target-only,
lifts below Hunted). Sources: the kill (vector-scaled, reused) + getting CAUGHT (+35) only - **decision: being
successful never raises heat, so both ambient trickles (per-reveal, per-press) were DROPPED**. Descent:
tier-scaled drift (never zero) + work-a-job + bribe + lie-low; the collapse +15 removed. **spend-standing-to-cool
DROPPED** (study.js `standingWith` is a max() floor, not a drawdown balance; burning it would need a study.js
rework + risk study-gate revocation - the other levers satisfy "descent always available"). Cover/disguise
still SPLIT OUT to its own later idea (its places/access foundation now EXISTS - see the Places section above).
All balance values are placeholders (band edges, drift rates, catch-risk slope, talk penalty) for a later balance pass.

### Pivot (2026-06-17): systems before the content pour
Tried to start 5b (the acquirables catalog) and found §3 is mostly FORWARD: §3a (carry/coin/goods pouches)
is OBSOLETE post-carry/room-removal (no carry cap to push); §3b (worn: disguise/cover/access) and §3c
(tools: locks/keys/seals) target systems that don't exist (disguise, stealth, travel, a lock mechanic, the
Heat redesign). Only a handful of acquirables have a live effect today (read discount, writing XP). So
pouring the catalog now = ~100 inert items. **Decision: build the systems the catalog leans on first, then
its acquirables become real.** 5b (and most of Bundle 5's content) is HELD behind those systems.
Recommended first system: the **Heat redesign** (it's the flagged-weakest mechanic, was explicitly deferred
"after play" - we've now played + deployed - and it underpins the largest acquirable group, §3b cover/disguise).

### Bundle 4 (Talk v0): SHIPPED LOCAL, 2026-06-17 (UNPUSHED)
`src/systems/social.js` + `data/talk.json`, the rewired Talk stub. Gated spec `talk_reviewed.md`.
Commits `47809e9` (spec) + `b8327df` (build). Reviewer caught + fixed a real FAIL: Talk skips contract
targets so it can never expose a Knot (its outer rings carry exactly enough inner threads to hit a target's
threshold). Verified: forced-success Talk reveals an outer thread on a non-target, nothing on a target;
Charisma now trains from Talk. NOT pushed/deployed yet.

### Bundle 3 (trainable skills): SHIPPED LOCAL, 2026-06-17 (UNPUSHED)
Spec `design/loop_v2/skills_reviewed.md` (gated, locked), plan `design/loop_v2/skills_reviewed-plan.md`.
Commits: `73c353f` lock spec · `9b5c2e7` engine · `9654a73` derive fold · `62541ff` exp from day-work ·
`1532e8e` Study-tab readout. Every phase passed its reviewer (PASS / PASS-WITH-NOTES, notes fixed in-commit).
**Phase 4 (skill->domain gate tree) DEFERRED to Bundle 5** (soft-lock avoidance; see build-bundle item 3).
Decisions baked in: no Train action; all 11 skills (5 gate-only); The Blade gates on Stamina 8.
Verified in-browser: skills gain exp from the day-work, passives fold into the derive (commerce L3 ->
+0.1/s coin; stamina L5 -> vigor cap 70), the Study-tab readout shows levels/exp/passives. Known cosmetic:
sub-1 placeholder passives display as "+0/s" (rounding of placeholder magnitudes; a balance-pass concern).
- **Not pushed/deployed yet.** Bundle 3 is 6 local commits past `origin/main`. Offer push + deploy.
Also this session: a run of strip/UI polish (grouped meter strip, Settings modal, bigger readable type,
uniform name+tooltip buttons) + Identity's redundant save card removed - all shipped + deployed earlier.

The Life-Sim Axis (the resource lattice, storage caps, shelter/upkeep, consumable vials) is BUILT and shipped
local across ~9 commits, UNPUSHED. On top of it, this session designed the surface and the content the axis
was missing. Both new docs are done; nothing of this layer is built yet. The job now is to plan and build it
through Gantry, in bundles.

### The doc set for this section (the cleanup index)

The designing got sprawling; this is the canonical map of what governs this layer and its status:

- `design/loop_v2/life_sim_and_resources_reviewed.md` — the axis STRUCTURE. BUILT (8 phases shipped). Its
  section 11 placement (a flat Quarters tab running the day) is SUPERSEDED by day_and_home.
- `design/loop_v2/day_and_home.md` — the SPEC for this layer: the Day (act here) vs the Home/Quarters
  (dwelling + furniture + stats) split, the two-tier action model (instant Hands / one sustained
  Occupation), Talk on the Day, and the furniture system (floor space, four functions, buy/sell). GRILLED
  2026-06-16, all 7 open questions resolved (section 10).
- `design/loop_v2/content_expansion.md` — the CONTENT catalog to pour through it: trainable skills (the
  gate tree), the action catalog, ~146 acquirables (carried, no refund), ~110 furniture (floor-space,
  sell-back), the named book shelf, the Knowledge economy, the full gold-sink wall, the progression quests.
  Brainstorm; folds in day_and_home's decisions.
- `design/loop_v2/childhood_opening.md` — the STAGING (the playable childhood prologue, Area D). Draft, 5
  open decisions; not on the critical path for the build below.

### The build bundle (sequenced, each a Gantry slice)

1. ~~**Day/Home surface split** (day_and_home §1-5).~~ DONE 2026-06-16 (5 commits, local). The Day (Hands +
   Occupation + In-Reach), the read-only Home, the data-driven occupation slot, and the Talk stub all ship.
2. ~~**The furniture system** (day_and_home §6, content §4).~~ DONE 2026-06-16 (3 phases, local), ON SINGLE-CAP.
   Floor space + slots (Rest/Storage/Work/Cover; Grounds/Light unwired) + buy/SELL, `data/furniture.json`
   (7 seed pieces), `src/systems/furniture.js`, furniture folded into `deriveBonuses()`, the Arcanum-style
   Home table (buy/sell/filters/detail). The carry/room reshape was tried then REMOVED (see Carried over) -
   storage stays single-cap, so the storage-upgrade migration + carry acquirables are moot/dropped.
3. ~~**Trainable skills** (content §1).~~ DONE 2026-06-17 (Phases 1,2,3,5; local). `data/skills.json` (11 skills,
   6 with live passives + 5 honest gate-only), `src/systems/skills.js` exp/level engine, `skillBonuses` folded
   into the derive, skill-xp tags on the existing Hands/occupations (NO Train action), the Study-tab readout.
   **Phase 4 (the skill->domain gate tree) DEFERRED to Bundle 5** - gating Poisoncraft/Blade/Wild would soft-lock
   them (their gating skills have no exp feeder until the Bundle-5 action catalog). The unlock flags are set by
   the engine, just unread until then. (Same lesson as carry/room: no gate ahead of its feeder.)
4. ~~**Talk v0** (day_and_home §4; closes Queue #1).~~ DONE 2026-06-17 (local). `src/systems/social.js`:
   Talk spends Hours, rolls Charisma (+grants Charisma XP, closing the skills feeder loop), always gives a
   lore beat (`data/talk.json`, per-person `talkLore` slot for Bundle 5), reveals the next outer Thread on
   success - never on a contract target (Knot-safe). Spec `design/loop_v2/talk_reviewed.md` (gated).
5. **The content pour** (content §2,3,5,7,8) — SLICED. **5a DONE 2026-06-17 (local): skill feeders + the gate tree.**
   Added the actions that feed the feederless skills (forage_woodedge->physick, haul_water/split_kindling->stamina,
   track_in_wood->beast_lore, walk_with_beast->wild) in `lattice_actions.json`, then wired the skill->domain gate
   tree onto the Study entry nodes in `study.json` (this RESOLVES the deferred Bundle-3 Phase 4 - no longer
   soft-locking). gateLabel now shows readable prerequisites ("Physick 6"). Remaining 5 slices (pick next):
   **5b acquirables** (`data/acquirables.json`, carried gear/upgrades), **5c books + the Knowledge economy**
   (`data/books.json`), **5d the gold-sink wall**, **5e the progression-quest unlock-flag chain**, **5f per-person
   `talkLore`** on `npcs.json` (fills Bundle 4's slot). `content_expansion.md` §2-8 still needs its own design gate.
6. **The Home stats panel** (day_and_home §10.6). The character readout: personality/temper, stats and caps,
   resting effects, shelter/upkeep, the acquirables chosen.

Deferred to their own grills/sessions: the Research/Knowledge spend system; a **Heat redesign after play**
(it reads as the weakest mechanic); the full dwelling roster (Holdings G); the Becoming tie (declined as a
furniture link); every balance value. Rule held throughout: **acquirables never refund, furniture sells
back; Nerve recovers by sleep only (for now); food is eaten once a night by Sleep, nothing else "eats."**

### Bundles 1 + 2: SHIPPED LOCAL + PUSHED, 2026-06-16

**Bundle 1 (the Day/Home surface split)** - 4 phases, full Gantry gate, PUSHED (`532c53d`):
- `034c498` carve the Day (Hands + Occupation + In-Reach) · `b595c99` data-driven Occupation slot
- `9e48883` Quarters -> read-only Home · `eeb6393` Talk stub (presence-wired, once-per-day gate)

**Bundle 2 (the furniture system, on single-cap)** - 3 phases + a design backout, full Gantry gate, LOCAL/unpushed:
- `bedcc85`+`5784461` the carry/room two-cap reshape, then `f492a32` BACKED IT OUT (design call, see below)
- `8925e74` furniture content + accessor + state · `18f7706` fold furniture into `deriveBonuses()`
- `44e5157` the Home furniture table (buy/sell/filters/detail; closed the bankOffline occRate gap)

Every phase passed its phase-reviewer (PASS / PASS-WITH-NOTES, notes fixed in-commit). Furniture verified
end-to-end in browser: buy drops coin + raises owned + fills floor + (boot derive) raises the bucket cap;
sell refunds + reverts. NOTE: the headless preview's game loop doesn't tick (rAF throttled), so per-tick
re-derive can't be seen there - caps were verified via the boot derive (reload); a real focused browser
re-derives every 100ms.

### Carried over

- **Push: clean.** `origin/main` is in sync (verified 2026-07-08); the prior NOW-only commits and the CONVENTIONS.md orphans-sweep note are all pushed.
- **Deploy: last known LIVE at https://the-unwoven.pages.dev (deployed `7776f2b`, build `3c7ce4e5`) — the Loom v1 is pushed but NOT deployed, so live is behind main.** Deploy is outward-facing; only on your say-so. Re-deploy = `node build.mjs` then `npx wrangler pages deploy dist --project-name=the-unwoven`.
- **Uncommitted: none.** Tree is clean.
- **CARRY/ROOM SPLIT REMOVED (design decision 2026-06-16).** Carry only bites "when away" (§7's own rule),
  but Home is one click away so there's no away mechanic to give carry/room teeth, and routing Hands to a
  carry cap that was 0 for every non-food bucket hard-locked the gather loop. **Storage is just storage.** If
  an away-from-home mechanic is ever designed, the split can return with it. `day_and_home_reviewed.md` §7 +
  decision 8 (the carry floor) are now superseded.
- `content_expansion.md` still needs its own design gate before Bundles 3/5 (it feeds skills + the content pour).

**Next physical action:** USER TO TEST the Loom v1 (pushed, NOT deployed — say the word and it deploys). Play a few minutes: the Journal tab, talk to Wenna twice across two days, try Wardhold before and after. Then pick the next slice:
- **Evolution stage B (RECOMMENDED next)** — the Reading itself teaches world lore (design doc §evolution). GROUNDED against the code 2026-07-08: skein threads carry NO authored data (generated from ring structure in `reading_model.js`), so the doc's literal "factRef ON the thread" would need a new `npcs.json` authoring surface. Cleaner + consistent with the four live channels: put a `read` reveal-condition ON the fact in `lore.json`, and have `lore.js` listen to the already-emitted `thread:revealed` event exactly like `place:arrived`. This pointer-direction fork needs a user call before build; then author a low-invention seed (facts whose `subjects` name an NPC point at an inner thread on that skein).
- **Whispers Phase 2** — HANDOFF PLAN READY (2026-07-03): `design/loop_v2/textgen_loom_rebase.md`. Phase 0 spec reconciliation -> phase 1 engine+keeper fixes (a/an bug, pronouns, seedFrom, grammar linting in loom.mjs) -> Whispers through Gantry with BOTH strands on the lore store. Gantry-vs-direct is resolved: Gantry.
- **Grill the parked calls** — `meta.lore` wiring, loom-gates-deploy, cross-life fold (design doc §open questions)
- **The Spindle runway (parked BEHIND Whispers, design-first)** — pool: `design/living_world.md`; runway: `design/spindle_handoff.md` (onboarding order, decision state, grill agenda, slice contracts, the traps, session openers). First Spindle step is its grill (handoff §4), never a build.

(Parked, NOT being worked: Broodhall combat arena + races; balance pass; cover/disguise; later Places slices; the content pour.)

Rule: when you finish a step, check it off and write the next single tiny step. Do not start another thread until this one ships or you consciously move it to the Queue.

## Queue (in order, not now)

What is eligible to become active next, in order. Items clear triage's readiness gate before they land here: each is either a ready task (carries a one-line "done" + first action) or a spike (the unknown to resolve before it can be built). Nothing queues as a bare one-liner.

1. **Talk/Explore v0** — ABSORBED into the active thread as Bundle 4 (Talk on the Day, `day_and_home.md` §4:
   a chance keyed to a trainable skill, lots of lore). Explore still rides here as the new-place verb. No
   longer a separate queued thread; it ships when the active thread reaches Bundle 4.
2. **Smoke checklist** — write `docs/RUNTIME_VERIFICATION_QUEUE.md`: a real manual pass over the daily verbs (work, rest, study, case, kill, talk, explore) plus the offline-bank path, so each new slice has a floor to test against. Spike resolved by the two tasks above; the checklist documents what "works" means for each verb.

## Quick fixes (clear in one pass)

Small, self-contained chores that need no plan and aren't worth their own thread. Capped at 5 — overflow means clear some or promote one out, so this stays a batch and never a second backlog. Add with `/claudhd:quick <text>`, clear them in one focused pass with `/claudhd:quick`. The active thread has right of way: clear these between threads, not mid-thread. A fix that turns out to need real thinking gets kicked back to IDEAS.md.

(nothing queued yet)

## Idea flow (do not open a new chat)

New idea mid-task: `/claudhd:idea <text>` records it in IDEAS.md so you can keep working. `/claudhd:harvest` backfills ideas from past sessions you never recorded. `/claudhd:triage` clears the inbox. Finished work is recorded in SHIPPED.md via `/claudhd:shipped`.

## Parked: story & NPC design (parallel, 2026-06-15)

A long design session separate from the Area A build above (not the active thread). Committed: the
story **CANON_LEDGER** (`design/story/CANON_LEDGER.md`, the continuity source of truth) and a `names.md`
reshuffle (king = Wren's grandfather; the roster repositioned to aunts/uncles + cousins; Geraint the
Crownless of Lornhold, Nerys, Cobb, Merrick); the childhood prologue draft (`docs/storyline.md`); the
world-expansion + NPC-depth direction (`design/loop_v2/world_and_npcs.md`); and the full NPC generator
spec (`design/loop_v2/npc_generator.md`: 19 archetypes, the tie web, the Skein derivation). Open on this
thread: anchors-vs-generated (generator), `namesbases.md` (another agent is building it), and the
old-doc reconciliation to the new canon (in progress).

## NPC text generator (parallel system, started 2026-06-17)

The rendering layer that turns world-state into in-world prose without AI (grammar-based, Tracery
lineage). It serves the NPC design lineage above (fills the rendering layer `npc_generator.md` defers).
Spec: `design/loop_v2/npc_text_generator.md` (locked; the Whispers reframe folded in this session). Four-
phase build order, three surfaces (Whispers / Conversation / lore reveals).

- **Phase 1 (engine): SHIPPED + PUSHED (commit `4fbd421`).** `src/content/textgen.js`, a generic
  content-free grammar engine: `expand`, the `when` mini-DSL, weight/`tag` scaling, post-processing, and
  a load-time AI-tell lint. Verified by a node smoke test (25 checks); test removed. Impl note: the
  `when` membership key is `moralFlags` (plural array field).
- **Whispers reframe (the design call this session).** Rumors are NOT a journal ticker (that draft is
  superseded). A rumor is the unverified inverse of a Thread: contested intel with source/subject/
  strength/state, living in a **Whispers TAB in the keep**, never the journal. It feeds the reading loop
  via the existing `revealCost` `hinted` discount, scaled by strength. Resolved this session: false-rumor
  cost is SOFT (just expires, lost discount), rumors DECAY/expire, the lore strand is DEFERRED to surface
  C (build the `npc` leads strand first).
- **Next: Phase 2 = Whispers.** `data/voice/rumors.json` + the rumor store in `voices.js` (spawn on
  `jobs:done`/Working/`politics:kill`/`politics:day`, resolve on `thread:revealed`, decay on the day
  tick) + the keep tab + `state.whispers` save field (back-fill + `migrations` entry) + the `isHinted`
  hook into `revealCost`. Two tunables open: whisper spawn rate/cap, per-band strength numbers (default
  then tune, like the Heat numbers).
- **DECIDED 2026-07-03: Gantry, after a rebase.** The 06-17 spec drifted stale against the Loom pivot
  (Verdance/late_lore_rewrite naming, `jobs:done` vs the real `jobs:shift`, surface C overlapping what
  the Loom now owns). The handoff plan is `design/loop_v2/textgen_loom_rebase.md`: reconcile the spec,
  land the engine+keeper fixes, then Whispers through Gantry with the lore strand pointing at fact ids.
  Engine + spec are committed and pushed (`4fbd421`).

This sits BESIDE the active Heat thread, not ahead of it. Heat is still the declared active thread;
this got started parallel and is parked at a clean seam (engine done, spec locked, nothing half-built).

## Loose ends

- **Story-doc reconciliation pass DONE 2026-07-08** (chat session, uncommitted): swept every design/docs story doc against current canon (`data/lore.json` / CANON_LEDGER / factions / names). Fixed: the ledger's own staleness (Vael no longer [open]; the childhood beats aligned to the WRITTEN `docs/storyline.md`, where the boy gives his own name in ch 2 and scribing lands before Nerys; the owed-reconciliation list closed out), factions.md's still-open list pruned (Dunstan, the Realm of the Makers, Warden of the Cordon, Rime, Husk-takers-as-warbands, Brambleward->Wardhold all recorded settled), the king's-bastard -> king's-bastard-GRANDSON framing fixed in lore_bible/DESIGN_BASELINE/signature, New-Identity prestige language annotated across the docs (canon: act-6 burn = Heat reset only, death-gated rebirth is the real prestige), supersession banners on world_magic_expansion (husk-taker origin, Stillfolk-as-enclave, Sourmoor fold pending) / core_loop_redesign (the Crownsworn; "the Hand's Web you are a tool of" retired) / wyrm_breeding, GLOSSARY notes on New Identity / Burn the name, and 2 `lore.json` display strings (`cobb_named_me`, `garrow_other_hand`; ids untouched; loom re-run CLEAN). The old loose-end here (README acts / Vite in the baseline) was already fixed in both files, dropped. **Open rulings parked:** Merrick still [PROPOSED] though shipped in data (lock him?); whose by-blow Garrow is (new [OPEN] in names.md); Part VI's "rebirth carries memory, never power" vs the ledger/OVERVIEW cross-life multiplier (annotated in all three, rides the Spindle rebirth grill); the Sourmoor/Quickbite deep-Sere fold ([RECONCILE], unchanged). `npc_text_generator.md`'s Verdance staleness left alone on purpose: owned by `textgen_loom_rebase.md` phase 0.
- Hold the politics layer thin (schemes/rivalries). Do not deepen it until Talk/Explore give the player real handles to influence it.

## Leaving this file when you stop

Before you walk away, or whenever you switch context, make the "Next physical action" line true and tiny. That one line is what lets you stop mid-thought and lose nothing. The quick way: run `/claudhd:wrap` and it reconciles this file for you - checks off what's done, writes the next action, and closes out loose ends.
