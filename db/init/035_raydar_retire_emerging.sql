-- RayDar — retire "Emerging" from the pickers.
--
-- It was our watch-bucket, not one of Talent500's content series, so it sat in
-- the Content Series picker looking like a real family. Deactivated rather than
-- deleted: existing stories still reference it by name, and the classifier may
-- still route a genuinely new topic there for review.
update wh_demand_topic set active = false where name = 'Emerging';
update wh_franchise    set active = false where name = 'Emerging';
