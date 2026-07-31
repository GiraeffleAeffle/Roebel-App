-- 20260801_account_membership_lockdown.sql
-- Closes SECURITY_FINDINGS_2026-07-28 §1 (+ the forgeable/enumerable invite_tokens
-- corollary) and §2. Anon-key writes on accounts/account_owners/invite_tokens are
-- replaced by SECURITY DEFINER RPCs (below) + the signature-verified org-membership
-- edge function (service role).
-- ⚠️ APPLY ONLY AFTER the org-membership edge function and rewired clients are live.

-- ── RPC ─────────────────────────────────────────────────────────────────────
-- The ONLY anon-callable function. Knowledge of the token is the credential
-- (bearer semantics); it takes no wallet parameter. All other membership
-- reads/writes go through the signature-verified org-membership edge function
-- (service role). Rule: no anon-granted function may take a wallet parameter
-- as an authorization input — owner wallets are public in account_owners, so
-- such a parameter is attacker-controlled.
create or replace function public.get_invite_by_token(p_token text)
returns invite_tokens
language sql security definer set search_path = public, pg_temp stable as $$
  select * from invite_tokens where token = p_token limit 1;
$$;

revoke all on function public.get_invite_by_token(text) from public;
grant execute on function public.get_invite_by_token(text) to anon, authenticated;

-- ── Policy lockdown ─────────────────────────────────────────────────────────
-- accounts: reads stay public; every write becomes service-role/RPC only.
drop policy if exists "accounts_insert" on accounts;                -- 005:25
drop policy if exists "accounts_update" on accounts;                -- 005:26  (finding §2)
drop policy if exists "accounts_delete" on accounts;                -- 20260504_accounts_delete_policy.sql:15

-- account_owners: reads stay public (keystone + UI rely on it); writes locked.
drop policy if exists "account_owners_insert" on account_owners;    -- 005:42  (finding §1)
drop policy if exists "account_owners_delete" on account_owners;    -- 005:43

-- invite_tokens: fully locked; bearer lookup goes through get_invite_by_token.
drop policy if exists "invite_tokens_select" on invite_tokens;      -- 011:58 (enumeration hole)
drop policy if exists "invite_tokens_insert" on invite_tokens;      -- 011:59 (forgery hole)
drop policy if exists "invite_tokens_update" on invite_tokens;      -- 011:60

-- ── Guarded owner deletion (fix round 2026-07-31 security review) ──────────
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
grant execute on function public.delete_owner_guarded(uuid,text) to service_role;
