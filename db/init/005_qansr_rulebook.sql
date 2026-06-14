-- ============================================================================
-- Q&ANSR rule-book layer. Input changed: the user provides ONLY the EMP list
-- (employee facts — dates, role, source, CTC). Q&ANSR DERIVES the calculations,
-- formulas and rule book from the contract analysis (Phase A). There is no
-- pre-built workbook to reconcile against — Q&ANSR IS the source of truth.
--
-- Trust (replaces workbook reconciliation):
--   1. clause refs + replay trace on every number
--   2. AI-generated worked examples from the SOW that the engine MUST reproduce
--   3. confidence heatmap + human approval of the rule-book box
-- ============================================================================

-- the central Phase-A box: the derived executable billing logic. Reviewed,
-- chatted, approved → compiles to ta_rate / milestone / oss_slab / cost_head /
-- rule_version. (box.box_type_code = 'billing_rules')
insert into box_type(code,label) values
  ('billing_rules','Rule book & formulas')
on conflict (code) do nothing;

-- worked examples: the engine's correctness test. Pulled from SOW examples or
-- AI-generated from the rule book; the calc engine must match `expected`.
-- This is the trust anchor in the absence of a customer workbook.
create table if not exists formula_test (
  id            serial primary key,
  customer_id   int references customer(id),
  rule_code     text,                          -- 'ta_rate' | 'oss_slab' | 'milestone' | 'ctc'
  scenario      text,                          -- human label: 'referral director, band 3'
  inputs        jsonb not null,                -- {level, referral, tech, gcc_band, ctc, ccy, dates...}
  expected      numeric(14,2), expected_ccy text,
  expected_basis text,                          -- where the expected value came from (SOW example / AI)
  actual        numeric(14,2),                  -- engine output on last run
  status        text default 'pending',         -- pending | pass | fail
  clause_ref    text, source_box_id int references box(id),
  created_by    text default 'ai', created_at timestamptz default now()
);
