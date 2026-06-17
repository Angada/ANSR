-- ============================================================================
-- Q&ANSR clause store + interpretation memory.
-- The contract MD is the working source of truth, CHUNKED BY CLAUSE (stable §
-- refs). Every rule/answer cites a clause. `interpretation` is the learning
-- memory — how we read each clause + the formula it compiles to; corrections
-- upsert here and ground every future query (RAG-of-rules). PDF stays in the
-- vault as legal authority (document.storage_path).
-- ============================================================================

create table if not exists clause (
  id            serial primary key,
  customer_id   int references customer(id),
  document_id   int references document(id),
  ref           text not null,                 -- '§3.1'
  title         text,
  body          text,                          -- the clause markdown (verbatim)
  ord           int,                           -- order in the document
  md_path       text,                          -- T2 source
  version       int default 1,
  created_at    timestamptz default now(),
  unique(customer_id, ref, version)
);
create index if not exists clause_cust on clause(customer_id, ord);

create table if not exists interpretation (
  id            serial primary key,
  customer_id   int references customer(id),
  clause_ref    text not null,                 -- the clause this reads
  reading       text not null,                 -- our plain-English understanding
  compiles_to   jsonb,                         -- the rule/formula it produces
  confidence    numeric(4,3),
  scope         text default 'contract',       -- run | contract | mint (promotion ladder)
  status        text default 'proposed',       -- proposed | confirmed | promoted
  source        text default 'ai',             -- ai | user
  run_id        int,
  created_by    text, created_at timestamptz default now(), updated_at timestamptz default now(),
  unique(customer_id, clause_ref)              -- latest current reading; history via audit_log
);
create index if not exists interp_cust on interpretation(customer_id);
