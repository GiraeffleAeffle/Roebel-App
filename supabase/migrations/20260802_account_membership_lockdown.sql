-- 20260802_account_membership_lockdown.sql
-- Closes SECURITY_FINDINGS_2026-07-28 §1 (+ the forgeable/enumerable invite_tokens
-- corollary) and §2. Anon-key writes on accounts/account_owners/invite_tokens are
-- replaced by the functions in 20260801_membership_functions.sql (which must
-- already be applied) + the signature-verified org-membership edge function
-- (service role).
-- ⚠️ APPLY ONLY AFTER the org-membership edge function and rewired clients are live.

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
