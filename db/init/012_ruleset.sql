-- ============================================================================
-- BigFlex Contract Compiler — the canonical, N-dimensional rule set built and
-- validated BEFORE a worksheet arrives. A rule set declares its DIMENSIONS
-- (subset of the fixed worksheet columns), its cost HEADS, and a SPARSE rate
-- matrix (rate_cell, wildcards allowed). Coverage is checked logically against
-- the declared dimension domains — never by materialising the cross-product.
-- Soft gate: a worksheet may compute on a partial rule set; uncovered combos
-- surface as rate_gap exceptions, with coverage% always visible.
-- ============================================================================

create table if not exists rule_set (
  id             serial primary key,
  customer_id    int references customer(id),
  version_no     int not null,
  status         text default 'draft',          -- draft | structured | validated | locked | superseded
  base_currency  text default 'USD',
  source_doc_id  text,
  compiled       jsonb,                          -- the executable rule book the engine runs
  coverage_pct   numeric(5,2),                   -- 0..100 (last validation)
  validated_at   timestamptz, locked_at timestamptz,
  effective_from date, effective_to date,
  created_by     text default 'compiler', created_at timestamptz default now(), updated_at timestamptz default now(),
  unique(customer_id, version_no)
);
create index if not exists rule_set_cust on rule_set(customer_id, status);

-- a dimension this contract bills on (must map to a fixed worksheet column)
create table if not exists rule_dimension (
  id             serial primary key,
  rule_set_id    int references rule_set(id) on delete cascade,
  name           text not null,                  -- level | referral | tech | band | location | department
  source_column  text,                           -- the fixed worksheet column it reads
  type           text default 'enum',            -- enum | bool | range
  allowed_values jsonb,                           -- the domain, e.g. ["non_leadership","manager","director"] or ["≤50","51–250"]
  required       boolean default true,
  unique(rule_set_id, name)
);

-- a cost head (what gets billed) within a rule set
create table if not exists rule_head (
  id             serial primary key,
  rule_set_id    int references rule_set(id) on delete cascade,
  code           text not null,                  -- ta | oss | recruitment | managed_ops | onboarding | ...
  label          text,
  kind           text not null,                  -- recurring_slab | one_time_split | per_unit | flat | clawback | credit | tiered
  measure        text, base text,
  dimensions     text[],                          -- which rule_dimension names this head's rates key on
  slabs          jsonb, schedule jsonb,           -- slab table / milestone phases
  rate_field     text default 'pct',             -- 'pct' or 'amount'
  clause_ref     text, ord int default 0,
  unique(rule_set_id, code)
);

-- the SPARSE rate matrix — only authored combinations (wildcards allowed)
create table if not exists rate_cell (
  id             serial primary key,
  rule_set_id    int references rule_set(id) on delete cascade,
  head_code      text not null,
  dims           jsonb not null,                  -- {level:"manager",referral:false,tech:true}  ("*" = wildcard)
  pct            numeric(8,4), amount numeric(14,2),
  fee_type       text,                            -- minimum | per_resource (for slab-ish cells)
  clause_ref     text
);
create index if not exists rate_cell_set on rate_cell(rule_set_id, head_code);

-- a validation snapshot (readiness): coverage + gaps + conflicts + worked examples
create table if not exists rule_validation (
  id             serial primary key,
  rule_set_id    int references rule_set(id) on delete cascade,
  run_at         timestamptz default now(),
  coverage_pct   numeric(5,2),
  status         text,                            -- red | amber | green
  gaps           jsonb,                            -- [{head, combo}] uncovered
  conflicts      jsonb,                            -- [{head, combo, rows}] overlapping
  examples       jsonb                             -- [{scenario, expected, actual, pass}]
);
create index if not exists rule_validation_set on rule_validation(rule_set_id);

-- pre-worksheet clarifications (feed the recalibrate loop while building the rules)
create table if not exists rule_clarification (
  id             serial primary key,
  rule_set_id    int references rule_set(id) on delete cascade,
  topic          text not null, question text, options jsonb,
  answer         text, status text default 'open',
  created_at     timestamptz default now(),
  unique(rule_set_id, topic)
);

-- Atlas archetype: carry the dimension + schedule shape for pre-fill
alter table archetype add column if not exists dimensions jsonb;
alter table archetype add column if not exists schedule_template jsonb;
