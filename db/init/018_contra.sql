-- Contra — contract review app. Persistent + prod-safe: every object is NEW
-- (contra_* only — existing schema is never touched) and idempotent
-- (CREATE IF NOT EXISTS + ALTER ADD COLUMN IF NOT EXISTS), so re-runs upgrade
-- in place without dropping data. Retention by design: reviews/changes/logs
-- are written as work completes and survive tab-switches, reloads, restarts.

-- ARCHETYPE — a saved review template for a contract TYPE, incl. the user's
-- plain-English review rules (LLM-interpreted at review time).
create table if not exists contra_archetype (
  id serial primary key,
  name text not null,
  slug text unique,
  status text not null default 'draft',            -- draft | saved
  review_outline jsonb not null default '[]',      -- [{key,label,what_to_check,required,order,rules:[{id,text,created_at}]}]
  global_rules jsonb not null default '[]',        -- archetype-wide rules [{id,text,created_at}]
  detect_signature jsonb not null default '{}',    -- section keys + terms, for auto-detect
  source_doc text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table contra_archetype add column if not exists global_rules jsonb not null default '[]';

-- BATCH — one Contract-Review run over N dropped contracts.
create table if not exists contra_batch (
  id serial primary key,
  name text not null,
  status text not null default 'draft',            -- draft|detecting|reviewing|done|error
  contract_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- REVIEW — one contract's review within a batch. Written as it completes so
-- partial progress survives a crash. Holds both outputs' source data.
create table if not exists contra_review (
  id serial primary key,
  batch_id int references contra_batch(id) on delete cascade,
  contract_name text,
  contract_doc text,                               -- doc/vault ref of the original
  archetype_id int references contra_archetype(id),
  detect_confidence real,
  status text not null default 'pending',          -- pending|reviewing|done|error
  verdicts jsonb not null default '[]',            -- section boxes [{key,verdict,evidence_refs,note}]
  rule_checks jsonb not null default '[]',         -- [{rule_id,section_key,result:pass|check|breach,found,note,refs}]
  findings jsonb not null default '[]',            -- whole-contract [{kind,severity,note,refs}]
  report jsonb not null default '{}',              -- composed legal report {summary,checks,findings,prepared_by,generated_at}
  marked_doc_path text,                            -- exported marked-up .docx (storage ref)
  issue_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table contra_review add column if not exists detect_confidence real;
alter table contra_review add column if not exists rule_checks jsonb not null default '[]';
alter table contra_review add column if not exists report jsonb not null default '{}';
alter table contra_review add column if not exists marked_doc_path text;
create index if not exists contra_review_batch on contra_review(batch_id);

-- CHANGE — append-only audit timeline for a review (AI · human · comment · redline).
-- Powers the Reviewed timeline and the marked-up document's accept/reject state.
create table if not exists contra_change (
  id serial primary key,
  review_id int references contra_review(id) on delete cascade,
  seq int not null default 0,
  actor_type text not null default 'ai',           -- ai | human
  actor_id text,                                    -- user id / pipeline id
  kind text not null,                              -- finding|redline|comment|accept|reject|edit|qa
  body text,
  reasoning text,
  refs jsonb not null default '[]',                 -- ["§7.4", ...]
  anchor text,                                      -- ties a doc mark <-> this entry (the ① ② ③)
  status text,                                      -- redline: proposed|accepted|rejected
  created_at timestamptz not null default now()
);
create index if not exists contra_change_review on contra_change(review_id);

-- LOG — full AI-activity log for the app: every gated pipeline call, with the
-- rules applied, for tracking in Admin.
create table if not exists contra_log (
  id serial primary key,
  ts timestamptz not null default now(),
  pipeline text,
  provider text,
  model text,
  ref_type text,                                    -- archetype|review|contract|batch
  ref_id int,
  rules_applied jsonb not null default '[]',
  input_summary text,
  output_summary text,
  status text,                                      -- ai|stub|disabled|error
  tokens int,
  ms int,
  actor text
);
create index if not exists contra_log_ts on contra_log(ts desc);
