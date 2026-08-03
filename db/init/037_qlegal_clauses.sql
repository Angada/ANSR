-- The Canon clause layer: the contract's own structure, stored.
--
-- Until now the "clause wiki" was a model's recollection inside the same JSON
-- blob as the key — capped at max_clauses and lost entirely whenever that call
-- truncated. A clause is a thing the document states, so it is stored as one:
-- verbatim body, printed § reference, real nesting.
create table if not exists ql_clause (
  id           bigserial primary key,
  document_id  bigint not null references ql_document(id) on delete cascade,
  version_id   bigint not null references ql_version(id) on delete cascade,
  ord          int    not null,               -- document order, the only true order
  ref          text   not null,               -- as PRINTED (§12.3, "Annexure III")
  parent_ref   text,                          -- §12.3 -> §12
  depth        int    not null default 1,
  title        text,                          -- read from the document
  label        text,                          -- 2-4 word topic (model)
  gist         text,                          -- one line (model)
  body         text   not null,               -- verbatim. never model-rewritten
  created_at   timestamptz not null default now()
);
create index if not exists ql_clause_doc_idx    on ql_clause(document_id, ord);
create index if not exists ql_clause_ref_idx    on ql_clause(document_id, ref);
create index if not exists ql_clause_ver_idx    on ql_clause(version_id);
-- the clause wiki is searched as text, not only ranked by vector
create index if not exists ql_clause_fts_idx    on ql_clause
  using gin (to_tsvector('english', coalesce(title,'') || ' ' || coalesce(label,'') || ' ' || body));

-- Cross-references — the edges Ask walks. "continue indefinitely unless
-- terminated per Section 15" is only answerable if Section 15 can be reached
-- FROM the term clause; similarity ranking will not find it, because a
-- cross-reference reads nothing like its target.
create table if not exists ql_clause_edge (
  id           bigserial primary key,
  document_id  bigint not null references ql_document(id) on delete cascade,
  version_id   bigint not null references ql_version(id) on delete cascade,
  from_ref     text not null,
  to_ref       text not null,
  phrase       text,                          -- WHY they are linked, as printed
  resolved     boolean not null default false -- false = cites something absent
);
create index if not exists ql_clause_edge_doc_idx  on ql_clause_edge(document_id, from_ref);
create index if not exists ql_clause_edge_to_idx   on ql_clause_edge(document_id, to_ref);
