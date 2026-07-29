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

## Ingestion (per file — persisted per step, resumable)
`POST /api/qlegal/upload` (multi ≤20) →
1. sha256 → **duplicate?** skip. Same filename → **new version** of that `ql_document` (1 doc, N versions).
2. **read** — `extractFile` (deterministic; Munshi vision-OCR fallback for scans) → vault snapshot + docstore C1 + `ql_version.c1_text`.
3. **qlegal-key** (+ ingestion rules) → C2: meta (title/type/parties/dates/law/value/auto-renewal), summary, tags, clause map (§ anchors), **notice register** (notice clauses/contacts/change-of-control) → updates `ql_document` facts.
4. **qlegal-obligations** (+ obligations rules) → `ql_obligation` rows (proposed; re-proposed on re-ingest, confirmed rows kept).
5. **qlegal-diff** (v>1) → `ql_version.diff_summary` for the wiki version rail.
6. async: **qlegal-link** (parent proposal from tell-tales) + deterministic Jaccard **lineage** sweep (draft↔executed ≥.85) → `ql_confirm` rows.
7. No keyed model / unclassified → `ql_confirm` kind `classification`.

## Pipelines (registry ids — swap model/gate in Admin)
`qlegal-key` (opus) · `qlegal-obligations` (sonnet) · `qlegal-link` (sonnet) · `qlegal-diff` (sonnet) · `qlegal-ask` (opus).
Output contracts are passed **caller-side** in `system` (immune to stored-prompt drift — the Contra lesson).

## Business rules (`ql_rule`)
Editable in Governance → Business rules; scope → injection: `global` = every step ·
`ingestion` = key + link · `obligations` = obligation mapper · `search` = Ask · `drafting` = reserved (P3).
`rulesFor(scope)` builds the prompt block; applied codes are recorded on each `ql_log` row.

## Endpoints
Registry `GET /registry` · wiki `GET /document/:id` · C1 `GET /c1/:versionId` (doc×api switch) ·
search `GET /search?q=` (facts + **OR-ranked** websearch_to_tsquery FTS with ts_headline snippets) ·
ask `POST /ask` (grounded: top-4 FTS docs + estate shape + 120-day obligations) ·
obligations `GET /obligations`, `POST /obligation/:id {status|owner}` ·
confirms `GET /confirms`, `POST /confirm/:id {action, doc_type?}` ·
rules `GET/POST /rules`, `POST /rule/:id` · feedback `POST /feedback` (Level-0 fact fix applies instantly) ·
log `GET /log`. All under `/api/qlegal/`.

## Schema (ql_* — see docs/04-schema.md §8)
`ql_document` (logical doc, facts jsonb, tags, parent_id tree) → `ql_version` (C1 text + c2 jsonb, diff, executed, GIN FTS index) ·
`ql_obligation` · `ql_rule` · `ql_confirm` · `ql_feedback` (append-only) · `ql_log` (append-only) · `ql_tag_vocab`.

## UI conventions
Dates: compact `dd-mm-yyyy` (+ `· h:mm am/pm`); weekday only on due dates ("Mon, 9 Jun, 2026"). IST always.
Views re-render from server state (no client-held progress). Facts on the wiki are click-to-correct → `POST /feedback`.

## Not built yet (P2/P3 — see TODO.md)
SharePoint Graph delta sync + AD roles · pgvector spine + query router + estate map · organism loops (gardener/drift/tag-hygiene) ·
Standards + Create-a-Draft · reminder emails/scheduler · rule promotion ladder L1/L2 · stage-time analytics.
