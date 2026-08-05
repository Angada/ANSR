-- ============================================================================
-- RayDar (Talent Trend Radar) — align Whisperer to the approved brief.
-- Keeps table names (wh_*) but adds the real domain model: the 6 demand topics
-- + Emerging, 1Up franchise routing, the 4 emotional registers, ranking, and
-- review feedback (Used/Rejected/Saved). UI relabels ClientMind→TalentMind and
-- Candidate/Client→Talent (job seeker).
-- ============================================================================

-- demand-topic gains: the underlying question, franchise routing, strategic weight
alter table wh_demand_topic add column if not exists question text;
alter table wh_demand_topic add column if not exists franchise text;
alter table wh_demand_topic add column if not exists format_home text;
alter table wh_demand_topic add column if not exists strategic_weight numeric default 1;
alter table wh_demand_topic add column if not exists notes text;

-- feed story (idea) gains: franchise, platform, contradiction flag, score + breakdown, feedback
alter table wh_feed_story add column if not exists franchise text;
alter table wh_feed_story add column if not exists platform text;
alter table wh_feed_story add column if not exists contradiction boolean default false;
alter table wh_feed_story add column if not exists contradiction_of text;
alter table wh_feed_story add column if not exists evidence text;
alter table wh_feed_story add column if not exists score numeric default 0;
alter table wh_feed_story add column if not exists score_breakdown jsonb;
alter table wh_feed_story add column if not exists feedback text;          -- used | rejected | saved
alter table wh_feed_story add column if not exists reject_reason text;     -- off-brand | not interesting | already covered | wrong timing

-- business rules keyed by integration name (upsertable)
create unique index if not exists wh_business_rule_name on wh_business_rule(name);

-- 1Up franchises (routing targets) — editable in settings, config not code
create table if not exists wh_franchise (
  id serial primary key, name text not null unique, stage text, format_home text, active boolean default true );
insert into wh_franchise(name, stage, format_home) values
  ('Skill Up', 'skills development', 'Tutorial / explainer · The 15-Minute Edge'),
  ('Stack Up', 'shortlisting', 'Carousel · quick video'),
  ('Pay Up', 'salary / negotiation', 'Long-form + downloadable template'),
  ('TrAIbe × Accelor', 'community + AI', 'Fast-turnaround short-form / interactive'),
  ('The Hot Seat', 'interview prep / brand story', 'Long-form narrative'),
  ('Emerging', 'watch bucket', 'TBD — new topics born here')
on conflict (name) do nothing;

-- Seed demand topics to the approved 6 + Emerging, with franchise routing.
-- NOTE: this used to `delete from wh_demand_topic` unconditionally. Because
-- every db/init file is re-applied on EVERY boot, that silently wiped any
-- concept the team added in the in-app editor. The reset now fires only on a
-- genuinely empty table (a fresh database); an existing estate is left alone
-- and its live taxonomy comes from 031 (the client's own wording).
delete from wh_demand_topic where not exists (select 1 from wh_demand_topic);
insert into wh_demand_topic(name, question, definition, source, franchise, format_home, strategic_weight, notes) values
  ('Skills to get a new job',  'What do I learn?',                    'Foundational skills demand', 'seed', 'Skill Up',         'Tutorial / explainer',            1.0, 'Steady volume'),
  ('Keywords and resume',      'Why am I not getting callbacks?',     'Resume / ATS / keywords',    'seed', 'Stack Up',         'Carousel · quick video',          1.1, 'Highest volume + most misinformation → biggest correction opportunity'),
  ('Salary negotiation',       'Am I leaving money on the table?',    'Negotiation / hikes / CTC',  'seed', 'Pay Up',           'Long-form + template',            1.0, 'Underserved in India — cultural taboo, high demand low-quality supply'),
  ('Which coding tool to use', 'What is everyone else using?',        'AI coding tools of the week','seed', 'TrAIbe × Accelor', 'Fast short-form',                 1.0, 'Fast churn — track velocity not substance'),
  ('Using AI to get better jobs','Is this a shortcut or cheating?',   'AI for resumes/portfolio/prep','seed','TrAIbe × Accelor', 'Interactive challenge (Proof of Work)', 1.5, 'HIGHEST strategic value — flag to Product; candidates want permission with an ethical frame'),
  ('Landing your dream job',   'Is it possible for someone like me?', 'FAANG/GCC/switch/remote',    'seed', 'The Hot Seat',     'Long-form narrative',             1.0, 'Lower volume, highest emotional intensity'),
  ('Emerging',                 'What new thing is being born?',       'Fits none of the six — watch','seed','Emerging',          'TBD',                             0.8, 'Where new topics are born — watch closely')
on conflict (name) do nothing;   -- was: do update … which reset the team's edits on EVERY boot

-- seed the 4 emotional registers (same fresh-DB-only guard as above)
delete from wh_emotional_register where not exists (select 1 from wh_emotional_register);
insert into wh_emotional_register(name, definition) values
  ('FOMO',      'Everyone''s already doing this → orient: cut noise, name what matters'),
  ('Anxiety',   'I''ll be left behind / replaced → steady: honest on risk, concrete on action'),
  ('Optimism',  'This could work for me → fuel: show proof, show the path'),
  ('Ambition',  'I want more than this → raise: the ceiling is higher than they think')
on conflict (name) do nothing;
