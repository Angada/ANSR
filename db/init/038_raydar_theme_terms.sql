-- RayDar — search terms for every theme that was missing them.
--
-- Same thinking as the terms already seeded: short, high-intent phrases a job
-- seeker would ACTUALLY type into YouTube or Reddit — not marketing phrasing,
-- not the theme's own name. 4-5 per theme, India-English, lower case.
--
-- "india" appears only as a MODIFIER on a phrase that already carries meaning
-- ("salary negotiation india"), never as a term on its own — a bare geography
-- term is what pulled cricket and comedy into the feed before the relevance fix.
update wh_demand_topic set terms = v.t
  from (values
    ('Career growth in GCCs', array[
      'career growth in gcc','how to get promoted india','gcc career path','global capability centre career','promotion tips india']),
    ('Switching domains', array[
      'switching career domain','change industry mid career','career pivot india','how to switch domains tech','transferable skills career change']),
    ('Remote vs hybrid', array[
      'remote vs hybrid work','work from home vs office india','hybrid work policy india','is remote work bad for career','return to office india']),
    ('Salary benchmarking', array[
      'salary for my role india','how much does x pay india','tech salary benchmark india','am i underpaid','ctc comparison india']),
    ('Role specific advice', array[
      'data analyst career advice','product manager india career','devops career path india','qa engineer career','how to become sre']),
    ('Interview tips and tricks', array[
      'interview tips india','most asked interview questions','how to answer tell me about yourself','interview mistakes to avoid','hr round questions india']),
    ('Questions to ask at each stage', array[
      'questions to ask interviewer','what to ask hr round','questions to ask before accepting offer','smart questions to ask in interview','what to ask hiring manager']),
    ('Resume improvements', array[
      'resume mistakes india','how to write resume for tech job','resume format 2026','fix my resume','resume review india']),
    ('Upskilling', array[
      'skills to learn 2026','which certification is worth it','upskilling for tech jobs','best course to get a job','learn new skill for promotion']),
    ('AI-readiness', array[
      'will ai take my job','ai skills for my job','how to use ai at work','ai proof career','learn ai for non technical'])
  ) as v(nm, t)
 where wh_demand_topic.name = v.nm
   and coalesce(array_length(wh_demand_topic.terms, 1), 0) = 0;
