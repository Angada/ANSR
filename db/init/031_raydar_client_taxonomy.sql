-- ============================================================================
-- RayDar — Talent500's REAL content taxonomy, in the client's own words.
--
-- Source: Supriya Kamat's mail of 31-Jul-2026 ("Talent500 Content Series: 1Up &
-- Way Up") + Vikram Ahuja's narrowing ("For this, lets focus on 1Up") on the
-- same thread. Everything below is quoted or paraphrased from that mail — we
-- invented nothing.
--
-- What this replaces: the placeholder franchises we shipped in 014 (Stack Up,
-- Pay Up, TrAIbe × Accelor, The Hot Seat). Those were OURS, not theirs — a
-- sweep was routing ideas to franchises the client has never heard of. They are
-- DEACTIVATED, never deleted, because existing stories reference them by name.
--
-- The new model: a THEME is described by the content team in plain English.
-- That description is compiled (raydar-theme-compile) into the operational
-- logic the pipelines actually run on — search terms fired at YouTube/Reddit,
-- the franchise it routes to, and what counts as on- or off-theme. Words in,
-- logic out; the human always confirms before it saves.
-- ============================================================================

-- ---- a theme is now DESCRIBED, then compiled -------------------------------
alter table wh_demand_topic add column if not exists description  text;    -- the content team's own words
alter table wh_demand_topic add column if not exists compiled     jsonb;   -- what those words compiled into
alter table wh_demand_topic add column if not exists compiled_at  timestamptz;
alter table wh_demand_topic add column if not exists series       text;    -- parent property: 1Up | Way Up

-- ---- franchises gain the client's structure: a parent series + a blurb -----
alter table wh_franchise add column if not exists parent text;
alter table wh_franchise add column if not exists blurb  text;

-- retire our invented routing targets (keep the rows — stories point at them)
update wh_franchise set active = false
 where name in ('Stack Up', 'Pay Up', 'TrAIbe × Accelor', 'The Hot Seat');

-- the two real properties + 1Up's three sub-series, in Supriya's own wording
insert into wh_franchise(name, stage, format_home, parent, blurb, active) values
  ('1Up', 'expert led, tips and tricks content', 'Fast, listicle style — scroll stopping and shareable', null,
   'Expert led tips and tricks. Fast, listicle style content built for scroll stopping value and shareability. Deliberately edgy and punchy — think "3 questions to ask that''ll win you the interview". Covers everything tied to landing a GCC job.', true),
  ('Interview Lab', 'interview prep', 'Listicle · short-form', '1Up',
   'Interview specific tips, tactical and specific — e.g. "3 things to ask your interviewer to stand out".', true),
  ('Resume Lab', 'resume / application', 'Listicle · carousel', '1Up',
   'Resume tips and fixes — framing over content.', true),
  ('Way Up', 'narrative series', 'Long-form storytelling', null,
   'A longer form storytelling series following a GCC leader''s journey, career arc, key decisions and lessons learned — documentary and human interest in tone, versus 1Up''s tips format.', false)
on conflict (name) do update set stage=excluded.stage, format_home=excluded.format_home,
  parent=excluded.parent, blurb=excluded.blurb, active=excluded.active;

-- Skill Up already exists from 014 — restate it in the client's words, under 1Up
update wh_franchise
   set parent = '1Up', active = true,
       stage = 'AI and upskilling',
       format_home = 'Listicle · short-form',
       blurb = 'AI and upskilling focused — e.g. "5 skills you need to land your next role".'
 where name = 'Skill Up';

update wh_franchise set blurb = 'Where a theme that fits none of the above is parked and watched.'
 where name = 'Emerging' and blurb is null;

-- ---- the themes, in the client's words -------------------------------------
-- Vikram named five for 1Up; Supriya's mail adds two more that 1Up also covers.
-- All seven are live so the team can describe and tune each one.
insert into wh_demand_topic(name, question, definition, description, source, franchise, series, format_home, strategic_weight, notes, active) values
  ('Interview tips and tricks', 'What will they ask me, and how do I answer?',
   'Must know questions, how to answer', 'Interview specific tips — tactical and specific. Must know questions and how to answer them. The kind of thing that makes someone stand out in the room, e.g. "3 things to ask your interviewer".',
   'client', 'Interview Lab', '1Up', 'Listicle · short-form', 1.0, 'Vikram, 31-Jul-2026: a named 1Up theme', true),

  ('Resume improvements', 'Why am I not getting callbacks?',
   'Keywords, structure', 'Resume tips and fixes — framing over content. How the resume is structured and worded, the keywords that get it read, the fixes that turn it around.',
   'client', 'Resume Lab', '1Up', 'Listicle · carousel', 1.1, 'Vikram, 31-Jul-2026: a named 1Up theme', true),

  ('Salary negotiation', 'Am I leaving money on the table?',
   'Negotiation, hikes, CTC', 'How to negotiate — asking for the right number, handling the hike conversation, knowing what a role is actually worth in a GCC.',
   'client', '1Up', '1Up', 'Listicle · short-form', 1.0, 'Vikram, 31-Jul-2026: a named 1Up theme. Underserved in India — high demand, low quality supply', true),

  ('Upskilling', 'What should I learn next?',
   'Skills that get you the next role', 'What to learn to land the next role, and what is genuinely worth the time versus noise.',
   'client', 'Skill Up', '1Up', 'Listicle · short-form', 1.0, 'Vikram, 31-Jul-2026: a named 1Up theme', true),

  ('AI-readiness', 'Am I going to be replaced, or can I use this?',
   'Being ready for AI at work', 'Being ready for AI in your work and your job hunt — what to learn, what it changes, and how to use it without it looking like a shortcut.',
   'client', 'Skill Up', '1Up', 'Listicle · short-form', 1.5, 'Vikram, 31-Jul-2026: a named 1Up theme. Highest strategic value', true),

  ('Role specific advice', 'What does it take in MY role?',
   'Advice cut by role', 'Advice cut by the specific role someone is going for, rather than generic career advice.',
   'client', '1Up', '1Up', 'Listicle · short-form', 0.9, 'Supriya, 31-Jul-2026: "1Up also covers... role specific advice"', true),

  ('Questions to ask at each stage', 'What should I be asking, and when?',
   'What to ask at each hiring stage', 'What a candidate should be asking at each stage of the hiring process — screening, interview, offer — and why it lands well.',
   'client', 'Interview Lab', '1Up', 'Listicle · short-form', 0.9, 'Supriya, 31-Jul-2026: "...and what questions to ask at each stage"', true)
on conflict (name) do update set question=excluded.question, definition=excluded.definition,
  description=excluded.description, franchise=excluded.franchise, series=excluded.series,
  format_home=excluded.format_home, strategic_weight=excluded.strategic_weight,
  notes=excluded.notes, source=excluded.source, active=excluded.active;

update wh_demand_topic set description = 'Anything that fits none of the named themes — parked here and watched, so a new theme has somewhere to be born.',
       series = '1Up', franchise = 'Emerging'
 where name = 'Emerging' and description is null;

-- retire OUR phrasings (never delete — old batches reference them by name)
update wh_demand_topic set active = false
 where name in ('Skills to get a new job', 'Keywords and resume', 'Which coding tool to use',
                'Using AI to get better jobs', 'Landing your dream job',
                'Career growth in GCCs', 'Switching domains', 'Remote vs hybrid', 'Salary benchmarking');
