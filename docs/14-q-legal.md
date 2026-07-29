# 14 — Q-Legal

**Q-Legal** is the second product on the Q&ANSR platform (after ANSR/Mint): a standalone legal-repository intelligence app for a client legal department — 1000+ contracts, ~100 new documents/month.

**One-liner:** SharePoint stays the source of truth (storage, versions, tracked changes, workflow); Q-Legal is a strictly **read-only intelligence overlay** — per-version C1 (full transcript) / C2 (concise key) ingestion, a generated wiki + document tree, first-class vector retrieval (pgvector, hybrid with facts + FTS, always §-grounded), Standards + AI drafting bookends, renewal/obligation reminders, pin-a-question reporting, and four "organism" loops (self-classifying intake, gardener, drift watch, tag hygiene) that let the taxonomy grow with the estate under human confirmation.

**Deliberately not built:** workflow engine, e-signature/stamping, in-app collaborative editing.

**Platform commons reused:** `lib/contra/` (pluggable-LLM archetype/review components), Munshi ingestion + vision OCR, gated AI-pipeline registry + Vault, RayDar shell + ops design system, resumable batch persistence. Ring-fenced `ql_*` schema + own vault namespace + RBAC.

**Full plan (source of truth):** [`Q-Legal/GODDOC.md`](../Q-Legal/GODDOC.md) · build checklist: [`Q-Legal/TODO.md`](../Q-Legal/TODO.md)

**Status (2026-07-30): P1 cut BUILT + e2e smoke-tested inside ANSR Core** — nav tab 3rd (RayDar · Contra · **Q-Legal** · Mint · Admin). Shipped: `db/init/022_qlegal.sql` (8 ql_* tables + 7 seeded business rules), `server/qlegal.js` (ingestion with per-step persistence, registry, wiki, OR-ranked FTS search, grounded Ask, obligations, confirm queue, editable business rules with scope-injection, learning-loop feedback, append-only AI log), `public/qlegal.html/js` (Repository · Tasks · Governance), 5 gated pipelines (`qlegal-key/obligations/link/diff/ask`). Build ledger: [`Q-Legal/TODO.md`](../Q-Legal/TODO.md). Dev skill: `.claude/skills/qlegal`. Commercials pending client alignment; P0 corpus study awaits the 50–100 contract sample; SharePoint/AD sync + vectors are P2.
