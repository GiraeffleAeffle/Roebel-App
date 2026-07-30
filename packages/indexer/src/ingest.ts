import { RelayClient, verifyEvent, type NostrEvent } from "@netizen-labs/nostr";
import {
  DELETE_SUPERSEDED_SQL,
  INSERT_IF_NEWEST_SQL,
  INSERT_SQL,
  replaceableDTag,
  toRow,
} from "./query.js";

/**
 * Pulling a relay's public events into the index.
 *
 * Deliberately a periodic pull rather than a live subscription: the index is a
 * derived view, and a pull that can be re-run from a timestamp recovers from any
 * outage by itself. A dropped subscription silently stops producing data, which is
 * the failure mode that looks like "nothing is happening" rather than an error.
 */

export interface Source {
  /** Whose record this relay serves — the provenance stamp. */
  nodeId: string;
  relay: string;
  kinds: number[];
}

export interface IngestDeps {
  /** Bound parameters, never interpolation. */
  insert: (sql: string, values: unknown[]) => Promise<void>;
  /** Newest `created_at` already indexed for this source, so a pass resumes. */
  watermark: (nodeId: string, relay: string) => Promise<number | null>;
  log?: (message: string) => void;
  makeClient?: (url: string) => Pick<RelayClient, "query" | "close">;
}

export interface IngestResult {
  source: string;
  fetched: number;
  stored: number;
  rejected: number;
}

/** Re-read a small overlap so an event written during the previous pass is not skipped. */
const OVERLAP_SECONDS = 300;

/**
 * Index one relay.
 *
 * Signatures are re-verified here even though the relay already checked them. The
 * index is served publicly and cross-node, so "this event is genuinely signed by
 * that key" must be something this node established itself rather than inherited
 * from a peer's word.
 */
export async function ingestSource(source: Source, deps: IngestDeps): Promise<IngestResult> {
  const log = deps.log ?? (() => {});
  const client = deps.makeClient
    ? deps.makeClient(source.relay)
    : new RelayClient(source.relay, { timeoutMs: 15_000 });

  const since = await deps.watermark(source.nodeId, source.relay);
  const filter: Record<string, unknown> = { kinds: source.kinds, limit: 500 };
  if (since !== null) filter.since = Math.max(0, since - OVERLAP_SECONDS);

  let events: NostrEvent[] = [];
  try {
    events = await client.query([filter]);
  } finally {
    client.close();
  }

  let stored = 0;
  let rejected = 0;
  for (const event of events) {
    if (!verifyEvent(event)) {
      rejected += 1;
      continue;
    }
    const dTag = replaceableDTag(event);
    if (dTag !== null) {
      // Replaceable: supersede older versions, then insert only if newest.
      // NIP-01 semantics the relay already enforces; the index must match it,
      // or every edit is returned beside the version it was meant to replace.
      await deps.insert(DELETE_SUPERSEDED_SQL, [
        event.pubkey.toLowerCase(),
        event.kind,
        dTag,
        event.created_at,
        event.id,
      ]);
      await deps.insert(INSERT_IF_NEWEST_SQL, toRow(event, source.nodeId, source.relay));
    } else {
      await deps.insert(INSERT_SQL, toRow(event, source.nodeId, source.relay));
    }
    stored += 1;
  }

  log(
    `${source.nodeId} <- ${source.relay}: ${events.length} fetched, ${stored} stored` +
      (rejected ? `, ${rejected} REJECTED (bad signature)` : ""),
  );
  return { source: source.relay, fetched: events.length, stored, rejected };
}

/**
 * One pass over every source.
 *
 * A failing relay must not stop the others: an unreachable peer is a normal
 * condition in a federation, and losing the whole sweep for one of them would make
 * the index quietly stale.
 */
export async function ingestAll(sources: Source[], deps: IngestDeps): Promise<IngestResult[]> {
  const log = deps.log ?? (() => {});
  const results: IngestResult[] = [];
  for (const source of sources) {
    try {
      results.push(await ingestSource(source, deps));
    } catch (error) {
      log(`${source.nodeId} <- ${source.relay}: FAILED, continuing — ${(error as Error).message}`);
      results.push({ source: source.relay, fetched: 0, stored: 0, rejected: 0 });
    }
  }
  return results;
}
