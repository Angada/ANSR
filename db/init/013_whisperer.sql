-- ============================================================================
-- Whisperer — demand↔supply content intelligence (new agent). Journey 1 first:
-- Talent500 candidates → ClientMind (chips) → Cohort → Hunger → Feed Stories.
-- Mock-first: real Talent500/YouTube/Reddit swap in behind the same tables.
-- Properties (demand_topic / one_up / emotional_framework / register) + business
-- rules live in settings; every AI step runs through a gated pipeline.
-- ============================================================================

-- ---- audience side ----------------------------------------------------------
create table if not exists wh_candidate (
  id          serial primary key,
  ext_id      text unique,                 -- Talent500 id (or mock)
  name        text,
  meta        jsonb default '{}'::jsonb,    -- role, domain, location, years_exp, tenure history…
  source      text default 'mock',          -- mock | talent500
  updated_at  timestamptz default now(),
  created_at  timestamptz default now()
);

create table if not exists wh_candidate_doc (
  id           serial primary key,
  candidate_id int references wh_candidate(id) on delete cascade,
  doc_type     text,                        -- cv | cover_letter | recommendation | profile | note
  filename     text, sha256 text,
  raw          text,                        -- extracted text (mock: seeded)
  md           text,                        -- markdown extract (T2)
  created_at   timestamptz default now()
);

-- ClientMind: one master profile MD + rich chips per candidate. Refresh weekly +
-- on any doc change (parse via the clientmind-parse pipeline; munshi method).
create table if not exists wh_client_mind (
  candidate_id int primary key references wh_candidate(id) on delete cascade,
  master_md    text,
  chips        jsonb default '[]'::jsonb,    -- [{kind, value, weight}] — queryable
  model        text,
  refreshed_at timestamptz default now()
);
create index if not exists wh_chip_gin on wh_client_mind using gin (chips);

-- ---- cohorts + demand -------------------------------------------------------
create table if not exists wh_cohort (
  id           serial primary key,
  name         text not null,
  filter_def   jsonb default '{}'::jsonb,    -- Talent500-style filters
  nl_query     text,                         -- "never stayed >2 years anywhere"
  member_ids   int[] default '{}',
  hunger_story jsonb,                         -- the Hunt Outcome (editable, saved)
  created_at   timestamptz default now()
);

-- properties (managed in settings) --------------------------------------------
create table if not exists wh_demand_topic (
  id         serial primary key,
  name       text not null,
  definition text,
  source     text default 'admin',           -- hunger | admin | seo
  active     boolean default true,
  created_at timestamptz default now(),
  unique(name)
);
create table if not exists wh_one_up (
  id serial primary key, name text not null unique, definition text, active boolean default true );
create table if not exists wh_emotional_framework (
  id serial primary key, name text not null unique, definition text, active boolean default true );
create table if not exists wh_emotional_register (
  id serial primary key, name text not null unique, definition text, active boolean default true );
create table if not exists wh_business_rule (
  id serial primary key, name text not null, rule jsonb, active boolean default true, created_at timestamptz default now() );

-- ---- supply (feed) ----------------------------------------------------------
create table if not exists wh_feed_source (
  id serial primary key, name text not null unique, kind text,   -- youtube | reddit | trends | news
  enabled boolean default false, config jsonb default '{}'::jsonb );
create table if not exists wh_feed_item (
  id serial primary key, source text, external_id text, title text, url text, body text,
  meta jsonb default '{}'::jsonb, collected_at timestamptz default now() );

-- Feed Story — the classified, justified content idea. Final output = heading +
-- topic_guide (a brief); NOT finished content.
create table if not exists wh_feed_story (
  id             serial primary key,
  cohort_id      int references wh_cohort(id) on delete set null,
  demand_topic   text, one_up text, emotional_framework text, emotional_register text,
  heading        text,
  topic_guide    jsonb,                        -- {take, beats[], proof[], register, one_up}
  summary        text, why_now text, why_relevant text, why_cohort text,
  source_refs    jsonb default '[]'::jsonb,
  status         text default 'draft',         -- draft | approved | banked | deleted
  selected       boolean default false,
  created_at     timestamptz default now()
);

-- ---- ops --------------------------------------------------------------------
create table if not exists wh_schedule (
  id serial primary key, target text, cadence text, active boolean default false, last_run timestamptz );
create table if not exists wh_seo_input (
  id serial primary key, kind text, content text, created_at timestamptz default now() );

-- seed the property vocabularies + feed sources (idempotent) ------------------
insert into wh_demand_topic(name, definition, source) values
  ('Career growth in GCCs', 'Moving up inside global capability centres', 'admin'),
  ('Switching domains', 'Pivoting function or industry mid-career', 'admin'),
  ('Remote vs hybrid', 'Work-model preferences and trade-offs', 'admin'),
  ('Salary benchmarking', 'What roles/bands actually pay', 'admin')
on conflict (name) do nothing;
insert into wh_one_up(name, definition) values
  ('Contrarian take', 'Say the non-obvious thing the audience secretly feels'),
  ('Insider data', 'A number or fact only an operator would know'),
  ('Do-this-now', 'A concrete action the reader can take today')
on conflict (name) do nothing;
insert into wh_emotional_framework(name, definition) values
  ('Aspiration', 'Who they want to become'),
  ('Anxiety relief', 'Name and defuse a fear'),
  ('Belonging', 'You are not alone / your tribe')
on conflict (name) do nothing;
insert into wh_emotional_register(name, definition) values
  ('Warm mentor', 'Encouraging, experienced, on your side'),
  ('Sharp analyst', 'Crisp, data-led, no fluff'),
  ('Straight talker', 'Blunt, honest, a little provocative')
on conflict (name) do nothing;
insert into wh_feed_source(name, kind, enabled) values
  ('YouTube', 'youtube', false), ('Reddit', 'reddit', false),
  ('Google Trends', 'trends', false), ('News', 'news', false)
on conflict (name) do nothing;
