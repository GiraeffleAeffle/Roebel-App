-- 20260801_account_membership_lockdown.sql
-- Closes SECURITY_FINDINGS_2026-07-28 §1 (+ the forgeable/enumerable invite_tokens
-- corollary) and §2. Anon-key writes on accounts/account_owners/invite_tokens are
-- replaced by SECURITY DEFINER RPCs (below) + the signature-verified org-membership
-- edge function (service role).
-- ⚠️ APPLY ONLY AFTER the org-membership edge function and rewired clients are live.

-- ── RPCs ────────────────────────────────────────────────────────────────────
create or replace function public.create_account_with_owner(
  p_wallet text, p_account_type text, p_name text,
  p_sub_type text default null, p_bio text default null, p_avatar_url text default null
) returns accounts
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_account accounts;
begin
  if p_account_type not in ('personal','organisation') then
    raise exception 'invalid account_type' using errcode = '22023';
  end if;
  insert into accounts (account_type, name, sub_type, bio, avatar_url)
  values (p_account_type, p_name, p_sub_type, p_bio, p_avatar_url)
  returning * into v_account;
  insert into account_owners (account_id, wallet_address, role)
  values (v_account.id, lower(p_wallet), 'owner');
  return v_account;
end $$;

create or replace function public.get_invite_by_token(p_token text)
returns invite_tokens
language sql security definer set search_path = public, pg_temp stable as $$
  select * from invite_tokens where token = p_token limit 1;
$$;

create or replace function public.list_pending_invites(p_account_id uuid, p_wallet text)
returns setof invite_tokens
language sql security definer set search_path = public, pg_temp stable as $$
  select i.* from invite_tokens i
  where i.account_id = p_account_id and i.status = 'pending'
    and exists (select 1 from account_owners o
                where o.account_id = p_account_id
                  and lower(o.wallet_address) = lower(p_wallet)
                  and o.role in ('owner','admin'));
$$;

create or replace function public.has_pending_invite(p_account_id uuid, p_wallet text)
returns boolean
language sql security definer set search_path = public, pg_temp stable as $$
  select exists (select 1 from invite_tokens
    where account_id = p_account_id and status = 'pending'
      and lower(coalesce(invited_wallet,'')) = lower(p_wallet));
$$;

revoke all on function public.create_account_with_owner(text,text,text,text,text,text) from public;
revoke all on function public.get_invite_by_token(text) from public;
revoke all on function public.list_pending_invites(uuid,text) from public;
revoke all on function public.has_pending_invite(uuid,text) from public;
grant execute on function public.create_account_with_owner(text,text,text,text,text,text) to anon, authenticated;
grant execute on function public.get_invite_by_token(text) to anon, authenticated;
grant execute on function public.list_pending_invites(uuid,text) to anon, authenticated;
grant execute on function public.has_pending_invite(uuid,text) to anon, authenticated;

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
