-- rls-write-policies.sql — a standing assertion, not a one-off audit.
--
-- WHY THIS EXISTS
-- SECURITY_FINDINGS_2026-07-28 flagged permissive write policies on three tables
-- and said "verify against production before acting". Nobody did, for 15 days,
-- and the fix (20260802_account_membership_lockdown.sql) sat unapplied. A finding
-- that lives only in markdown is a finding that rots. This is the same knowledge
-- as an assertion the database itself can fail.
--
-- HOW TO RUN
--   Supabase MCP: execute_sql with this file's contents (mandated by CLAUDE.md).
--   psql:         psql "$SUPABASE_DB_URL" -f supabase/checks/rls-write-policies.sql
-- It RAISES EXCEPTION on regression and prints the offenders as NOTICEs either way.
--
-- ── THE STRUCTURAL FACT THIS ENCODES ────────────────────────────────────────
-- Measured 2026-08-12 against production:
--
--     156  write policies (INSERT/UPDATE/DELETE/ALL) in schema public
--       0  of them reference auth.uid()
--      25  have names claiming ownership ("own", "their", "self")
--      25  of those 25 evaluate to literal `true`
--      81  tables are anon/authenticated-writable behind a `true` policy
--
-- This app authenticates by WALLET (thirdweb smart accounts), not by Supabase
-- Auth, so `auth.uid()` is null on every request and RLS has no subject to bind
-- to. Policies named "Users can update their own posts" therefore cannot mean
-- that, and do not: they are `true`. Authorization really lives in the signed
-- edge functions and the client.
--
-- That is a legitimate architecture. What is NOT legitimate is policy names that
-- assert a guarantee the policy does not implement — that is how three of these
-- were mistaken for safe until someone read the expression instead of the name.
-- Assertion 1 is a lie detector for exactly that.
--
-- These are RATCHETS with a dated baseline, not a clean bill of health. They do
-- not claim the debt is fixed; they stop it growing silently. When you fix some,
-- LOWER the baseline in the same commit — that is the whole mechanism.

do $$
declare
  baseline_ownership_lies constant int := 25;  -- measured 2026-08-12
  baseline_anon_write_tables constant int := 81;  -- measured 2026-08-12
  n_lies int;
  n_tables int;
  offender record;
begin
  -- ── Assertion 1: no policy may claim ownership it does not enforce ────────
  with pol as (
    select tablename, policyname, cmd,
           coalesce(qual, '') as q, coalesce(with_check, '') as wc
    from pg_policies
    where schemaname = 'public'
      and permissive = 'PERMISSIVE'
      and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  )
  select count(*) into n_lies
  from pol
  where policyname ~* '(own|their|self)' and 'true' in (q, wc);

  raise notice '--- policies claiming ownership but evaluating to true (% found) ---', n_lies;
  for offender in
    select tablename, policyname, cmd
    from pg_policies
    where schemaname = 'public' and permissive = 'PERMISSIVE'
      and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
      and policyname ~* '(own|their|self)'
      and 'true' in (coalesce(qual, ''), coalesce(with_check, ''))
    order by tablename, policyname
  loop
    raise notice '  %.% [%]', offender.tablename, offender.policyname, offender.cmd;
  end loop;

  if n_lies > baseline_ownership_lies then
    raise exception
      'RLS regression: % policies claim ownership in their name but evaluate to true (baseline %). A policy name that promises "own row" while the expression is `true` is how a hole hides in plain sight — either enforce it or rename it.',
      n_lies, baseline_ownership_lies;
  end if;

  -- ── Assertion 2: no NEW table becomes anon-writable-by-default ────────────
  -- Scoped to tables the anon/authenticated roles actually hold write grants on,
  -- because a permissive policy on a table no client role can write is inert.
  with writable as (
    select distinct p.tablename
    from pg_policies p
    join (
      select distinct table_name
      from information_schema.role_table_grants
      where table_schema = 'public'
        and grantee in ('anon', 'authenticated')
        and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
    ) g on g.table_name = p.tablename
    where p.schemaname = 'public'
      and p.permissive = 'PERMISSIVE'
      and p.cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
      and 'true' in (coalesce(p.qual, ''), coalesce(p.with_check, ''))
  )
  select count(*) into n_tables from writable;

  if n_tables > baseline_anon_write_tables then
    raise exception
      'RLS regression: % tables are anon-writable with a `true` write policy (baseline %). Route the write through a signature-verified edge function, or add the table to the baseline with a written reason.',
      n_tables, baseline_anon_write_tables;
  end if;

  raise notice 'OK — ownership lies: %/%  ·  anon-writable tables: %/%',
    n_lies, baseline_ownership_lies, n_tables, baseline_anon_write_tables;
end $$;

-- ── The three tables the lockdown migration closes ──────────────────────────
-- Kept as a named query rather than an assertion, because 20260802 is gated on
-- EAS-build adoption (older installed Expo builds still write these directly).
-- After that migration is applied this returns ZERO ROWS; until then it is the
-- exact live blast radius. Run it before deciding.
select tablename, policyname, cmd,
       coalesce(qual, with_check) as expression
from pg_policies
where schemaname = 'public'
  and tablename in ('accounts', 'account_owners', 'invite_tokens')
  and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
order by tablename, cmd;
