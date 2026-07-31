/**
 * The social layer: posts, threads, reactions — kind 1/7 as read by
 * CONSUMING_THE_RECORD.md's "kind 1 — posts and replies" section.
 *
 * Same discipline as `datasets.ts` and `civic.ts`: pure readers over
 * `RecordClient` + the tag helpers, no runtime dependency on
 * `@netizen-labs/nostr` (dependency-free per package discipline — the label
 * rules below are re-derived locally rather than imported, since
 * `isAgentEvent`/`AGENT_TAG` live in a package this one must not depend on
 * at runtime).
 */

import type { RecordClient, RecordEvent } from "./client";
import { dTag, tagValue } from "./tags";

/** Immutable note/reply (NIP-01). */
const KIND_NOTE = 1;
/** Reaction (NIP-25). */
const KIND_REACTION = 7;
/** Profile metadata. */
const KIND_PROFILE = 0;
/** Tag marking an event as machine-authored — mirrors @netizen-labs/nostr's AGENT_TAG (not imported: runtime dependency-free). */
const AGENT_TAG = "netizen_agent";

export interface RecordPost {
  id: string; // Supabase post id when the event carries the d/publication mapping; else the event id
  event_id: string;
  author_pubkey: string;
  author_name: string | null;
  author_avatar: string | null;
  is_org: boolean;
  is_agent: boolean;
  content: string;
  media_urls: string[];
  created_at: string; // ISO from event created_at
  likes_count: number;
  comments_count: number;
  parent_event_id: string | null;
  quoted_event_id: string | null;
}

interface AuthorProfile {
  name: string | null;
  avatar: string | null;
  isOrg: boolean;
  isBot: boolean;
}

/** Parses a kind-0 profile's content JSON defensively — a malformed profile must not break the whole feed. */
function parseProfile(ev: RecordEvent): AuthorProfile {
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(ev.content) as Record<string, unknown>;
  } catch {
    body = {};
  }
  const str = (k: string) => (typeof body[k] === "string" && body[k] !== "" ? (body[k] as string) : null);
  return {
    name: str("name"),
    avatar: str("picture"),
    // Organisations carry a netizen_org tag on their OWN kind-0 profile
    // (CONSUMING_THE_RECORD.md "kind 0 — profiles"), same tag listOrgs
    // (datasets.ts) keys on.
    isOrg: ev.tags.some((t) => t[0] === "netizen_org"),
    // NIP-24's bot:true — one of the two agent signals the brief requires.
    isBot: body["bot"] === true,
  };
}

/** True when the note carries any `e` tag — a reply, per CONSUMING_THE_RECORD.md ("A reply carries an e tag"). */
function isReply(ev: RecordEvent): boolean {
  return ev.tags.some((t) => t[0] === "e");
}

/**
 * Turn raw kind-1 events into `RecordPost`s with ONE batched kind-0 authors
 * join, ONE batched kind-7 reaction count and ONE batched kind-1 (e-filtered)
 * comment count — never a query per post. Shared by `listPosts` (top-level
 * notes) and `getThread` (replies): both need identical enrichment over a
 * different starting event set, so the batching lives here once.
 */
async function enrich(client: RecordClient, events: RecordEvent[]): Promise<RecordPost[]> {
  if (events.length === 0) return [];

  const authorPubkeys = [...new Set(events.map((e) => e.pubkey))];
  const postIds = events.map((e) => e.id);

  const [profiles, reactions, comments] = await Promise.all([
    client.events({ kinds: [KIND_PROFILE], authors: authorPubkeys }),
    client.events({ kinds: [KIND_REACTION], e: postIds }),
    client.events({ kinds: [KIND_NOTE], e: postIds }),
  ]);

  const profileByPubkey = new Map(profiles.map((p) => [p.pubkey, parseProfile(p)]));

  const countByTarget = (targets: RecordEvent[]): Map<string, number> => {
    const counts = new Map<string, number>();
    for (const t of targets) {
      const target = tagValue(t, "e");
      if (target === null) continue;
      counts.set(target, (counts.get(target) ?? 0) + 1);
    }
    return counts;
  };
  const likesByPost = countByTarget(reactions);
  const commentsByPost = countByTarget(comments);

  return events.map((ev) => {
    const author = profileByPubkey.get(ev.pubkey);
    // is_agent = author's kind-0 "bot": true OR the post's own netizen_agent
    // tag — either signal suffices (per the brief's rule and
    // CONSUMING_THE_RECORD.md's dual "machine speech" labelling: an agent's
    // NOTE always carries the tag too, per buildAgentNoteEvent, but an
    // agent's profile alone must be enough for a reader who only fetched
    // this batch, e.g. getThread on a single reply).
    const isAgent = (author?.isBot ?? false) || ev.tags.some((t) => t[0] === AGENT_TAG);
    return {
      // orgPostToSpec (mappers.ts) never emits a `d` tag (spec.tags is always
      // []), and the device-side publishPost (apps/expo/lib/nostr/publish.ts)
      // doesn't either — so today this always falls through to the event id.
      // Kept as a `d`-tag lookup per the brief's interface, in case a future
      // mapper version starts carrying a publication-mapping d tag.
      id: dTag(ev) ?? ev.id,
      event_id: ev.id,
      author_pubkey: ev.pubkey,
      author_name: author?.name ?? null,
      author_avatar: author?.avatar ?? null,
      is_org: author?.isOrg ?? false,
      is_agent: isAgent,
      content: ev.content,
      // Both publishing paths (orgPostToSpec, and the device's publishPost /
      // repairMisdatedMirrors) fold media URLs into the plain-text content
      // ("body\n\n<url>\n<url>") rather than a separate tag — there is no
      // structural signal a record-mode reader can use to split them back
      // out today, so this is always [].
      media_urls: [],
      created_at: new Date(ev.created_at * 1000).toISOString(),
      likes_count: likesByPost.get(ev.id) ?? 0,
      comments_count: commentsByPost.get(ev.id) ?? 0,
      parent_event_id: tagValue(ev, "e"),
      quoted_event_id: tagValue(ev, "q"),
    };
  });
}

/** kind 1, top-level only (no `e` tag) — replies are excluded, see `getThread`. */
export async function listPosts(
  client: RecordClient,
  opts?: { limit?: number; until?: number },
): Promise<RecordPost[]> {
  const events = await client.events({ kinds: [KIND_NOTE], limit: opts?.limit, until: opts?.until });
  return enrich(client, events.filter((ev) => !isReply(ev)));
}

/** kind 1 with `e = eventId` — the direct replies to one post or comment. */
export async function getThread(client: RecordClient, eventId: string): Promise<RecordPost[]> {
  const events = await client.events({ kinds: [KIND_NOTE], e: [eventId] });
  // Re-filter after fetch (same discipline as datasets.ts): a note can carry
  // more than one `e` tag (NIP-10 root+reply), so match on ANY of them
  // rather than trusting the server-side filter's semantics or the first tag.
  const replies = events.filter((ev) => ev.tags.some((t) => t[0] === "e" && t[1] === eventId));
  return enrich(client, replies);
}
