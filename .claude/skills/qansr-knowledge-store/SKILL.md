---
name: qansr-knowledge-store
description: Q&ANSR hybrid document store — the doc×api switch. Originals in a vault (T1), markdown extracts in /docstore (T2), structured facts in Postgres (T3), joined by a provenance chain. Use when ingesting SOW/Excel/PDF docs, serving document content to the model, or answering "which document/clause backs this". Grows to hundreds of docs without schema bloat.
---

# Q&ANSR — Hybrid Knowledge Store (doc×api switch)

Adapted from ESPL recon-16. Three tiers; originals are NEVER the query source.

| Tier | What | Where | Queryable | Authority |
|------|------|-------|-----------|-----------|
| **T1 originals** | raw xlsx/pdf/docx | `uploads/` (vault; prod = object store) | no | **yes — final word on dispute** |
| **T2 md extracts** | one `.md` per doc, with frontmatter | `docstore/<CUSTOMER>/<docId>.md` | grep / AI-read | no — extract only |
| **T3 facts** | normalized rows | Postgres (`document`, `ta_rate`, `placement`, `ta_calc`, …) | **yes — filter/join/aggregate** | no — derived |

## The doc×api switch
Code never reads originals to answer. It serves the **T2 markdown**:
`GET /api/doc/:customer/:docId` → returns `docstore/<cust>/<docId>.md`.
The model reads the relevant `.md` slice (deterministic md/db retrieval — no
vector drift). On any dispute, the frontmatter `source_file` points back to the
T1 original, which is the authority.

## Provenance chain (audit trail)
```
T3 fact row (e.g. ta_calc.invoice_value)
  → run_id that produced it
  → doc_version / document.md_path  (which extract)
  → frontmatter source_file         (which original)
  → T1 file (the authority — never queried directly)
```

## Why it scales to 100s of docs
- New doc type = new `.md` (+ `document` row). **No schema migration.**
- DB holds only cross-doc comparable facts (clauses, rates, placements, calcs).
- `.md` extracts are git-diffable; originals sit in cheap storage.
- Per-doc quirks/layout stay in markdown; only normalized facts get promoted to T3.

## Ingest flow (server/index.js + extract.js)
1. `POST /api/upload` → hash original → `extractFile()` (xlsx via SheetJS, pdf/docx via officeparser).
2. `toMarkdown()` writes T2 `.md` with frontmatter (doc, source_file, sha256, authority).
3. Insert `document` row (T3) with `md_path` + `storage_path`.
4. Downstream pipelines promote facts (clauses → `ta_rate`/`milestone`/`oss_slab`; EMP LIST → `placement`).

## Rules
- Never send a raw original to the model — send the `.md` extract (or a DB slice).
- Every promoted fact must trace to a `document` row. No orphan facts.
- Frontmatter `authority` line is mandatory; it's the dispute pointer.
