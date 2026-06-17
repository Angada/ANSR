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
-- ============================================================================
-- Q&ANSR framework layer — the reusable doc-intelligence spine + currency,
-- cost heads, rule versioning, clawback/credit, approvals, explainable trace.
-- Built on 001_qansr_core.sql. Applies to op #1 (Invoice Studio) and the ~20
-- future operations: any doc → dynamic typed boxes → explain/chat → approve →
-- propagate to tables/md/memory.
-- ============================================================================

-- ---------- currency awareness ----------------------------------------------
-- Money rule: store native (amount, ccy) AND base (amount in billing ccy) +
-- the fx used. Conversion is always a visible trace step. No bare numbers.
create table if not exists fx_rate (
  id            serial primary key,
  from_ccy      text not null, to_ccy text not null,
  rate          numeric(18,8) not null,          -- 1 from_ccy = rate to_ccy
  effective_from date not null, effective_to date,
  source        text,                            -- 'RBI' | 'contract-fixed' | 'spot' | 'manual'
  created_at    timestamptz default now(),
  unique(from_ccy, to_ccy, effective_from, source)
);

-- customer billing currency + the contract's own term currency (may differ).
alter table customer add column if not exists billing_ccy text default 'USD';
alter table customer add column if not exists contract_ccy text default 'USD';

-- term currencies (contract side)
alter table milestone add column if not exists ccy text;     -- advance amounts' currency
alter table oss_slab  add column if not exists ccy text;      -- slab rate currency

-- placement comp native currency + base conversion
alter table placement add column if not exists ctc_ccy text;          -- wage native ccy (often INR)
alter table placement add column if not exists total_ctc_base numeric(14,2);
alter table placement add column if not exists base_ccy text;         -- billing ccy
alter table placement add column if not exists fx_rate_id int references fx_rate(id);

-- calc lines carry native + base + the fx applied
alter table ta_calc  add column if not exists ccy text;
alter table ta_calc  add column if not exists base_ccy text;
alter table ta_calc  add column if not exists fx_rate_id int references fx_rate(id);
alter table ta_calc  add column if not exists invoice_value_base numeric(14,2);
alter table oss_calc add column if not exists ccy text;
alter table oss_calc add column if not exists base_ccy text;
alter table oss_calc add column if not exists fx_rate_id int references fx_rate(id);
alter table oss_calc add column if not exists oss_amount_base numeric(14,2);

-- ---------- dynamic typed boxes (the doc-intelligence core) ------------------
create table if not exists box_type (
  id            serial primary key,
  code          text unique not null,            -- company|legal|payment_terms|commercial_terms|caveats|flags|...
  label         text, dynamic boolean default true, -- AI may propose new types
  schema_hint   jsonb,                            -- optional field hints for extraction
  created_by    text default 'ai'
);

create table if not exists box (
  id            serial primary key,
  customer_id   int references customer(id),
  run_id        int references run(id),           -- understanding is run-versioned
  document_id   int references document(id),
  box_type_code text references box_type(code),
  title         text,
  content       jsonb,                            -- structured extraction
  ai_explain    text,                             -- plain-English explanation
  confidence    numeric(4,3),
  clause_ref    text,                             -- SOW section backing this box
  status        text default 'draft',             -- draft|approved|rejected
  version       int default 1,
  approved_by   text, approved_at timestamptz,
  created_at    timestamptz default now()
);

create table if not exists box_chat (
  id            serial primary key,
  box_id        int references box(id),
  role          text,                             -- user|assistant
  message       text, at timestamptz default now()
);

-- ---------- cost-head framework (what the bill is made of) -------------------
create table if not exists cost_head (
  id            serial primary key,
  customer_id   int references customer(id),
  code          text,                             -- ta_sourcing|ta_acceptance|ta_balance|oss|advance|phase|clawback|credit
  label         text,
  kind          text,                             -- advance|phase|milestone|recurring|one_off|clawback|credit|tax
  ccy           text,
  calc_logic    jsonb,                            -- executable {trigger, formula, dims}
  clause_ref    text,
  source_box_id int references box(id),
  unique(customer_id, code)
);

-- ---------- rule versioning (terms change mid-contract) ----------------------
-- A term/rule has versions with effective dates; the bill for month M uses the
-- version live for M (ESPL min-wage-version pattern). Amendment = new version.
create table if not exists rule_version (
  id              serial primary key,
  customer_id     int references customer(id),
  rule_code       text not null,                  -- 'ta_rate' | 'oss_slab' | 'milestone' | custom
  version_no      int not null,
  effective_from  date not null, effective_to date,
  logic           jsonb not null, ccy text,
  why             text, clause_ref text,
  source_box_id   int references box(id),
  status          text default 'proposed',        -- proposed|approved|active|retired
  approved_by     text, approved_at timestamptz,
  unique(customer_id, rule_code, version_no)
);

