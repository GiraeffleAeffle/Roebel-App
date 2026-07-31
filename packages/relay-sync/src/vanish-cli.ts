/**
 * Vanish scanner — the node half of the NIP-62/NIP-09 deletion pipeline.
 *
 * Scans the authoring relay (and the federation mirror, when one exists) for
 * kind-62 vanish requests and — mirror only, where strfry's native NIP-09
 * ingest handling is not guaranteed for sync-written events — kind-5 deletion
 * requests. Valid requests become lines in a work queue on a shared volume;
 * the sh executor inside the strfry image drains that queue with
 * `strfry delete` (see packages/cli renderVanishExecutor).
 *
 * Split on purpose: JSON parsing and ownership verification happen HERE, in a
 * real JSON parser against relay-verified events — never in shell string
 * matching, where crafted event content could steer a deletion. The executor
 * only ever sees fixed-shape, re-validated hex.
 *
 * Fail-safe like the allow-list syncer: an error in a pass leaves state
 * untouched and the pass retries later. Processed-request state lives beside
 * the queue, so a restart never re-enqueues (deletes are idempotent anyway).
 *
 * Env:
 *   AUTH_WS            authoring relay socket   (default ws://strfry:7777)
 *   MIRROR_WS          mirror socket, optional  (e.g. ws://mirror:7777)
 *   PUBLIC_RELAY_URLS  comma-separated public URLs of THIS node's relays —
 *                      what a kind-62 `relay` tag must name to address us
 *                      (ALL_RELAYS always does)
 *   VANISH_DIR         shared volume dir (default /vanish)
 *   SCAN_INTERVAL_SECONDS  pass interval (default 300)
 */
import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RelayClient } from "@netizen-labs/nostr";
import {
  KIND_DELETE,
  KIND_VANISH,
  encodeWork,
  isHex64,
  ownedDeletionIds,
  parseVanishRequest,
  referencedIds,
  type NostrEvent,
  type VanishWork,
} from "./vanish.js";

const AUTH_WS = process.env.AUTH_WS ?? "ws://strfry:7777";
const MIRROR_WS = process.env.MIRROR_WS ?? "";
const PUBLIC_RELAY_URLS = (process.env.PUBLIC_RELAY_URLS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const VANISH_DIR = process.env.VANISH_DIR ?? "/vanish";
const INTERVAL_MS = Number(process.env.SCAN_INTERVAL_SECONDS ?? 300) * 1000;

const QUEUE = join(VANISH_DIR, "queue.log");
const STATE = join(VANISH_DIR, "processed.json");

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function loadProcessed(): Set<string> {
  try {
    const arr = JSON.parse(readFileSync(STATE, "utf8"));
    return new Set(Array.isArray(arr) ? arr.filter(isHex64) : []);
  } catch {
    return new Set();
  }
}

function saveProcessed(ids: Set<string>): void {
  const tmp = `${STATE}.tmp`;
  writeFileSync(tmp, JSON.stringify([...ids]));
  renameSync(tmp, STATE);
}

function enqueue(work: VanishWork[]): void {
  if (!work.length) return;
  appendFileSync(QUEUE, work.map((w) => encodeWork(w) + "\n").join(""));
}

/** Both stores get the author purge: a delete of nothing is a no-op, and a
 *  request seen on one store may concern events that leaked into the other. */
function authorWork(pubkey: string, until: number, hasMirror: boolean): VanishWork[] {
  const stores: Array<"auth" | "mirror"> = hasMirror ? ["auth", "mirror"] : ["auth"];
  return stores.map((store) => ({ op: "author", store, pubkey, until }));
}

async function scanStore(
  url: string,
  store: "auth" | "mirror",
  processed: Set<string>,
  hasMirror: boolean,
): Promise<{ work: VanishWork[]; seen: string[] }> {
  const client = new RelayClient(url);
  try {
    const work: VanishWork[] = [];
    const seen: string[] = [];

    const kinds = store === "mirror" ? [KIND_VANISH, KIND_DELETE] : [KIND_VANISH];
    const events = (await client.query([{ kinds }])) as NostrEvent[];

    for (const evt of events) {
      if (!isHex64(evt.id) || processed.has(evt.id)) continue;

      if (evt.kind === KIND_VANISH) {
        const req = parseVanishRequest(evt, PUBLIC_RELAY_URLS.concat(url));
        if (req) {
          work.push(...authorWork(req.pubkey, req.until, hasMirror));
          log(`vanish request ${evt.id.slice(0, 8)}… on ${store}: purge author ${req.pubkey.slice(0, 8)}… until ${req.until}`);
        }
        // Addressed to us or not: mark seen, so foreign-relay requests are not
        // re-parsed every pass.
        seen.push(evt.id);
        continue;
      }

      // kind 5 on the mirror: verify ownership against the referenced events
      // before anything may be deleted (NIP-09: only your own events).
      const candidates = referencedIds(evt);
      if (!candidates.length) {
        seen.push(evt.id);
        continue;
      }
      const fetched = (await client.query([{ ids: candidates }])) as NostrEvent[];
      const authorById = new Map(fetched.map((e) => [e.id, e.pubkey]));
      const ids = ownedDeletionIds(evt, authorById);
      if (ids.length) {
        work.push({ op: "ids", store, ids });
        log(`deletion request ${evt.id.slice(0, 8)}… on ${store}: ${ids.length} owned event(s)`);
      }
      seen.push(evt.id);
    }

    return { work, seen };
  } finally {
    client.close();
  }
}

async function pass(): Promise<void> {
  const processed = loadProcessed();
  const hasMirror = MIRROR_WS.length > 0;

  // Per-store isolation: a mirror outage must not stop authoring-relay
  // requests from being honoured, and vice versa. State is only advanced for
  // stores whose scan completed.
  const targets: Array<[string, "auth" | "mirror"]> = [[AUTH_WS, "auth"]];
  if (hasMirror) targets.push([MIRROR_WS, "mirror"]);

  for (const [url, store] of targets) {
    try {
      const { work, seen } = await scanStore(url, store, processed, hasMirror);
      enqueue(work);
      seen.forEach((id) => processed.add(id));
      saveProcessed(processed);
    } catch (err) {
      log(`scan of ${store} (${url}) failed — state untouched, will retry: ${String(err)}`);
    }
  }
}

async function main(): Promise<void> {
  mkdirSync(VANISH_DIR, { recursive: true });
  log(`vanish scanner up — auth=${AUTH_WS} mirror=${MIRROR_WS || "(none)"} interval=${INTERVAL_MS / 1000}s`);
  for (;;) {
    await pass();
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
}

main().catch((err) => {
  console.error("vanish scanner fatal:", err);
  process.exit(1);
});
