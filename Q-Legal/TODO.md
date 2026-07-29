# Q-Legal — TODO checklist

> Companion to [GODDOC.md](GODDOC.md). Check items off as they land; add discoveries under the right phase.
> Status: **P1 cut BUILT inside ANSR Core (2026-07-30)** — nav tab live, e2e smoke-tested locally on port 4180. Commercials still pending client alignment.

## Pre-build (commercial + inputs) — all still open
- [ ] Client replies aligned on scope → **propose commercials** (TCO yearly all-in, storage, support level, upgrade costs)
- [ ] Obtain **corpus sample** (50–100 real contracts) — blocks P0
- [ ] Ask for the department's existing **contract-index Excel** (extraction ground truth)
- [ ] Kranthi's **frequently-used prompts** list → seeds query router + benchmark
- [ ] Client IT: confirm the **SharePoint + AD data checklist** (see GODDOC §11) → then Azure AD app registration, `Sites.Selected` READ
- [ ] Agree **Status choice column + Urgent flag** SOP with legal team (stage-time reporting dependency)
- [ ] Deployment target: client's cloud of choice — confirm which

## P0 — Corpus study (first build step on real data; read before you write)
- [ ] Ingest sample corpus read-only; measure format mix (docx/native-PDF/scan %), OCR quality, languages
- [ ] Category seed list from actual documents (~8–15 types at 1K docs)
- [ ] Per-doc C1 cost from real samples → cost model (1000 backfill + 100/mo run-rate)
- [ ] Validate extraction vs the contract-index Excel → the accuracy number
- [ ] Set C1 clause-chunking rule (feeds P2 vectors)

## P1 — Repository ✅ BUILT (inside ANSR Core; e2e-verified 2026-07-30)
### Scaffold
- [x] Product surface in ANSR Core: `server/qlegal.js`, `public/qlegal.html/js`, nav 3rd tab (decision 2026-07-30: inside Core, not a separate server — standalone client deploy = same codebase, ring-fenced)
- [x] Ring-fence: `ql_*` schema (`db/init/022_qlegal.sql`) + storage tenant `Q-LEGAL` (vault + docstore)
- [x] 5 gated pipelines registered (Admin-switchable): `qlegal-key` · `qlegal-obligations` · `qlegal-link` · `qlegal-diff` · `qlegal-ask`
- [x] **Business rules engine**: `ql_rule` seeded (7 standing rules) + Governance editor + scope-matched injection into every pipeline call + `rules_applied` logged per call
- [x] Append-only `ql_log` (AI activity) + `ql_feedback` (learning loop)
- [ ] RBAC roles (legal user / legal admin / viewer) — currently the platform's single soft login; needs AD-backed roles (P2, with the AD integration)
### Ingestion
- [x] Manual upload path (≤20 files/batch, persisted per file+step, errors never fail the batch)
- [x] One document ↔ many versions (same filename → new version; sha dedup skips identical files)
- [x] C1 (deterministic extract + Munshi vision-OCR fallback) → vault + docstore + FTS column
- [x] C2 concise key (meta · tags · clause map w/ §s · **notice register** for change-of-guard)
- [x] Obligations mapper → proposed `ql_obligation` rows (confirmed rows survive re-ingest)
- [x] Version diff summaries (v>1) for the wiki rail
- [x] Doc-tree link proposals (tell-tale based) + deterministic draft↔executed lineage (Jaccard ≥.85) → confirm queue
- [x] Unclassified / no-key → classification confirm
- [ ] **SharePoint Graph delta sync** (idempotent on item id + version + etag; maps sp_item_id — column already in schema)
- [ ] Word→PDF conversion on demand
- [ ] Lazy-versioning enforcement at sync time (historical drafts = snapshot + diff only; today every uploaded file is fully processed, which is correct for manual mode)
### Screens
- [x] Registry (drop → estate table, type-count chips, filter, dd-mm-yyyy dates)
- [x] Wiki drill-in (facts click-to-correct, summary, notice register, obligations, family tree, clause map, version rail, C1 transcript link)
- [x] Search & Ask (OR-ranked FTS with § snippets + facts fallback; grounded Ask citing document + §)
- [x] Tasks → Obligations (due chips w/ weekday, confirm / assign doer / done)
- [x] Governance → Confirm queue · Business rules editor · AI activity log
- [ ] Dedicated tree **browser** (counterparty → MSA → SOWs as a navigable tree; family already shows per-doc on the wiki)
### Prove it (needs a keyed model + real documents)
- [ ] Run 20–50 real contracts through with a keyed model; verify C2 accuracy, obligations, links
- [ ] Full-estate backfill through the queue; watch cost/throughput vs the P0 model
- [ ] "Change of guard" demo query end-to-end (notice register populated → one-click answer)

## P2 — Intelligence (vectors, router, Standards, organism)
### Vector spine
- [ ] pgvector + HNSW; embed clause/section/document from C1/C2 with § anchors
- [ ] Vector rows carry (embedding_model, model_version, embedded_at); embedding pipeline in Vault; batch re-embed migration
- [ ] Hybrid retrieval: facts-SQL + FTS + vector, reciprocal-rank fusion
- [ ] **Query router** behind the one Ask box (fact / clause / deep-read routes)
- [ ] Wiki "nearest in estate" panels; clause clustering → emergent clause library; centroid benchmarking
- [ ] Estate map screen (2D projection)
### SharePoint + AD (mandatory integrations)
- [ ] Azure AD app registration (`Sites.Selected` READ on the legal site) + Graph delta sync live
- [ ] AD user sync (employee id, name, role; legal dept + named approvers/viewers) → RBAC roles in Q-Legal
- [ ] Status-column transition capture → `ql_status_transition` (stage-time analytics feed)
- [ ] Rebuild drill: nuke derived layer → resync → regenerate → replay `ql_feedback` confirmations
### Standards + sweep
- [ ] Standards tab (transplant `lib/contra` archetype maker; model contracts → structure + rules + preferred language)
- [ ] Deviations register (per contract, with reason)
- [ ] Estate risk sweep vs Standards → first estate-wide risk report
### Reporting + organism
- [ ] Canned reports (by category, expiry, counterparty, governing law) + **pin-a-question** living reports + digests
- [ ] Loop 1 self-classifying intake (neighbour vote) · Loop 2 nightly gardener (emergence) · Loop 3 weekly drift watch · Loop 4 monthly tag-merge
- [ ] Monthly cohort digest
- [ ] Labelled benchmark (~50 query→§ pairs from Kranthi's prompts); gate model swaps on it
### Learning loop L1/L2
- [ ] Recurring-pattern detector over `ql_feedback` → propose **type rules** → confirm → inject into that type's prompts
- [ ] Estate-wide rule / Standards-amendment proposals (L2)
- [ ] Failed-query capture → auto-benchmark pairs
- [ ] Admin: promoted-rules viewer + accuracy-per-type-over-time pinned report

## P3 — BAU (drafting, reminders, gaps, stage analytics)
- [ ] Create-a-Draft (NL ask + Standard → complete draft 1 → .docx download; `drafting` rule scope already reserved)
- [ ] Reminder scheduler + email delivery (lead-days + escalation on `ql_obligation`; done/snooze; deliberately tiny)
- [ ] Vendor–client back-to-back gap mapping
- [ ] Stage-time analytics (after Status-column SOP adopted)
- [ ] Urgent-request reporting from intake (MS Forms/SharePoint read)

## Standing rules for this build
- SharePoint is never written to. Every answer cites a §. Every AI call goes through a gated pipeline with its business rules injected and logged. Propose → human confirm → learn. No Standards designed before real samples are read.
