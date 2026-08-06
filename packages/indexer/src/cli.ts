#!/usr/bin/env node
import pg from "pg";
import { RelayClient, verifyEvent, type NostrEvent } from "@netizen-labs/nostr";
import { createApi } from "./api.js";
import { ingestAll, type Source } from "./ingest.js";
import { SCHEMA_SQL } from "./schema.js";

/**
 * `netizen-indexer` — the node's cross-node query layer.
 *
 * Ingests this node's own relay and its federation mirror into Postgres, and
 * serves questions that span both. Runs on the node beside them.
 *
 * SOURCES is a JSON array so the installer can render it straight from the
 * manifest: [{ "nodeId": "roebel", "relay": "ws://strfry:7777", "kinds": [0,1] }]
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`missing required env var: ${name}`);
    process.exit(2);
  }
  return value;
}

function parseSources(raw: string): Source[] {
  const parsed = JSON.parse(raw) as Source[];
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("SOURCES must be a non-empty JSON array");
  }
  for (const s of parsed) {
    if (!s.nodeId || !s.relay || !Array.isArray(s.kinds) || s.kinds.length === 0) {
      throw new Error(`each source needs nodeId, relay and a non-empty kinds array: ${JSON.stringify(s)}`);
    }
  }
  return parsed;
}

async function main(): Promise<void> {
  const nodeId = required("NODE_ID");
  const sources = parseSources(required("SOURCES"));
  const intervalSeconds = Number(process.env.INGEST_INTERVAL_SECONDS ?? 120);
  const port = Number(process.env.PORT ?? 8080);

  const pool = new pg.Pool({ connectionString: required("DATABASE_URL"), max: 8 });
  await pool.query(SCHEMA_SQL);

  const query = async (sql: string, values: unknown[]) => (await pool.query(sql, values)).rows;

  const pass = async () => {
    const at = new Date().toISOString();
    try {
      const results = await ingestAll(sources, {
        insert: async (sql, values) => {
          await pool.query(sql, values);
        },
        // Resume from what is already indexed for this exact source, so a restart
        // costs one small overlap rather than a full re-read.
        // Per (source, kind): a shared watermark would let the newest feed post
        // starve back-dated replaceable kinds out of the ingest window.
        watermark: async (id, relay, kind) => {
          const rows = await query(
            "SELECT MAX(created_at)::bigint AS newest FROM nostr_events WHERE node_id = $1 AND source = $2 AND kind = $3",
            [id, relay, kind],
          );
          const newest = rows[0]?.newest;
          return newest == null ? null : Number(newest);
        },
        log: (m) => console.log(`[${at}] ${m}`),
      });
      const stored = results.reduce((n, r) => n + r.stored, 0);
      if (stored) console.log(`[${at}] indexed ${stored} new event(s)`);
    } catch (error) {
      // A failed pass leaves the index stale, never wrong — the next tick retries.
      console.error(`[${at}] ingest pass failed:`, (error as Error).message);
    }
  };

  await pass();
  setInterval(() => void pass(), intervalSeconds * 1000);

  /**
   * Proof lookups must work immediately. Ask every configured relay for the ids,
   * verify each signature here rather than trusting the relay, and shape the rows
   * like indexed ones so a caller cannot tell the difference beyond `source`.
   */
  const fetchFromRelay = async (ids: string[]): Promise<Record<string, unknown>[]> => {
    const out = new Map<string, Record<string, unknown>>();
    for (const s of sources) {
      const client = new RelayClient(s.relay, { timeoutMs: 6000 });
      try {
        for (const e of (await client.query([{ ids }])) as NostrEvent[]) {
          if (!verifyEvent(e) || out.has(e.id)) continue;
          out.set(e.id, {
            id: e.id, pubkey: e.pubkey, kind: e.kind, created_at: e.created_at,
            content: e.content, tags: e.tags, sig: e.sig,
            node_id: s.nodeId, source: s.relay,
          });
        }
      } catch {
        // A relay being unreachable must not fail the lookup.
      } finally {
        client.close();
      }
    }
    return [...out.values()];
  };

  // Optional mounts: the node's public manifest, and the content-addressed
  // media mirror the publisher fills. Both absent on nodes that don't use them.
  const manifestPath = process.env.MANIFEST_PATH ?? "";
  let manifestJson: string | null = null;
  if (manifestPath) {
    try {
      const { readFileSync } = await import("node:fs");
      manifestJson = JSON.stringify(JSON.parse(readFileSync(manifestPath, "utf8")));
    } catch (error) {
      console.error(`MANIFEST_PATH unreadable (${manifestPath}):`, (error as Error).message);
    }
  }
  const mediaDir = process.env.MEDIA_DIR ?? "";
  const readMedia = mediaDir
    ? async (sha256: string) => {
        const { readFile } = await import("node:fs/promises");
        // The publisher stores each file as <sha256> with a sidecar <sha256>.type
        // naming the content type. Hash-named, so path traversal is impossible.
        try {
          const bytes = await readFile(`${mediaDir}/${sha256}`);
          let contentType = "application/octet-stream";
          try {
            contentType = (await readFile(`${mediaDir}/${sha256}.type`, "utf8")).trim() || contentType;
          } catch {
            // no sidecar — serve as generic bytes
          }
          return { bytes: new Uint8Array(bytes), contentType };
        } catch {
          return null;
        }
      }
    : undefined;

  createApi({
    query,
    nodeId,
    fetchFromRelay,
    ...(manifestJson ? { manifest: () => manifestJson! } : {}),
    ...(readMedia ? { readMedia } : {}),
  }).listen(port, () => {
    console.log(`indexer for "${nodeId}" listening on :${port}; ingesting every ${intervalSeconds}s`);
    for (const s of sources) console.log(`  source ${s.nodeId} <- ${s.relay} kinds[${s.kinds}]`);
  });
}

void main().catch((error) => {
  console.error("indexer failed to start:", error);
  process.exit(1);
});
