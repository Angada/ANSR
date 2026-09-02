-- RayDar — retire "Emerging" from the pickers.
--
-- It was our watch-bucket, not one of Talent500's content series, so it sat in
-- the Content Series picker looking like a real family. Deactivated rather than
-- deleted: existing stories still reference it by name, and the classifier may
-- still route a genuinely new topic there for review.
-- ONE-SHOT. Retiring Emerging is a decision taken once. Left unguarded these two
-- lines re-fired at every boot, so a team that deliberately brought Emerging back
-- (which this file's own note says the classifier may need) lost it again at the
-- next restart.
do $$
begin
  if not exists (select 1 from schema_oneshot where key = '035_retire_emerging') then
    update wh_demand_topic set active = false where name = 'Emerging';
    update wh_franchise    set active = false where name = 'Emerging';
    insert into schema_oneshot(key) values ('035_retire_emerging');
  end if;
end $$;
