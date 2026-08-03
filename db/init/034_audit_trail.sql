-- ============================================================================
-- Platform audit trail — every action, by whom, when, on which app.
--
-- `audit_log` already existed (001) but was written by hand in a few places, so
-- coverage was patchy and it had no notion of WHICH APP an action belonged to.
-- These columns turn it into a complete, filterable activity record: the server
-- writes one row for every state-changing request, automatically.
-- ============================================================================

alter table audit_log add column if not exists app     text;    -- raydar | qlegal | contra | mint | admin | core
alter table audit_log add column if not exists method  text;    -- POST | DELETE …
alter table audit_log add column if not exists path    text;    -- the endpoint called
alter table audit_log add column if not exists status  int;     -- HTTP status returned
alter table audit_log add column if not exists ms      int;     -- how long it took
alter table audit_log add column if not exists role    text;    -- the actor's role at the time
alter table audit_log add column if not exists ip      text;

create index if not exists audit_log_at    on audit_log(at desc);
create index if not exists audit_log_app   on audit_log(app, at desc);
create index if not exists audit_log_actor on audit_log(actor, at desc);
