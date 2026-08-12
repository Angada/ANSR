-- ============================================================================
-- Supabase linter: RLS disabled in public + a SECURITY DEFINER view.
--
-- WHY THIS MATTERS. Supabase exposes the `public` schema through PostgREST.
-- With RLS off, anyone holding the project's anon key can read — and in some
-- configurations write — every table over the REST API, entirely bypassing this
-- application and its login. That is the whole estate: contracts, rosters,
-- audit log, API-key config rows.
--
-- WHY IT IS SAFE FOR THE APP. Q&ANSR does not use PostgREST. It connects
-- directly over Postgres as the table OWNER (`qansr`: superuser, BYPASSRLS).
-- A table owner is exempt from RLS unless FORCE ROW LEVEL SECURITY is set, and
-- we deliberately do NOT set it. So the app is unaffected; only the REST door
-- closes.
--
-- NO POLICIES ARE CREATED, on purpose. RLS enabled with zero policies means
-- default-deny for every non-owner role. If a genuine PostgREST client is ever
-- needed, add narrow policies for exactly that role — never a blanket
-- `using (true)`, which would re-open this.
--
-- Runs on every boot and covers tables added later, so a new table cannot
-- silently arrive unprotected.
-- ============================================================================

do $$
declare
  t record;
  n int := 0;
begin
  for t in
    select c.relname
      from pg_class c
      join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = 'public'
       and c.relkind = 'r'          -- ordinary tables only
       and c.relrowsecurity = false -- idempotent: skip the ones already done
  loop
    execute format('alter table public.%I enable row level security', t.relname);
    n := n + 1;
  end loop;
  if n > 0 then
    raise notice 'RLS: enabled on % table(s) in public', n;
  end if;
end $$;

-- ---- the SECURITY DEFINER view --------------------------------------------
-- `portfolio_billing` ran with its CREATOR's permissions, so any caller who
-- could reach the view read through the owner's rights — sidestepping both RLS
-- and the querying role's own grants. security_invoker makes it run as the
-- caller, which is what a reporting view should always do.
do $$
begin
  if exists (select 1 from pg_views where schemaname = 'public' and viewname = 'portfolio_billing') then
    execute 'alter view public.portfolio_billing set (security_invoker = on)';
  end if;
end $$;
