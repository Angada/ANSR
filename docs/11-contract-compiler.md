# 11 · The Contract Compiler — model + the method that built it

[← AI pipelines](10-ai-pipelines.md) · [Wiki home](README.md)

Two things live here: **what** the Contract Compiler is, and the **method** used to design it — because the method (audit → root-cause → adversarial-matrix test → declarative model → prove coverage → flag, don't guess) is reusable on any doc-driven rules engine, including ESPL reconciliation.

---

## Part A — What the compiler is

A contract is turned into a **complete, validated, locked rule set BEFORE any worksheet arrives**. The worksheet is then just data poured into a finished mould.

### The fixed worksheet (shared input universe)
Every contract bills off the **same** canonical columns: ext_id, name, level, source→referral, tech, location, department, sourcing/offer/join/exit dates, fixed_ctc, variable_ctc, currency. This fixed set is the **universe of dimensions** — contracts vary only in *how* they use them.

### The canonical rule model
A rule set = ordered **cost heads**, each *declaring* the dimensions it bills on:
- `dimensions` — the worksheet fields this head's rates key on (e.g. `[level, referral, tech]`, or `[location]`)
- **sparse `rate_cell` matrix** — only authored combos, **wildcards allowed** (`tech: *`)
- `slabs` — bands on any measure (headcount/seats/GB…)
- `schedule`/milestones — phases (sourcing/acceptance/balance) with trigger + amount (fixed-by-dim | % | remainder)
- `kind` — recurring_slab · one_time_split · per_unit · flat · clawback · credit

### Coverage = proof of readiness (logical, not materialised)
The validator walks the **declared dimension domain** and confirms every combination resolves to a cell (specific or wildcard), reporting **coverage % + named gaps + conflicts** — it never enumerates a giant cross-product. `green` (100% + examples pass) · `amber` (<100%) · `red` (conflicts).

### Soft gate
A worksheet may compute on a partial rule set; an uncovered combo surfaces as a **`rate_gap` exception** (that row quarantines, the rest bills), and coverage % stays visible. Flag, don't guess — at the rule layer.

### Schema (`db/init/012_ruleset.sql`)
`rule_set` (compiled book + status + coverage) · `rule_dimension` (declared dims + domain + source column) · `rule_head` · **`rate_cell`** (sparse matrix) · `rule_validation` (coverage/gaps/conflicts/examples) · `rule_clarification`. See [Schema](04-schema.md) / `qansr-db` skill.

### Code
`server/engine/coverage.js` (logical coverage) · `ruleset.js` (compile spec → executable rule book; validate; buildRuleSet) · `compute.js` (generic rate ctx) · `run.js` getRuleBook (prefers the compiled rule set) · `/api/mint/ruleset/:client`.

---

## Part B — The method (the reusable part)

These are the working rules that produced the compiler. They apply to **any** document → rules → outputs engine.

### 1. Verify, don't assert
When challenged ("you're not using all the rules"), don't defend — **read the actual code and run a test**. The truth was in `rateLookup`, `compute.js`, and a 20-line script — not in memory. Every claim of "it works" was backed by a run.

### 2. Root-cause over symptom
"Buttons not working" → the invoice builder read empty DB tables → fix the builder, not the buttons. Trace the symptom to the line.

### 3. Adversarial *matrix* testing (the confirmation-bias guard)
The worst miss: I verified *breadth* ("do all 3 phases fire?") and stopped — never testing *depth* ("does the % differ by tech? by every level × referral × tech combo?"). **Test the full cross-product of dimensions, not the happy path you built.** This is exactly what `coverage.js` now automates: it refuses to call a rule set ready until every combo resolves.

### 4. Declarative + provable
Don't hope a rule set is complete — **make completeness checkable**. Declare dimensions + domains; compute coverage. A model you can validate beats a model you trust.

### 5. Scale by logic, not materialisation
The dimensional matrix is the curse-of-dimensionality trap. Store **sparse authored rows + wildcards**; check coverage by **walking the domain logically** (capped), never by inserting every combo. ~32 cells/contract, not millions.

### 6. Flag, don't guess
Anything the model can't express (unknown cost-head kind, uncovered rate combo) → an **exception for a human**, never a silent zero. Partial-compute so one bad contract never blocks the other 9,999.

### 7. Generic over the input universe
Rates must key on **any** worksheet column. The bug: `compute.js` passed a hardcoded ctx (`level, referral, tech`) to the lookup, so a `location`-keyed contract billed $0. Fix: pass the **whole row** as ctx. Generality is structural, not per-contract.

### 8. Separate build-time from run-time
Build-time: AI + human compile/validate/lock the rule set (slow, once). Run-time: deterministic compute over the ledger (fast, monthly, no AI). Never mix.

### Cautionary tales (real bugs this method caught)
- **Hardcoded lookup ctx** → location-keyed contract billed $0 (fixed: full-row ctx).
- **`ta_pct` vs `pct` key mismatch** → the % never applied; gross 0, balance 0 (fixed: key + compiler maps it).
- **TA/OSS-hardcoded invoice builder** → every non-TA/OSS contract billed $0 (fixed: generic `by_head`).
- **Missing `tech` dimension in the rate keys** → % didn't vary by tech (fixed: full matrix + coverage that would now flag it).
- **Cross-product materialisation** → would explode at high dimensionality (avoided: sparse + logical coverage).

---

## Part C — Applicability

- **ANSR / Mint** — live. The compiler is the spine of the AR product.
- **BigFlex** — the method + model are part of the reusable kit (see the `bigflex` skill, "Contract Compiler" pillar).
- **ESPL (reconciliation)** — **suitable.** ESPL's recon rules are also a doc-defined rule set over a periodic feed. The same pattern fits: declare the recon dimensions, author a sparse rule matrix, prove coverage before a run, flag unmatched rather than guess, keep build-time (rule authoring) separate from run-time (recon). Port the *method* (Part B) and the `coverage`/`ruleset` shape; retoken the dimensions to ESPL's domain.
