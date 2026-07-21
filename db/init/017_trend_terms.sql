-- Trend Spotting concepts get editable search terms (what each concept "covers").
-- These terms are the actual queries fired at YouTube/Reddit/News per topic.
alter table wh_demand_topic add column if not exists terms text[] default '{}';

-- seed default seed-terms per concept (editable in-app; only if empty)
update wh_demand_topic set terms='{"resume tips india","ATS resume","resume keywords","cv mistakes"}'                 where name='Keywords and resume'         and (terms is null or array_length(terms,1) is null);
update wh_demand_topic set terms='{"salary negotiation india","how to negotiate salary","counter offer","salary hike"}' where name='Salary negotiation'          and (terms is null or array_length(terms,1) is null);
update wh_demand_topic set terms='{"using ai for job search","chatgpt resume","ai interview prep","ai portfolio"}'     where name='Using AI to get better jobs'   and (terms is null or array_length(terms,1) is null);
update wh_demand_topic set terms='{"how to get dream job","land tech job india","dream company","faang india"}'        where name='Landing your dream job'         and (terms is null or array_length(terms,1) is null);
update wh_demand_topic set terms='{"skills to get a job","in-demand skills 2026","upskilling india","switch domains"}' where name='Skills to get a new job'       and (terms is null or array_length(terms,1) is null);
update wh_demand_topic set terms='{"best coding tool","cursor vs copilot","which ide 2026","ai coding assistant"}'     where name='Which coding tool to use'      and (terms is null or array_length(terms,1) is null);
