-- ============================================================================
-- HireAway — hiring-signal intelligence, as the fourth app in ANSR Core.
--
-- Ported from frontline-hiring-scraper, which has no database at all: it reads a
-- CSV and writes a CSV, caching resolved slugs in a JSON file. That is fine for a
-- script run by its author and useless for a shared product — nothing is
-- queryable, two runs cannot be compared, and a company's hiring history exists
-- only in whichever spreadsheet someone kept.
--
-- So the schema is ours. It follows Q-Legal's shape deliberately, because a job
-- posting behaves like a document: it is fetched, versioned, read, keyed and
-- asked about. That also means the engine already built — batches, gates, audit
-- log, business rules, vectors — applies here without a second implementation.
-- ============================================================================

-- A company we are watching. Resolution (website -> ATS platform + slug) is the
-- expensive step in the original pipeline and was cached in a JSON file with a
-- 30-day TTL; here it is a row, so a resolution can be corrected by a human and
-- stay corrected.
create table if not exists hire_company (
  id             bigserial primary key,
  name           text not null,
  website        text,
  domain         text,                          -- normalised, for dedup
  employees      int,                           -- gates the expensive tiers
  ats_platform   text,                          -- greenhouse | lever | workday | …
  ats_slug       text,                          -- the board identifier on that platform
  ats_url        text,                          -- click-through for a human
  resolved_at    timestamptz,
  resolve_source text,                          -- auto | headless | human | seed
  confirmed      boolean not null default false,-- a human vouched for the resolution
  status         text not null default 'active',
  meta           jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index if not exists hire_company_domain_idx on hire_company(domain) where domain is not null;
create index if not exists hire_company_plat_idx on hire_company(ats_platform);

-- One job posting. `fingerprint` is the dedup key and the hard part: the same
-- role appears simultaneously on Greenhouse, LinkedIn and Indeed, and counting it
-- three times inflates every number downstream. Kept as a stored column rather
-- than computed at read time so the uniqueness is enforced by the database.
create table if not exists hire_posting (
  id            bigserial primary key,
  company_id    bigint not null references hire_company(id) on delete cascade,
  source        text not null,                  -- which fetcher produced it
  source_id     text,                           -- the platform's own id
  url           text,
  title         text not null,
  location      text,
  department    text,
  employment    text,                           -- full-time | part-time | contract
  comp_text     text,                           -- as printed, never parsed into a number
  description   text,                           -- the posting body (the "C1")
  posted_at     date,
  first_seen    timestamptz not null default now(),
  last_seen     timestamptz not null default now(),
  closed_at     timestamptz,                    -- absent from a sweep = probably filled
  is_frontline  boolean,                        -- matched the role vocabulary
  matched_role  text,                           -- WHICH rule matched, for explainability
  fingerprint   text not null,                  -- company + normalised title + location
  meta          jsonb
);
create unique index if not exists hire_posting_fp_idx   on hire_posting(fingerprint);
create index if not exists hire_posting_co_idx          on hire_posting(company_id, last_seen desc);
create index if not exists hire_posting_front_idx       on hire_posting(company_id) where is_frontline;
create index if not exists hire_posting_open_idx        on hire_posting(last_seen desc) where closed_at is null;
create index if not exists hire_posting_fts_idx on hire_posting
  using gin (to_tsvector('english', coalesce(title,'') || ' ' || coalesce(description,'')));

-- A sweep, and what it cost. The original enforced a $15 per-run and $65 monthly
-- cap in code with no record of what was actually spent — so the cap could hold
-- while nobody could answer "on what". Every run is now accountable.
create table if not exists hire_run (
  id            bigserial primary key,
  job_id        bigint,                         -- the shared job() row driving it
  scope         text,                           -- all | list | single company
  companies     int not null default 0,
  postings_new  int not null default 0,
  postings_seen int not null default 0,
  frontline     int not null default 0,
  cost_usd      numeric(10,5) not null default 0,
  budget_usd    numeric(10,2),                  -- the cap this run ran under
  stopped_early boolean not null default false, -- hit the cap: say so, never silently truncate
  rules_applied jsonb,                          -- the rule values AT RUN TIME
  status        text not null default 'running',
  started_at    timestamptz not null default now(),
  ended_at      timestamptz
);
create index if not exists hire_run_started_idx on hire_run(started_at desc);

-- Per-source spend within a run. The original priced five tiers 150x apart
-- (Indeed $0.00008/job vs Google $0.02) and reported none of it, so the only way
-- to know where the money went was to read the code and guess.
create table if not exists hire_run_source (
  id         bigserial primary key,
  run_id     bigint not null references hire_run(id) on delete cascade,
  source     text not null,
  companies  int not null default 0,
  postings   int not null default 0,
  cost_usd   numeric(10,5) not null default 0,
  errors     int not null default 0,
  note       text
);
create index if not exists hire_run_source_idx on hire_run_source(run_id);

-- Hiring signal over time — the actual product. A single sweep says who is
-- hiring; the series says who STARTED, who accelerated, and who stopped, which
-- is the thing worth an alert.
create table if not exists hire_signal (
  id           bigserial primary key,
  company_id   bigint not null references hire_company(id) on delete cascade,
  run_id       bigint references hire_run(id) on delete set null,
  as_of        date not null,
  open_total   int not null default 0,
  open_front   int not null default 0,
  new_since    int not null default 0,
  closed_since int not null default 0,
  velocity     numeric(8,2),                    -- new per week, trailing
  meta         jsonb
);
create unique index if not exists hire_signal_co_date_idx on hire_signal(company_id, as_of);

-- Vectors, same spine as Q-Legal: find roles by meaning, cluster companies by
-- what they are building, match a posting to an ICP without keyword lists.
create table if not exists hire_embedding (
  id              bigserial primary key,
  posting_id      bigint references hire_posting(id) on delete cascade,
  company_id      bigint references hire_company(id) on delete cascade,
  granularity     text not null,                -- posting | company
  content         text not null,
  embedding       vector(1536),
  embedding_model text not null,
  recipe          text,
  created_at      timestamptz not null default now()
);
create index if not exists hire_embedding_doc_idx on hire_embedding(posting_id);
do $$ begin
  execute 'create index if not exists hire_embedding_hnsw_idx on hire_embedding using hnsw (embedding vector_cosine_ops)';
exception when others then null;   -- pgvector absent: the table still works, ANN does not
end $$;
