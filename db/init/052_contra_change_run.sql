-- ============================================================================
-- Contra — which review pass wrote this timeline row?
--
-- contra_change is append-only, and re-running a review does not delete the
-- previous run's rows. The review handler also restarted `seq` at 0 while every
-- other writer allocated with nextSeq(), so two runs both wrote seq 0,1,2… and
-- `order by seq desc` interleaved them arbitrarily: the report was overwritten
-- but the timeline showed both runs' findings with no way to tell which was
-- current. In an append-only audit trail that is the one thing it must never do.
--
-- seq is now allocated. This column answers the remaining question — which pass
-- a row belongs to — so an old run can be collapsed or labelled rather than
-- silently mixed in with the current one.
-- ============================================================================

alter table contra_change add column if not exists run_tag text;

create index if not exists contra_change_review_seq_idx on contra_change (review_id, seq desc);
