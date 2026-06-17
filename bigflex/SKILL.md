---
name: bigflex
description: TheBigFlex — the reusable engine + component kit behind Q&ANSR. Turns ANY document-defined ruleset (a contract/SOW/policy) plus a periodic data feed (a worksheet) into computed, explainable, auditable outputs (bills, statements, dashboards) — for thousands of tenants, with no per-tenant code. Use when building a new doc-driven calc/AR/ops product, adding a tenant, an operator, a pipeline, a screen, or when asked about the rule book, calc engine, clarifications, recalibration, the doc×api hybrid store, gates, or outputs. Triggers — "BigFlex", "calc engine", "rule book", "recalibrate", "clarification loop", "1000 contracts", "generic engine", "reuse this".
---

# TheBigFlex — generic doc→rules→data→outputs engine

**Thesis:** a document defines rules; a periodic sheet supplies data; BigFlex computes the result, explains every number, learns from corrections, and locks it for audit — **the same code for 1 or 10,000 tenants**. Tenants are *data* (a compiled rule book), never code. The only logic in code is a small set of **operators**; anything a tenant needs that operators can't express is **flagged for a human, never guessed**.

First product on it: **Mint · AR Contract Reconciler** (contracts → monthly TA/OSS invoicing). The engine is contract-agnostic.

## The 6 pillars
1. **Doc intelligence** — upload any doc (pdf/docx/xlsx/txt) → extract → **dynamic typed boxes** (company/legal/payment/commercial/**rule book**/caveats/flags), each with AI explain + chat + clause cite + approve. → `qansr-knowledge-store`, `qansr-ai-pipelines`.
2. **Rule book** — the `billing_rules` box **compiles** to a canonical, executable JSON (rate tables, slab tables, milestone triggers, normalizers, cost-heads) persisted + versioned + effective-dated. Worked-examples self-test on compile (trust gate). → `server/engine/rulebook.js`, `rule_version`, `formula_test`.
3. **Normalizer + clarifications** — a column-mapped row → canonical values via rule-book normalizers + persisted decisions; unmapped/ambiguous → a **clarification** (one question, answer once → `decision` → auto-applies to all rows + future runs). → `server/engine/normalize.js`, `roster.js`, `decision`, `alias`.
4. **Calc engine** — deterministic interpreter runs the rule book over the placement ledger → a **line per cost head** + a **trace per number**. Generic over cost-head KINDS (not just TA/OSS): `recurring_slab` (any measure — headcount/seats/GB/transactions), `one_time_split` (milestones), `per_unit` (rate × summed measure), `flat` (retainer/platform), `clawback`/`credit` (negative). Iterates ALL heads → returns `lines[]` + `by_head` totals; clean rows compute, bad rows **quarantine** (partial-compute); **an unknown kind is flagged ("rule needs a human"), never guessed**. Cumulative ledger → cross-period roll-forwards. Live **FX** (cache + manual override). → `server/engine/compute.js`, `operators.js`, `run.js`, `fx.js`.
5. **Outputs** — A4 branded **invoice (PDF)**, month-by-month, **detailed calc** (step trail + ask chips), **statement & charts** (KPIs, stacked trend, cost-head donut, **filterable bill**). All generic from run manifests. → `public/invoice-doc.*`, `invoice.*`.
6. **AI gates + recalibration** — every model call goes through a registered, **gated pipeline** (raw text never hits a model outside one); answers are **grounded** in clauses + interpretations (RAG-of-rules); **recalibrate** re-derives rules from corrections with a live meter; **release** freezes a run. → `server/ai.js`, `qansr-rule-learning`, admin AI page.

