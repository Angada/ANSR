-- Q-Legal — the vector spine (GODDOC §4.5, first-class by decision 2026-07-29).
-- pgvector in the same Postgres. Three granularities, all carrying § anchors:
--   document — the C2 summary/facts (families, dedup, similarity, the estate map)
--   section  — a contents-wiki heading + the gists of the clauses under it
--   clause   — one clause-wiki entry (semantic search, clustering, benchmarking)
-- Every row records WHICH embedding model produced it (model swap = re-embed
-- sweep; retrieval never compares vectors across models). A vector hit is only
-- ever a POINTER to a real § — the grounding rule.
-- Requires the pgvector extension (Supabase/Cloud SQL have it; local dev uses
-- the pgvector/pgvector:pg15 image). If unavailable this file fails harmlessly
-- (migrate.js logs + continues) and the code runs FTS-only.

create extension if not exists vector;

create table if not exists ql_embedding (
  id bigserial primary key,
  document_id bigint not null references ql_document(id) on delete cascade,
  version_id bigint references ql_version(id) on delete cascade,
  granularity text not null,                     -- document | section | clause
  ref text,                                      -- § anchor as printed (clause/section)
  title text,                                    -- label / heading
  content text not null,                         -- the exact text that was embedded
  embedding vector(1536) not null,
  embedding_model text not null,                 -- provider:model (e.g. zai:embedding-3, hash:v1)
  embedded_at timestamptz not null default now()
);
create index if not exists ql_embedding_doc_idx on ql_embedding(document_id);
create index if not exists ql_embedding_gran_idx on ql_embedding(granularity, embedding_model);
-- HNSW — approximate nearest neighbour at estate scale (750K clause vectors at 5K docs)
create index if not exists ql_embedding_hnsw_idx on ql_embedding using hnsw (embedding vector_cosine_ops);
