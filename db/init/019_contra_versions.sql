-- Contra — archetype description + version history. Additive / idempotent.
alter table contra_archetype add column if not exists description text;
alter table contra_archetype add column if not exists version int not null default 1;

-- one snapshot per saved version, so you can view/pick v1 · v2 · v3 …
create table if not exists contra_archetype_version (
  id serial primary key,
  archetype_id int references contra_archetype(id) on delete cascade,
  version int not null,
  name text,
  description text,
  review_outline jsonb not null default '[]',
  global_rules jsonb not null default '[]',
  created_at timestamptz not null default now()
);
create index if not exists contra_av_arch on contra_archetype_version(archetype_id);
