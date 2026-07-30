-- Q-Legal · SharePoint sync state (singleton). Connection config (secret AES-
-- encrypted via CONFIG_SECRET, same as the Vault), the Graph delta link so each
-- scan only sees what changed, and the last run's result. Idempotent.

create table if not exists ql_sync (
  id int primary key default 1 check (id = 1),
  config jsonb not null default '{}'::jsonb,     -- tenant_id, client_id, client_secret(enc:), site_id, drive_id?, folder?
  delta_link text,                               -- Graph delta cursor — null = full first scan
  nightly boolean not null default true,         -- the 2:00 AM IST scan
  last_run timestamptz,
  last_result jsonb,
  updated_at timestamptz not null default now()
);
insert into ql_sync (id) values (1) on conflict do nothing;
