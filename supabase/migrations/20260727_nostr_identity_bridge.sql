-- Nostr identity bridge (slice 1) — wallet↔npub registry + publication tracking.
-- Spec: docs/superpowers/specs/2026-07-27-nostr-citizen-identity-bridge-design.md
--
-- Two tables with DELIBERATELY DIFFERENT access postures. Read the note on
-- nostr_identities before adding any policy to it.

-- ---------------------------------------------------------------------------
-- 1. nostr_identities — the private registry the relay allow-list syncs from.
-- ---------------------------------------------------------------------------
-- ACCESS POSTURE: RLS enabled with NO POLICIES, plus an explicit REVOKE. That
-- means anon and authenticated have zero access; only service_role (which
-- bypasses RLS) can read or write it.
--
-- This is a deliberate departure from the permissive `USING (true)` pattern used
-- elsewhere in this schema. Everywhere else, the data is already public. Here it
-- is not: this table maps wallet_address -> npub, and the Supabase anon key ships
-- inside the app bundle. A readable version of this table would hand anyone a
-- bulk index linking every Citizen's Nostr activity to their Gnosis wallet, and
-- therefore to their MACI signup and Circles balance.
--
-- Honest limit: this protects the BULK mapping, not every individual inference.
-- A Citizen who dual-writes public posts can still be correlated by matching post
-- content between the app feed and the relay. What stays protected is the clean
-- lookup table, and the identities of Citizens who register but never publish.
-- The consent copy in the app states this plainly.
--
-- Writes go through the `nostr-identity-register` Edge Function (service role),
-- which verifies both halves of the binding before inserting.
CREATE TABLE IF NOT EXISTS public.nostr_identities (
  wallet_address    TEXT PRIMARY KEY,               -- lowercase smart-account address
  pubkey_hex        TEXT NOT NULL UNIQUE,           -- x-only Nostr pubkey, lowercase 64-hex
  npub              TEXT NOT NULL,                  -- NIP-19 form, for display
  eth_signature     TEXT NOT NULL,                  -- EIP-191 sig over the binding statement
  binding_event     JSONB NOT NULL,                 -- the signed NIP-78 binding event
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at        TIMESTAMPTZ,                    -- set on opt-out / account deletion
  last_verified_at  TIMESTAMPTZ,                    -- last successful syncer pass
  CONSTRAINT nostr_identities_wallet_lowercase
    CHECK (wallet_address = lower(wallet_address)),
  CONSTRAINT nostr_identities_wallet_shape
    CHECK (wallet_address ~ '^0x[0-9a-f]{40}$'),
  -- The syncer only ever admits lowercase 64-hex; enforce it at the boundary so a
  -- malformed key can never reach the allow-list file.
  CONSTRAINT nostr_identities_pubkey_shape
    CHECK (pubkey_hex ~ '^[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS idx_nostr_identities_active
  ON public.nostr_identities (wallet_address) WHERE revoked_at IS NULL;

ALTER TABLE public.nostr_identities ENABLE ROW LEVEL SECURITY;
-- No CREATE POLICY here. Its absence is the access control.
REVOKE ALL ON public.nostr_identities FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. nostr_publications — which app content reached the relay.
-- ---------------------------------------------------------------------------
-- Keyed by (source_type, source_id) rather than a column on `posts`, so events,
-- stories and comments generalize later without another migration.
--
-- Access posture is the schema's normal permissive one: every row here concerns
-- content that is already public in the app AND already published to a
-- world-readable relay, so there is nothing to protect.
-- `pubkey_hex` is the publishing author. It is needed so a Citizen's erasure
-- request targets THEIR events and not everyone's. It adds no exposure that the
-- relay does not already have: the event it points at is public and signed by
-- that same pubkey.
CREATE TABLE IF NOT EXISTS public.nostr_publications (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type    TEXT NOT NULL,                     -- 'post' | 'profile'
  source_id      TEXT NOT NULL,                     -- posts.id, accounts.id, …
  pubkey_hex     TEXT NOT NULL,                     -- author's x-only Nostr pubkey
  event_id       TEXT,                              -- NIP-01 event id, once accepted
  status         TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'published', 'rejected')),
  relay_message  TEXT,                              -- the relay's OK/reject reason
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_type, source_id)
);

CREATE INDEX IF NOT EXISTS idx_nostr_publications_status
  ON public.nostr_publications (status) WHERE status <> 'published';
CREATE INDEX IF NOT EXISTS idx_nostr_publications_pubkey
  ON public.nostr_publications (pubkey_hex);

ALTER TABLE public.nostr_publications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "nostr_publications_all" ON public.nostr_publications
  FOR ALL USING (true) WITH CHECK (true);
