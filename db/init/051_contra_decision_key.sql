-- ============================================================================
-- Contra — the teaching signal was firing on one reviewer changing their mind.
--
-- 033 declared `unique (review_id, box_key, finding_key)`. In Postgres, NULLs are
-- DISTINCT in a unique constraint — so for a SECTION-level decision, where
-- finding_key is null, the constraint never matched and the `on conflict` in
-- /act never fired. Three acts on one section wrote three rows:
--
--   3 acts (finding_key NULL) -> 3 rows: reject, accept, reject   -- upsert dead
--   2 acts (finding_key 'cap') -> 1 row: accept                   -- upsert works
--
-- The archetype signal counts decisions to decide "this rule is wrong across
-- contracts". With duplicates it counted one reviewer toggling a single section
-- twice as two contracts disagreeing, and prompted a human to soften or delete a
-- rule that was fine. contra_change already shows this happening in the live
-- data: 2 reject rows for one review where contra_decision has 1.
--
-- COALESCE the nulls so a section-level decision has a stable identity, and
-- collapse the duplicates that are already on disk (newest wins — it is the
-- reviewer's latest view).
-- ============================================================================

do $$
begin
  if not exists (select 1 from schema_oneshot where key = '051_contra_decision_key') then

    -- newest row per (review, box, finding) survives; the rest were never meant to exist
    delete from contra_decision d
     using contra_decision keep
     where d.review_id = keep.review_id
       and coalesce(d.box_key,'')     = coalesce(keep.box_key,'')
       and coalesce(d.finding_key,'') = coalesce(keep.finding_key,'')
       and d.id < keep.id;

    insert into schema_oneshot(key) values ('051_contra_decision_key');
  end if;
end $$;

-- the old constraint could never match a null; drop it and key on the coalesced form
alter table contra_decision drop constraint if exists contra_decision_review_id_box_key_finding_key_key;
create unique index if not exists contra_decision_ident_idx
  on contra_decision (review_id, coalesce(box_key, ''), coalesce(finding_key, ''));

-- archetype_id was a bare bigint with no FK, so deleting an archetype left decision
-- rows pointing at a dead id and quietly poisoning the next archetype to reuse it.
alter table contra_decision
  drop constraint if exists contra_decision_archetype_fk;
alter table contra_decision
  add constraint contra_decision_archetype_fk
  foreign key (archetype_id) references contra_archetype(id) on delete set null;
