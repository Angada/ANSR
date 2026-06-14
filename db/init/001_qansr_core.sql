-- ============================================================================
-- Q&ANSR — core datastore (Postgres).
-- Contract-aware AR engine: SOW clauses + employee lifecycle → deterministic
-- TA/OSS calc → Statement of Invoicing, every line clause- and calc-backed.
-- Audit spine adapted from the ESPL recon engine (runs / facts / discrepancies /
-- rules-with-why / alias mapping / financial impact).
-- One RUN = one monthly invoice computation for one customer.
-- ============================================================================

-- ---------- masters ---------------------------------------------------------
create table if not exists customer (
  id            serial primary key,
  code          text unique not null,          -- 'ANSR-KENVUE'
  name          text,                          -- 'Kenvue'
  currency      text default 'USD',            -- billing currency (INR/USD)
  created_at    timestamptz default now()
);

-- ---------- documents & versions (hybrid knowledge store provenance) --------
-- T1 originals live in a vault (storage_path); T2 md extracts in /docstore;
-- T3 = the facts in the tables below. doc x api switch serves the .md extract.
create table if not exists document (
  id            serial primary key,
  customer_id   int references customer(id),
  doc_type      text not null,                 -- sow | emp_list | rules | calc_inr | calc_usd | po | other
  filename      text, sha256 text,
  storage_path  text,                          -- T1 original (authority)
  md_path       text,                          -- T2 markdown extract (/docstore/<cust>/<docid>.md)
  uploaded_at   timestamptz default now(),
  meta          jsonb
);

create table if not exists doc_version (
  id                serial primary key,
  document_id       int references document(id),
  version_no        int not null,              -- 0 = raw extract
  parent_version_id int references doc_version(id),
  transform         text,                      -- 'extract' | 'normalized' | 'corrected'
  created_in_run_id int,
  created_by        text,                      -- 'ai' | user
  row_count         int, storage_path text,
  diff_vs_parent    jsonb,
  unique(document_id, version_no)
);

-- ---------- contract terms (clauses as structured billable rules) -----------
-- TA fee table: rate by GCC headcount band × level × referral × tech flag.
create table if not exists ta_rate (
  id            serial primary key,
  customer_id   int references customer(id),
  gcc_band_min  int, gcc_band_max int,         -- active GCC headcount band
  level         text,                          -- non_leadership | manager | director | vp_site_leader
  referral      boolean,                       -- referral vs non-referral
  tech          boolean,                       -- tech vs non-tech (null = either)
  ta_pct        numeric(6,3) not null,         -- % of total CTC
  clause_ref    text,                          -- SOW section that defines it
  source_doc_id int references document(id)
);

-- Payment milestone split (Col C / D / E in the workbook).
create table if not exists milestone (
  id            serial primary key,
  customer_id   int references customer(id),
  code          text,                          -- sourcing | acceptance | balance
  trigger_event text,                          -- sourcing_date | offer_date | join_date+1m
  workbook_col  text,                          -- 'C' | 'D' | 'E'
  amount_tech   numeric(14,2),                 -- fixed advance (tech)
  amount_nontech numeric(14,2),               -- fixed advance (non-tech); balance uses remainder
  is_balance    boolean default false,
  clause_ref    text
);

-- OSS monthly slab by active GCC headcount (no pro-rata).
create table if not exists oss_slab (
  id            serial primary key,
  customer_id   int references customer(id),
  hc_min        int, hc_max int,               -- active headcount band
  fee_type      text,                          -- minimum | per_resource
  rate          numeric(14,2) not null,        -- minimum monthly fee OR per-resource rate
  clause_ref    text
);

-- ---------- employee placed-lifecycle ledger (one row per placement) --------
create table if not exists placement (
  id              serial primary key,
  customer_id     int references customer(id),
  run_id          int,                          -- run that produced/refreshed this row
  ext_id          text,                         -- employee id from EMP LIST
  name            text,
  -- identity / classification (normalized)
  role_raw        text, role_level text,        -- non_leadership|manager|director|vp_site_leader
  tech            boolean,                       -- tech / non-tech
  source_raw      text, referral boolean,        -- normalized from messy source labels
  -- lifecycle dates
  sourcing_date   date, offer_date date, join_date date, exit_date date,
  status_raw      text, status text,             -- active|exited|offer|dropped (normalized)
  -- compensation
  fixed_ctc       numeric(14,2), variable_ctc numeric(14,2),
  total_ctc       numeric(14,2),                 -- fixed + target variable (excl LTI/stock/joining/retention)
  -- contract mapping
  gcc_band_min    int, gcc_band_max int,
  ta_rate_id      int references ta_rate(id), ta_pct numeric(6,3),
  clause_ref      text,
  -- invoice triggers (months)
  sourcing_month  text, acceptance_month text, balance_month text,  -- 'YYYY-MM'
  -- fee outputs
  gross_ta_fee    numeric(14,2),
  sourcing_fee    numeric(14,2), acceptance_fee numeric(14,2), balance_fee numeric(14,2),
  oss_eligible    boolean,
  -- audit
  source_row      int, calc_status text,         -- ok|flagged|blocked
  exceptions      jsonb, notes text,
  unique(customer_id, ext_id)
);

