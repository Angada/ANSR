-- RayDar — the detailed, evidence-backed story outline.
--
-- "Why this story" gives the take and the beats. This is the next layer down:
-- a concrete outline a writer can work from, built from the REAL comments
-- collected for that theme and the winning video's storyline, with the evidence
-- for every claim underneath it.
--
-- Generated ON DEMAND (one model call per idea, only when asked) and stored, so
-- opening it twice costs nothing and a sweep does not pay for eighteen of them.
alter table wh_feed_story add column if not exists outline    jsonb;
alter table wh_feed_story add column if not exists outline_at timestamptz;
