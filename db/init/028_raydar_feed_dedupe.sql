-- RayDar — feed dedupe across sweeps. wh_feed_item had NO unique constraint, so
-- "on conflict do nothing" never fired and every sweep re-inserted the same
-- videos. Dedupe what accumulated (keep the earliest row = first sighting),
-- then enforce url uniqueness. Items seen in a previous sweep are HIDDEN as
-- repeats in the results (never removed — the first sighting stays the record).
delete from wh_feed_item a using wh_feed_item b where a.url = b.url and a.id > b.id;
create unique index if not exists wh_feed_item_url_uniq on wh_feed_item(url);