-- ---------- clawback / credit notes -----------------------------------------
create table if not exists credit_note (
  id            serial primary key,
  run_id        int references run(id),
  customer_id   int references customer(id),
  placement_id  int references placement(id),
  reason        text,                             -- clawback|correction|retro_rate|replacement
  amount        numeric(14,2), ccy text,
  amount_base   numeric(14,2), base_ccy text, fx_rate_id int references fx_rate(id),
  applies_to_month text, clause_ref text, explain text,
  status        text default 'open', created_at timestamptz default now()
);

-- ---------- approvals (maker-checker; immutable release) ---------------------
create table if not exists approval (
  id            serial primary key,
  run_id        int references run(id),
  object_type   text,                             -- box|run|rule_version|roster|credit_note
  object_id     int,
  level         text,                             -- maker|checker
  decision      text,                             -- approved|rejected|reopened
  decided_by    text, decided_at timestamptz default now(), reason text
);

-- ---------- explainable trace (first-class; on every box + number) ----------
create table if not exists trace (
  id            serial primary key,
  run_id        int references run(id),
  object_type   text,                             -- box|ta_calc|oss_calc|statement_line|credit_note
  object_id     int,
  value_num     numeric(18,4), value_ccy text, value_base numeric(18,4), base_ccy text,
  why           text,                             -- the rule applied, in words
  clause_ref    text,
  calc_steps    jsonb,                            -- ordered steps incl currency conversion
  source_ref    jsonb,                            -- {document_id, md_path, sheet, row}
  fx_rate_id    int references fx_rate(id),
  confidence    numeric(4,3), model text,
  created_at    timestamptz default now()
);

-- seed the starter box types (dynamic = AI may add more)
insert into box_type(code,label) values
  ('company','Company detail'),
  ('legal','Legal details'),
  ('payment_terms','Payment terms'),
  ('commercial_terms','Commercial terms'),
  ('caveats','Caveats'),
  ('flags','Flags')
on conflict (code) do nothing;
-- ============================================================================
-- Q&ANSR date/time normalization layer.
-- Excel dates are the messiest input: serial numbers, dd/mm vs mm/dd ambiguity,
-- text, blanks, #N/A. These dates DRIVE billing (milestone months + OSS month-end
-- active HC), so a misread = wrong invoice. Store raw + normalized + format +
-- flags; resolve locale ambiguity ONCE per source via a persisted decision.
-- ============================================================================

-- contract/business timezone — OSS month-end ("no pro-rata") is measured here so
-- a join/exit on a boundary day lands in the correct billing month.
alter table customer add column if not exists tz text default 'Asia/Kolkata';

-- per-document detected date format + locale (the resolved ambiguity).
alter table document add column if not exists date_format text;   -- 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'EXCEL_SERIAL' | 'ISO' | 'mixed'
alter table document add column if not exists date_locale text;    -- 'IN' | 'US' | ...

-- placement: keep the raw verbatim alongside the normalized date + flags.
alter table placement add column if not exists sourcing_date_raw text;
alter table placement add column if not exists offer_date_raw    text;
alter table placement add column if not exists join_date_raw      text;
alter table placement add column if not exists exit_date_raw      text;
alter table placement add column if not exists date_format        text;  -- format applied to this row
alter table placement add column if not exists date_flags         jsonb; -- ['join_ambiguous','exit_missing','sourcing_unparseable']

-- date-format resolution is persisted like any other normalization decision:
-- decision.topic = 'date_format:<doc_id or customer>' , choice = 'DD/MM/YYYY' ...
-- unparseable / ambiguous-and-unresolved values raise an exception_item:
--   issue ∈ missing_join_date | unparseable_date | ambiguous_date
-- so they surface for natural-language fix before the run is processed.
-- ============================================================================
-- Q&ANSR Contract Aggregator — portfolio billing + explainable forecast.
-- Actuals = released runs rolled up across all customers (FX-normalized to base).
-- Forecast = driver-based projection; every forecast line keeps its REASONS
-- (forecast_driver) so the number is explainable, like the invoice trace.
-- ============================================================================

create table if not exists forecast (
  id            serial primary key,
  customer_id   int references customer(id),   -- null = portfolio-wide
  as_of_month   text not null,                 -- when the forecast was made 'YYYY-MM'
  horizon_month text not null,                 -- the month being projected
  metric        text not null,                 -- ta | oss | credit | total
  scenario      text default 'base',           -- base | best | worst
  amount        numeric(14,2), ccy text,
  amount_base   numeric(14,2), base_ccy text, fx_rate_id int references fx_rate(id),
  confidence    numeric(4,3),
  created_at    timestamptz default now(),
  unique(customer_id, as_of_month, horizon_month, metric, scenario)
);

