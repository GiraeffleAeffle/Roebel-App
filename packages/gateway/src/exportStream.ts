import { countByAuthor } from "./ledger.js";
import { type BulkCursor } from "./bulk.js";

const EXPORT_BATCH = 5000;

/** One export batch: everything, oldest-truncated only by the keyset walk. */
export function buildExportBatchQuery(
  kinds: number[] | undefined,
  cursor: BulkCursor | null,
  excluded: ReadonlySet<string>,
  batchSize = EXPORT_BATCH,
): { text: string; values: unknown[] } {
  const where: string[] = [];
  const values: unknown[] = [];
  const bind = (v: unknown) => `$${values.push(v)}`;
  if (kinds?.length) where.push(`kind = ANY(${bind(kinds)}::int[])`);
  if (excluded.size) where.push(`pubkey != ALL(${bind([...excluded])}::text[])`);
  if (cursor) {
    where.push(`(created_at < ${bind(cursor.until)} OR (created_at = $${values.length} AND id > ${bind(cursor.afterId)}))`);
  }
  return {
    text: `SELECT id, pubkey, kind, created_at, content, tags, sig, node_id, source
           FROM nostr_events
           ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
           ORDER BY created_at DESC, id ASC
           LIMIT ${bind(batchSize)}`.replace(/\s+/g, " "),
    values,
  };
}

/**
 * Stream the full record as NDJSON in keyset batches. Returns per-author
 * counts so the caller can write the serving log after the stream ends.
 */
export async function streamExport(deps: {
  query: (sql: string, values: unknown[]) => Promise<Record<string, unknown>[]>;
  write: (line: string) => void;
  kinds?: number[];
  excluded: ReadonlySet<string>;
}): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  let cursor: BulkCursor | null = null;
  for (;;) {
    const built = buildExportBatchQuery(deps.kinds, cursor, deps.excluded);
    const rows = await deps.query(built.text, built.values);
    for (const row of rows) {
      deps.write(JSON.stringify(row));
      const author = String(row.pubkey);
      counts.set(author, (counts.get(author) ?? 0) + 1);
    }
    if (rows.length < EXPORT_BATCH) return counts;
    const last = rows[rows.length - 1];
    cursor = { until: Number(last.created_at), afterId: String(last.id) };
  }
}

export { countByAuthor };
