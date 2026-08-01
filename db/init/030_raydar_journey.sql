-- ============================================================================
-- RayDar · JOURNEY — the high-involvement lane, ALONGSIDE the express sweep.
--
-- The express journey (Hunger → Sweep → Ideas) is untouched. Journey adds six
-- owned stations with human gates between them:
--   01 Radar → 02 Shortlist → 03 Dump → 04 Brief → 05 Assign → 06 Live
--
-- Same tables, one extra column set. A story with stage IS NULL is a classic
-- sweep idea; a story with a stage is travelling the journey. Nothing forks.
-- Idempotent (re-applied every boot): IF NOT EXISTS + ON CONFLICT throughout.
-- ============================================================================

-- ---- the traveling unit: a story now has a stage, an owner and a clock -----
-- Rows are born at SHORTLIST (as bare candidates) instead of only at ideation,
-- so a topic can be tracked before a single LLM token is spent on it.
alter table wh_feed_story add column if not exists stage         text;    -- radar|shortlist|dump|brief|assign|live
alter table wh_feed_story add column if not exists verdict       text;    -- keep|kill|merge|park|refresh
alter table wh_feed_story add column if not exists owner_team    text;    -- Content | SEO | Design
alter table wh_feed_story add column if not exists assignee      text;
alter table wh_feed_story add column if not exists due_at        timestamptz;
alter table wh_feed_story add column if not exists published_url text;
alter table wh_feed_story add column if not exists brief         jsonb;   -- the SEO brief artifact (station 04)
alter table wh_feed_story add column if not exists brief_at      timestamptz;
alter table wh_feed_story add column if not exists merged_into   int;     -- set when verdict='merge'
create index if not exists wh_feed_story_stage on wh_feed_story(batch_id, stage);

-- ---- the tracking spine: append-only, one row per human/machine act -------
-- This single table answers "who changed this, when, from what, to what, why".
-- Never updated, never deleted — the per-topic timeline reads straight off it.
create table if not exists wh_story_event (
  id         serial primary key,
  story_id   int references wh_feed_story(id) on delete cascade,
  batch_id   int references wh_batch(id) on delete cascade,
  actor      text default 'operator',       -- who acted (team or 'raydar' for machine)
  action     text not null,                 -- promote|verdict|stage|dump-attach|brief|assign|publish|edit
  from_stage text,
  to_stage   text,
  field      text,                          -- what changed (for edits)
  before_val text,
  after_val  text,
  note       text,
  at         timestamptz default now()
);
create index if not exists wh_story_event_story on wh_story_event(story_id, at);
create index if not exists wh_story_event_batch on wh_story_event(batch_id, at);

-- ---- station 03: the research DUMP store ----------------------------------
-- RayDar does NOT do keyword research. SEO dumps what they already produced in
-- their own tools; Dump AI reads it. These columns turn wh_seo_input from a
-- free-text paste box into a parsed, attributable research artifact.
alter table wh_seo_input add column if not exists batch_id  int references wh_batch(id) on delete cascade;
alter table wh_seo_input add column if not exists story_id  int references wh_feed_story(id) on delete set null;
alter table wh_seo_input add column if not exists filename  text;
alter table wh_seo_input add column if not exists shape_id  text;    -- detected export shape (ahrefs|semrush|gsc|serp|generic…)
alter table wh_seo_input add column if not exists parsed    jsonb;   -- typed rows: keyword/volume/kd/intent/position/url + paa/related
alter table wh_seo_input add column if not exists confidence numeric; -- 0-1 shape-match confidence
alter table wh_seo_input add column if not exists status    text default 'parsed';  -- parsed|confirm|attached
create index if not exists wh_seo_input_batch on wh_seo_input(batch_id);

