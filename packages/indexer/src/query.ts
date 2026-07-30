import type { NostrEvent } from "@netizen-labs/nostr";

/**
 * Building the cross-node query.
 *
 * Kept pure and separate from the database so the SQL can be tested without one.
 * Every value is a bound parameter — never interpolated — because this endpoint is
 * public by design, and the whole point of the index is that outsiders query it.
 */

export interface EventQuery {
  /**
   * Exact event ids. This is the PROOF lookup: an event id is the hash of its own
   * content, so fetching by id and checking the signature is a complete, offline
   * verification that nobody altered what was published.
   */
  ids?: string[];
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

  if (query.ids?.length) {
    where.push(`id = ANY(${bind(query.ids.map((i) => i.toLowerCase()))}::text[])`);
  }
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

/**
 * NIP-01 replaceable-event classes.
 *
 * The relay already enforces these semantics — one kind 0 per pubkey, one
 * 3xxxx per (pubkey, d) — and an index that ignores them returns every historic
 * version side by side. An edit that does not replace anything is not an edit,
 * so the index must collapse exactly the way the relay does.
 */
export function isReplaceable(kind: number): boolean {
  return kind === 0 || kind === 3 || (kind >= 10000 && kind < 20000);
}

export function isParameterised(kind: number): boolean {
  return kind >= 30000 && kind < 40000;
}

/** The `d` tag that scopes a parameterised replaceable event; "" when absent, per NIP-01. */
export function dTagOf(event: NostrEvent): string {
  const tag = event.tags?.find((t) => t[0] === "d");
  return tag?.[1] ?? "";
}

/** The replacement key for this event, or null for regular (immutable) kinds. */
export function replaceableDTag(event: NostrEvent): string | null {
  if (isParameterised(event.kind)) return dTagOf(event);
  if (isReplaceable(event.kind)) return "";
  return null;
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
    replaceableDTag(event),
  ];
}

export const INSERT_SQL = `
  INSERT INTO nostr_events (id, pubkey, kind, created_at, content, tags, sig, node_id, source, d_tag)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
  ON CONFLICT (id) DO NOTHING
`.replace(/\s+/g, " ");

/**
 * Drop every version this event supersedes: same author, same kind, same `d`
 * scope, and older by NIP-01 ordering (created_at, ties to the
 * lexicographically smaller id). Runs before the insert, so the pair leaves at
 * most one version standing regardless of arrival order.
 */
export const DELETE_SUPERSEDED_SQL = `
  DELETE FROM nostr_events
  WHERE pubkey = $1 AND kind = $2 AND d_tag IS NOT DISTINCT FROM $3
    AND (created_at < $4 OR (created_at = $4 AND id > $5))
`.replace(/\s+/g, " ");

/**
 * Insert a replaceable event only when nothing newer is already indexed —
 * the mirror image of the delete above, for events arriving out of order.
 */
export const INSERT_IF_NEWEST_SQL = `
  INSERT INTO nostr_events (id, pubkey, kind, created_at, content, tags, sig, node_id, source, d_tag)
  SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10
  WHERE NOT EXISTS (
    SELECT 1 FROM nostr_events
    WHERE pubkey = $2 AND kind = $3 AND d_tag IS NOT DISTINCT FROM $10
      AND (created_at > $4 OR (created_at = $4 AND id < $1))
  )
  ON CONFLICT (id) DO NOTHING
`.replace(/\s+/g, " ");
