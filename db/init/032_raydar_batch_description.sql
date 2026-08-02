-- ============================================================================
-- RayDar — a batch says what it is.
--
-- "Batch 01-08-2026 17:44" tells you nothing three weeks later. Every batch now
-- carries a one-line description, written automatically from what actually went
-- into it (themes armed, research pasted, the operator's brief) and editable by
-- hand afterwards.
--
-- Also: empty batches are noise. A sweep that produced no ideas is a failed run,
-- not a record worth keeping — they are purged on boot.
-- ============================================================================

alter table wh_batch add column if not exists description text;

-- backfill the ones already on file, from their stored inputs, so the list is
-- readable immediately rather than only for batches created from now on.
update wh_batch b
   set description = trim(both ' ·' from concat_ws(' · ',
         nullif(array_to_string(b.demand_topics, ', '), ''),
         case when (b.routes->>'seo')::bool then 'with SEO research' end,
         case when (b.routes->>'talentmind')::bool then 'TalentMind cohort' end,
         nullif(left(b.hunger->>'extra_prompt', 80), '')))
 where b.description is null
   and (coalesce(array_length(b.demand_topics, 1), 0) > 0 or b.hunger ? 'extra_prompt');

update wh_batch set description = 'Swept across all active themes.'
 where description is null or description = '';

-- purge batches that produced nothing — a sweep with no ideas is a failed run
delete from wh_batch b
 where not exists (select 1 from wh_feed_story s where s.batch_id = b.id and s.status <> 'deleted');
