create table if not exists oidc_payloads (
  id text not null,
  type text not null,
  payload jsonb not null,
  grant_id text,
  user_code text,
  uid text,
  expires_at timestamptz,
  primary key (type, id)
);
create index if not exists oidc_payloads_uid on oidc_payloads (uid);
create index if not exists oidc_payloads_user_code on oidc_payloads (user_code);
create index if not exists oidc_payloads_grant_id on oidc_payloads (grant_id);

-- oidc_payloads holds OAuth tokens/codes/sessions. This table lives in a Supabase
-- project that serves public anon/publishable keys via PostgREST. Enable RLS with NO
-- policies so anon/authenticated have zero access; the roebel-id service uses the
-- service_role key, which bypasses RLS.
alter table oidc_payloads enable row level security;
revoke all on oidc_payloads from anon, authenticated;
