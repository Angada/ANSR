-- ============================================================================
-- Contra — flag the contracts that were ALREADY truncated.
--
-- 053 records truncation at ingest, which protects everything uploaded from now
-- on. It does nothing for what is already in the queue — and those are precisely
-- the documents at risk: eight contracts are sitting unreviewed right now, and
-- four of them stored EXACTLY 60,000 characters, which is the cap rather than
-- their length. Reviewed as-is they would still have come back "clean" on a
-- fragment, because extract_truncated defaults to false.
--
-- An extract landing exactly on the cap was cut. We cannot recover how much was
-- lost without re-extracting the original, so extract_full_chars stays null and
-- the report says "the rest of the contract was not seen" rather than inventing
-- a number. A document that happens to be exactly 60,000 characters long would
-- be flagged too — erring toward "we may have cut this" is the safe direction
-- when the alternative is a confident clean.
-- ============================================================================

do $$
begin
  if not exists (select 1 from schema_oneshot where key = '054_contra_backfill_truncation') then

    update contra_review
       set extract_chars     = length(extract_md),
           extract_truncated = true
     where extract_md is not null
       and length(extract_md) >= 60000
       and extract_truncated = false;

    -- everything else: record what was read, so "we measured it" is distinguishable
    -- from "we never looked"
    update contra_review
       set extract_chars = length(extract_md)
     where extract_md is not null and extract_chars is null;

    insert into schema_oneshot(key) values ('054_contra_backfill_truncation');
  end if;
end $$;
