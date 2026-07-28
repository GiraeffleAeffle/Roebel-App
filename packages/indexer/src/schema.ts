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
  indexed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nostr_events_kind_time ON nostr_events (kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_nostr_events_pubkey    ON nostr_events (pubkey);
CREATE INDEX IF NOT EXISTS idx_nostr_events_node      ON nostr_events (node_id);

-- Full-text search is the one thing a relay filter genuinely cannot do.
CREATE INDEX IF NOT EXISTS idx_nostr_events_fts
  ON nostr_events USING GIN (to_tsvector('simple', content));
`;
