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

## Calc spec (ANSR–Kenvue)
- **Total Annual CTC** = fixed salary + target annual cash bonus. Exclude LTI, stock, joining bonus, retention bonus.
- **TA fee** = CTC × TA% (TA% by GCC headcount band × level × referral). Split:
  sourcing (Col C) + acceptance (Col D) + balance one month after onboarding (Col E).
  Milestone advances: sourcing tech $400 / non-tech $300; acceptance tech $600 / non-tech $300; balance = gross − advances.
- **OSS fee** = monthly, by active GCC headcount (prior-month active + new joiners − exits),
  apply OSS slab (≤50 = minimum fee; 51–250+ = per-resource). No pro-rata; measured at month-end via join/exit dates.
- **Level map**: non_leadership | manager | director | vp_site_leader.
