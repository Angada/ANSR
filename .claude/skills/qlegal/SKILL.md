---
name: qlegal
description: "Q-Legal — the legal-repository intelligence app inside ANSR Core (SharePoint/upload = source of truth; derived C1/C2 layer, registry, wiki, doc tree, obligations, global search + Ask, confirm queue, editable business rules, learning loop). Use when building/extending Q-Legal: adding an endpoint, a pipeline step, a screen, a ql_* table, a business-rule scope, or wiring SharePoint/AD sync. Triggers — 'Q-Legal', 'legal repository', 'ql_', 'C1 C2', 'obligations register', 'confirm queue', 'business rules', 'change of guard'."
---

# Q-Legal — legal repository intelligence

The second product surface in ANSR Core (nav: RayDar · Contra · **Q-Legal** · Mint · Admin).
A **read-only intelligence overlay**: SharePoint (later) / manual upload (now) is the source of
truth; Q-Legal builds a fully **rebuildable derived layer**. Full plan: [Q-Legal/GODDOC.md](../../../Q-Legal/GODDOC.md) ·
checklist: [Q-Legal/TODO.md](../../../Q-Legal/TODO.md) · core doc: [docs/14-q-legal.md](../../../docs/14-q-legal.md).

## Non-negotiables (mirror the seeded business rules)
1. **Never write to the source of truth.** Originals are snapshotted to the vault; nothing edits them.
2. **No naked claims** — every answer/insight cites document → version → §.
3. **Propose → confirm → learn** — classifications, tree links, lineage = `ql_confirm` rows until a human accepts; every decision lands in `ql_feedback` (append-only, replayable).
4. **Lazy versioning** — full C1/C2 for latest + executed versions only.
5. Every AI step = a **named gated pipeline** with scope-matched **business rules injected** at call time, logged to `ql_log`.

## Files
| File | What |
|---|---|
| `server/qlegal.js` | `mountQLegal(app, upload)` — ingestion + all `/api/qlegal/*` endpoints |
| `db/init/022_qlegal.sql` | ql_* schema + seeded business rules + tag vocabulary (idempotent) |
| `public/qlegal.html` + `public/qlegal.js` | the RayDar-skinned shell (Repository · Tasks · Governance) |
| `server/store.js` | the 5 `qlegal-*` pipelines (product "Q-Legal") |
| storage | ring-fenced under tenant `Q-LEGAL` — vault `uploads/Q-LEGAL/originals/`, docstore `docstore/Q-LEGAL/` (bucket in prod) |

## The layers (this is the whole mental model)
| Layer | What | Built by |
|---|---|---|
| **original** | the file itself, snapshotted to the vault — the authority, never read by a model | `putOriginal` |
| **C1** | the comprehensive transcript: every clause, table, field; scans/images via Munshi vision (`munshi3:read`) | `qlegal-c1` |
| **C2** | the concise key **+ the two wikis every doc gets** — the **contents wiki** (its own structure) and the **clause wiki** (each § + topic + gist) — plus facts, tags, notice register | `qlegal-key` |
| **Registers** | **"C2 you define"** — a standing question written once in plain English, answered for EVERY contract with § evidence. This is how an *infinite* set of lawyer questions is served without re-reading the estate. | `qlegal-register` |

Ask climbs these as a **retrieval ladder**, cheapest first: registers+facts (whole estate) → contents/clause wikis → C1 deep text → original (cited, never fed to the model).

## Ingestion (per file — persisted per step, resumable)
`POST /api/qlegal/upload` (multi ≤20) →
1. sha256 → **duplicate?** skip. Same filename → **new version** of that `ql_document` (1 doc, N versions).
2. **C1** — `extractFile` (deterministic text layer; Munshi vision-OCR for scans) → vault snapshot + docstore + `ql_version.c1_text`; logged as pipeline `qlegal-c1`.
3. **qlegal-key** (+ ingestion rules) → C2: meta, summary, tags, **contents wiki**, **clause wiki**, exhibits, **notice register** → updates `ql_document` facts.
4. **qlegal-obligations** (+ obligations rules) → `ql_obligation` rows (proposed; re-proposed on re-ingest, confirmed rows kept).
5. **qlegal-register** (+ registers rules) → every active standing question answered for this doc → `ql_register_hit`.
6. **qlegal-diff** (v>1) → `ql_version.diff_summary` for the version rail.
7. **qlegal-link** (parent from tell-tales) + deterministic Jaccard **lineage** (draft↔executed ≥.85) → `ql_confirm`.
   ⚠️ These run **before `res.json()`** on purpose: Cloud Run throttles CPU after the response, so fire-and-forget background work silently never runs.
