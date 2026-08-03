-- RayDar — cache every external search by term.
--
-- A YouTube search costs 100 quota units against a 10,000/day default: roughly
-- four full sweeps a day. Re-running the same term the same day buys nothing
-- and spends the budget, so a term searched recently is served from here.
create table if not exists wh_search_cache (
  id         serial primary key,
  source     text not null,              -- youtube | reddit | news …
  term       text not null,
  payload    jsonb not null,             -- the normalised items, exactly as collected
  fetched_at timestamptz default now(),
  unique (source, term)
);
create index if not exists wh_search_cache_age on wh_search_cache(source, fetched_at desc);
