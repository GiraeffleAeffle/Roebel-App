/**
 * Firehose passes: one payment mints a token; the SSE socket checks it on
 * connect. Tokens are capability-style random strings — no account behind
 * them, exactly as frictionless as the payment that bought them.
 */
export function mintPassSql(token: string, ledgerId: number, hoursValid: number): { text: string; values: unknown[] } {
  return {
    text: `INSERT INTO firehose_passes (token, ledger_id, expires_at)
           VALUES ($1, $2, now() + make_interval(hours => $3))`.replace(/\s+/g, " "),
    values: [token, ledgerId, hoursValid],
  };
}

export function passLookupSql(token: string): { text: string; values: unknown[] } {
  return {
    text: `SELECT ledger_id, expires_at FROM firehose_passes WHERE token = $1 AND expires_at > now()`,
    values: [token],
  };
}

/** New rows since the watermark, in arrival order — indexed_at, not created_at,
 *  because a peer can sync in old events and the firehose promise is "everything
 *  NEW TO THIS INDEX", not "everything recently authored". */
export function firehoseBatchQuery(
  sinceIndexedAt: string,
  excluded: ReadonlySet<string>,
): { text: string; values: unknown[] } {
  const values: unknown[] = [sinceIndexedAt];
  let exclusionClause = "";
  if (excluded.size) {
    values.push([...excluded]);
    exclusionClause = ` AND pubkey != ALL($2::text[])`;
  }
  return {
    text: `SELECT id, pubkey, kind, created_at, content, tags, sig, node_id, source, indexed_at
           FROM nostr_events WHERE indexed_at > $1${exclusionClause}
           ORDER BY indexed_at ASC LIMIT 500`.replace(/\s+/g, " "),
    values,
  };
}
