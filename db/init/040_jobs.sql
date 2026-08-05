-- Long work, recorded — for every app, not just Q-Legal.
--
-- Q-Legal's ingestion batch proved the shape: write the work down BEFORE doing
-- it, update each item as it moves, and the tab that started it stops being the
-- only place the run exists. Contract uploads, archetype creation, contract
-- review and RayDar's content sweeps are all the same shape — many items, minutes
-- of work, a browser holding the connection — and all of them currently vanish on
-- a reload.
--
-- Generalised rather than copied, because four private batch tables would drift
-- into four dialects of the same idea.
create table if not exists job (
  id          bigserial primary key,
  app         text not null,                  -- qlegal | contra | raydar
  kind        text not null,                  -- ingest | review | archetype | sweep | reindex
  label       text,                           -- what a human calls this run
  total       int  not null default 0,
  status      text not null default 'running',-- running | done | failed | stalled
  actor       text,
  meta        jsonb,                          -- whatever the app needs to resume
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists job_app_idx on job(app, id desc);
create index if not exists job_open_idx on job(app) where status = 'running';

-- One row per unit of work, carrying its own state. The list IS the progress
-- meter: which item is being worked now, what is queued behind it, and what
-- stopped and why — instead of a percentage that explains nothing when it stalls.
create table if not exists job_item (
  id          bigserial primary key,
  job_id      bigint not null references job(id) on delete cascade,
  ord         int not null default 0,
  label       text not null,                  -- filename, theme, contract name
  ref_id      bigint,                         -- the row this produced, once it exists
  stage       text not null default 'queued',
  status      text not null default 'pending',-- pending | ok | blocked | failed | duplicate
  gate        jsonb,                          -- a verdict needing a human
  decision    text,                           -- accept | reject
  decided_at  timestamptz,
  note        text,
  payload     jsonb,                          -- what this item needs to be RETRIED
  attempts    int not null default 0,
  updated_at  timestamptz not null default now()
);
create index if not exists job_item_job_idx  on job_item(job_id, ord);
create index if not exists job_item_open_idx on job_item(job_id) where status = 'pending';

-- Resumption depends on knowing an item was never finished, not on guessing from
-- a timestamp. A run whose request died leaves items 'queued' or mid-stage with a
-- payload still attached; that is exactly what a resume pass looks for.
