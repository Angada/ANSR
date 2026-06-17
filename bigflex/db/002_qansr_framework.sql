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
