-- Workspace sessions. Server-side because Collabora calls the WOPI endpoints
-- itself, carrying no browser cookie — a cookie-only session is unreadable
-- exactly where a document load needs it.
create table if not exists public.workspace_sessions (
  id            text        primary key,
  sub           text        not null,
  groups        text[]      not null default '{}',
  access_token  text        not null,
  refresh_token text,
  expires_at    timestamptz not null,
  created_at    timestamptz not null default now()
);

create index if not exists workspace_sessions_sub_idx on public.workspace_sessions (sub);

-- This table holds live OAuth tokens. RLS on with NO policies, plus an explicit
-- revoke: the anon key ships inside the app bundle, and a readable version
-- would hand any reader every citizen's Nextcloud access token.
alter table public.workspace_sessions enable row level security;
revoke all on public.workspace_sessions from anon, authenticated;
