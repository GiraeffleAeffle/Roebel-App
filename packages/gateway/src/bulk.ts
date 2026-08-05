import type { EventQuery } from "@netizen-labs/indexer";

/**
 * The paid twin of the indexer's /events: same filter grammar, 50× the limit,
 * keyset pagination. Deliberately its own SQL builder — the indexer's is
 * hard-capped at MAX_LIMIT=200 as a free-tier guarantee, and weakening that
 * cap for reuse would be exactly the wrong trade.
 */
export const BULK_MAX_LIMIT = 10000;
const DEFAULT_BULK_LIMIT = 1000;

export interface BulkCursor {
  until: number;
  afterId: string;
}

export function encodeCursor(c: BulkCursor): string {
  return Buffer.from(JSON.stringify(c)).toString("base64url");
}

export function decodeCursor(s: string | null): BulkCursor | null {
  if (!s) return null;
  try {
    const parsed = JSON.parse(Buffer.from(s, "base64url").toString("utf8")) as BulkCursor;
    if (typeof parsed.until !== "number" || typeof parsed.afterId !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function buildBulkQuery(
  query: EventQuery,
  cursor: BulkCursor | null,
  excluded: ReadonlySet<string>,
): { text: string; values: unknown[] } {
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
  if (excluded.size) {
    // The monetization opt-out: excluded authors never appear in a paid response.
    where.push(`pubkey != ALL(${bind([...excluded])}::text[])`);
  }
  if (cursor) {
    where.push(`(created_at < ${bind(cursor.until)} OR (created_at = $${values.length} AND id > ${bind(cursor.afterId)}))`);
  }

  const limit = Math.min(Math.max(1, query.limit ?? DEFAULT_BULK_LIMIT), BULK_MAX_LIMIT);

  return {
    text: `SELECT id, pubkey, kind, created_at, content, tags, sig, node_id, source
           FROM nostr_events
           ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
           ORDER BY created_at DESC, id ASC
           LIMIT ${bind(limit)}`.replace(/\s+/g, " "),
    values,
  };
}

/** A full page means "probably more" — hand back where to resume. */
export function nextCursor(rows: Array<{ created_at: number; id: string }>, limit: number): string | null {
  if (rows.length < limit) return null;
  const last = rows[rows.length - 1];
  return encodeCursor({ until: last.created_at, afterId: last.id });
}
