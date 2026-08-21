-- Durable, public read model for source-bound signed Public Mecky replies.
--
-- Citizens keep writing ordinary posts/comments through the existing tables.
-- Only the Edge Function's service role may project a cryptographically verified
-- agent event. The application receives read access, not write authority.

create table if not exists public.public_mecky_replies (
  event_id text primary key check (event_id ~ '^[0-9a-f]{64}$'),
  request_event_id text not null unique check (request_event_id ~ '^[0-9a-f]{64}$'),
  source_post_id text not null check (
    source_post_id ~ '^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[0-9a-f]{64})$'
  ),
  source_comment_id text check (
    source_comment_id is null or source_comment_id ~ '^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[0-9a-f]{64})$'
  ),
  agent_pubkey text not null check (agent_pubkey ~ '^[0-9a-f]{64}$'),
  content text not null check (length(btrim(content)) between 1 and 2000),
  evidence_refs jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence_refs) = 'array'),
  event_created_at timestamptz not null,
  projected_at timestamptz not null default now(),
  authority_binding text not null default 'none' check (authority_binding = 'none'),
  signed_event jsonb not null check (jsonb_typeof(signed_event) = 'object')
);

create index if not exists public_mecky_replies_post_time_idx
  on public.public_mecky_replies (source_post_id, event_created_at, event_id);
create index if not exists public_mecky_replies_comment_time_idx
  on public.public_mecky_replies (source_comment_id, event_created_at, event_id)
  where source_comment_id is not null;

alter table public.public_mecky_replies enable row level security;
drop policy if exists public_mecky_replies_public_read on public.public_mecky_replies;
create policy public_mecky_replies_public_read
  on public.public_mecky_replies
  for select
  to anon, authenticated
  using (authority_binding = 'none');

revoke all on table public.public_mecky_replies from anon, authenticated;
grant select on table public.public_mecky_replies to anon, authenticated;
