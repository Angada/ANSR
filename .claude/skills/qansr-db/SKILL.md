---
name: qansr-db
description: Q&ANSR / BigFlex Postgres schema — the complete data model (38 tables + 1 view across db/init/001..011), how they relate, the conventions (money native+base+FX, raw jsonb ledger, run manifest JSON, append-only audit), recall paths, and common queries. Use when adding a table/column, writing a query, persisting a run, debugging data, designing a migration, or answering "where is X stored / which table backs this number". Migrations auto-apply idempotently on boot (server/migrate.js). Triggers — "schema", "database", "table", "column", "migration", "where is X stored", "ta_calc", "placement", "run manifest", "FK", "query the db".
---

# Q&ANSR / BigFlex — Postgres schema map

**38 tables + 1 view**, defined in `db/init/001..011_*.sql`, applied **idempotently on boot** by `server/migrate.js → runMigrations()` (a fresh DB self-provisions). Client: `server/db/client.js` exports `q(text, params)` → `{ rows }` and `getPool()`.

> Exact DDL anytime: `pg_dump --schema-only "$DATABASE_URL"`. Human reference: [docs/04-schema.md](../../docs/04-schema.md).

## Cross-cutting conventions (read first)
- **Money is never bare**: store native `(amount, ccy)` **and** base `(amount_base, base_ccy)` **and** the `fx_rate_id` used. Conversion is always a visible trace step.
- **Everything is per-tenant**: keyed by `customer_id` (or `customer.code`). 100 contracts = 100 isolated datasets, one engine.
- **The ledger keeps raw**: `placement.raw` (jsonb) is the verbatim mapped row, so a run can re-normalize with the latest `decision`s (the clarification loop) deterministically.
- **The run is the unit**: one `run` = one calculation. Facts (`ta_calc`/`oss_calc`/`trace`/`statement`/`exception_item`) hang off `run_id`. The full computed run is also snapshotted in `run.manifest` (jsonb) for instant recall.
- **Every number traces**: `trace` row = value + ccy + base + FX + why + clause § + source row. Chain: number → trace → run → clause → md (T2) → original (T1 vault).
- **Audit is append-only**: `audit_log` (never updated/deleted).
- **Released runs are immutable**: recompute opens a new `run_no` (each Calculate = a new version); clarify/recalibrate edit a run in place.

## The 7 groups

### 1 · Masters, documents, clauses (provenance)
| Table | Key columns · notes |
|---|---|
| **customer** | `code` (uniq, e.g. ANSR-KENVUE), name, currency, **billing_ccy**, **contract_ccy**, **tz** (Asia/Kolkata) |
| **document** | customer_id, doc_type (sow/roster/…), sha256, **storage_path** (T1 vault), **md_path** (T2 extract), date_format, date_locale, meta |
| **doc_version** | document_id, version_no, parent_version_id, transform (extract/normalized/corrected), diff_vs_parent |
| **clause** | customer_id, document_id, **ref** (`§3.1`), title, body (md), ord, md_path · uniq(customer_id,ref,version) |
| **interpretation** | customer_id, clause_ref, **reading**, **compiles_to** (jsonb), scope (run/contract/mint), status (proposed/confirmed/promoted) · uniq(customer_id,clause_ref) — the RAG-of-rules learning memory |

### 2 · Contract terms = the compiled rule book
| Table | Key columns · notes |
|---|---|
| **ta_rate** | gcc_band_min/max, level, referral, tech, **ta_pct**, clause_ref |
| **milestone** | code (sourcing/acceptance/balance), trigger_event, amount_tech, amount_nontech, is_balance, ccy |
| **oss_slab** | hc_min/max, fee_type (minimum/per_resource), **rate**, ccy |
| **cost_head** | code, label, **kind** (milestone/recurring/one_off/clawback/credit/tax), calc_logic (jsonb), source_box_id · uniq(customer_id,code) |
| **rule_version** | rule_code, version_no, **effective_from/to**, **logic** (jsonb = compiled rule book), why, clause_ref, status · uniq(customer_id,rule_code,version_no) — bill for month M uses the version live for M |
| **rule** | code, rule_type, logic (jsonb), **why** (mandatory), created_from_discrepancy_id, status |
| **rule_application** | rule_id, run_step_id, before_json → after_json |
| **formula_test** | rule_code, scenario, inputs (jsonb), **expected**, actual, status (pending/pass/fail) — the trust gate |

> Note: the live engine computes from the **compiled rule book** (`rule_set.compiled` preferred, else `rule_version.logic` / `run.manifest.compiled_rule_book`), not by joining ta_rate/oss_slab. Those are the normalized term store; the jsonb rule book is what `computeRun` interprets.

