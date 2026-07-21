# 13 · Munshi-for-Mint — parser upgrade (v1 BUILT)

> **Status:** **v1 built & deployed.** Corpus→chips decomposition, hash-guarded
> re-parse preserving human-confirmed chips, and the Mint "Rule chips · Munshi"
> panel all live. Remaining: phase 4 (calc engine reads chips instead of the
> static rule JSON) and real uploaded-SOW AI parse (currently deterministic from
> the stub; the `mint-munshi-parse` AI path is wired but off by default).
> Built: 2026-07-22 · Banked: 2026-07-21

## Built in v1
- **Schema** `db/init/016_munshi.sql`: `mint_contract_doc` + `mint_contract_chip`
  (unique per customer×box×key, `status draft|confirmed`, `source_hash`, provenance).
- **Parser** `server/munshi.js`: `decomposeChips()` breaks the 7 boxes into 33
  atomic clause-referenced chips (each TA row / OSS slab / milestone / caveat = a
  chip); `munshiParse()` upserts hash-guarded and **never overwrites a confirmed
  chip** (verified: confirm a TA-rate chip → re-parse re-derives the other 32 but
  keeps the confirmed value locked).
- **Endpoints**: `POST /api/mint/munshi/parse/:client`, `GET /api/mint/chips/:client`,
  `POST /api/mint/chip/:id/confirm`, `POST /api/mint/chip/:id/amend`.
- **Pipeline**: `mint-munshi-parse` (Mint, hybrid) in the registry.
- **UI**: Mint step 5 "Rule chips · Munshi" — chips grouped by box, each with
  clause_ref + confidence + Confirm/Amend, plus a Re-parse button.

## Remaining (phase 4-5)
- Calc engine reads the chip set for a customer instead of `billing_rules` JSON.
- Multi-doc corpus ingest (SOW + amendments) + enable the AI parse of real MD.

## Why

Mint's document parser today is **single-SOW, fixed-taxonomy, clause-grounded**. The
**Munshi method** (from RayDar's `clientmind-parse` / TalentMind Parse) reads a *whole
corpus* holistically into a master profile + typed, weighted, provenance-backed atomic
"chips", and **re-parses on change**. Adopting the *method* (not the loose-chip output
format) upgrades Mint from "one SOW → fixed boxes" to a **living contract corpus →
atomic, clause-traceable rule-chips that re-derive on amendment** — directly serving
Mint's promise that *every number traces to source*.

## Current Mint parser (as-is)

Files: [`server/clauses.js`](../server/clauses.js), [`server/stub.js`](../server/stub.js), [`public/mint.js`](../public/mint.js).

1. **Chunk** — `chunkMd()` splits SOW markdown into clause chunks with stable `§` refs.
2. **Classify** — the `contract-intake` pipeline fills **7 fixed boxes**: `company ·
   legal · payment_terms · commercial_terms · billing_rules · caveats · flags`, each
   grounded via `CLAUSE_FOR_BOX` (e.g. `billing_rules → §2.4,§3.1,§3.3,§4.2`).
3. **Output** — each box: `content(JSON) · ai_explain · confidence · clause_ref ·
   status(draft/approved) · chat[] · suggestions[]`. The `billing_rules` box emits the
   **executable rule tables** (TA rate table, milestone split, OSS slabs, FX, worked
   examples) that the calc engine runs verbatim.
4. **Memory** — `interpretation` table stores confirmed clause readings (confirm→lock);
   `audit_log` records changes.

Limitation: reads **one** SOW; amendments/side-letters/clarifications don't mutate the
rule book; each rule is not individually traceable/amendable.

## Recommendation — adopt the *method*, keep the *format*

**Adopt (high value):**
- **Corpus-level parse** — ingest SOW **+ amendments + side-letters + email
  clarifications + prior invoices** in one holistic pass (extend `chunkMd` to multi-doc).
- **Atomic weighted "rule chips"** — decompose each box into atomic facts (each TA rate
  row, OSS slab, milestone, caveat, flag) = a chip `{value, confidence, clause_ref,
  provenance, status, hash}`. Boxes become *groupings* of chips → each number
  individually traceable, amendable, re-scorable.
- **Re-parse on change (idempotent)** — content-hash each source chunk; on a new
  amendment re-parse only the delta, update affected chips, **preserve human-confirmed
  interpretations** (reuse `interpretation` lock + `audit_log`). Add a scheduled refresh
  (Munshi's weekly re-parse).

**Do NOT adopt:** Munshi's open-ended chip *taxonomy*. The calc engine needs the
**structured rule tables**, not loose fuzzy chips. Keep Mint's fixed box/rule-table
output as the calc contract; use the Munshi method only to *populate and maintain* it.

## Build plan (phased)

1. **Schema** — `contract_chip` table (Munshi-analogue of `wh_client_mind`):
   `id, customer_id, box_type, key, value(jsonb), weight/confidence, clause_ref,
   provenance(jsonb: doc_id + span), status(draft/confirmed), source_hash, updated_at`.
   Add `contract_doc` for multi-doc corpus (SOW + amendments + …).
2. **Intake rewrite** — extend `chunkMd` to multi-doc + content-hash; `contract-intake`
   pipeline emits chips (not a static rule JSON), grouped into the 7 boxes.
3. **Re-parse-on-change job** — on new/changed doc, hash-diff chunks, re-parse affected,
   update affected chips, keep confirmed ones locked. Optional weekly cron.
4. **Calc read-path** — calc engine reads the **chip set** for a customer instead of the
   static `billing_rules` JSON; each computed number cites the chip → clause → doc span.
5. **UI** — boxes render as chip groups; each chip shows its clause_ref + confidence +
   confirm/amend; amendments visibly re-derive affected rules.

Keep the current stub (`stubContract`/`stubAnalysis`) live behind a flag until the chip
path reproduces the worked examples (the trust test).

## Related
- Munshi method origin: `clientmind-parse` pipeline in [`server/store.js`](../server/store.js), RayDar TalentMind Parse.
- Interpretation memory to reuse: [`server/clauses.js`](../server/clauses.js) `getInterpretations` / `upsertInterpretation`.