-- the "reason for forecast" — each driver's contribution to a forecast line.
create table if not exists forecast_driver (
  id            serial primary key,
  forecast_id   int references forecast(id),
  driver        text not null,                 -- pipeline_acceptance|pipeline_balance|oss_runrate|
                                               -- milestone|rate_change|churn_clawback|seasonality|manual
  contribution  numeric(14,2),                 -- amount this driver adds (base ccy)
  basis         text,                          -- "11 candidates in offer × 0.8 conv × avg $X"
  assumptions   jsonb,                          -- {conv_rate, avg_ctc, hc_growth, ...}
  source_ref    jsonb                           -- placements / runs / rule_versions used
);

-- portfolio actuals roll-up (released runs across all customers).
create or replace view portfolio_billing as
  select s.invoice_month, s.currency,
         sum(s.total_oss)   as total_oss,
         sum(s.total_ta)    as total_ta,
         sum(s.grand_total) as grand_total,
         count(distinct s.customer_id) as customers
  from statement s
  join run r on r.id = s.run_id and r.status = 'complete'
  group by s.invoice_month, s.currency;
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
-- ============================================================================
-- Q&ANSR interactive boxes — esp. the "Rule book & formulas" box.
-- Each box supports: AI explain (box.ai_explain) + clarification chat
-- (box_chat) + AI suggestions + user amendments (box_suggestion below).
-- Accepting a suggestion bumps box.version, updates the compiled rule_version,
-- and writes audit_log — so the rule book is co-authored (AI + human) with a trail.
-- ============================================================================

create table if not exists box_suggestion (
  id            serial primary key,
  box_id        int references box(id),
  kind          text not null,                 -- ai_suggestion | user_amendment | clarification
  proposed_by   text not null,                 -- ai | user
  summary       text,                          -- "Tighten CTC: exclude joining bonus per §2.4"
  before_json   jsonb, after_json jsonb,        -- the proposed change to box.content / rule
  rationale     text, clause_ref text, confidence numeric(4,3),
  status        text default 'open',            -- open | accepted | rejected | applied
  decided_by    text, decided_at timestamptz,
  created_at    timestamptz default now()
);

create index if not exists box_suggestion_box on box_suggestion(box_id, status);
-- ============================================================================
-- Q&ANSR — app config persistence.
-- The AI-pipeline registry + provider keys (AES-256-GCM encrypted at rest) live
-- here as a single JSONB row so they survive ephemeral compute (Cloud Run).
-- Dev with no DB falls back to data/config.json; prod owns this row.
-- The encryption secret is NEVER stored here — it comes from CONFIG_SECRET (env
-- / Secret Manager). This row holds only ciphertext.
-- ============================================================================
create table if not exists app_config (
  id          int primary key default 1,
  data        jsonb not null,
  updated_at  timestamptz default now(),
  constraint app_config_singleton check (id = 1)
);
-- ============================================================================
-- Q&ANSR clause store + interpretation memory.
-- The contract MD is the working source of truth, CHUNKED BY CLAUSE (stable §
-- refs). Every rule/answer cites a clause. `interpretation` is the learning
-- memory — how we read each clause + the formula it compiles to; corrections
-- upsert here and ground every future query (RAG-of-rules). PDF stays in the
-- vault as legal authority (document.storage_path).
-- ============================================================================

create table if not exists clause (
  id            serial primary key,
  customer_id   int references customer(id),
  document_id   int references document(id),
  ref           text not null,                 -- '§3.1'
  title         text,
  body          text,                          -- the clause markdown (verbatim)
  ord           int,                           -- order in the document
  md_path       text,                          -- T2 source
  version       int default 1,
  created_at    timestamptz default now(),
  unique(customer_id, ref, version)
);
create index if not exists clause_cust on clause(customer_id, ord);

create table if not exists interpretation (
  id            serial primary key,
  customer_id   int references customer(id),
  clause_ref    text not null,                 -- the clause this reads
  reading       text not null,                 -- our plain-English understanding
  compiles_to   jsonb,                         -- the rule/formula it produces
  confidence    numeric(4,3),
  scope         text default 'contract',       -- run | contract | mint (promotion ladder)
  status        text default 'proposed',       -- proposed | confirmed | promoted
  source        text default 'ai',             -- ai | user
  run_id        int,
  created_by    text, created_at timestamptz default now(), updated_at timestamptz default now(),
  unique(customer_id, clause_ref)              -- latest current reading; history via audit_log
);
create index if not exists interp_cust on interpretation(customer_id);
-- Calc-engine support. placement keeps the RAW mapped row so a run can
-- re-normalize with the latest decisions (the clarification loop) deterministically.
alter table placement add column if not exists raw jsonb;
alter table placement add column if not exists invoice_month text;
create index if not exists placement_cust on placement(customer_id);
create index if not exists placement_dates on placement(customer_id, join_date, exit_date);

-- compiled rule book lives in rule_version.logic (already exists). Ensure a fast lookup.
create index if not exists rule_version_cust on rule_version(customer_id, rule_code, version_no);

-- decisions already exist (customer_id, topic unique). clarifications are derived
-- at compute time from normalize() + compute exceptions; resolved → decision row.
