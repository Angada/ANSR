# 9 · Glossary

[← Deployment](08-deployment.md) · [Wiki home](README.md)

---

| Term | Meaning |
|---|---|
| **Q&ANSR** | The product: a contract-aware AR engine that reads SOWs + worksheets, reproduces invoicing, and explains every number. |
| **Mint** | The first agent/product on the engine — "AR Contract Reconciler." |
| **BigFlex** | The generic, contract-agnostic engine + component kit underneath Mint. |
| **Atlas** | The cross-contract learning brain: archetypes + 4 learning axes. |
| **TA fee** | Talent Acquisition (recruitment) fee — one-time, `% of CTC`, split across milestones. |
| **OSS fee** | Operations fee — recurring monthly, by active-headcount slab. |
| **CTC** | Cost To Company (salary). `total_ctc = fixed + target variable` (excl. LTI/stock/joining/retention). |
| **Rule book** | The compiled, executable JSON form of a contract's billing logic (`rule_version.logic`). |
| **cost_head** | One billable line type in a rule book (e.g. `ta`, `oss`). |
| **kind** | A cost_head's pattern: `one_time_split`, `recurring_slab`, `per_unit`, `flat`, `clawback`, `credit`. |
| **rate_table** | A keyed lookup in the rule book (e.g. level+band+referral → %). |
| **slab** | A headcount band → fee (`minimum` or `per_resource`). |
| **normalizer** | A messy-label → clean-label dictionary (e.g. "GDC" → `non_referral`). |
| **operator** | The only logic in code: `rate_lookup`, `slab`, `pct`, `month_of`, `month_after`, `active_headcount`, `fx_convert`. |
| **worked example** | A test pair (`inputs → expected`) the engine must reproduce on compile. The **trust gate**. |
| **placement** | One employee/placement row in the cumulative ledger. |
| **decision** | A persisted clarification answer (`map:source:GDC=non_referral`) that auto-applies to all rows + future runs. |
| **clarification** | A question raised when a value can't be normalized — never a guess. |
| **trace** | The full derivation of one number: value + ccy + base + FX + why + clause + source row. |
| **exception / quarantine** | A row that can't be safely billed, isolated so clean rows still compute (**partial compute**). |
| **run** | One monthly invoice computation for one customer. One draft per month, reused; released = frozen. |
| **manifest** | The full computed run snapshotted as JSON in `run.manifest`, for instant recall. |
| **statement** | The released totals (OSS + TA + grand total) for a run. |
| **doc×api switch** | Serving the T2 md extract for "the document," never the T1 original. |
| **hybrid store** | The 4 tiers: T1 vault · T2 md · T3 DB · T4 JSON manifest. |
| **clause / interpretation** | A SOW clause (`§3.1`) + our plain-English reading of it that compiles to a rule (RAG-of-rules memory). |
| **archetype** | A family of contracts that bill the same way (e.g. `split-fee+headcount-slab`). |
| **fingerprint** | A contract's structured billing "physiology" (heads, dims, measures, milestones, currency). |
| **match decision** | `matched` (≥.8), `partial` (≥.5), `novel` (<.5). |
| **route** | Adopt the matched archetype (template-fill) or crystallise a new one; persist + learn. |
| **federation** | Learning labels across siblings — a label confirmed on ≥2 contracts promotes to the archetype. |
| **epidemiology** | Learning failures across siblings — recurring exceptions pre-warn a new contract. |
| **prevalence** | % of an archetype's members hit by a given exception issue. |
| **embedding** | A semantic vector used to blend with structural similarity (`0.75·Jaccard + 0.25·cosine`). |
| **drift** | When a contract's fingerprint no longer fits its archetype (sim<.8 or heads changed). |
| **fork** | Crystallising a new archetype **version** (parent_id lineage) when a contract drifts. |
| **pre-intake** | Fingerprinting raw SOW text before compile, behind a human-confirm token gate. |
| **recalibrate** | Re-deriving rules from corrections, with a live meter, after Q&A. |
| **release / immutable** | Freezing a run; a later recompute opens a new version. |
| **AI pipeline / gate** | Every model call goes through a registered, enabled pipeline; raw text never hits a model outside one. |
| **FX base** | Money is stored native + base (billing ccy) + the FX used; conversion is always a trace step. |
