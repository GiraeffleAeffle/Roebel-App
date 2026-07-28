-- Provenance for every mutating workspace operation. Metadata only: slice 2
-- mirrors these rows to Nostr, where reads are open and deletion is advisory,
-- so document content must be structurally unable to reach this table.
create table if not exists public.workspace_actions (
  id           bigserial primary key,
  actor_kind   text        not null check (actor_kind in ('human', 'agent')),
  actor_sub    text        not null,
  acting_for   text,
  kind         text        not null,
  scope_kind   text        not null check (scope_kind in ('personal', 'org')),
  account_id   text,
  path         text        not null,
  at           timestamptz not null default now()
);

create index if not exists workspace_actions_actor_idx on public.workspace_actions (actor_sub, at desc);
create index if not exists workspace_actions_account_idx on public.workspace_actions (account_id, at desc);

-- An audit trail nobody may edit from the client. Writes come from the server
-- with the service role; RLS on with no policies denies the anon key entirely.
alter table public.workspace_actions enable row level security;
revoke all on public.workspace_actions from anon, authenticated;
