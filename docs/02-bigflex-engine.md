# 2 · BigFlex engine — rules→data→bill

[← Architecture](01-architecture.md) · [Wiki home](README.md) · Next: [Atlas →](03-atlas.md)

---

## The rule book — the heart of it

When you upload a contract, AI reads it and fills typed "boxes" (company, legal, payment terms, commercial terms, caveats, flags, and the important one: **billing_rules**).

The `billing_rules` box gets **compiled** (`server/engine/rulebook.js → compileRuleBook(box)`) into a canonical JSON and persisted to `rule_version.logic` (per customer, versioned, effective-dated). Example for Kenvue:

```jsonc
{
  "base_currency": "USD",
  "inputs": [ {"field":"join_date","required":true,"type":"date"}, ... ],
  "normalizers": {
    "source": [ {"to":"referral","match":["Employee Referral","Business Referral"]},
                {"to":"non_referral","match":["GDC","Vendor","#N/A"]} ]
  },
  "cost_heads": [
    { "code":"oss", "kind":"recurring_slab", "measure":"active_headcount",
      "slabs":[ {"hc_min":0,"hc_max":50,"fee_type":"minimum","rate":22000},
                {"hc_min":51,"hc_max":250,"fee_type":"per_resource","rate":530} ],
      "no_prorata":true, "clause_ref":"§4.2" },
    { "code":"ta", "kind":"one_time_split", "base":"total_ctc",
      "rate_table":{ "keys":["gcc_band","level","referral"],
                     "rows":[ {"gcc_band":"<=100","level":"non_leadership","referral":false,"pct":8.5}, ... ] },
      "milestones":[ {"code":"sourcing","trigger":"month_of:sourcing_date","amount":{"tech":400,"nontech":300}},
                     {"code":"acceptance","trigger":"month_of:offer_date","amount":{"tech":600,"nontech":300}},
                     {"code":"balance","trigger":"month_after:join_date:1","amount":"gross_minus_advances"} ],
      "clause_ref":"§3.1 §3.3" }
  ],
  "worked_examples":[ {"inputs":{...},"expect":{"head":"ta","amount":5200}} ]
}
```

### Key terms
- **cost_head** — one billable line type. Kenvue has `ta` and `oss`.
- **kind** — the *pattern* of that line:
  - `one_time_split` — a fee split across milestones
  - `recurring_slab` — a recurring fee picked from a slab table by **any measure** (active headcount, seats, GB stored, transactions…)
  - `per_unit` — rate × a measure summed across the sheet (per transaction/seat/license)
  - `flat` — fixed amount for the period (retainer / platform fee)
  - `clawback` — reversal (negative line)
  - `credit` — credit note (negative line)

The engine iterates **every** cost head and dispatches by kind → returns a `line` per head plus `by_head` totals; an **unknown kind is flagged ("rule needs a human"), never guessed**. So a contract with no TA/OSS (e.g. SaaS per-seat + flat platform fee) computes on the same engine with zero code changes.
- **rate_table** — a keyed lookup ("level + band + referral → %").
- **slabs** — headcount bands → fee.
- **normalizers** — messy-label → clean-label dictionaries ("GDC" means `non_referral`).
- **inputs** — the columns the worksheet must contain.

### The trust gate
The rule book carries `worked_examples` ("an $80k referral hire should bill $5,200"). On compile, the engine runs those examples through *itself* (`runWorkedExamples`, writes `formula_test` rows). If the math doesn't match, **the contract can't lock**. That's the proof the engine understood the contract — replacing the old "reconcile against the client's workbook" approach (there is no client workbook; Q&ANSR *is* the source of truth).

## The operators — the only "logic" in the code

`server/engine/operators.js`. The whole engine is built from just these primitives:

| Operator | Does |
|---|---|
| `rate_lookup` | find a table row by key (level+band+referral → 8.5%) — range or exact match |
| `slab` | given a headcount, pick the band (≤50 → minimum, 51–250 → per-resource) |
| `pct` | base × percent |
| `month_of(date)` | which month a milestone fires |
| `month_after(date, n)` | n months after a date (e.g. balance = join + 1) |
| `active_headcount` | roll the joiner/leaver ledger forward to month-end, count active (tz-aware, no pro-rata) |
| `fx_convert` | currency conversion via FX |

Cost-head `kind`s map to combinations of these. **Unknown kind/operator → `exception_item` ("rule needs human"), never a silent guess.**

## Normalization + clarifications

`server/engine/normalize.js → normalizeRow(row, ruleBook, decisions)` returns `{normalized, clarifications}`:
- Applies the rule book's normalizers + date parsing (`parseDate` handles Excel serials, dd/mm vs mm/dd ambiguity, blanks, `#N/A`) + currency.
- A value with **no normalizer match** (a source label the dictionary never saw) or a **genuinely ambiguous date** → a **clarification** (a question), not a guess.
- Resolved answers persist as a `decision` (`map:source:GDC-2=non_referral`) that **auto-applies to all affected rows and future runs**.

## The compute engine

`server/engine/compute.js → computeRun({month, ruleBook, ledger, getRate, currency})` → `{oss, ta[], traces, exceptions, hc, totals}`:
- **TA**: look up the %, multiply by CTC, FX-convert, split across the milestones that fall in *this* month.
- **OSS**: roll the cumulative ledger forward, count active heads at month-end, pick the slab, compute the monthly fee.
- **Every number emits a `trace`**: value + currency + base + FX + the *why* + clause ref + calc steps + source row.
- **Quarantine**: bad rows go to `exception_item`, isolated — the clean rows still compute (**partial compute**).

## The run state machine

`server/engine/run.js` orchestrates. A monthly run moves:
```
staged → normalized → computed(partial) → clarifying → computed(clean) → released
```
- **One draft run per month** is reused (the clarify loop edits it in place). Only a **released** run is frozen; a fresh compute then opens a new version.
- On recompute, prior facts for the run are wiped before re-insert (idempotent).
- After persist: `epidemiology.record(client)` (teach the archetype) — see [Atlas](03-atlas.md).

## Live FX

`server/fx.js → getRate(from, to, date)`: read the `fx_rate` cache → else fetch a free no-key API (frankfurter.app) → cache it (`source:'api'`). A manual override pins a row (`source:'manual'`). Conversion is always a visible trace step — no bare numbers.

## The end-to-end run (one month)

1. **Stage the feed** → rows written to the cumulative **placement ledger** (raw verbatim).
2. **Normalize** each row.
3. **Detect clarifications** for unmapped/ambiguous values.
4. **Partition** clean vs problem rows.
5. **Compute clean rows** → `ta_calc` + `oss_calc` + `trace`; quarantine the rest → `exception_item`.
6. **Clarification loop** — answer once → `decision` → only affected rows recompute, live, no reload.
7. **Release** → `statement` (frozen). Outputs read the real numbers.

See [Flows](05-flows.md) for the full diagram.
