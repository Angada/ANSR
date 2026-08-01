-- Q-Legal vectors: record WHAT each vector was built from, and make staleness
-- detectable so the spine re-freshens when a document changes.
--   source   — 'c1' (the real clause body, located by its § anchor in the
--              transcript) or 'gist' (the C2 one-line summary, when the anchor
--              couldn't be found). The coverage panel shows this so a lawyer can
--              see which clauses the index is thin on.
-- Staleness is derived, not stored: a document is pending when it has no rows for
-- the target model, its rows point at an older ql_version, or the rows predate the
-- document's own updated_at (a fact correction changes the document vector too).
alter table ql_embedding add column if not exists source text;

-- the staleness predicate scans by document + model + version; index the triple
create index if not exists ql_embedding_fresh_idx on ql_embedding(document_id, embedding_model, version_id);

-- recipe = the version of the CHUNKING rules the row was built with. The model
-- can be right and the rows still stale, because we changed what we feed it
-- (e.g. clause vectors moving from the C2 gist to the real C1 clause body).
-- Bumping VECTOR_RECIPE in server/qlegal-vectors.js re-embeds the estate on the
-- next sweep — without it a code change silently leaves an old index in place.
alter table ql_embedding add column if not exists recipe text;