## Atlas — the archetype library (addon, meta-learning)
Makes each new contract faster/cheaper than the last. Step 0 before intake.
- **Fingerprint** (`server/atlas/fingerprint.js`) — a contract's billing *physiology* from its compiled rule book: revenue heads, driver dimensions, measures, milestones, currency. Structured + comparable, not words.
- **Match** (`server/atlas/match.js`) — weighted-Jaccard similarity + ranking; decision: `matched` (≥.8 → adopt template, AI fills deltas) · `partial` (≥.5 → skeleton + flag divergences) · `novel` (<.5 → seed a new archetype). Never silently mis-apply.
- **Atlas** (`server/atlas/atlas.js`) — `classify` (no mutation) / `route` (adopt or crystallise an archetype, persist `contract_fingerprint`, bump stats) / wiki list + detail. Cross-contract learning via `norm_federation` (contract→archetype→global promotion ladder + conflict detection).
- **Schema** (`db/init/010_atlas.sql`): `archetype` (fingerprint + rule_template + operators + required_inputs + normalizers + playbook_md + stats), `contract_fingerprint`, `norm_federation`.
- **APIs**: `POST /api/atlas/classify/:client` · `/api/atlas/route/:client` · `GET /api/atlas/archetypes` · `/api/atlas/archetype/:slug`. **UI**: `public/atlas.*` (live agent card).
- **Hybrid learning (not just DB rows)** — every route regenerates:
  - **MD wikis** per archetype (playbook + fingerprint + members + related archetypes) at `_ATLAS/<slug>.md`, served via the doc×api switch (`GET /api/atlas/wiki/:slug`).
  - a **relationship-graph index** (`/api/atlas/wiki`) — archetypes, edges (shared heads/dims), and **common denominators** across all contracts (head/dimension/measure frequencies).
  - **schema templates** in `archetype.rule_template` (jsonb), **DB structures** for matching, and **`norm_federation`** for shared label dictionaries. So knowledge lives as MD (human/AI-readable) + graph + schema + DB together.
- **Effect at scale**: contract #1 seeds an archetype; same-shape contracts auto-match (sim→1) and pre-load the rule book/inputs/playbook; exception epidemiology + drift detection make clarifications-per-contract trend to ~0.
- **Federated normalizer learning (reusable handoff)** — `createFederation(q)` (`atlas/federation.js`, exported from the package root) is decoupled and host-agnostic. Wire it into any BigFlex host two ways: (1) on a clarification answer call `engine.recordDecision(client, topic, choice)` (or `federation.record`) — it writes the contract-scope mapping, recomputes the archetype consensus, and **promotes** the canonical label once ≥2 distinct contracts agree (marks `conflicted` on disagreement); (2) `getDecisions` merges federation's promoted archetype/global mappings **under** contract decisions (contract overrides), so a label confirmed on one contract auto-applies to its siblings. Pass `federation` into `createEngine({...,federation})` and the engine does both for you. Net effect: each confirmation is learned once and reused across the whole archetype — clarifications-per-contract decay toward zero.
- **Exception epidemiology (reusable handoff)** — `createEpidemiology(q)` (`atlas/epidemiology.js`, exported from the package root) learns recurring *failures*. Pass `epidemiology` into `createEngine({...,epidemiology})`: after each `computeAndPersist` the engine calls `record(client)` to recompute the archetype's `exception_patterns` (per issue: distinct contracts hit, occurrences, prevalence, a heuristic `suggestFix` hint), and `engine.prewarn(client)` returns the recurring ones (>1 contract or prevalence ≥ .5) so a new contract of that shape is warned *before* its first run and steered to the known fix. Surfaces in the per-archetype wiki MD. Same moat as federation, for exceptions instead of labels.
- **Semantics · drift · pre-intake (reusable handoff)** — needs `db/011_atlas_semantic.sql` (embedding/lineage/drift columns). `createEmbedder()` (`atlas/embed.js`) — deterministic key-free hashed vector + `cosine`; the classifier blends it (`0.75·Jaccard + 0.25·cosine`) for transparency/tie-break, structural sim still gates matched/partial/novel. `createDrift({q, getRuleBook})` (`atlas/drift.js`) — `check(client)` flags divergence (sim < .8 or heads changed) and suggests `reroute:<slug>`|`fork`; `fork(client)` crystallises a new archetype **version** (`parent_id` lineage) and re-routes. `createPreIntake(q)` (`atlas/preintake.js`) — `propose(client, sowText)` fingerprints **raw SOW prose** and returns a `confirm_token` binding the shown shape (no persistence); `confirm(client, payload)` adopts only if the token still matches → a human always approves the shape before a template is applied.

