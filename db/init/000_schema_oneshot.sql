-- ============================================================================
-- ONE-SHOT LEDGER — sorts first, so every later file can rely on it.
--
-- Every db/init/*.sql re-applies on EVERY boot. That is correct and wanted for
-- SCHEMA (create table if not exists, add column if not exists — all idempotent).
-- It is actively destructive for DATA: a seed written as `on conflict do update`,
-- or a bare `update … set active = …`, silently reverts whatever the team changed
-- in the app the last time the container restarted. Turn a theme off in Settings,
-- restart, and it is back on.
--
-- Files 014, 031, 032 and 036 were each retro-fitted with a bespoke guard after
-- exactly that happened. This table replaces the bespoke guards with one honest
-- mechanism: a data mutation records that it ran, and never runs again.
--
--   do $$
--   begin
--     if not exists (select 1 from schema_oneshot where key = '047_way_up_activate') then
--       update wh_franchise set active = true where name = 'Way Up';
--       insert into schema_oneshot(key) values ('047_way_up_activate');
--     end if;
--   end $$;
--
-- SCHEMA changes never need this. Only statements that write data a human can
-- later edit — seeds with `do update`, and `update`/`delete` on user-facing rows.
-- ============================================================================

create table if not exists schema_oneshot (
  key        text primary key,
  applied_at timestamptz not null default now()
);
