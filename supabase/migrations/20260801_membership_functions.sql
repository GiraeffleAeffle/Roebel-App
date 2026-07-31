-- 20260801_membership_functions.sql
-- Additive only — SAFE to apply immediately, BEFORE the edge function deploys.
--
-- Split off the previously-combined 20260801_account_membership_lockdown.sql
-- (deploy-order fix, security review round 2): the org-membership edge
-- function's leave/remove_member handlers call delete_owner_guarded, so
-- that function (and get_invite_by_token, and the account_owners
-- case-insensitive uniqueness guard below) must exist BEFORE the edge
-- function goes live — not gated behind the same "apply only after" fence
-- as the policy lockdown in 20260802_account_membership_lockdown.sql, which
-- would otherwise 500 every leave/remove_member call for the entire deploy
-- window between "edge function live" and "this migration applied".

-- ── RPC: bearer-token invite lookup ─────────────────────────────────────────
-- The ONLY anon-callable function in this pair of migrations. Knowledge of
-- the token is the credential (bearer semantics); it takes no wallet
-- parameter. All other membership reads/writes go through the
-- signature-verified org-membership edge function (service role). Rule: no
-- anon-granted function may take a wallet parameter as an authorization
-- input — owner wallets are public in account_owners, so such a parameter
-- is attacker-controlled.
create or replace function public.get_invite_by_token(p_token text)
returns invite_tokens
language sql security definer set search_path = public, pg_temp stable as $$
  select * from invite_tokens where token = p_token limit 1;
$$;

revoke all on function public.get_invite_by_token(text) from public;
grant execute on function public.get_invite_by_token(text) to anon, authenticated;

-- ── Guarded owner deletion ───────────────────────────────────────────────────
-- Closes a TOCTOU race in the org-membership edge function's leave/
-- remove_member handlers: without this, two concurrent calls against the
-- same account could both read owner_count > 1 and both proceed, leaving
-- the account with zero owners. `for update` locks the account's
-- account_owners rows before counting, serializing the count-then-delete
-- against any other concurrent call on the same account_id. service_role
-- grant ONLY — the edge function is the only caller, never anon/authenticated
-- (same wallet-parameter-is-attacker-controlled rule as above, but here the
-- caller already had to pass signature verification before this runs).
create or replace function public.delete_owner_guarded(p_account_id uuid, p_wallet text)
returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_deleted_role text; v_owner_count int;
begin
  perform 1 from account_owners where account_id = p_account_id for update;
  select role into v_deleted_role from account_owners
    where account_id = p_account_id and lower(wallet_address) = lower(p_wallet);
  if v_deleted_role is null then return 'not_a_member'; end if;
  select count(*) into v_owner_count from account_owners
    where account_id = p_account_id and role = 'owner';
  if v_deleted_role = 'owner' and v_owner_count <= 1 then return 'last_owner'; end if;
  delete from account_owners
    where account_id = p_account_id and lower(wallet_address) = lower(p_wallet);
  return 'deleted';
end $$;

revoke all on function public.delete_owner_guarded(uuid,text) from public;
-- Supabase's ALTER DEFAULT PRIVILEGES grants EXECUTE to anon/authenticated on
-- every new function; revoking from PUBLIC alone does NOT remove those direct
-- grants (verified against production 2026-07-31). Revoke them explicitly.
revoke execute on function public.delete_owner_guarded(uuid,text) from anon, authenticated;
grant execute on function public.delete_owner_guarded(uuid,text) to service_role;

-- ── Guarded owner role change ─────────────────────────────────────────────────
-- Sibling to delete_owner_guarded above, closing the same TOCTOU race for role
-- changes (Task 6b): without the `for update` lock, a concurrent demote of an
-- account's last owner could race a concurrent leave/remove_member on the
-- same account and both pass their independent checks, leaving the account
-- with zero owners. Refuses to demote the sole remaining owner away from
-- 'owner'. service_role grant ONLY — the org-membership edge function's
-- update_member_role action (which already requires the signer to hold
-- 'owner' role before calling this) is the only caller, never anon/
-- authenticated (same wallet-parameter-is-attacker-controlled rule as above).
create or replace function public.set_owner_role_guarded(p_account_id uuid, p_wallet text, p_role text)
returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_current_role text; v_owner_count int;
begin
  if p_role not in ('owner', 'admin', 'member') then
    raise exception 'invalid role: %', p_role;
  end if;
  perform 1 from account_owners where account_id = p_account_id for update;
  select role into v_current_role from account_owners
    where account_id = p_account_id and lower(wallet_address) = lower(p_wallet);
  if v_current_role is null then return 'not_a_member'; end if;
  if v_current_role = 'owner' and p_role <> 'owner' then
    select count(*) into v_owner_count from account_owners
      where account_id = p_account_id and role = 'owner';
    if v_owner_count <= 1 then return 'last_owner'; end if;
  end if;
  update account_owners set role = p_role
    where account_id = p_account_id and lower(wallet_address) = lower(p_wallet);
  return 'updated';
end $$;

revoke all on function public.set_owner_role_guarded(uuid,text,text) from public;
revoke execute on function public.set_owner_role_guarded(uuid,text,text) from anon, authenticated;
grant execute on function public.set_owner_role_guarded(uuid,text,text) to service_role;

-- ── Case-insensitive wallet uniqueness guard ─────────────────────────────────
-- At least one production account_owners row stores a checksummed wallet
-- address (pre-dates this lockdown's lower-casing convention). The edge
-- function's lookups now use .ilike() to tolerate it, but that only papers
-- over the read side — if a write path ever inserted a *lowercase* sibling
-- row for the same (account_id, wallet) pair (e.g. accept_invite), ilike
-- lookups (and .maybeSingle() in particular) would start matching 2 rows
-- and 500 forever. This index makes that structurally impossible going
-- forward. Verified zero duplicate-case pairs exist in production today, so
-- this is safe to apply immediately. Existing data is NOT normalized —
-- account_owners.wallet_address has no FK cascade from users that would
-- make a case rewrite safe to do blindly here.
create unique index if not exists uq_account_owners_account_lower_wallet
  on account_owners (account_id, lower(wallet_address));
