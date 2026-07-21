-- RayDar as a real product: first-class batches, story→library, rule categories.
-- Idempotent (re-applied every boot): IF NOT EXISTS + guarded backfill.

-- ---- batches: one row per sweep, retrievable ------------------------------
create table if not exists wh_batch (
  id            serial primary key,
  name          text not null,
  source        text default 'trend',            -- trend | seo | talentmind | mixed
  routes        jsonb default '{}'::jsonb,        -- {trend:bool, seo:bool, talentmind:bool}
  demand_topics text[] default '{}',
  cohort_id     int references wh_cohort(id) on delete set null,
  hunger        jsonb,
  status        text default 'draft',             -- draft | swept | archived
  story_count   int default 0,
  created_at    timestamptz default now(),
  swept_at      timestamptz
);

-- ---- feed_story: link to batch, library flag, gap type, angle -------------
alter table wh_feed_story add column if not exists batch_id   int references wh_batch(id) on delete cascade;
alter table wh_feed_story add column if not exists angle      text;
alter table wh_feed_story add column if not exists gap_type   text;    -- unanswered|stale|wrong|thin|emerging
alter table wh_feed_story add column if not exists in_library boolean default true;
update wh_feed_story set in_library = true where in_library is null;

-- ---- business rules: category so the UI can group them --------------------
alter table wh_business_rule add column if not exists category text;    -- integration | journey | scoring

-- ---- backfill: promote existing batch-cohorts into wh_batch --------------
insert into wh_batch (name, source, routes, hunger, cohort_id, status, story_count, created_at, swept_at)
  select c.name, 'mixed',
         coalesce(c.hunger_story->'routes', '{}'::jsonb),
         c.hunger_story, c.id, 'swept',
         (select count(*) from wh_feed_story s where s.cohort_id = c.id),
         c.created_at, c.created_at
    from wh_cohort c
   where ( (c.filter_def->>'batch')::bool is true
           or exists (select 1 from wh_feed_story s where s.cohort_id = c.id) )
     and not exists (select 1 from wh_batch b where b.cohort_id = c.id);

-- link any story that has a cohort but no batch yet
update wh_feed_story s set batch_id = b.id
  from wh_batch b
 where s.batch_id is null and b.cohort_id = s.cohort_id;
