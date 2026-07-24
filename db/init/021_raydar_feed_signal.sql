-- RayDar: per-sweep snapshot of the top-scoring feed items (YouTube/Reddit…),
-- so the results page can show WHICH videos scored high and why + link out.
-- Additive + idempotent (safe to re-run on every boot).
alter table if exists wh_batch add column if not exists feed_signal jsonb;
