-- Q-Legal — legal-repository intelligence (ring-fenced ql_* namespace).
-- One logical contract = ql_document; each ingested file/version = ql_version
-- carrying C1 (full transcript) + C2 (concise key). Obligations, business rules,
-- confirm queue, feedback (learning loop) and the append-only AI log live here.
-- Idempotent: safe to run on every boot (migrate.js).

create table if not exists ql_document (
  id bigserial primary key,
  source text not null default 'upload',         -- upload | sharepoint
  sp_item_id text unique,                        -- SharePoint item id (stable across renames)
  filename text not null,
  title text,
  doc_type text,                                 -- MSA | SOW | NDA | Amendment | ...
  counterparty text,
  party1 text,
  party2 text,
  status text not null default 'active',         -- active | expired | superseded | draft
  latest_version int not null default 0,
  facts jsonb not null default '{}'::jsonb,      -- C2 key facts of the latest version
  summary text,
  tags jsonb not null default '[]'::jsonb,
  parent_id bigint references ql_document(id) on delete set null,  -- doc tree
  relation_kind text,                            -- amends | governed_by | supersedes | references | executed_of
  relation_status text,                          -- proposed | confirmed
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ql_document_type_idx on ql_document(doc_type);
create index if not exists ql_document_cp_idx on ql_document(counterparty);
create index if not exists ql_document_parent_idx on ql_document(parent_id);

create table if not exists ql_version (
  id bigserial primary key,
  document_id bigint not null references ql_document(id) on delete cascade,
  version_no int not null,
  sha256 text,
  storage_path text,                             -- T1 vault (original snapshot)
  c1_doc_id text,                                -- docstore id of the C1 markdown extract
  c1_text text,                                  -- C1 transcript (search source)
  c2 jsonb not null default '{}'::jsonb,         -- concise key: meta, clause map, notice register, tags
  diff_summary text,                             -- AI diff vs the previous version
  ocr boolean not null default false,
  is_executed boolean not null default false,
  status text not null default 'pending',        -- pending | processing | done | error
  error text,
  created_at timestamptz not null default now(),
  unique(document_id, version_no)
);
-- expression index → full-text search over C1 without a trigger
create index if not exists ql_version_fts_idx on ql_version using gin(to_tsvector('english', coalesce(c1_text, '')));

-- obligations ARE the tasks: lifecycle dates (expiry/renewal/notice) + post-execution
-- deliverables/SLAs. proposed → human confirms + assigns the doer → reminders.
create table if not exists ql_obligation (
  id bigserial primary key,
  document_id bigint not null references ql_document(id) on delete cascade,
  kind text not null,                            -- expiry | renewal | termination_notice | deliverable | sla | notice
  what text not null,
  who_owes text,                                 -- us | counterparty | unknown
  owner text,                                    -- the assigned doer
  due_date date,
  frequency text,                                -- one_time | monthly | quarterly | annual
  lead_days int not null default 30,
  ref text,                                      -- § citation
  status text not null default 'proposed',       -- proposed | confirmed | done | dismissed
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ql_obligation_due_idx on ql_obligation(due_date);
create index if not exists ql_obligation_doc_idx on ql_obligation(document_id);

-- editable business rules — injected into the gated pipelines by scope.
create table if not exists ql_rule (
  id bigserial primary key,
  code text unique not null,
  title text not null,
  body text not null,
  scope text not null default 'global',          -- global | ingestion | search | obligations | drafting
  status text not null default 'active',         -- active | off
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- one confirm queue for every AI proposal (classification, tree link, lineage, fact).
create table if not exists ql_confirm (
  id bigserial primary key,
  kind text not null,                            -- classification | link | lineage | fact
  document_id bigint references ql_document(id) on delete cascade,
  proposal jsonb not null default '{}'::jsonb,
  confidence numeric,
  why text,
  status text not null default 'open',           -- open | accepted | rejected
  resolved_by text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists ql_confirm_open_idx on ql_confirm(status);

-- append-only learning-loop event store: every human correction, replayable.
create table if not exists ql_feedback (
  id bigserial primary key,
  surface text not null,                         -- fact | answer | classification | search | confirm
  document_id bigint,
  field text,
  was text,
  corrected text,
  note text,
  actor text,
  created_at timestamptz not null default now()
);

-- append-only AI activity log (every gated pipeline call).
create table if not exists ql_log (
  id bigserial primary key,
  pipeline text, provider text, model text,
  ref_type text, ref_id bigint,
  rules_applied jsonb not null default '[]'::jsonb,
  input_summary text, output_summary text,
  status text,
  created_at timestamptz not null default now()
);

-- controlled tag vocabulary (auto-tags draw from here; free tags get added as kind 'free').
create table if not exists ql_tag_vocab (
  id bigserial primary key,
  tag text unique not null,
  kind text not null default 'auto',             -- auto | free
  created_at timestamptz not null default now()
);

-- ---- seed: the standing business rules (editable in the UI afterwards) --------
insert into ql_rule (code, title, body, scope) values
  ('source-of-truth', 'SharePoint / the original file is the source of truth',
   'Q-Legal never modifies an original document. Everything Q-Legal builds (C1 transcript, C2 key, wiki, tree, tags) is a derived layer that must remain fully rebuildable from the originals. On any dispute, the original file wins.', 'global'),
  ('grounding', 'No naked claims — every answer cites its source',
   'Every search result, answer, insight and report row must cite document → version → § reference so the reader can click through to the actual clause. If the evidence is not in the documents, say so instead of guessing.', 'search'),
  ('confirm-dont-guess', 'Propose, never silently decide',
   'Classifications, document-family links, draft-to-executed lineage matches and extracted facts are PROPOSALS until a human confirms them. Anything below high confidence goes to the confirm queue. Never silently force a match.', 'ingestion'),
  ('lazy-versioning', 'Full processing for latest + executed versions only',
   'Generate the full C1/C2 for the latest version and any executed version of a document, plus any version a user opens. Historical intermediate drafts get snapshot + diff only — do not spend model calls on drafts nobody will query.', 'ingestion'),
  ('tag-vocabulary', 'Controlled tags — no sprawl',
   'Auto-tags must come from the controlled vocabulary (contract type, governing law, status, auto-renewal, scanned-source, region). Prefer an existing tag over inventing a near-duplicate. Free tags are allowed but suggest existing ones first.', 'ingestion'),
  ('notice-extraction', 'Always extract the notice machinery',
   'From every contract extract: notice clauses (who must be notified of what, method, days), designated notice contacts, and change-of-control / assignment clauses (notice vs consent). This powers the change-of-guard register — one click answers "who must we inform".', 'ingestion'),
  ('obligation-reminders', 'Every dated obligation carries a lead time and a citation',
   'Extracted obligations (expiry, renewal windows, termination notice, deliverables, SLAs) must carry a due date where stated, a default 30-day lead time, who owes it (us vs counterparty), and the § reference. A human assigns the doer before reminders count.', 'obligations')
on conflict (code) do nothing;

-- ---- seed: controlled tag vocabulary ------------------------------------------
insert into ql_tag_vocab (tag, kind) values
  ('msa','auto'), ('sow','auto'), ('nda','auto'), ('amendment','auto'), ('dpa','auto'),
  ('employment','auto'), ('lease','auto'), ('saas','auto'), ('services','auto'), ('supply','auto'),
  ('auto-renewal','auto'), ('scanned-source','auto'), ('executed','auto'), ('draft','auto')
on conflict (tag) do nothing;