8. No keyed model / unclassified → `ql_confirm` kind `classification`.

## Pipelines (registry ids — swap model/gate in Admin)
`qlegal-c1` (zai/glm-4.5v, hybrid) · `qlegal-key` (opus) · `qlegal-register` (opus) · `qlegal-obligations` (sonnet) · `qlegal-link` (sonnet) · `qlegal-diff` (sonnet) · `qlegal-ask` (opus).
Output contracts are passed **caller-side** in `system` (immune to stored-prompt drift — the Contra lesson).

## Gotchas that have already bitten
- **Postgres returns `bigint` ids as STRINGS.** Never `===` an id against a number — `Number(a) === Number(b)`. This silently killed the tree-link proposal and the rules/registers Edit buttons.
- **Cloud Run kills CPU after the response** — no post-response async work (see step 7).
- FTS uses `websearch_to_tsquery` on an **OR-joined** term list; `plainto_tsquery` (AND) silently missed "liability cap".

## Business rules (`ql_rule`)
Editable in Governance → Business rules; scope → injection: `global` = every step ·
`ingestion` = key + link · `obligations` = obligation mapper · `search` = Ask · `drafting` = reserved (P3).
`rulesFor(scope)` builds the prompt block; applied codes are recorded on each `ql_log` row.

## Endpoints (all under `/api/qlegal/`)
**Ingest** `POST /upload` · **Registry** `GET /registry` · **wiki** `GET /document/:id` (facts, versions, c2, obligations, family, confirms, registers)
**The three ways in:** `GET /original/:versionId` (vault snapshot) · `GET /c1/:versionId` (transcript) · `GET /c2/:versionId` (key + wikis)
**Search** `GET /search?q=` (facts + OR-ranked FTS w/ ts_headline snippets) · **Ask** `POST /ask {question, history[]}` → `{answer, rungs, sources}` (conversational — last 4 turns travel with the question and widen the FTS terms)
**Registers** `GET /registers` · `POST /registers` · `POST /register/:id` · `DELETE /register/:id` · `GET /register/:id/hits` (estate-wide answer table) · `POST /registers/run {register_id?, limit}` (resumable sweep) · `POST /register-hit/:id` (correct → authoritative, `status='corrected'` so the extractor stops overwriting)
**Obligations** `GET /obligations` · `POST /obligation/:id {status|owner}`
**Governance** `GET /confirms` · `POST /confirm/:id {action, doc_type?}` · `GET/POST /rules` · `POST /rule/:id` · `POST /feedback` (L0 fact fix applies instantly) · `GET /log`

## Schema (ql_* — see docs/04-schema.md §8)
`ql_document` (logical doc, facts jsonb, tags, parent_id tree) → `ql_version` (C1 text + c2 jsonb, diff, executed, GIN FTS index) ·
`ql_obligation` · `ql_rule` · `ql_confirm` · `ql_feedback` (append-only) · `ql_log` (append-only) · `ql_tag_vocab` ·
**`ql_register`** + **`ql_register_hit`** (`unique(register_id, document_id)`; 5 built-in questions seeded from the client's own examples).

## UI conventions
Dates: compact `dd-mm-yyyy` (+ `· h:mm am/pm`); weekday only where a human plans (due dates: "Mon, 9 Jun, 2026"). IST always.
Views re-render from server state (no client-held progress). Facts on the wiki are click-to-correct → `POST /feedback`.
Every document page carries the three-way open row (file · C1 · C2) + a Family jump; the family cards navigate to the related contract.

## Not built yet (P2/P3 — see TODO.md)
SharePoint Graph delta sync + AD roles · pgvector spine (semantic recall behind the same ladder) + estate map · organism loops (gardener/drift/tag-hygiene) ·
Standards + Create-a-Draft · reminder emails/scheduler · rule promotion ladder L1/L2 · stage-time analytics ·
register **suggestions** (mine `ql_feedback`/failed Asks for questions worth making standing).
