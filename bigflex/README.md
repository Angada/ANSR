# TheBigFlex

Turn **any document-defined ruleset** (a contract / SOW / policy) plus a **periodic data feed** (an Excel worksheet **or an API**) into **computed, explainable, auditable outputs** (bills, statements, dashboards) — for **thousands of tenants with no per-tenant code**.

Tenants are **data** (a compiled rule book), never code. The only logic in code is a small set of **operators**; anything they can't express is **flagged for a human, never guessed**. First product built on it: **Q&ANSR · Mint** (contract → monthly TA/OSS invoicing).

## What's in the box
- `engine/` — the pure, deterministic core (no app coupling):
  - `operators.js` — rate_lookup · slab · pct · month_of/after · active_headcount roll-forward
  - `rulebook.js` — compile an AI `billing_rules` box → canonical executable rule book
  - `normalize.js` — row → canonical via normalizers + decisions; unknowns → clarifications
  - `compute.js` — `computeRun()` (facts + a trace per number; partial-compute + quarantine) + `runWorkedExamples()` (trust gate)
  - `fx.js` — `createFx(q)`: live rate + cache + manual override
  - `run.js` — `createEngine({q,getExtract,getRuleBookBox,getRate})`: ledger + compute/persist
- `db/schema.sql` — the 35-table canonical schema (Postgres)
- `ui/` — drop-in kit: `app.css` (header, modals, chips, charts, mobile), `q.js` (shared header + modals + Dubai dates), `ops-design.css`, `tokens.css` (brand)
- `SKILL.md` — the full architecture + reuse guide

## Mount (host supplies DB + storage + the rule-book box)
```js
import pg from "pg";
import { createFx, createEngine } from "bigflex";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const q = (t, p) => pool.query(t, p);
const { getRate } = createFx(q);

const engine = createEngine({
  q,
  getExtract: async (client, docId) => /* read docstore/<client>/<docId>.md|-rows.json */,
  getRuleBookBox: async (client) => /* the approved billing_rules box for this tenant */,
  getRate,
});

await engine.saveLedger(client, docId, mapping);          // stage the feed (file or API rows)
const run = await engine.computeAndPersist(client, "2025-03"); // → totals, computed, exceptions, clarifications
```

## The contract you inject
- **`q(text, params)`** → `{ rows }` (Postgres). Apply `db/schema.sql` first.
- **`getExtract(client, docId)`** → the stored `*-rows` JSON (and `.md`) for a staged feed (file upload or API push/pull both write here).
- **`getRuleBookBox(client)`** → the tenant's approved `billing_rules` box (`{content:{ta_rate_table,milestones,oss_slabs,normalizers,...}}`).
- **`getRate(from,to,date)`** → from `createFx(q)`.

## The data feed is source-agnostic
A feed is just rows. Upload an Excel (SheetJS → rows) **or** push/pull via API (`rows[]` or a URL returning an array) — both land as `<docId>-rows` JSON and flow through the same map → confirm → compute path.

## Invariants
Raw text/sheets never reach a model outside a gated pipeline · rules are data, unsupported → exception · clean rows compute even if others fail · released runs are immutable (recompute → new version) · every number carries currency + base + FX + clause + source row.
