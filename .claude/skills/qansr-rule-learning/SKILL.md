---
name: qansr-rule-learning
description: Q&ANSR rule-learning feedback loop — how agent interpretation of a contract gets better from your feedback. Two loops — intra-run (this contract, live) and cross-run/MINT-wide (rule promotion ladder). Use when wiring feedback handling, the run-rule store, T2/T3 refinement on correction, or promoting a learned rule MINT-wide. Triggers — "wrong interpretation", "this clause means", "rule got better", "apply my earlier read", "promote rule", "MINT-wide".
---

# Q&ANSR — Rule Learning (feedback → refinement → promotion)

Builds on [[qansr-ai-pipelines]] (the gate) + [[qansr-knowledge-store]] (the 3 tiers).
This is the missing 4th surface: where interpretation **learns**. Feedback is not a one-cell
fix — it refines the extract, the facts, and the rule, and it compounds.

## Two loops (don't conflate)

| Loop | Scope | When it fires | Effect |
|------|-------|---------------|--------|
| **Intra-run** | one contract, live session | every accepted feedback | understanding of THIS contract improves now |
| **Cross-run / MINT** | future docs, all customers | end of run, opt-in review | promoted rule seeds every future pipeline |

Intra-run is automatic and immediate. MINT promotion is reviewed and explicit. Never auto-promote.

## Loop 1 — intra-run (the core)

You correct a clause. Agent does **3 things live, not 1:**

```
feedback ("clause Y means X")
  → 1. UPDATE T3 fact      re-derive the affected rows (ta_rate/milestone/calc…), new run_id
  → 2. PATCH T2 .md        rewrite that slice of docstore/<cust>/<docId>.md so re-reads see X
  → 3. HOLD a run-rule     run-scoped store: { clause_type, context, reading:X, source:feedback }
```

Why all 3: a contract repeats patterns. Same clause type recurs across placements/milestones.
Fix once (#3) → agent **pre-applies** to the rest of this contract without re-flagging each.

### The run gets smarter as it proceeds
- Correction #1: you flag → agent fixes (#1,#2) + remembers (#3).
- Clause recurs → agent applies the run-rule, surfaces **"applied your earlier read here"** (never silent).
- Corrections-per-clause trends down inside the session. That is "better for this run".

### Rules (intra-run)
- Every run-rule application is **shown**, not silent — user can reject a misapplied read.
- #1 and #2 move together. A patched fact whose md slice still says the old thing is a provenance break.
- Re-derive downstream calcs after #1 — a corrected rate must reflow into `ta_calc`.
- Run-rules live for the run. They do not touch T3 `rule` table or other customers.

## Loop 2 — cross-run / MINT promotion (phase 2)

At end of run, run-rules that held up (applied, not rejected) become **candidates**.

```
run-rule (held)
  → write RULE CANDIDATE to `rule` table (T3), scope = customer
  → Admin review (promote / reject — auditable, like a pipeline switch)
  → on approve, STRIP customer data → MINT-global rule
  → future pipeline runs inject matching rules as prompt context
```

### Two scopes — data siloed, understanding shared
| Thing | Scope | Crosses customers? |
|-------|-------|--------------------|
| Customer **data** (rates, names, $) | per customer | never (gate enforces) |
| Interpretation **rule** (clause-type → meaning) | customer → MINT-global | yes, once stripped of data |

A rule learned on Customer A's SOW ("milestone clause w/ 'net-45' → payment trigger"), stripped of
A's numbers, seeds every MINT customer's pipeline. **Data stays siloed; understanding circulates.**

### Measurable
- Per run: which rules fired (run-rules + injected global rules).
- Trend: corrections-per-doc falling = learning works.
- MINT reach: `% global rules` vs `customer-local rules`.

## `rule` table (T3) shape
```
rule(id, scope[customer|mint], customer_id?, clause_type, context, reading,
     source_run_id, status[candidate|approved|rejected], created_at, approved_by?)
```
Run-rules are the in-memory mirror; promoted ones persist with scope=mint and customer_id null.

## Rules (non-negotiable)
- Feedback refines **three** surfaces (fact, md, rule) — never just the fact.
- Run-rule applications are always surfaced to the user.
- No auto-promotion. Customer→MINT only via admin review, only after data strip.
- Promoted rules carry no customer data. Ever. (Gate from [[qansr-ai-pipelines]] still holds.)
- Every promoted rule traces to its `source_run_id` → provenance chain from [[qansr-knowledge-store]].
