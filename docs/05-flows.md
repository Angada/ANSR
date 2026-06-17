# 5 · Flows — end-to-end diagrams

[← Schema](04-schema.md) · [Wiki home](README.md) · Next: [API reference →](06-api-reference.md)

---

## Flow A — Intake (document → rule book)

```
SOW file ─► POST /api/upload
                │  extract (officeparser / xlsx)
                ▼
        T1 vault (original)  +  T2 md (docstore/<t>/<docId>.md)  +  document row
                │
                ▼
        AI fills typed BOXES   (company · legal · payment · commercial ·
                                caveats · flags · BILLING_RULES)
                │  clauses chunked → clause + interpretation (RAG-of-rules)
                ▼
        billing_rules box ── compileRuleBook() ──► canonical JSON → rule_version.logic
                │
                ▼
        worked_examples self-test (formula_test)  ── TRUST GATE ──► must pass to lock
```

## Flow B — Atlas routing (before the run)

```
compiled rule book
        │
        ▼
  fingerprint(rb)  ─►  match vs archetypes (weighted Jaccard + embedding blend)
        │                         │
        │                    decide: matched ≥.8 · partial ≥.5 · novel
        ▼                         ▼
  route():  matched → adopt archetype, PRE-LOAD rule_template (template-fill)
            novel   → crystallise new archetype
        │
        ├─► contract_fingerprint row (customer → archetype, + embedding)
        ├─► epidemiology.prewarn()  → known recurring failures for this family
        ├─► federation pre-fills decisions agreed by siblings
        └─► regenerate _ATLAS wikis (playbook + graph + common denominators)
```

## Flow C — The monthly run (data → bill)

```
worksheet (file OR API)
   │  POST /api/mint/roster/map     (AI/deterministic column mapping)
   │  POST /api/mint/roster/confirm (write rows to ledger)
   ▼
placement LEDGER  (raw jsonb + mapped; cumulative across months)
   │
   │  POST /api/mint/run/compute  { client, month }
   ▼
for each row:  normalizeRow(raw, ruleBook, decisions)
                 │
        clean ───┤                    unmapped / ambiguous
                 ▼                              │
        computeRun() ── operators ──►          ▼
          rate_lookup · slab · pct ·     CLARIFICATION (a question, not a guess)
          month_of/after · active_hc · fx
                 │
                 ├─► ta_calc · oss_calc          (the facts)
                 ├─► trace                        (one per number: value+ccy+fx+why+clause+row)
                 └─► exception_item               (bad rows quarantined — PARTIAL COMPUTE)
   │
   ▼
CLARIFY LOOP:  POST /api/mint/clarify { topic, choice }
   │  → decision (auto-applies to all affected rows + future runs)
   │  → recompute ONLY affected rows (live, no reload)
   │  → federation.record()  (promote label across the archetype)
   ▼
POST /api/mint/run/:no/release
   │  → statement (totals, frozen, immutable)
   │  → epidemiology.record()  (teach the family this run's exceptions)
   ▼
OUTPUTS:  invoice PDF · month-by-month · detailed calc (trace) · charts · filterable bill
          (all rendered from run.manifest)
```

## Flow D — Drift & fork (over time)

```
each run / on demand:  GET /api/atlas/drift/:client
   │  recompute fingerprint vs assigned archetype
   ▼
 sim < .8  OR  heads changed?
   │ no → stable
   │ yes → drift!  suggest: reroute:<slug>  (a better family exists)
   │                         or  fork
   ▼
POST /api/atlas/fork/:client
   │  crystallise new archetype VERSION (slug-v2, parent_id lineage)
   └─ re-route the contract to the fork
```

## Flow E — Pre-intake gate (raw SOW, before compile)

```
raw SOW text ─► POST /api/atlas/preintake { client, sow }
   │  fingerprintText() heuristics  (keywords → heads/dims/currency)
   ▼
 propose:  fingerprint + candidate archetypes + confirm_token   (NOTHING persisted)
   │
   ▼  human reviews the proposed shape
POST /api/atlas/preintake/confirm { client, fingerprint, confirm_token, archetype_slug }
   │  token must still bind the shown fingerprint
   ▼
 adopt → contract_fingerprint (decision = preintake-confirmed)
   (wrong/edited token → rejected; human-approval gate holds)
```

## The audit chain (any number, backwards)
```
invoice number  →  trace  →  run  →  clause (§)  →  md extract (T2)  →  original file (T1)
```
