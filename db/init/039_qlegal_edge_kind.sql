-- Edges come in kinds, and they are not interchangeable.
--   xref    · "pursuant to Section 15" — the contract sends you somewhere
--   defines · this clause uses a term another clause defines
-- A cross-reference is rare and always worth showing; a defined-term link is
-- common and would drown the clause index if displayed the same way. Both are
-- worth WALKING, only one is worth PRINTING.
alter table ql_clause_edge add column if not exists kind text not null default 'xref';
create index if not exists ql_clause_edge_kind_idx on ql_clause_edge(document_id, kind);
