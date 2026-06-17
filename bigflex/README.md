# TheBigFlex

Turn **any document-defined ruleset** (a contract / SOW / policy) plus a **periodic data feed** (an Excel worksheet **or an API**) into **computed, explainable, auditable outputs** (bills, statements, dashboards) — for **thousands of tenants with no per-tenant code**.

Tenants are **data** (a compiled rule book), never code. The only logic in code is a small set of **operators**; anything they can't express is **flagged for a human, never guessed**. First product built on it: **Q&ANSR · Mint** (contract → monthly TA/OSS invoicing).

## What's in the box
- `engine/` — the pure, deterministic core (no app coupling):
  - `operators.js` — rate_lookup · slab · pct · month_of/after · active_headcount roll-forward
  - `rulebook.js` — compile an AI `billing_rules` box → canonical executable rule book
  - `normalize.js` — row → canonical via normalizers + decisions; unknowns → clarifications
  - `compute.js` — `computeRun()` — generic over cost-head KINDS: `recurring_slab` (any measure: headcount/seats/GB/…), `one_time_split` (milestones), `per_unit` (rate × measure), `flat` (retainer), `clawback`/`credit` (negative). Iterates ALL heads, returns `lines[]` + `by_head` + a trace per number; partial-compute + quarantine; **unknown kinds → flagged ("needs a human"), never guessed**. Plus `runWorkedExamples()` (trust gate)
  - `fx.js` — `createFx(q)`: live rate + cache + manual override
  - `run.js` — `createEngine({q,getExtract,getRuleBookBox,getRate,federation,epidemiology})`: ledger + compute/persist
- `atlas/` — classification + the moat:
  - `fingerprint.js` — a contract's billing *physiology* (heads · dims · measures · milestones · currency) from its rule book
  - `match.js` — weighted-Jaccard `similarity`/`rank`/`decide` (matched ≥.8 · partial ≥.5 · novel)
  - `federation.js` — `createFederation(q)`: federated normalizer learning (label confirmed once → promoted across the archetype)
  - `epidemiology.js` — `createEpidemiology(q)`: recurring-exception learning (a failure seen on siblings pre-warns a new contract, with a suggested fix)
  - `embed.js` — `createEmbedder()`: deterministic key-free hashed embedding + cosine (semantic match signal, blended with structural Jaccard)
  - `drift.js` — `createDrift({q,getRuleBook})`: detect when a contract diverges from its archetype (`check`) and fork a new archetype version (`fork`, `parent_id` lineage)
  - `preintake.js` — `createPreIntake(q)`: fingerprint from RAW SOW text + human-confirm gate (`propose`/`confirm`) before adopting a template
- `db/schema.sql` + `db/010_atlas.sql` + `db/011_atlas_semantic.sql` — the canonical schema (Postgres) incl. `archetype`/`contract_fingerprint`/`norm_federation` + embedding/lineage/drift columns
- `ui/` — drop-in kit: `app.css` (header, modals, chips, charts, mobile), `q.js` (shared header + modals + Dubai dates), `ops-design.css`, `tokens.css` (brand)
- `SKILL.md` — the full architecture + reuse guide

## Mount (host supplies DB + storage + the rule-book box)
```js
import pg from "pg";
import { createFx, createEngine } from "bigflex";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const q = (t, p) => pool.query(t, p);
import { createFederation, createEpidemiology } from "bigflex";
const { getRate } = createFx(q);
const federation = createFederation(q);     // optional — the cross-contract moat
const epidemiology = createEpidemiology(q); // optional — recurring-exception pre-warnings

const engine = createEngine({
  q,
  getExtract: async (client, docId) => /* read docstore/<client>/<docId>.md|-rows.json */,
  getRuleBookBox: async (client) => /* the approved billing_rules box for this tenant */,
  getRate,
  federation,                              // getDecisions now inherits archetype-promoted labels
  epidemiology,                            // computeAndPersist refreshes archetype exception patterns
});

const pre = await engine.prewarn(client);                 // recurring exceptions for this archetype (pre-run)
await engine.saveLedger(client, docId, mapping);          // stage the feed (file or API rows)
const run = await engine.computeAndPersist(client, "2025-03"); // → totals, computed, exceptions, clarifications
await engine.recordDecision(client, "source:GDC", "non_referral"); // confirm once → promotes across the archetype
```

## Atlas — federated learning (the moat)
`createFederation(q)` makes every clarification compound. When a host calls `engine.recordDecision(client, topic, choice)` (e.g. on a clarification answer), it (1) saves the contract-scope mapping, (2) recomputes consensus among contracts of the same archetype, (3) **promotes** the canonical label once ≥2 distinct contracts agree (flags `conflicted` on disagreement). `getDecisions` then merges promoted archetype/global mappings **under** contract decisions, so a sibling contract auto-applies the label without ever being asked — clarifications-per-contract decay toward zero. Requires `db/010_atlas.sql` + a `contract_fingerprint` row linking each customer to its archetype.

`createEpidemiology(q)` does the same for **failures**. After each `computeAndPersist`, the engine refreshes the archetype's `exception_patterns` — every distinct issue, how many sibling contracts it hit, its prevalence, and a heuristic fix hint. `engine.prewarn(client)` returns the recurring ones (>1 contract or prevalence ≥ .5) so a brand-new contract of that shape is warned *before* its first run and steered to the known fix.

## Atlas — semantics, drift & pre-intake (needs `db/011_atlas_semantic.sql`)
- **Embeddings** — `createEmbedder()` gives a deterministic, key-free hashed vector + `cosine`. The classifier blends it with the structural score (`0.75·Jaccard + 0.25·cosine`) for transparency and tie-breaking; the structural similarity still decides matched/partial/novel. Store the centroid on the archetype + contract for reuse.
- **Drift + fork** — `createDrift({q, getRuleBook})`. `check(client)` recomputes the contract's fingerprint and flags drift when it falls below match (sim < .8) or its revenue heads changed, suggesting `reroute:<slug>` (a better archetype exists) or `fork`. `fork(client)` crystallises a **new archetype version** from the contract's current shape (`parent_id` lineage) and re-routes it — archetypes evolve instead of silently mis-applying.
- **Pre-intake gate** — `createPreIntake(q)`. `propose(client, sowText)` fingerprints the **raw SOW prose** (before the rule book is compiled), ranks archetypes, and returns a `confirm_token` that binds the shown fingerprint — **nothing is persisted**. `confirm(client, {fingerprint, confirm_token, archetype_slug})` adopts it only if the token still matches, so a human always approves the shape before a template is applied.

## The contract you inject
- **`q(text, params)`** → `{ rows }` (Postgres). Apply `db/schema.sql` first.
- **`getExtract(client, docId)`** → the stored `*-rows` JSON (and `.md`) for a staged feed (file upload or API push/pull both write here).
- **`getRuleBookBox(client)`** → the tenant's approved `billing_rules` box (`{content:{ta_rate_table,milestones,oss_slabs,normalizers,...}}`).
- **`getRate(from,to,date)`** → from `createFx(q)`.

## The data feed is source-agnostic
A feed is just rows. Upload an Excel (SheetJS → rows) **or** push/pull via API (`rows[]` or a URL returning an array) — both land as `<docId>-rows` JSON and flow through the same map → confirm → compute path.

## Invariants
Raw text/sheets never reach a model outside a gated pipeline · rules are data, unsupported → exception · clean rows compute even if others fail · released runs are immutable (recompute → new version) · every number carries currency + base + FX + clause + source row.
