-- ============================================================================
-- Contra — how much of the contract was actually read?
--
-- Two independent ways a review can be run against a fraction of the document,
-- both silent:
--
--  1. TRUNCATION. The extract is capped at 60,000 characters on ingest and the
--     review prompt takes the first 50,000 of that. Four contracts sitting in
--     the production queue right now extracted to exactly 60,000 characters —
--     which is the cap, not their length. A long MSA is reviewed on its opening
--     pages and reported on as though it were whole.
--
--  2. UNREAD PAGES. extractFile already returns unread_pages and figure_pages,
--     commented in that file as "the honest gap, surfaced loudly downstream".
--     Contra took only .text and dropped both. A 60-page agreement whose
--     Schedule B is a scan was reviewed on the 50 readable pages.
--
-- Neither reached the reviewer, the report, or the exported document. A clean
-- verdict on a contract that was two-thirds read is worse than no verdict,
-- because it is trusted.
-- ============================================================================

alter table contra_review add column if not exists extract_chars     int;      -- length actually stored
alter table contra_review add column if not exists extract_full_chars int;     -- length BEFORE the cap
alter table contra_review add column if not exists extract_truncated boolean not null default false;
alter table contra_review add column if not exists figure_pages      jsonb;    -- pages that are images we could not read
-- unread_pages already added by 050_contra_not_assessed.sql