-- ---------- runs (one monthly invoice computation) --------------------------
create table if not exists run (
  id            serial primary key,
  customer_id   int references customer(id),
  run_no        int not null,
  invoice_month text,                            -- 'YYYY-MM' being billed
  currency      text,
  label         text, status text default 'running', -- running|complete|failed
  started_at    timestamptz default now(), finished_at timestamptz,
  manifest      jsonb,                           -- versions/models/gates used
  unique(customer_id, run_no)
);

create table if not exists run_step (
  id            serial primary key,
  run_id        int references run(id),
  step_no       int, step_name text,             -- intake|normalize|map|calc_ta|calc_oss|assure|statement
  pipeline_id   text, status text,               -- passed|passed_with_flags|exceptions|blocked
  ai_model      text, counts jsonb,
  started_at    timestamptz default now(), finished_at timestamptz
);

-- ---------- calc facts (the reproduced engine output) -----------------------
-- TA line per placement per invoice month (the TA bridge).
create table if not exists ta_calc (
  id              serial primary key,
  run_id          int references run(id),
  placement_id    int references placement(id),
  invoice_month   text,
  referral        boolean, tech boolean, level text,
  gcc_band_min int, gcc_band_max int,
  total_ctc       numeric(14,2), ta_pct numeric(6,3),
  gross_ta_fee    numeric(14,2),
  sourcing_billed numeric(14,2), acceptance_billed numeric(14,2), balance_billed numeric(14,2),
  invoice_value   numeric(14,2),                 -- amount billed THIS month
  clause_ref      text, explain text
);

-- OSS line per invoice month (the headcount roll-forward).
create table if not exists oss_calc (
  id              serial primary key,
  run_id          int references run(id),
  invoice_month   text,
  opening_hc      int, new_joiners int, exits int, closing_active_hc int,
  slab_id         int references oss_slab(id),
  fee_type        text, rate numeric(14,2),
  oss_amount      numeric(14,2),
  clause_ref      text, explain text
);

-- ---------- statement of invoicing (generated output) -----------------------
create table if not exists statement (
  id            serial primary key,
  run_id        int references run(id),
  customer_id   int, invoice_month text, currency text,
  total_oss     numeric(14,2), total_ta numeric(14,2), grand_total numeric(14,2),
  generated_at  timestamptz default now(), xlsx_path text
);

-- ---------- variance (Excel workbook vs reproduced calc) --------------------
create table if not exists discrepancy (
  id            serial primary key,
  run_id        int references run(id),
  dtype         text not null,                   -- ta_variance|oss_variance|rate_mismatch|hc_mismatch|
                                                 -- missing_join|missing_ctc|missing_source|unknown_level|
                                                 -- exit_before_billing|duplicate|manual_override
  placement_id  int, invoice_month text,
  expected      text, actual text,               -- workbook value vs reproduced value
  delta_value   numeric(14,2), delta_pct numeric(8,3),
  status        text default 'open',             -- open|explained|fixed|accepted_risk
  resolution    text
);

-- ---------- exception sheet (rows that cannot be safely invoiced) -----------
create table if not exists exception_item (
  id            serial primary key,
  run_id        int references run(id),
  placement_id  int, ext_id text,
  issue         text not null,                   -- missing_join_date|missing_source|missing_ctc|
                                                 -- unknown_level|exit_before_billing|duplicate|manual_override
  detail        text, severity text default 'block', -- block|warn
  status        text default 'open', resolution text
);

-- ---------- normalization (mapping studio: source/role/status/level) --------
create table if not exists alias (
  id              serial primary key,
  layer           text not null,                 -- source|role|status|level|date|ctc
  raw_label       text not null,
  canonical_value text,                          -- e.g. 'referral' / 'manager' / 'active'
  confidence      numeric(4,3), suggested_by text, -- ai|human|exact
  ai_reasoning    text,
  status          text default 'suggested',      -- suggested|confirmed|rejected
  confirmed_by    text, first_seen_run_id int, confirmed_in_run_id int,
  unique(layer, raw_label)
);

-- ---------- rules created from discrepancies (with mandatory WHY) -----------
create table if not exists rule (
  id            serial primary key, code text unique,
  title         text, rule_type text,            -- mapping|calc|tolerance|routing|correction
  trigger_dtype text, logic jsonb not null,       -- executable {if,then}
  why           text not null,                    -- AI rationale citing evidence
  created_from_discrepancy_id int references discrepancy(id),
  created_by    text default 'ai',
  status        text default 'proposed',          -- proposed|approved|active|retired
  approved_by   text, approved_at timestamptz, version int default 1
);

create table if not exists rule_application (
  id            serial primary key,
  rule_id       int references rule(id), run_step_id int references run_step(id),
  before_json   jsonb, after_json jsonb, applied_at timestamptz default now()
);

-- ---------- AI clarification decisions (persist + auto-apply next run) -------
create table if not exists decision (
  id            serial primary key,
  customer_id   int references customer(id),
  topic         text not null,                   -- 'map:source:GDC' | 'level:Architect' ...
  question      text, options jsonb,
  choice        text, confidence_pct int,
  analysis      text, evidence jsonb, risk_if_wrong text,
  decided_by    text, decided_at timestamptz default now(),
  unique(customer_id, topic)
);

-- ---------- append-only audit log -------------------------------------------
create table if not exists audit_log (
  id            bigserial primary key,
  at            timestamptz default now(),
  actor         text, action text, object_type text, object_id text,
  detail        jsonb
);
