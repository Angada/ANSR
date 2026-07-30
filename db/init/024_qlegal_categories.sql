-- Q-Legal · Legal Setting — the GROWING contract-category taxonomy.
-- Not a fixed enum: the AI classifies each upload against the current list (with
-- confidence), may propose a brand-new category when nothing fits, and the legal
-- team confirms/overrides and adds their own. Idempotent.

create table if not exists ql_category (
  id bigserial primary key,
  name text unique not null,
  source text not null default 'seed',           -- seed | ai | human
  status text not null default 'active',         -- active | off
  created_at timestamptz not null default now()
);

insert into ql_category (name, source) values
  ('MSA','seed'), ('SOW','seed'), ('NDA','seed'), ('Amendment','seed'), ('DPA','seed'),
  ('Lease','seed'), ('ATS','seed'), ('Recruitment','seed'), ('Staffing Contract','seed'),
  ('Welfare Agreement','seed'), ('Employment','seed'), ('SaaS','seed'), ('Services','seed'),
  ('Supply','seed'), ('Partnership','seed'), ('Other','seed')
on conflict (name) do nothing;
