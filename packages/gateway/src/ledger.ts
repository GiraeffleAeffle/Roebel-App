/**
 * The meter's memory. Every paid request writes one access_ledger row and, per
 * served author, a serving_log row. The accrual view turns those into "what
 * does this npub's data have earned" — computed, never stored, so a split
 * change never rewrites history (split_authors is snapshotted per sale).
 */
export const LEDGER_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS access_ledger (
  id            BIGSERIAL PRIMARY KEY,
  ts            TIMESTAMPTZ NOT NULL DEFAULT now(),
  endpoint      TEXT NOT NULL,
  payer         TEXT NOT NULL,
  amount        NUMERIC(78,0) NOT NULL,
  asset         TEXT NOT NULL,
  network       TEXT NOT NULL,
  split_authors INTEGER NOT NULL,
  tx            TEXT,
  nonce         TEXT,
  -- true when we served after a network_error settle: the authorization was
  -- valid but the tx did not confirm — re-submit or write off, by hand.
  reconcile     BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS serving_log (
  ledger_id BIGINT NOT NULL REFERENCES access_ledger(id),
  author    TEXT NOT NULL,
  events    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_serving_log_ledger ON serving_log (ledger_id);
CREATE INDEX IF NOT EXISTS idx_serving_log_author ON serving_log (author);

CREATE TABLE IF NOT EXISTS firehose_passes (
  token      TEXT PRIMARY KEY,
  ledger_id  BIGINT NOT NULL REFERENCES access_ledger(id),
  expires_at TIMESTAMPTZ NOT NULL
);

-- The firehose SSE loop polls new rows by indexed_at; this is the indexer's
-- own table, but the gateway shares its database, and the poll would be a
-- sequential scan on every tick without an index on the watermark column.
-- CREATE INDEX IF NOT EXISTS keeps this DDL idempotent against the indexer
-- possibly already having created it.
CREATE INDEX IF NOT EXISTS idx_nostr_events_indexed_at ON nostr_events (indexed_at);

-- Pro-rata author accrual: each sale's author share, divided by events served.
-- WHERE NOT l.reconcile excludes sales whose settlement is still pending
-- reconciliation (network_error at settle time) — an unsettled sale must not
-- count as author-earned revenue until it is confirmed or written off by hand.
CREATE OR REPLACE VIEW metering_accruals AS
SELECT s.author,
       SUM(l.amount * l.split_authors / 100.0 * s.events::numeric / t.total_events) AS accrued_atomic
FROM serving_log s
JOIN access_ledger l ON l.id = s.ledger_id
JOIN (SELECT ledger_id, SUM(events) AS total_events FROM serving_log GROUP BY ledger_id) t
  ON t.ledger_id = s.ledger_id
WHERE NOT l.reconcile
GROUP BY s.author;
`;

export interface LedgerEntry {
  endpoint: string;
  payer: string;
  amount: string;
  asset: string;
  network: string;
  splitAuthors: number;
  tx: string | null;
  nonce: string | null;
  reconcile: boolean;
}

export function insertLedgerSql(e: LedgerEntry): { text: string; values: unknown[] } {
  return {
    text: `INSERT INTO access_ledger (endpoint, payer, amount, asset, network, split_authors, tx, nonce, reconcile)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`.replace(/\s+/g, " "),
    values: [e.endpoint, e.payer, e.amount, e.asset, e.network, e.splitAuthors, e.tx, e.nonce, e.reconcile],
  };
}

/**
 * The x402 replay guard: an authorization's nonce is checked against every
 * prior sale before the gateway asks the facilitator to verify/settle it, so
 * a captured X-PAYMENT header cannot be replayed to buy a second response
 * for the same signed authorization.
 */
export function nonceSeenSql(nonce: string): { text: string; values: unknown[] } {
  return {
    text: `SELECT 1 FROM access_ledger WHERE nonce = $1 LIMIT 1`,
    values: [nonce],
  };
}

export function countByAuthor(rows: Array<{ pubkey: string }>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.pubkey, (counts.get(row.pubkey) ?? 0) + 1);
  return counts;
}

export function insertServingSql(
  ledgerId: number, counts: Map<string, number>,
): { text: string; values: unknown[] } | null {
  if (counts.size === 0) return null;
  const values: unknown[] = [];
  const tuples: string[] = [];
  for (const [author, events] of counts) {
    tuples.push(`($${values.length + 1},$${values.length + 2},$${values.length + 3})`);
    values.push(ledgerId, author, events);
  }
  return { text: `INSERT INTO serving_log (ledger_id, author, events) VALUES ${tuples.join(",")}`, values };
}

// WHERE NOT reconcile — an unsettled sale (network_error at settle time) is
// not yet confirmed revenue; counting it here would overstate totals until
// the sale is reconciled or written off.
export const STATS_TOTALS_SQL =
  `SELECT COUNT(*)::int AS requests, COALESCE(SUM(amount),0)::text AS revenue_atomic FROM access_ledger WHERE NOT reconcile`;

export const STATS_ENDPOINTS_SQL =
  `SELECT endpoint, COUNT(*)::int AS requests, COALESCE(SUM(amount),0)::text AS revenue_atomic
   FROM access_ledger WHERE NOT reconcile GROUP BY endpoint ORDER BY endpoint`.replace(/\s+/g, " ");

export const TOP_ACCRUALS_SQL =
  `SELECT author, ROUND(accrued_atomic)::text AS accrued_atomic
   FROM (SELECT author, accrued_atomic FROM metering_accruals ORDER BY accrued_atomic DESC LIMIT 100) top`.replace(/\s+/g, " ");
