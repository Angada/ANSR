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

-- REMOVED. This ran on EVERY boot and was not a "purge of empty batches":
--   * a batch created but not yet swept (status='draft', zero stories) was
--     deleted if the container restarted between creating it and sweeping it;
--   * a batch whose ideas were ALL rejected was deleted too — rejection is a
--     soft delete (status='deleted'), not emptiness.
-- It cascaded to wh_feed_story, wh_story_event and wh_seo_input, so a sweep's
-- entire journey timeline and any attached SEO research went with it.
-- Retention is a deliberate user action, not a boot-time side effect: the purge
-- endpoint (server/whisperer.js) previews first and protects accepted work.
