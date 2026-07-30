-- Q-Legal · Registers — user-defined estate-wide extraction.
-- The legal team writes a standing question in plain English once ("does this
-- contract require notification on a data breach, and within how long?"); it is
-- then extracted from EVERY contract at ingestion (and backfilled across the
-- estate) into a structured, citable, filterable answer. The change-of-guard
-- register and obligations are simply two built-ins of the same idea.
-- Idempotent: safe to run on every boot.

create table if not exists ql_register (
  id bigserial primary key,
  code text unique not null,
  name text not null,                            -- short column label, e.g. "Data-breach notice"
  question text not null,                        -- the standing question, in plain English
  extract_hint text,                             -- what the "value" should be, e.g. "the number of hours"
  doc_types jsonb not null default '[]'::jsonb,  -- [] = every contract; else only these types
  builtin boolean not null default false,
  status text not null default 'active',         -- active | off
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists ql_register_hit (
  id bigserial primary key,
  register_id bigint not null references ql_register(id) on delete cascade,
  document_id bigint not null references ql_document(id) on delete cascade,
  version_id bigint references ql_version(id) on delete set null,
  present text not null default 'unclear',       -- yes | no | unclear
  answer text,                                   -- one-line plain-English answer
  value text,                                    -- the key number/term pulled out (for sorting/filtering)
  refs jsonb not null default '[]'::jsonb,       -- § citations
  confidence numeric,
  status text not null default 'auto',           -- auto | confirmed | corrected
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(register_id, document_id)
);
create index if not exists ql_register_hit_reg_idx on ql_register_hit(register_id);
create index if not exists ql_register_hit_doc_idx on ql_register_hit(document_id);
create index if not exists ql_register_hit_present_idx on ql_register_hit(present);

-- Seeds: the client's own due-diligence examples (Kranthi's email) as built-ins.
-- The team adds their own from the Registers screen — no code change needed.
insert into ql_register (code, name, question, extract_hint, builtin) values
  ('data-breach-notice', 'Data-breach notice',
   'Does this contract require notifying the other party of a data breach or security incident, and within what time?',
   'the notification deadline (e.g. "72 hours")', true),
  ('change-of-control', 'Change of control',
   'Does this contract require notice or consent on a change of control, or on assignment of the agreement?',
   'whether it needs notice or consent, and the days', true),
  ('insurance', 'Insurance requirement',
   'Does this contract require a party to maintain insurance, and of what type and amount?',
   'the cover type and amount', true),
  ('liability-cap', 'Liability cap',
   'Is there a cap on aggregate liability, what is it, and are there carve-outs that escape the cap?',
   'the cap (e.g. "12 months of fees") plus any carve-outs', true),
  ('termination-convenience', 'Termination for convenience',
   'May either party terminate for convenience (without cause), who may, and on how much notice?',
   'who may terminate and the notice period', true)
on conflict (code) do nothing;