### 2b · Contract Compiler (canonical rule set — `db/init/012_ruleset.sql`)
| Table | Key columns · notes |
|---|---|
| **rule_set** | customer_id, version_no, status (draft/structured/validated/locked/superseded), base_currency, **compiled** (jsonb executable book), **coverage_pct**, validated_at, locked_at · uniq(customer_id,version_no) — `getRuleBook` prefers locked/latest |
| **rule_dimension** | rule_set_id, name (level/referral/tech/location/…), **source_column** (fixed worksheet col), type (enum/bool/range), **allowed_values** (domain) · uniq(rule_set_id,name) |
| **rule_head** | rule_set_id, code, kind, measure, base, **dimensions** text[], slabs, schedule, rate_field · uniq(rule_set_id,code) |
| **rate_cell** | rule_set_id, head_code, **dims** (jsonb combo, "*"=wildcard), pct, amount, fee_type — the **sparse** rate matrix; coverage checked logically vs the dimension domains |
| **rule_validation** | rule_set_id, coverage_pct, status (red/amber/green), gaps, conflicts, examples — readiness snapshot |
| **rule_clarification** | rule_set_id, topic, question, options, answer, status — pre-worksheet recalibrate loop |

### 3 · Doc-intelligence boxes
| Table | Key columns · notes |
|---|---|
| **box_type** | code (company/legal/payment_terms/commercial_terms/billing_rules/caveats/flags), label, dynamic (AI may add types), schema_hint |
| **box** | customer_id, run_id, document_id, box_type_code, **content** (jsonb), ai_explain, confidence, clause_ref, status (draft/approved/rejected), version |
| **box_chat** | box_id, role (user/assistant), message |
| **box_suggestion** | box_id, kind (ai_suggestion/user_amendment/clarification), before_json → after_json, rationale, status (open/accepted/rejected/applied) |

### 4 · Data ledger
| Table | Key columns · notes |
|---|---|
| **placement** | customer_id, ext_id, **raw** (jsonb verbatim), normalized identity (role_level, tech, referral, status), dates (sourcing/offer/join/exit + `_raw` + date_flags), comp (fixed/variable/total_ctc + ctc_ccy + total_ctc_base + base_ccy + fx_rate_id), fee outputs, calc_status · **uniq(customer_id, ext_id)** — the cumulative ledger · idx (customer_id, join_date, exit_date) |
| **alias** | layer (source/role/status/level/date/ctc), raw_label, canonical_value, status · uniq(layer,raw_label) |
| **decision** | customer_id, **topic** (`map:source:GDC`), choice, evidence, risk_if_wrong · **uniq(customer_id, topic)** — answer once → auto-applies to all rows + future runs |

### 5 · Runs & facts
| Table | Key columns · notes |
|---|---|
| **run** | customer_id, run_no, invoice_month, status (running/complete/failed/released), **manifest** (jsonb = whole computed run incl. compiled_rule_book, lines, by_head) · **uniq(customer_id, run_no)** |
| **run_step** | run_id, step_name (intake/normalize/map/calc_ta/calc_oss/assure/statement), pipeline_id, ai_model, counts |
| **ta_calc** | run_id, placement_id, invoice_month, ta_pct, gross_ta_fee, sourcing/acceptance/balance_billed, **invoice_value** (+ ccy/base/fx), clause_ref, explain |
| **oss_calc** | run_id, invoice_month, opening_hc, new_joiners, exits, **closing_active_hc**, slab_id, fee_type, rate, oss_amount (+ base/fx), clause_ref |
| **statement** | run_id, customer_id, invoice_month, total_oss, total_ta, **grand_total**, xlsx_path |
| **trace** | run_id, object_type, object_id, value_num/ccy/base, **why**, clause_ref, **calc_steps** (jsonb), **source_ref** (jsonb: doc/md/sheet/row), fx_rate_id, confidence, model — one per number |
| **discrepancy** | dtype, placement_id, expected vs actual, delta_value/pct, status (open/explained/fixed/accepted_risk) |
| **exception_item** | run_id, ext_id, **issue**, detail, severity (block/warn), status — quarantine |
| **credit_note** | placement_id, reason (clawback/correction/retro_rate/replacement), amount (+ base/fx), applies_to_month |

> Generic engine note: non-TA/OSS cost heads (flat, per_unit, …) currently live in `run.manifest.lines` / `by_head`; `ta_calc`/`oss_calc` persist only those two kinds. Extend with a generic `line` table if a new product needs per-line SQL.

### 6 · Money · Portfolio · Platform
| Table | Key columns · notes |
|---|---|
| **fx_rate** | from_ccy, to_ccy, **rate**, effective_from/to, source (RBI/contract-fixed/spot/manual) · uniq(from_ccy,to_ccy,effective_from,source) |
| **forecast** | customer_id (null=portfolio), as_of_month, horizon_month, metric (ta/oss/credit/total), scenario, amount(+base) |
| **forecast_driver** | forecast_id, driver, contribution, basis, assumptions — explainable forecast |
| *view* **portfolio_billing** | rolls up `statement` of `complete` runs by month/currency |
| **app_config** | singleton (id=1) jsonb — AI-pipeline registry + AES-256-GCM-encrypted provider keys (secret from `CONFIG_SECRET` env, never in row) |
| **approval** | run_id, object_type, level (maker/checker), decision — immutable release |
| **audit_log** | at, actor, action, object_type, object_id, detail (jsonb) — append-only |

