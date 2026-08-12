-- Three gaps found by reading the original's hard rules, not by designing.
--
-- Each one is the difference between "we don't know" and "we checked, and the
-- answer is none" — a distinction the first schema quietly lost, and the exact
-- distinction the original spends a hard rule protecting.

-- 1 · NEVER EMIT A FALSE ZERO.
-- A company that could not be resolved is unresolved; it is not a company with
-- zero open roles. Sales acts on zeros — someone works a "not hiring" list and
-- the misses were never looked at. Without this column both read as 0.
alter table hire_signal add column if not exists resolved boolean not null default true;
alter table hire_signal add column if not exists unresolved_reason text;
comment on column hire_signal.resolved is
  'false = we could not look, NOT that there is nothing. Zero with resolved=false is unknown.';

-- 2 · NEVER GUESS A SLUG.
-- Slugs are opaque, especially Greenhouse and Workday. Read one from the careers
-- page, then hit the endpoint before trusting it. `confirmed` already recorded a
-- human vouching; this records the MACHINE having checked, which is a different
-- claim and the one the original insists on.
alter table hire_company add column if not exists slug_verified_at timestamptz;
alter table hire_company add column if not exists verify_status text;      -- verified | failed | unchecked
alter table hire_company add column if not exists unresolved_reason text;  -- no_careers_page | unknown_ats | slug_unverified
alter table hire_company add column if not exists tech_hint text;          -- Apollo's guess: a hint, never truth
create index if not exists hire_company_unresolved_idx on hire_company(unresolved_reason)
  where unresolved_reason is not null;

-- 3 · A COUNT IS MEANINGLESS WITHOUT ITS VOCABULARY.
-- The role list is 500 terms and the original versions it in roles_archive/,
-- because adding one term changes every historical count. Comparing June to
-- August across a vocabulary change is comparing two different questions.
create table if not exists bw_roles (
  id         bigserial primary key,
  version    int not null,
  kind       text not null,            -- include | exclude | lead_ok
  term       text not null,
  note       text,
  created_by text,
  created_at timestamptz not null default now()
);
create unique index if not exists bw_roles_uniq on bw_roles(version, kind, term);
create index if not exists bw_roles_ver_idx on bw_roles(version, kind);

alter table bw_search add column if not exists roles_version int;
alter table hire_run  add column if not exists roles_version int;
comment on column hire_run.roles_version is
  'The vocabulary this run counted with. Two runs on different versions are not comparable.';
