# 12 · Whisperer — demand↔supply content intelligence (plan)

[← Contract Compiler](11-contract-compiler.md) · [Wiki home](README.md)

**Status:** planned, mock-first. A new agent on the ANSR hub. This is the spec + build plan we align on before code. Decisions locked: new agent on the ANSR hub · mock data first · Journey 1 end-to-end first · this doc + a reusable `whisperer` skill first.

---

## Thesis
Match **who candidates are** (demand / *Hunger*) with **what the world is talking about** (supply / *Feed*), and produce classified, justified **Feed Stories** a content team can approve and build. Three entry points converge on one **Whisperer** pipeline.

```
J1 Hunger-led:   Talent500 → ClientMind(chips) → Cohort → Hunger Story (Demand Topics) ─┐
J2 Admin-seeded: Admin Demand Topics + 1-Ups + Emotional Frameworks/Registers ──────────┤→ WHISPERER
J3 SEO workspace: paste keywords / GSC / competitor / Reddit / trend reports ───────────┘
                                                                                          │
 Supply (Feed): YouTube · Reddit · Google Trends · News (India / English) ──► Trend detect
                                                                                          ▼
 Feed Stories — classified (Demand Topic · 1-Up · Emotional Framework · Register),
   justified (What · Why now · Why trending · Why relevant · Why-relevant-to-this-cohort),
   actioned (Approve · Bank · Delete · Edit · Save · multi-select → build).
```
Every step carries a **flow meter** on top (the staggered step-flow UI).

---

## The pieces

### 1 · ClientMind (the candidate parser) — reuse the `munshi` method
Per candidate, study the **whole corpus** (profile, employment history, CV, cover letters, recommendation letters, documents, notes, activity) with **100% coverage** → a **Master Profile MD** (one file, source of truth) → **ClientMind**: a rich collection of searchable **chips** (attributes · interests · behaviours · skills · aspirations · career patterns · motivations). Chips are as detailed as possible.
- **One-time parse**, then **re-parse on any update**; **weekly refresh** across the whole database.
- Storage = the hybrid store: raw docs (T1 vault) · Master MD (T2) · chips (T3 Postgres, queryable).
- `munshi` gives: fingerprinted doc archetypes, deterministic re-parse of known formats, learn-once for new formats, ask-never-guess clarifications, identity memory.

### 2 · Cohort Builder
Build cohorts by **Talent500 filters** + **AI Natural-Language queries** (e.g. *"candidates who have never stayed longer than two years in any company"*). **Save with name + timestamp** for reuse; each cohort is targetable.

### 3 · Hunger (Demand) — the "Hunt Outcome"
AI reads the cohort's ClientMind chips → a **Hunger Story**: who this cohort is · what they currently care about · topics they're likely searching · career motivations · emotional drivers. These crystallise into **Demand Topics**. The Hunger Story is shown as a **nicely written Hunt Outcome** the user can tweak + save; the saved story drives matching/search for feed stories.

### 4 · Whisperer pipeline (all journeys converge)
- **Feed collection** — continuously ingest YouTube · Reddit · Google Trends · News · industry blogs (India-focused, English). Official APIs + selected paid providers. An **Integration Library** for every source.
- **Trend detection** — emerging topics · viral conversations · recurring themes · industry movements · opportunity signals.
- **Feed Story generation** — rich stories: *what it is · why it matters now · why it's trending · why it's relevant*.
- **Classification** — every story tagged **Demand Topic · 1-Up · Emotional Framework · Emotional Register**.
- **Justification** — *why now · why relevant · why relevant to this cohort*, each showing **which Demand Topic, which 1-Up, which Emotional Framework, which Emotional Register** — combining **scientific reasoning + creative storytelling**.

### 5 · Feed Review interface
Each story displays: Demand Topic · 1-Up · Emotional Framework · Register · Summary · Why now · Why relevant · Why-relevant-to-cohort. Actions per story: **Approve · Bank · Delete · Edit · Save**. **Multi-select** stories to develop further. A separate **SEO tab** (Journey 3 workspace).

