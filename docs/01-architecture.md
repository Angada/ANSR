# 1 · Architecture — the hybrid store + component map

[← Overview](00-overview.md) · [Wiki home](README.md) · Next: [BigFlex engine →](02-bigflex-engine.md)

---

## The 4-tier hybrid store

BigFlex never keeps truth in one place. Four tiers, each with a distinct job:

```
T1  VAULT (object store / disk)        the ORIGINAL file. Legal authority. Never queried.
        docs bucket:  <tenant>/<sha256>.<ext>
        │
T2  MD  docstore       the doc×api switch serves THIS, never the original
        docstore/<tenant>/<docId>.md         AI-readable, clause-chunked extract
        docstore/<tenant>/<docId>-rows.json  parsed worksheet rows (the data feed)
        docstore/_ATLAS/<archetype>.md       per-family playbook wiki
        docstore/_ATLAS/index.md             relationship graph + common denominators
        │
T3  DB (Postgres)      queryable FACTS — the 38 tables (see Schema doc)
        │
T4  JSON               run.manifest (jsonb): the full computed run, for instant recall
```

### Why four tiers
- **T1 Vault** = legal authority. The signed PDF, untouched. Never served to a model or a query — it's the thing you point to in a dispute.
- **T2 MD** = the working source of truth. Extracted, clause-chunked, git-diffable, human + AI readable. The **doc×api switch** means any request for "the document" gets *this* extract, never the original — the original stays sealed.
- **T3 DB** = the structured facts you compute and query (ledger, calc lines, traces…).
- **T4 JSON manifest** = the whole run snapshotted for instant recall without recomputing.

### The audit chain
Every number can be walked all the way back:
```
a number  →  trace  →  run  →  clause (§)  →  md extract  →  original file
```

## The doc×api switch

`GET /api/doc/:tenant/:docId` returns the **T2 markdown extract**, never the T1 original. This is deliberate: models and the UI consume the controlled extract; the legal original is never exposed or sent to an LLM. Storage adapter (`server/storage.js`) is disk in dev, Supabase bucket in prod (switched by env).

## Component map (drop-in)

| Layer | Files |
|---|---|
| **Engine** | `server/engine/{operators,rulebook,normalize,compute,run}.js`, `server/fx.js` |
| **Atlas** | `server/atlas/{fingerprint,match,atlas,federation,epidemiology,embed,drift,preintake}.js` |
| **Doc / AI** | `server/{ai,clauses,extract,store,storage,roster,stub}.js` |
| **DB** | `db/init/001..011_*.sql`, `server/db/client.js`, `server/migrate.js` (idempotent auto-apply on boot) |
| **API** | `server/index.js` |
| **UI kit** | `public/{q.js,app.css}` (header, modals, chips, charts, mobile), `public/brand/ops-design.css` |
| **Screens** | `public/{index,mint,invoice-doc,invoice,admin,login,atlas}.*` |

## Runtime stack

- **Node + Express (ESM)**, `@anthropic-ai/sdk`, `xlsx` (SheetJS), `officeparser`, `multer` (25 MB upload cap), `exceljs`.
- **Postgres** — local Docker (port 5433) in dev; **Supabase** (Mumbai, ap-south-1) in prod.
- **Schema auto-applies on boot** via `runMigrations()` — every `db/init/*.sql` runs idempotently, so a fresh DB (or a new prod) self-provisions.

## AI gating

Every model call goes through a **registered, enabled pipeline** (`server/ai.js`, admin AI page). Raw user text or sheets never hit a model outside one. Answers are **grounded** in clauses + interpretations (RAG-of-rules). Provider keys are AES-encrypted at rest in `app_config` (key from `CONFIG_SECRET` env, never stored in the row).

## The reusable package

The same engine + Atlas ships as a decoupled, host-agnostic package on the repo's **`bigflex` branch** — pure factories (`createEngine`, `createFx`, `createFederation`, `createEpidemiology`, `createDrift`, `createPreIntake`, `createEmbedder`) with no app coupling. Mount it in any product: apply the schema, inject `q`/storage/rule-book-box, reuse the engine + UI kit, rebrand via `brand/tokens.css`.