## Per-run artifacts — the hybrid store (DB · MD · JSON · vault)
- **Vault (T1)** — the original file (object store / disk), legal authority, never queried.
- **MD (T2)** — `docstore/<tenant>/<docId>.md` extract (+ `-rows.json` parsed rows); readable, git-diffable, the doc×api switch serves this, never the original.
- **DB (T3)** — queryable facts (rule_version, placement ledger, ta_calc/oss_calc, trace, statement, exception_item, decision, fx_rate, audit_log).
- **Run manifest (JSON)** — the full computed run (boxes, totals, lines, exceptions, clarifications) for instant recall.
Every fact traces: number → run → clause (§) → md → original.

## Recalibration + learning loop
correction (chat instruction / clarification / suggestion) → persisted `decision`/`interpretation` → **recalibrate** (meter: re-read → derive rules → map labels → FX basis → mandatory+exceptions) → incremental recompute → grounds every future answer. Cross-run promotion ladder (run → contract → MINT-wide). → `qansr-rule-learning`.

## Components map (drop-in)
| Layer | Files |
|---|---|
| Engine | `server/engine/{operators,rulebook,normalize,compute,run}.js`, `server/fx.js` |
| Doc/AI | `server/{ai,clauses,extract,store,storage,roster,stub}.js` |
| DB | `db/init/001..009_*.sql` (36 tables), `server/db/client.js` |
| API | `server/index.js` (routes below) |
| UI kit | `public/{q.js,app.css}` (header, modals, chips, charts, mobile), `public/brand/ops-design.css` |
| Screens | `public/{index,mint,invoice-doc,invoice,admin,login}.*` |
| Sub-skills | `qansr-knowledge-store`, `qansr-ai-pipelines`, `qansr-rule-learning`, `qansr-roster-ingest`, `qansr-ui`, `qansr-ops-design` |

## Schema (36 tables, grouped)
- **Tenant/docs:** customer, document, doc_version, clause, interpretation
- **Rules:** rule, rule_version, cost_head, box, box_type, box_chat, box_suggestion, formula_test
- **Data ledger:** placement, alias, decision
- **Runs/facts:** run, run_step, ta_calc, oss_calc, trace, statement, discrepancy, exception_item, credit_note
- **Money:** fx_rate · **Portfolio:** forecast, forecast_driver, portfolio_billing (view)
- **Platform:** app_config, approval, audit_log

## APIs (grouped)
- **Auth/config:** `/api/login` `/api/me` `/api/logout` `/api/config` `/api/pipelines/*` `/api/providers/*` `/api/ai/map`
- **Docs:** `POST /api/upload` · `GET /api/doc/:t/:id` (doc×api switch) · `/api/docs/:t`
- **Tenants/runs:** `/api/clients` (GET/POST) · `/api/mint/run` · `/api/mint/runs/:t` · `/api/mint/run/:t/:no` · `/api/mint/run/:t/:no/release`
- **Ingest+compute:** `/api/mint/roster/map` · `/roster/confirm` · `/api/mint/run/compute` · `/api/mint/clarifications/:t` · `/api/mint/clarify` · `/api/mint/rulebook/:t`
- **Outputs:** `/api/mint/invoice/:t/:no` · `/api/mint/analytics/:t` · `/api/run/:t/:no`
- **FX:** `/api/fx/override` · **Boxes:** `/api/box/:id/chat` `/api/box/:id/amend` `/api/mint/interpret`

## Gates (invariants)
- Raw user text/sheets never reach a model outside an **enabled** pipeline.
- Rules are data; unsupported rule/operator → exception, never a guess.
- Clean rows compute even when others fail (partial-compute + quarantine).
- Released runs are immutable; recompute opens a new version.
- Every number carries currency + base + FX + clause + source row (trace).

## Reuse in a new product
1. Brand: edit `brand/tokens.css` (+ `ops-design.css --brand-*`). 2. Point `DATABASE_URL` + Supabase bucket. 3. Define the tenant's rule book shape → extend `compileRuleBook` + add operators if a new `kind` is needed. 4. Reuse the engine + UI kit as-is; rename the product (e.g. "Mint"). 5. Each new agent = a card on the hub sharing the same spine.
