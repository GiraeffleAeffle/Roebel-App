/**
 * The index schema.
 *
 * One table. An event is identified by its NIP-01 id, which is a hash of its own
 * content, so the id is a natural primary key and re-ingesting is a no-op. That is
 * what makes the indexer safe to restart, and safe to point at overlapping relays.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS nostr_events (
  id          TEXT PRIMARY KEY,
  pubkey      TEXT NOT NULL,
  kind        INTEGER NOT NULL,
  created_at  BIGINT NOT NULL,
  content     TEXT NOT NULL,
  tags        JSONB NOT NULL DEFAULT '[]'::jsonb,
  sig         TEXT NOT NULL,

  -- Provenance. Without this, federation produces an undifferentiated soup: an
  -- agent asking "what is happening in the region" could not tell this node's own
  -- record from a peer's, and cross-node trust would be impossible to reason about.
  node_id     TEXT NOT NULL,
  source      TEXT NOT NULL,
  indexed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Replacement scope for NIP-01 replaceable kinds: "" for plain replaceable
  -- (0, 3, 1xxxx), the d tag for parameterised (3xxxx), NULL for regular
  -- (immutable) events. Ingest collapses versions on this key.
  d_tag       TEXT
);

-- Existing databases predate d_tag; CREATE TABLE IF NOT EXISTS will not add it.
ALTER TABLE nostr_events ADD COLUMN IF NOT EXISTS d_tag TEXT;

-- Backfill rows ingested before the column existed, then collapse the
-- duplicates they left behind (the live index really had two kind 0 profiles
-- for one pubkey after a key rotation — this is not hypothetical). Both
-- statements are idempotent, so running them at every startup is safe.
UPDATE nostr_events SET d_tag =
  CASE WHEN kind >= 30000 AND kind < 40000 THEN COALESCE(
    (SELECT t.value->>1 FROM jsonb_array_elements(tags) AS t(value) WHERE t.value->>0 = 'd' LIMIT 1), '')
  ELSE '' END
WHERE d_tag IS NULL
  AND (kind = 0 OR kind = 3 OR (kind >= 10000 AND kind < 20000) OR (kind >= 30000 AND kind < 40000));

DELETE FROM nostr_events e USING nostr_events newer
WHERE e.d_tag IS NOT NULL AND newer.d_tag IS NOT NULL
  AND e.pubkey = newer.pubkey AND e.kind = newer.kind AND e.d_tag = newer.d_tag
  AND (e.created_at < newer.created_at OR (e.created_at = newer.created_at AND e.id > newer.id));

CREATE INDEX IF NOT EXISTS idx_nostr_events_kind_time ON nostr_events (kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_nostr_events_pubkey    ON nostr_events (pubkey);
CREATE INDEX IF NOT EXISTS idx_nostr_events_node      ON nostr_events (node_id);
CREATE INDEX IF NOT EXISTS idx_nostr_events_replace   ON nostr_events (pubkey, kind, d_tag);

-- Full-text search is the one thing a relay filter genuinely cannot do.
CREATE INDEX IF NOT EXISTS idx_nostr_events_fts
  ON nostr_events USING GIN (to_tsvector('simple', content));
`;
