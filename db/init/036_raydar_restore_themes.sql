-- RayDar — bring the earlier themes back, mapped into the client's series.
--
-- These were retired in 031 because they were OUR phrasing rather than
-- Talent500's. But they cover real ground the seven client themes don't, and
-- every one of them belongs under an existing 1Up series. So: reactivated and
-- mapped, rather than thrown away. Wording kept as-is — they read as searcher
-- questions, which is exactly what a demand concept should sound like.
update wh_demand_topic set active = true, series = '1Up', franchise = v.fr
  from (values
    ('Skills to get a new job',    'Skill Up'),
    ('Which coding tool to use',   'Skill Up'),
    ('Using AI to get better jobs','Skill Up'),
    ('Keywords and resume',        'Resume Lab'),
    ('Landing your dream job',     '1Up'),
    ('Career growth in GCCs',      '1Up'),
    ('Switching domains',          '1Up'),
    ('Remote vs hybrid',           '1Up'),
    ('Salary benchmarking',        '1Up')
  ) as v(nm, fr)
 where wh_demand_topic.name = v.nm;
