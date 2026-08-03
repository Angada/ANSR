-- RayDar — the nine restored themes get real descriptions.
--
-- 036 brought them back and mapped them to a series, but left `description`
-- null. The theme editor reads that field, so they all showed as blank with
-- "Not worked out yet" — as if the content had been purged. Written in the same
-- plain-English voice as the client themes, so a reader cannot tell which came
-- from where. Each also carries the searcher question it answers.
update wh_demand_topic set description = v.d, question = coalesce(question, v.qn)
  from (values
    ('Skills to get a new job',
     'The foundational skills a job seeker needs to be hireable right now — what actually gets you shortlisted, versus what only looks good on a course list.',
     'What do I need to learn to get hired?'),
    ('Keywords and resume',
     'Getting a resume past the filter: the keywords that matter, how applicant-tracking systems read a CV, and the formatting mistakes that quietly bin an application.',
     'Why is my resume not getting through?'),
    ('Which coding tool to use',
     'The AI coding tools people are actually using this month — Cursor, Copilot, the rest — and which is worth learning rather than just talked about.',
     'What is everyone else using?'),
    ('Using AI to get better jobs',
     'Using AI in the job hunt itself: resumes, portfolios, interview prep. Where it genuinely helps, and where it reads as a shortcut to a recruiter.',
     'Is this a smart move or does it look like cheating?'),
    ('Landing your dream job',
     'Getting into the company someone actually wants — FAANG, a top GCC, a big switch. Long odds, high emotion, and what really separates the people who get in.',
     'Is it possible for someone like me?'),
    ('Career growth in GCCs',
     'Moving up inside a global capability centre — how promotion really works there, what gets noticed, and where careers stall.',
     'How do I actually get promoted here?'),
    ('Switching domains',
     'Changing function or industry mid-career: what transfers, what has to be rebuilt, and how to make the jump without starting over.',
     'Can I switch without going back to the start?'),
    ('Remote vs hybrid',
     'The trade-offs between remote, hybrid and in-office work — pay, progression, visibility — and how to choose without regretting it later.',
     'Which one is better for my career?'),
    ('Salary benchmarking',
     'What roles and bands genuinely pay, so a number can be checked against the market rather than guessed at.',
     'Am I being paid what the role is worth?')
  ) as v(nm, d, qn)
 where wh_demand_topic.name = v.nm
   and (wh_demand_topic.description is null or wh_demand_topic.description = '');
