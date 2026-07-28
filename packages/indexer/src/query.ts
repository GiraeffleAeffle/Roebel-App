import type { NostrEvent } from "@netizen-labs/nostr";

/**
 * Building the cross-node query.
 *
 * Kept pure and separate from the database so the SQL can be tested without one.
 * Every value is a bound parameter — never interpolated — because this endpoint is
 * public by design, and the whole point of the index is that outsiders query it.
 */

export interface EventQuery {
  /** Full-text search over content. */
  q?: string;
  kinds?: number[];
  authors?: string[];
  /** Unix seconds, inclusive. */
  since?: number;
  until?: number;
  /** Restrict to events this node learned from a particular node (provenance). */
  node?: string;
  limit?: number;
}

export interface BuiltQuery {
  text: string;
  values: unknown[];
}

/** Hard ceiling. An unbounded query against a public endpoint is a denial-of-service waiting to be found. */
export const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

export function buildEventQuery(query: EventQuery): BuiltQuery {
  const where: string[] = [];
  const values: unknown[] = [];
  const bind = (v: unknown) => `$${values.push(v)}`;

  if (query.q?.trim()) {
    where.push(`to_tsvector('simple', content) @@ plainto_tsquery('simple', ${bind(query.q.trim())})`);
  }
  if (query.kinds?.length) where.push(`kind = ANY(${bind(query.kinds)}::int[])`);
  if (query.authors?.length) {
    where.push(`pubkey = ANY(${bind(query.authors.map((a) => a.toLowerCase()))}::text[])`);
  }
  if (typeof query.since === "number") where.push(`created_at >= ${bind(query.since)}`);
  if (typeof query.until === "number") where.push(`created_at <= ${bind(query.until)}`);
  if (query.node) where.push(`node_id = ${bind(query.node)}`);

  const limit = Math.min(Math.max(1, query.limit ?? DEFAULT_LIMIT), MAX_LIMIT);

  return {
    text:
      `SELECT id, pubkey, kind, created_at, content, tags, sig, node_id, source
       FROM nostr_events
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY created_at DESC
       LIMIT ${bind(limit)}`.replace(/\s+/g, " "),
    values,
  };
}

/** What this node knows, grouped by where it came from. Answers "what is in here". */
export const STATS_SQL = `
  SELECT node_id, kind, COUNT(*)::int AS count, MAX(created_at)::bigint AS newest
  FROM nostr_events GROUP BY node_id, kind ORDER BY node_id, kind
`.replace(/\s+/g, " ");

export interface IndexedEvent extends NostrEvent {
  /** Which node's record this belongs to. */
  node_id: string;
  /** The relay it was read from. */
  source: string;
}

/** Map a relay event onto a row, stamped with where it came from. */
export function toRow(event: NostrEvent, nodeId: string, source: string): unknown[] {
  return [
    event.id,
    event.pubkey.toLowerCase(),
    event.kind,
    event.created_at,
    event.content,
    JSON.stringify(event.tags ?? []),
    event.sig,
    nodeId,
    source,
  ];
}

export const INSERT_SQL = `
  INSERT INTO nostr_events (id, pubkey, kind, created_at, content, tags, sig, node_id, source)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
  ON CONFLICT (id) DO NOTHING
`.replace(/\s+/g, " ");
