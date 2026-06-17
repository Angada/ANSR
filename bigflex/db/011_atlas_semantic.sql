-- ============================================================================
-- Atlas semantic + lineage layer: embeddings (semantic match signal),
-- archetype version lineage (fork parent), and a per-contract drift marker.
-- ============================================================================
alter table archetype           add column if not exists embedding jsonb;
alter table archetype           add column if not exists parent_id int references archetype(id);
alter table contract_fingerprint add column if not exists embedding jsonb;
alter table contract_fingerprint add column if not exists drift     jsonb;