### 7b · Q-Legal (ring-fenced ql_* — db/init/022_qlegal.sql; see the `qlegal` skill)
| Table | Key columns · notes |
|---|---|
| **ql_document** | filename, title, doc_type, parties, status, **latest_version**, **facts** jsonb (C2 meta), tags, **parent_id** doc-tree + relation_kind/status, sp_item_id uniq |
| **ql_version** | document_id, version_no (uniq pair), sha256, storage_path (vault), c1_doc_id (docstore), **c1_text** (GIN FTS expr index), **c2** jsonb (meta·clauses·notice register), diff_summary, ocr, is_executed |
| **ql_obligation** | kind (expiry/renewal/termination_notice/deliverable/sla/notice), what, who_owes, **owner** (doer), due_date, lead_days, **ref** §, status proposed→confirmed→done |
| **ql_rule** | code uniq, title, body, **scope** (global/ingestion/search/obligations/drafting), status, version — editable business rules injected into qlegal-* pipelines |
| **ql_confirm** | kind (classification/link/lineage/fact), proposal jsonb, confidence, why, status — the one confirm queue |
| **ql_feedback** | append-only learning-loop events (replayed on rebuild) |
| **ql_log** | append-only AI activity (pipeline, model, **rules_applied**) |
| **ql_tag_vocab** | controlled tag vocabulary (auto/free) |
| **ql_embedding** | the vector spine (027): document_id, granularity (`document`/`section`/`clause`), **ref** §, content, **embedding vector(1536)** HNSW-cosine, **embedding_model** (`zai:embedding-3` / `hash:v1` fallback) — never knn across models; needs the pgvector extension (local: `pgvector/pgvector:pg15` image) |

### 7 · Atlas (cross-contract learning)
| Table | Key columns · notes |
|---|---|
| **archetype** | slug (uniq), name, **version**, fingerprint (jsonb centroid), rule_template, operators[], required_inputs, normalizers, playbook_md, **exception_patterns** (epidemiology), **embedding** (jsonb), **parent_id** (fork lineage), stats, status |
| **contract_fingerprint** | customer_id, archetype_id, signals, similarity, decision (matched/partial/novel/forked/preintake-confirmed), candidates, **embedding**, **drift** (jsonb) · **uniq(customer_id)** · idx(archetype_id) |
| **norm_federation** | scope (contract/archetype/global), scope_ref, layer, raw_label, **canonical**, votes, conflicts, status (proposed/promoted/conflicted) · uniq(scope,scope_ref,layer,raw_label) |

## FK spine
```
customer ─┬─ document ─┬─ doc_version
          │            └─ clause ─ interpretation
          ├─ ta_rate / milestone / oss_slab / cost_head / rule_version / rule   (terms)
          ├─ box ─┬─ box_chat
          │       └─ box_suggestion
          ├─ placement ─┐
          ├─ decision   │
          ├─ contract_fingerprint ─ archetype (self-ref parent_id; norm_federation keyed by code/slug, no FK)
          └─ run ─┬─ run_step ─ rule_application
                  ├─ ta_calc ─ placement
                  ├─ oss_calc ─ oss_slab
                  ├─ trace · exception_item · discrepancy · credit_note · statement · box · approval
fx_rate ← ta_calc / oss_calc / placement / trace / credit_note / forecast
```

## Recall paths (where a number lives)
- **A computed run** → `run.manifest` (jsonb, fastest) or join `ta_calc`/`oss_calc`/`statement` by `run_id`.
- **Why a number** → `trace` (value + why + clause + calc_steps + source_ref).
- **The rule applied** → `run.manifest.compiled_rule_book` or `rule_version.logic`.
- **The clause text** → `clause.body`; our reading → `interpretation`.
- **The source document** → `document.md_path` (T2, served) / `storage_path` (T1 vault).
- **Run history / versions** → `run` (one row per version, `run_no`).

## Common queries
```sql
-- latest run + totals for a client
select run_no, invoice_month, status, manifest->'totals' from run
 where customer_id=(select id from customer where code=$1) order by run_no desc limit 1;

-- by-cost-head breakdown of a run (generic)
select manifest->'by_head' from run where customer_id=(select id from customer where code=$1) and run_no=$2;

-- every traced number for a run
select object_type, value_num, value_ccy, why, clause_ref from trace where run_id=$1;

-- a client's confirmed label decisions (auto-applied each run)
select topic, choice from decision where customer_id=(select id from customer where code=$1);

-- date range present in the ledger (calibrates the invoice-month picker)
select raw from placement where customer_id=(select id from customer where code=$1);
```

## Adding to the schema
1. New file `db/init/0NN_*.sql`, **idempotent** (`create table if not exists`, `alter table … add column if not exists`). It auto-applies on next boot.
2. Keep the money rule (native + base + fx) and `customer_id` scoping.
3. Add a covering index for any hot lookup.
4. Never store secrets in a row (use `CONFIG_SECRET`-encrypted, like `app_config`).
5. Update [docs/04-schema.md](../../docs/04-schema.md) + this skill.
