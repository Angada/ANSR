# Q&ANSR — Build Plan

Contract-aware finance/AR calculation assistant. Reproduces ANSR's customer
invoicing (TA + OSS) from the SOW + employee Excel, deterministically, with a
clause + calc audit trail. First case: **ANSR–Kenvue**.

## Architecture
- **Base**: ESPL Node/Express engine (Postgres audit spine, hybrid md/db doc store, AI clarification).
- **Layer**: Leela AI-pipeline registry + admin panel + listeners + chatbot gate.
- **Optional**: FITA pgvector RAG (deferred — deterministic md/db is primary; add embeddings only if recall needs it).
- **Retrieval**: deterministic md/db + AI-read (finance-trust). No vector drift.

## The 3 layers of the product
1. **Contract interpretation** — SOW clauses → structured billable rules (`ta_rate`, `milestone`, `oss_slab`).
2. **Excel calc reconstruction** — reproduce OSS + TA invoice math from the placed-lifecycle ledger.
3. **NL answer** — AR-analyst answers: evidence + calc trail + clause reference.

## Skill manifest (source → Q&ANSR)
| Q&ANSR skill | From | Status |
|---|---|---|
| qansr-knowledge-store | ESPL recon-16 | ✅ authored |
| qansr-normalizer | ESPL recon-00/05 | ⬜ |
| qansr-contract-intake | ESPL recon-01 | ⬜ |
| qansr-calc-engine | **new** (TA/OSS/milestone) | ⬜ |
| qansr-lifecycle-ledger | **new** (placed lifecycle) | ⬜ |
| qansr-variance | ESPL recon-04 | ⬜ |
| qansr-invoice-assurance | ESPL recon-08 | ⬜ |
| qansr-statement-generator | **new** (Statement of Invoicing xlsx) | ⬜ |
| qansr-exceptions | **new** (un-invoiceable rows) | ⬜ |
| qansr-ai-clarify | ESPL solve.js | ⬜ |
| qansr-ai-pipelines | Leela ai-avenues + 008 + chatbot-gating | ⬜ (registry scaffolded in store.js) |
| qansr-admin | Leela admin-users + tabAdmin | ⬜ |
| qansr-tasks | Leela taskmanager | ⬜ |
| qansr-deploy / qansr-dbwiki / qansr-api-shield | Leela | ⬜ |

## Build sequence
1. ✅ Foundation: package.json, Postgres schema, server (intake + doc×api switch + pipeline registry), brand kit.
2. ⬜ Contract intake → rule tables (`ta_rate`/`milestone`/`oss_slab`) with clause refs.
3. ⬜ Normalizer (source/role/status/level/date/CTC) — AI suggest → confirm → learn (`alias`, `decision`).
4. ⬜ Lifecycle ledger build from EMP LIST → `placement`.
5. ⬜ Calc engine: OSS roll-forward + TA bridge + milestone split (deterministic).
6. ⬜ Variance vs workbook + exceptions.
7. ⬜ Statement of Invoicing generator (xlsx: cover / OSS / TA / evidence / exceptions).
8. ⬜ AR-analyst Q&A + AI clarify.
9. ⬜ Admin panel + listeners + chatbot gate.
10. ⬜ Deploy (local docker now; staging qansr.thekettleblack.in later).

## Framework layer (002_qansr_framework.sql) — reusable across all ~20 ops
Page = **Operations hub**; op #1 = **Invoice Studio** (run-based). Each run is saved + explainable.

**Doc-intelligence spine (reusable for every op):** any doc → AI emits **dynamic typed boxes**
(`box_type`: company / legal / payment_terms / commercial_terms / caveats / flags / AI-proposed) →
each box has AI-explain + **chat-with-box** (`box_chat`) + confidence + clause_ref → **approve**
(`approval`, maker-checker) → propagate to DB tables + MD + memory. Understanding is run-versioned.

**Two-phase journey:**
- **Phase A · Contract intelligence**: upload SOW → boxes → explain/chat → approve → becomes the
  **rule framework** (cost heads, rate tables, terms, dimensions).
- **Phase B · Roster + billing**: upload Process Roster (emp list + pricing) → normalize + **align to
  framework** → AI clarifies missing data via natural language → approve → process **SOA result sheet**
  (filter by month / person / role / division / dept / function / seniority; cost heads incl advance/phases).

**Explainable trace (first-class, `trace` table):** every box AND every number =
`value(+ccy+base) · why · clause_ref · calc_steps(incl FX) · source_ref → md → original · confidence · model · run_id`.
No bare numbers. Drill any total → line → source row → md → original.

**Currency-aware (the FX requirement):** wage may be INR, terms another ccy, bill another.
Every money fact = `(amount, ccy)` + `(base_amount, base_ccy)` + `fx_rate + date + source` (`fx_rate` table;
ccy columns on customer/milestone/oss_slab/placement/ta_calc/oss_calc/credit_note). Conversion is a
visible trace step; convert-then-% vs %-then-convert is **clause-defined**, not assumed.

**Cost-head framework (`cost_head`):** the bill is composed of typed heads — ta_sourcing/acceptance/balance,
oss, advance, phase, milestone, recurring, one_off, clawback, credit, tax — each with calc_logic + clause_ref.

**Rule versioning (`rule_version`):** terms have effective-dated versions; month M bills with the version live
for M (amendment = new version). Handles mid-contract rate changes.

**Clawback / credit notes (`credit_note`):** exit-within-X / correction / retro-rate / replacement →
clawback or credit; SOA nets these.

## Backlog — power-ups ("what more crazy")
1. Clause→rule compiler w/ effective dates ✅ schema (`rule_version`)
2. Clawback / replacement ✅ schema (`credit_note`)
3. Tax + FX engine — FX ✅; tax (GST/IGST/SEZ/VAT/TDS) ⬜ (ESPL GST pattern)
4. Credit notes / catch-up billing ✅ schema
5. Reconciliation scorecard (reproduced vs workbook vs prior invoice) ⬜
6. Maker–checker + immutable release ✅ schema (`approval`); freeze logic ⬜ (Leela immutability)
7. Roster⟷contract alignment (unmapped row = exception, never silent) ⬜
8. Anomaly detection (outlier CTC, HC jump, dup placement, exit-before-billing) ⬜
9. Listeners/notifications (roster uploaded, run ready, deviation>threshold) ⬜ (Leela poll)
10. What-if simulate (HC±, rate±, band shift → bill/margin) ⬜ (ESPL simulate)
11. Export pack (Statement xlsx + PDF invoice + audit pack) ⬜
12. Self-learning (approved decisions → rules; next run auto-applies, only deltas flagged) ⬜

## Calc spec (ANSR–Kenvue)
- **Total Annual CTC** = fixed salary + target annual cash bonus. Exclude LTI, stock, joining bonus, retention bonus.
- **TA fee** = CTC × TA% (TA% by GCC headcount band × level × referral). Split:
  sourcing (Col C) + acceptance (Col D) + balance one month after onboarding (Col E).
  Milestone advances: sourcing tech $400 / non-tech $300; acceptance tech $600 / non-tech $300; balance = gross − advances.
- **OSS fee** = monthly, by active GCC headcount (prior-month active + new joiners − exits),
  apply OSS slab (≤50 = minimum fee; 51–250+ = per-resource). No pro-rata; measured at month-end via join/exit dates.
- **Level map**: non_leadership | manager | director | vp_site_leader.
