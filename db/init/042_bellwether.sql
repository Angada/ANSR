-- ============================================================================
-- Bellwether — the sources, the saved searches, and the history.
--
-- Three things the original could not do, all for the same reason: it kept its
-- structure in code. The list of scrapers was a folder of Python files, a search
-- was a command line, and a run was a CSV somebody saved. So you could not add a
-- source without a deploy, could not re-run last month's search, and could not
-- answer "what did we look at in June" at all.
--
-- Putting the scraper structure in the database is the change that makes it a
-- product rather than a script.
-- ============================================================================

-- The source registry — one row per scraper. What was fetchers/*.py becomes data:
-- enable a source, change its page size, see what it costs and whether it is
-- currently failing, without touching code.
create table if not exists bw_source (
  id            bigserial primary key,
  slug          text not null unique,           -- greenhouse | indeed | jsonld …
  name          text not null,
  tier          text not null,                  -- api | scrape | headless | apify
  auth          text not null default 'none',   -- none | vault | apify
  vault_key     text,                           -- which credential, when auth='vault'
  apify_actor   text,                           -- actor id, when tier='apify'
  cost_per_job  numeric(10,6) not null default 0,
  page_size     int,                            -- per-source paging (was hardcoded)
  rate_limit_ms int,
  enabled       boolean not null default true,
  -- health, so a source that quietly broke is visible rather than merely absent
  last_ok_at    timestamptz,
  last_error    text,
  last_error_at timestamptz,
  fail_streak   int not null default 0,
  notes         text,
  config        jsonb,                          -- per-source knobs, still user-editable
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists bw_source_enabled_idx on bw_source(tier) where enabled;

-- The Apify actor library, kept apart from bw_source because Apify is ONE
-- credential and many actors. Registering an actor must never mean registering
-- another key, and the marketplace has thousands we have not written fetchers for.
create table if not exists bw_apify_actor (
  id            bigserial primary key,
  actor_id      text not null unique,           -- e.g. kaix/indeed-scraper
  label         text not null,
  purpose       text,                           -- what it is for, in plain English
  cost_per_job  numeric(10,6) not null default 0,
  input_schema  jsonb,                          -- what it needs, so the UI can build a form
  default_input jsonb,
  enabled       boolean not null default true,
  last_run_at   timestamptz,
  runs          int not null default 0,
  spend_usd     numeric(12,5) not null default 0,
  created_at    timestamptz not null default now()
);

-- A saved search — the library. The original's search WAS its command line, so
-- nothing could be named, re-run, scheduled or compared. Every parameter that was
-- a constant in the code lives here instead, per search.
create table if not exists bw_search (
  id            bigserial primary key,
  name          text not null,
  description   text,
  -- WHO to look at
  company_scope text not null default 'list',   -- list | segment | single
  company_ids   bigint[],
  segment       jsonb,                          -- industry, size band, geography
  -- WHAT counts as a signal — the rules that used to be constants
  roles         text[],                         -- was roles.txt + config.py lists
  threshold     int not null default 20,        -- was FRONTLINE_THRESHOLD
  since_days    int not null default 30,        -- was SINCE_CHOICES
  min_employees int,                            -- was GOOGLE_MIN_EMP
  -- HOW hard to look
  sources       text[],                         -- which bw_source slugs to use
  max_fetch     int not null default 10,        -- was MAX_FETCH per company
  budget_usd    numeric(10,2),                  -- was DEFAULT_RUN_CAP
  concurrency   int,                            -- was WORKERS / INDEED_WORKERS
  -- lifecycle
  schedule      text,                           -- null | daily | weekly | monthly
  last_run_at   timestamptz,
  run_count     int not null default 0,
  created_by    text,
  status        text not null default 'active',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists bw_search_active_idx on bw_search(updated_at desc) where status = 'active';

-- What a run actually did, per company — the retrieval layer. Without this a run
-- is a number; with it you can ask why a company was skipped, what it cost, and
-- which source found it.
create table if not exists bw_run_company (
  id          bigserial primary key,
  run_id      bigint not null references hire_run(id) on delete cascade,
  company_id  bigint references hire_company(id) on delete set null,
  company     text,                             -- as given, even if never resolved
  outcome     text not null,                    -- ok | unresolved | no_postings | error | skipped_budget
  source      text,                             -- which one answered
  postings    int not null default 0,
  frontline   int not null default 0,
  cost_usd    numeric(10,5) not null default 0,
  ms          int,
  note        text
);
create index if not exists bw_run_company_run_idx on bw_run_company(run_id);
create index if not exists bw_run_company_co_idx  on bw_run_company(company_id);

-- Point a run at the search that produced it, so history is comparable: the same
-- saved search run in June and August is the ONLY honest before-and-after, and
-- rules_applied on hire_run records the values used in case the search was edited.
alter table hire_run add column if not exists search_id bigint references bw_search(id) on delete set null;
alter table hire_run add column if not exists label text;
create index if not exists hire_run_search_idx on hire_run(search_id, started_at desc);