### 5a · The final output = a heading + a topic guide (NOT finished content)
**Deliberately not fully automated.** Fully auto-writing the final piece is painful and low-quality — it removes the craft. So Whisperer's end result per approved idea stops at:
- a **heading** (the angle/title), and
- a **topic guide** — a short brief: the take, the key points/beats to cover, the 1-Up and emotional register to hit, the source signals (why-now/why-trending), and suggested proof/links.

The content team writes from the guide. Whisperer proposes and briefs; it does **not** ship finished copy. (Same principle as Mint: the engine explains and prepares; a human commits.)

### 6 · Second starting point (Feed-led)
Not hunger-led but **feed-led / trend-spotting first** — start from detected trends, then map back to Demand Topics / cohorts.

---

## Schema (draft)
- **Candidates & ClientMind:** `candidate` · `candidate_doc` (raw, T1) · `client_mind` (master_md, chips jsonb, refreshed_at) · `chip` (candidate_id, kind, value, weight — queryable)
- **Cohorts & demand:** `cohort` (name, ts, filter_def, nl_query, member_ids, **hunger_story**) · `demand_topic` (name, definition, source: hunger|admin|seo) · `one_up` · `emotional_framework` · `emotional_register`
- **Feed & supply:** `feed_source` (integration config) · `feed_item` (raw ingested) · `trend` · `feed_story` (demand_topic, one_up, emotional_framework, emotional_register, summary, why_now, why_relevant, why_cohort, status: draft|approved|banked|deleted, selected)
- **SEO & ops:** `seo_input` (keyword/GSC/competitor/reddit/trend pastes) · `schedule` (target: clientmind_refresh|feed_run, cadence) · `user_role`

## AI pipelines (gated, model-switchable, clause/source-traceable)
`clientmind-parse` (munshi) · `cohort-nl-query` (NL → filter) · `hunger-generate` (chips → Hunger Story + Demand Topics) · `trend-detect` · `feedstory-generate` · `feedstory-classify` (topic/1up/framework/register) · `feedstory-justify` (why-now / why-relevant / why-cohort — scientific + creative).

## Admin (Whisperer console — reuses the RayDar shell)
Integrations (Talent500 · YouTube · Reddit · Google Trends · News + Integration Library) · **Demand Topic / 1-Up / Emotional Framework / Register** management (add + define) · **Scheduler** (run feed now | build cadence; weekly ClientMind refresh) · role-based permissions · MissQ AI console (providers + apply-to-all model).

## Roles
| You are | Read sections |
|---|---|
| **Engineering** | 1, 2, 5, 6, 7, 8, 9, 11 |
| **SEO team** | 1, 4 |
| **Content team** | 1, 3, 10 |
| **Vikram** | 1, 3, 12 |

## Reuse map (why this is fast)
| Whisperer piece | Reuses |
|---|---|
| ClientMind parser | `munshi` skill (doc-ingestion that learns) + hybrid store |
| Chips / cohorts | Atlas-style fingerprints + saved, learnable groups |
| Every AI step | the gated pipeline registry (apply-to-all, model dropdowns) |
| Integrations · Scheduler · MissQ | the **RayDar** admin shell |
| Flow meter per step | the staggered step-flow UI |
| Feed/candidate storage | vault T1 · MD T2 · Postgres T3 (doc×api switch) |

## External dependencies (you provision)
Talent500 API/export · YouTube Data API key · Reddit app · Google Trends / news provider (paid ok). Until then → **mock data** (seeded candidates + sample feed items) so the whole journey works, then swap in live sources.

## Build plan (mock-first)
1. **Whisperer agent** tile + console shell (on the hub, reusing RayDar).
2. **ClientMind** (munshi) on ~10 mock candidates → Master MD → chips.
3. **Cohort builder** (filters + NL query) → saved cohorts.
4. **Hunger** → Hunt Outcome (editable, saved).
5. **Whisperer** on mock feed items → trend detect → **Feed Stories** (classified + justified).
6. **Feed Review** UI (Approve/Bank/Delete/Edit/Save/multi-select) + **SEO tab**.
7. **Admin**: Demand Topic / 1-Up / Emotional Framework / Register management + Scheduler + roles.
8. Swap mocks → live integrations as keys land. Journey 2 (Admin-seeded) + Journey 3 (SEO) reuse the converged pipeline.
