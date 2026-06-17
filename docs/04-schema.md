# 4 · Schema — full Postgres reference

[← Atlas](03-atlas.md) · [Wiki home](README.md) · Next: [Flows →](05-flows.md)

---

**38 tables + 1 view.** Defined in `db/init/001..011_*.sql`, applied idempotently on boot by `server/migrate.js`. Money rule everywhere: store **native (amount, ccy) AND base (amount in billing ccy) + the FX used** — no bare numbers.

> Generate exact DDL anytime: `pg_dump --schema-only "$DATABASE_URL"`.

---

## Migration files
| File | Adds |
|---|---|
| `001_qansr_core.sql` | masters, docs, contract terms, ledger, runs, calc facts, discrepancies, exceptions, alias, rules, decisions, audit |
| `002_qansr_framework.sql` | FX + currency columns, boxes, cost_head, rule_version, credit_note, approval, trace |
| `003_qansr_dates.sql` | date normalization columns (raw + format + flags + tz) |
| `004_qansr_aggregator.sql` | forecast, forecast_driver, portfolio_billing view |
| `005_qansr_rulebook.sql` | billing_rules box type, formula_test (trust gate) |
| `006_qansr_box_interactive.sql` | box_suggestion |
| `007_app_config.sql` | app_config (AI pipeline registry + encrypted keys) |
| `008_qansr_clauses.sql` | clause, interpretation (RAG-of-rules) |
| `009_qansr_engine.sql` | placement.raw + indexes (clarification re-normalize) |
| `010_atlas.sql` | archetype, contract_fingerprint, norm_federation |
| `011_atlas_semantic.sql` | embedding + parent_id + drift columns |

---

## 1. Masters & documents (provenance spine)
| Table | Key columns |
|---|---|
| **customer** | code, name, currency, **billing_ccy**, **contract_ccy**, **tz** (`Asia/Kolkata`) |
| **document** | customer_id, doc_type, sha256, **storage_path** (T1), **md_path** (T2), date_format, date_locale, meta |
| **doc_version** | document_id, version_no, parent_version_id, transform (`extract`/`normalized`/`corrected`), diff_vs_parent |
| **clause** | customer_id, document_id, **ref** (`§3.1`), title, body, ord, md_path — *MD chunked by clause* |
| **interpretation** | customer_id, clause_ref, **reading**, **compiles_to** (jsonb), scope (`run`/`contract`/`mint`), status — *learning memory* |

## 2. Contract terms — the compiled rule book
| Table | Key columns |
|---|---|
| **ta_rate** | gcc_band_min/max, level, referral, tech, **ta_pct**, clause_ref |
| **milestone** | code (`sourcing`/`acceptance`/`balance`), trigger_event, amount_tech, amount_nontech, is_balance, ccy |
| **oss_slab** | hc_min/max, fee_type (`minimum`/`per_resource`), **rate**, ccy |
| **cost_head** | code, label, **kind** (`milestone`/`recurring`/`one_off`/`clawback`/`credit`/`tax`), calc_logic (jsonb), source_box_id |
| **rule_version** | rule_code, version_no, **effective_from/to**, **logic** (jsonb = compiled rule book), why, clause_ref, status — *bill for month M uses the version live for M* |
| **rule** | code, rule_type, logic (jsonb), **why** (mandatory), created_from_discrepancy_id, status |
| **rule_application** | rule_id, run_step_id, before_json → after_json |
| **formula_test** | rule_code, scenario, inputs, **expected**, actual, status (`pass`/`fail`) — *the trust gate* |

## 3. Doc-intelligence boxes
| Table | Key columns |
|---|---|
| **box_type** | code, label, dynamic (AI may add types), schema_hint |
| **box** | customer_id, run_id, document_id, box_type_code, **content** (jsonb), ai_explain, confidence, clause_ref, status, version |
| **box_chat** | box_id, role (`user`/`assistant`), message |
| **box_suggestion** | box_id, kind (`ai_suggestion`/`user_amendment`/`clarification`), before_json → after_json, rationale, status |

## 4. Data ledger
| Table | Key columns |
|---|---|
| **placement** | customer_id, ext_id, **raw** (jsonb verbatim), normalized identity (role_level, tech, referral, status), dates (sourcing/offer/join/exit + `_raw` + date_flags), comp (fixed/variable/total_ctc + ctc_ccy + base + fx_rate_id), gross/sourcing/acceptance/balance fee, calc_status. `unique(customer_id, ext_id)` — *cumulative ledger* |
| **alias** | layer (`source`/`role`/`status`/`level`/`date`/`ctc`), raw_label, canonical_value, status. `unique(layer, raw_label)` |
| **decision** | customer_id, **topic** (`map:source:GDC`), choice, evidence, risk_if_wrong. `unique(customer_id, topic)` — *answer once → auto-apply* |

