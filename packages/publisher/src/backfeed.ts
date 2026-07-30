import { RelayClient, isAgentEvent, type NostrEvent } from "@netizen-labs/nostr";

/**
 * The relay → app direction: posts and interactions written by ANY Nostr
 * client appear in the official app.
 *
 * Without this, multi-client is half true — a citizen posting from a third
 * party client reaches the public record but not the app feed their neighbours
 * read. With it, the protocol is the write surface and Supabase is a follower.
 *
 * Trust model, in order:
 *  - only events by **bound citizens** (unrevoked wallet↔npub binding) are
 *    ingested — the binding maps the event back to the wallet that owns it,
 *    which is what makes every ingested row attributable;
 *  - agent-labelled events never enter the feed as people;
 *  - `nostr_publications` is the dedupe ledger in BOTH directions: the app
 *    records what it published, the backfeed records what it ingested, and
 *    neither side touches an event id the ledger already knows;
 *  - a cutover timestamp fences off history — events older than the first run
 *    predate the ledger and would double-insert.
 */

export interface BackfeedDeps {
  relayUrl: string;
  /** Ingest nothing older than this (unix seconds). */
  cutover: number;
  fetchRows: (table: string, query: string) => Promise<Record<string, unknown>[]>;
  /** POST returning the created row. */
  insertRow: (table: string, body: Record<string, unknown>) => Promise<Record<string, unknown>>;
  /** PATCH rows matching the query. */
  updateRow: (table: string, query: string, body: Record<string, unknown>) => Promise<void>;
  makeClient?: (url: string) => Pick<RelayClient, "query" | "close">;
  log?: (message: string) => void;
}

export interface BackfeedSummary {
  fetched: number;
  posts: number;
  comments: number;
  likes: number;
  skipped: number;
}

type Classified =
  | { type: "post"; content: string }
  | { type: "comment"; parentEventId: string; content: string }
  | { type: "like"; parentEventId: string }
  | { type: "skip"; reason: string };

/** Pure classification, so the trust rules are testable without I/O. */
export function classify(
  event: NostrEvent,
  bindings: Map<string, string>,
  knownEventIds: Set<string>,
): Classified {
  if (knownEventIds.has(event.id)) return { type: "skip", reason: "already-known" };
  if (!bindings.has(event.pubkey.toLowerCase())) return { type: "skip", reason: "not-a-bound-citizen" };
  if (isAgentEvent(event)) return { type: "skip", reason: "agent" };

  const eTag = event.tags?.find((t) => t[0] === "e" && t[1]);
  if (event.kind === 7) {
    if (!eTag) return { type: "skip", reason: "reaction-without-target" };
    return { type: "like", parentEventId: eTag[1] };
  }
  if (event.kind === 1) {
    const content = event.content.trim();
    if (!content) return { type: "skip", reason: "empty" };
    if (eTag) return { type: "comment", parentEventId: eTag[1], content };
    return { type: "post", content };
  }
  return { type: "skip", reason: `kind-${event.kind}` };
}

/** The feed reads denormalised counters; an invisible interaction is no interaction. */
async function bumpCount(
  deps: BackfeedDeps,
  postId: string,
  column: "comments_count" | "likes_count",
): Promise<void> {
  const rows = await deps.fetchRows("posts", `select=${column}&id=eq.${postId}&limit=1`);
  const current = Number(rows[0]?.[column] ?? 0);
  await deps.updateRow("posts", `id=eq.${postId}`, { [column]: current + 1 });
}

/** The app post a relay event id belongs to, via the publication ledger. */
async function postIdFor(
  deps: BackfeedDeps,
  eventId: string,
): Promise<string | null> {
  const rows = await deps.fetchRows(
    "nostr_publications",
    `select=source_id&source_type=eq.post&event_id=eq.${eventId}&limit=1`,
  );
  return rows[0] ? String(rows[0].source_id) : null;
}

