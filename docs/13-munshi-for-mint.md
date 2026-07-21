# 13 · Munshi-for-Mint — parser upgrade (BUILT / flag-gated)

> **Status:** Built in phases, tested locally against the live DB. Ships **flag-gated**
> (`MINT_PARSER`, default `stub`) — the current single-SOW path stays live until the
> chip path reproduces the worked examples (the trust test). Not yet deployed.
> Owner: —  ·  Banked: 2026-07-21 · Built: 2026-07-22

## Built (what landed)

- **Schema** — [`db/init/016_munshi_chips.sql`](../db/init/016_munshi_chips.sql):
  `contract_doc` (corpus membership layered over `document`), `contract_chunk`
  (per-clause content hashes = the change detector), `contract_chip` (atomic,
  weighted, provenance-backed rule facts; unique `(customer, box_type, key)`).
- **Engine** — [`server/munshi/`](../server/munshi/): `atomize.js` (box↔chip round-trip,
  byte-identical), `chunk.js` (multi-doc chunk + hash-diff), `mstore.js` (persistence
  with **confirmed-chip preservation**), `engine.js` (intake · reparse · read-path),
  `flag.js`.
- **Calc read-path** — `getRuleBook()` in [`server/engine/run.js`](../server/engine/run.js)
  reads the chip set (assembled → `compileRuleBook`) when `MINT_PARSER=munshi`; each
  number traces chip → clause → doc span. Falls back to the static box path otherwise.
- **Routes** — `/api/mint/corpus/*` (add/list/intake/reparse), `/api/mint/chips/:client`,
  `/api/mint/chip/:id/{confirm,amend}`, `/api/mint/trust/:client` (worked-example gate),
  `/api/mint/parser` (flag toggle) in [`server/index.js`](../server/index.js).
- **UI** — [`public/mint.js`](../public/mint.js) + [`mint.html`](../public/mint.html):
  the "Living contract corpus" panel — 7 boxes as chip groups, per-chip
  clause_ref + confidence + confirm/amend, corpus manager (add amendment → re-derive),
  amendment-conflict banner (confirmed vs proposed), parser toggle + trust badge.
  Additive + hidden until a corpus exists, so the generate flow is untouched.

**Verified locally:** atomizer round-trips byte-identical & yields identical
worked-example results vs the stub path; confirm→amend→force-reparse **preserves** the
human reading and **surfaces** the AI's re-derivation as a conflict (never overwrites);
flag flip changes what `getRuleBook` returns (stub 8.5% → chip 7.25%); delta re-parse
skips unchanged docs. **Trust gate correctly refuses to flip** while the stub's
worked-example `expected` strings aren't machine-verifiable — real AI intake emits
numeric expecteds. **Not deployed** (awaiting approval).

---


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