-- ---- known dump shapes: learn a format once, parse it deterministically ----
-- The Munshi promise. A recognised header signature never costs a model call
-- again. New shapes get learned once (LLM) then written back here.
create table if not exists wh_dump_shape (
  id          serial primary key,
  shape_id    text not null unique,
  label       text,
  signature   text[] default '{}',   -- header tokens that identify this export
  colmap      jsonb default '{}',    -- {keyword: "Keyword", volume: "Search Volume", …}
  learned_by  text default 'seed',   -- seed | ai | human
  uses        int default 0,
  created_at  timestamptz default now()
);
insert into wh_dump_shape(shape_id, label, signature, colmap) values
  ('gsc',     'Google Search Console export', '{query,clicks,impressions,ctr,position}',
              '{"keyword":"query","clicks":"clicks","impressions":"impressions","position":"position"}'),
  ('ahrefs',  'Ahrefs keyword export',        '{keyword,volume,kd,cpc,parent topic}',
              '{"keyword":"keyword","volume":"volume","kd":"kd","cpc":"cpc"}'),
  ('semrush', 'Semrush keyword export',       '{keyword,search volume,keyword difficulty,intent}',
              '{"keyword":"keyword","volume":"search volume","kd":"keyword difficulty","intent":"intent"}'),
  ('serp',    'SERP / competitor snapshot',   '{position,url,title,domain}',
              '{"position":"position","url":"url","title":"title"}'),
  ('paa',     'People-Also-Ask / question list', '{question,people also ask,related}',
              '{"question":"question"}')
on conflict (shape_id) do nothing;

-- ---- own published inventory: kills the "already covered" rejection --------
-- Populated from a sitemap crawl (keyless) or a GSC connector when it lands.
create table if not exists wh_own_content (
  id           serial primary key,
  url          text not null unique,
  title        text,
  topic        text,          -- matched demand concept, if any
  published_at date,
  clicks       int,           -- from GSC when connected
  impressions  int,
  position     numeric,
  refreshed_at timestamptz default now()
);

-- ---- preset chips: one table, many chip kinds (concise by design) ---------
-- season + business-push + verdict + owner-team live here so the content team
-- edits them in Settings rather than waiting on a deploy.
create table if not exists wh_journey_chip (
  id      serial primary key,
  kind    text not null,       -- season | push | verdict | owner | dumpkind
  value   text not null,
  meta    jsonb default '{}'::jsonb,
  active  boolean default true,
  unique (kind, value)
);
insert into wh_journey_chip(kind, value, meta) values
  -- seasonality — the Indian hiring year, absent from RayDar until now
  ('season','Appraisal season',  '{"months":[3,4,5],"lift":0.15,"why":"hike + switch intent peaks"}'),
  ('season','Campus hiring',     '{"months":[7,8,9],"lift":0.15,"why":"fresher intake + placement prep"}'),
  ('season','Results / joining', '{"months":[6,7],"lift":0.1,"why":"offer season, notice periods"}'),
  ('season','Budget / layoffs',  '{"months":[1,2],"lift":0.1,"why":"cost cycles drive anxiety register"}'),
  -- business priorities — a monthly push that reweights without editing concepts
  ('push','Resume Lab',    '{"lift":0.2}'),
  ('push','Interview Lab', '{"lift":0.2}'),
  ('push','1Up',           '{"lift":0.2}'),
  -- shortlist verdicts
  ('verdict','keep',    '{"to":"dump","tone":"grn"}'),
  ('verdict','kill',    '{"to":null,"tone":"dim"}'),
  ('verdict','merge',   '{"to":null,"tone":"cyan"}'),
  ('verdict','park',    '{"to":null,"tone":"amber"}'),
  ('verdict','refresh', '{"to":"dump","tone":"mag","why":"we already rank — update, do not rewrite"}'),
  -- owning teams
  ('owner','Content','{}'), ('owner','SEO','{}'), ('owner','Design','{}'),
  -- what kind of research got dumped (replaces free-text wh_seo_input.kind)
  ('dumpkind','Keyword export','{}'), ('dumpkind','GSC export','{}'),
  ('dumpkind','SERP snapshot','{}'),  ('dumpkind','Competitor audit','{}'),
  ('dumpkind','PAA / questions','{}'),('dumpkind','Trend report','{}')
on conflict (kind, value) do nothing;

-- ---- journey dials live with the other editable business rules ------------
insert into wh_business_rule(name, category, rule) values
  ('journey_lane', 'journey', '{
     "gates":        {"shortlist": true, "dump": true, "brief": true},
     "auto_promote": {"enabled": true, "top_n": 12, "min_score": 0.35},
     "sla_days":     {"shortlist": 2, "dump": 3, "brief": 2, "assign": 5},
     "dump_required_before_brief": true
   }'::jsonb)
on conflict (name) do nothing;