export async function backfeedOnce(deps: BackfeedDeps): Promise<BackfeedSummary> {
  const log = deps.log ?? (() => {});

  const bindingRows = await deps.fetchRows(
    "nostr_identities",
    "select=wallet_address,pubkey_hex,revoked_at&revoked_at=is.null",
  );
  const bindings = new Map(
    bindingRows
      .filter((b) => typeof b.pubkey_hex === "string" && typeof b.wallet_address === "string")
      .map((b) => [String(b.pubkey_hex).toLowerCase(), String(b.wallet_address).toLowerCase()]),
  );

  const client = deps.makeClient
    ? deps.makeClient(deps.relayUrl)
    : new RelayClient(deps.relayUrl, { timeoutMs: 15_000 });
  let events: NostrEvent[] = [];
  try {
    events = await client.query([{ kinds: [1, 7], since: deps.cutover, limit: 500 }]);
  } finally {
    client.close();
  }

  // One ledger lookup for the whole batch.
  const ids = events.map((e) => e.id);
  const known = new Set<string>();
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const rows = await deps.fetchRows(
      "nostr_publications",
      `select=event_id&event_id=in.(${chunk.join(",")})`,
    );
    for (const row of rows) known.add(String(row.event_id));
  }

  const summary: BackfeedSummary = { fetched: events.length, posts: 0, comments: 0, likes: 0, skipped: 0 };

  for (const event of events) {
    if (event.created_at < deps.cutover) {
      summary.skipped += 1;
      continue;
    }
    const verdict = classify(event, bindings, known);
    if (verdict.type === "skip") {
      summary.skipped += 1;
      continue;
    }
    const wallet = bindings.get(event.pubkey.toLowerCase())!;

    try {
      if (verdict.type === "post") {
        // Belt and braces beside the ledger: an identical post by the same
        // wallet means an app write whose ledger row was lost mid-flight.
        const dup = await deps.fetchRows(
          "posts",
          `select=id&wallet_address=eq.${wallet}&content=eq.${encodeURIComponent(verdict.content)}&limit=1`,
        );
        if (dup.length) {
          summary.skipped += 1;
          continue;
        }
        const owners = await deps.fetchRows(
          "account_owners",
          `select=account_id&wallet_address=eq.${wallet}&limit=1`,
        );
        const post = await deps.insertRow("posts", {
          wallet_address: wallet,
          account_id: owners[0] ? owners[0].account_id : null,
          content: verdict.content,
          category: "generell",
          feed_type: "main",
          post_type: "user",
          status: "published",
        });
        await deps.insertRow("nostr_publications", {
          source_type: "post",
          source_id: post.id,
          pubkey_hex: event.pubkey,
          event_id: event.id,
          status: "published",
          relay_message: "backfeed: ingested from relay",
        });
        summary.posts += 1;
      } else if (verdict.type === "comment") {
        const postId = await postIdFor(deps, verdict.parentEventId);
        if (!postId) {
          summary.skipped += 1;
          continue;
        }
        const comment = await deps.insertRow("post_comments", {
          post_id: postId,
          wallet_address: wallet,
          content: verdict.content,
        });
        await deps.insertRow("nostr_publications", {
          source_type: "comment",
          source_id: comment.id,
          pubkey_hex: event.pubkey,
          event_id: event.id,
          status: "published",
          relay_message: "backfeed: ingested from relay",
        });
        await bumpCount(deps, postId, "comments_count");
        summary.comments += 1;
      } else {
        const postId = await postIdFor(deps, verdict.parentEventId);
        if (!postId) {
          summary.skipped += 1;
          continue;
        }
        const existing = await deps.fetchRows(
          "post_likes",
          `select=id&post_id=eq.${postId}&wallet_address=eq.${wallet}&limit=1`,
        );
        if (existing.length) {
          summary.skipped += 1;
          continue;
        }
        await deps.insertRow("post_likes", { post_id: postId, wallet_address: wallet });
        await deps.insertRow("nostr_publications", {
          source_type: "like",
          source_id: `${postId}:${event.pubkey.slice(0, 16)}`,
          pubkey_hex: event.pubkey,
          event_id: event.id,
          status: "published",
          relay_message: "backfeed: ingested from relay",
        });
        await bumpCount(deps, postId, "likes_count");
        summary.likes += 1;
      }
    } catch (error) {
      // One bad row must not stop the sweep; the ledger has no entry, so the
      // next pass retries it.
      log(`backfeed: failed for ${event.id.slice(0, 12)}…: ${(error as Error).message}`);
      summary.skipped += 1;
    }
  }

  if (summary.posts || summary.comments || summary.likes) {
    log(
      `backfeed: ${summary.posts} post(s), ${summary.comments} comment(s), ${summary.likes} like(s) from the relay`,
    );
  }
  return summary;
}