## 5. Runs & facts
| Table | Key columns |
|---|---|
| **run** | customer_id, run_no, invoice_month, status (`running`/`complete`/`failed`), **manifest** (jsonb). `unique(customer_id, run_no)` |
| **run_step** | run_id, step_name (`intake`/`normalize`/`map`/`calc_ta`/`calc_oss`/`assure`/`statement`), pipeline_id, ai_model, counts |
| **ta_calc** | run_id, placement_id, invoice_month, ta_pct, gross_ta_fee, sourcing/acceptance/balance_billed, **invoice_value** (+ base + fx), clause_ref, explain |
| **oss_calc** | run_id, invoice_month, opening_hc, new_joiners, exits, **closing_active_hc**, slab_id, fee_type, rate, oss_amount (+ base + fx), clause_ref |
| **statement** | run_id, invoice_month, total_oss, total_ta, **grand_total**, xlsx_path |
| **trace** | run_id, object_type, object_id, value_num/ccy/base, **why**, clause_ref, **calc_steps** (jsonb), **source_ref** (jsonb: doc/md/sheet/row), fx_rate_id, confidence, model — *one per number* |
| **discrepancy** | dtype, placement_id, expected vs actual, delta_value/pct, status (`open`/`explained`/`fixed`/`accepted_risk`) |
| **exception_item** | run_id, ext_id, **issue**, detail, severity (`block`/`warn`), status — *quarantine* |
| **credit_note** | placement_id, reason (`clawback`/`correction`/`retro_rate`/`replacement`), amount (+ base + fx), applies_to_month |

## 6. Money · Portfolio · Platform
| Table | Key columns |
|---|---|
| **fx_rate** | from_ccy, to_ccy, **rate**, effective_from/to, source (`RBI`/`contract-fixed`/`spot`/`manual`). `unique(from_ccy,to_ccy,effective_from,source)` |
| **forecast** | customer_id (null = portfolio), as_of_month, horizon_month, metric (`ta`/`oss`/`credit`/`total`), scenario, amount (+ base) |
| **forecast_driver** | forecast_id, driver, contribution, basis, assumptions — *explainable forecast* |
| *view* **portfolio_billing** | rolls up `statement` of `complete` runs by month/currency |
| **app_config** | singleton jsonb row — AI-pipeline registry + AES-encrypted provider keys (`id=1`) |
| **approval** | run_id, object_type, level (`maker`/`checker`), decision — *immutable release* |
| **audit_log** | at, actor, action, object_type, object_id, detail (jsonb) — *append-only* |

## 7. Atlas — the learning brain
| Table | Key columns |
|---|---|
| **archetype** | slug, name, **version**, **fingerprint** (centroid jsonb), **rule_template**, operators, required_inputs, normalizers, **playbook_md**, **exception_patterns** (epidemiology jsonb), **embedding** (jsonb), **parent_id** (fork lineage), stats, status |
| **contract_fingerprint** | customer_id, archetype_id, signals, similarity, decision (`matched`/`partial`/`novel`/`forked`/`preintake-confirmed`), candidates, **embedding**, **drift** (jsonb). `unique(customer_id)` |
| **norm_federation** | scope (`contract`/`archetype`/`global`), scope_ref, layer, raw_label, **canonical**, votes, conflicts, status (`proposed`/`promoted`/`conflicted`). `unique(scope, scope_ref, layer, raw_label)` |

---

## The FK spine
```
customer ─┬─ document ─┬─ doc_version
          │            └─ clause ─ interpretation
          ├─ ta_rate / milestone / oss_slab / cost_head / rule_version   (terms)
          ├─ box ─┬─ box_chat
          │       └─ box_suggestion
          ├─ placement
          ├─ decision
          ├─ contract_fingerprint ─ archetype   (Atlas; norm_federation keyed by archetype slug)
          └─ run ─┬─ run_step
                  ├─ ta_calc ─ placement
                  ├─ oss_calc ─ oss_slab
                  ├─ trace            (one per number)
                  ├─ exception_item
                  ├─ credit_note
                  └─ statement
fx_rate ← referenced by ta_calc / oss_calc / placement / trace / credit_note / forecast
```
