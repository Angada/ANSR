-- ============================================================================
-- RayDar — switch Way Up on, alongside 1Up and its labs.
--
-- Way Up is Talent500's SECOND content series (Supriya, 31-Jul-2026): a longer
-- form storytelling series following a GCC leader's journey, career arc, key
-- decisions and lessons learned — documentary and human interest in tone,
-- versus 1Up's tips format.
--
-- It was seeded inactive in 031 because Vikram narrowed the first build to 1Up.
-- Now live as a peer series with its own themes, because a narrative series
-- hunts a genuinely different signal: 1Up looks for questions people ask, Way
-- Up looks for journeys people tell. Same sweep, different demand.
-- ============================================================================

update wh_franchise set active = true where name = 'Way Up';

-- Way Up's own themes. Search terms aim at first-person career STORIES, not
-- how-to answers — the phrasing someone uses when telling what happened to
-- them, rather than asking what to do.
insert into wh_demand_topic
  (name, question, definition, description, source, franchise, series, format_home, strategic_weight, notes, active)
values
  ('Leader journeys', 'How did someone like me get there?',
   'The career arc of a GCC leader, start to now',
   'The long road: how someone reached a senior role in a GCC — where they started, the jobs that did not work out, and what the climb actually looked like from inside it.',
   'client', 'Way Up', 'Way Up', 'Long-form narrative', 1.0,
   'Supriya, 31-Jul-2026: Way Up follows a GCC leader''s journey and career arc', true),

  ('Decisions that changed a career', 'Which choice actually mattered?',
   'The pivot points — the call that changed everything',
   'The single decisions people point to years later: the offer they turned down, the move sideways, the risky team they joined. What the choice looked like at the time, and what it cost.',
   'client', 'Way Up', 'Way Up', 'Long-form narrative', 1.0,
   'Supriya, 31-Jul-2026: "key decisions"', true),

  ('Lessons learned the hard way', 'What do they wish they had known?',
   'Hindsight from people further along',
   'What senior people say they got wrong — the misread, the wasted year, the thing nobody tells you early. Honest rather than triumphant.',
   'client', 'Way Up', 'Way Up', 'Long-form narrative', 1.0,
   'Supriya, 31-Jul-2026: "lessons learned"', true)
on conflict (name) do nothing;

-- Search terms: story-shaped, not question-shaped.
update wh_demand_topic set terms = v.t
  from (values
    ('Leader journeys', array[
      'my career journey india','from fresher to manager','how i became a director',
      'gcc leadership journey','career story india tech']),
    ('Decisions that changed a career', array[
      'best career decision i made','i turned down the offer','career pivot story',
      'why i left my job story','biggest career risk']),
    ('Lessons learned the hard way', array[
      'career mistakes i made','what i wish i knew earlier career',
      'career advice from experience','lessons from 10 years working','my biggest career regret'])
  ) as v(nm, t)
 where wh_demand_topic.name = v.nm
   and coalesce(array_length(wh_demand_topic.terms, 1), 0) = 0;
