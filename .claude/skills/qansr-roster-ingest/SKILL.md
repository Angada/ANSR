---
name: qansr-roster-ingest
description: Q&ANSR working-sheet (employee roster) ingestion + contract-readiness gate for Mint. Use when wiring the Excel upload → AI/deterministic column mapping → issue detection → confirm-to-DB + doc×api switch → terms-vs-data validation → readiness checklist that MUST close before the results tab. Triggers — "roster", "working sheet", "excel mapping", "ingest", "readiness", "is it ready to analyse".
---

# qansr-roster-ingest — ingest → map → validate → ready (gate before results)

Adapted from Leela roster-ingest. The whole journey must close **before** the
results/calc tab. If anything is missing, Mint asks the user.

## Flow (mint.html / mint.js + server/roster.js + endpoints)
1. **Upload** working sheet (≤25 MB) → `POST /api/mint/roster/map`.
2. **Map columns** — `inferMapping()` (deterministic header→canonical). When the
   `normalize` pipeline is **enabled + keyed** (Admin → AI Skills & Pipelines), the
   AI refines the map; otherwise the deterministic map stands (finance-safe default).
   Canonical fields: ext_id, name, role, source, sourcing/offer/join/exit_date,
   fixed_ctc, variable_ctc, status. User can correct any mapping inline.
3. **Detect issues** — `detectIssues()`: missing name/id, unparseable/ambiguous
   dates (dd/mm vs mm/dd), duplicate id, missing/non-numeric CTC, missing source.
   Shown to fix/confirm. Raw rows kept verbatim (immutable); corrections apply on
   the staged mapping.
4. **Confirm → DB** (`POST /api/mint/roster/confirm`) — saves; the source chip
   switches **filename → API** (`/api/doc/<client>/<docId>` = the doc×api switch,
   serves the .md extract, never the original).
5. **Validate** (`GET /api/mint/validate/:client`) — contract terms (AI-identified)
   vs the supplied data, step-by-step bar → pass/warn each.
6. **Readiness checklist** (computed on the fly from the `billing_rules` box):
   CTC definition · TA rate table · milestone split · OSS slabs · currency/FX ·
   role→level map. Each ✓ or ✕. **Missing → "Ask me"** (user supplies it; goes to
   the rule book). `window.READY` gates `acceptFile()` — **no results until green.**

## Pipelines / gates involved
- `contract-intake` (hybrid) → produced the boxes incl. the rule book the checklist reads.
- `normalize` (hybrid) → column + value mapping; gated, deterministic fallback.
- `calc` (deterministic) → runs only after readiness is green + file accepted.
- Gate rule: raw user text / sheet never goes to a model outside an enabled pipeline.

## Hybrid storage (what's DB vs MD)
- **DB**: `document` row, mapped facts → `placement`, run/calc tables.
- **MD** (`docstore/<client>/<docId>.md`): the verbatim sheet extract (T2).
- **Vault**: the original xlsx (T1, authority).

## Invariants
- Raw upload rows immutable; edits on the staged mapping only.
- Unknowns are flagged, never silently bucketed.
- Results tab is unreachable until the readiness checklist closes.
