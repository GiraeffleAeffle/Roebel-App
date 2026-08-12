import {
  buildCalendarEvent,
  buildCitizenSignedSuggestion,
  buildCivicDiscussionEvent,
  type CivicCaseBinding,
  type CitizenSignedSuggestionV1,
  type NostrEvent,
  type ProfileMetadata,
  RelayClient,
  buildDeletionEvent,
  buildEvent,
  buildVanishEvent,
  buildNoteEvent,
  buildProfileEvent,
} from '@netizen-labs/nostr';
import { supabase } from '../supabase';
import { type NostrIdentity, loadStoredIdentity } from './identity';
import { resolvePublicRelayUrls } from './relay-config';

/**
 * Publishing app content to the sovereign relay.
 *
 * Everything here is BEST-EFFORT and must never block or fail a user action.
 * Supabase remains the app's source of truth for this slice; the relay is a
 * parallel, signed, portable copy that other nodes and agents can read.
 */

const relayUrls = resolvePublicRelayUrls();
export const ROEBEL_RELAY_URL = relayUrls.citizenRelayUrl;
export const ROEBEL_MECKY_REPLY_RELAY_URL = relayUrls.agentRelayUrl;

let citizenClient: RelayClient | null = null;
let agentClient: RelayClient | null = null;

function citizenRelay(): RelayClient {
  if (!citizenClient) citizenClient = new RelayClient(ROEBEL_RELAY_URL, { timeoutMs: 8000 });
  return citizenClient;
}

function agentRelay(): RelayClient {
  if (ROEBEL_MECKY_REPLY_RELAY_URL === ROEBEL_RELAY_URL) return citizenRelay();
  if (!agentClient) agentClient = new RelayClient(ROEBEL_MECKY_REPLY_RELAY_URL, { timeoutMs: 8000 });
  return agentClient;
}

/** Drop the pooled connection — call on sign-out. */
export function closeRelay(): void {
  citizenClient?.close();
  agentClient?.close();
  citizenClient = null;
  agentClient = null;
}

export type PublicationStatus = 'published' | 'rejected' | 'pending';

async function recordPublication(
  sourceType: string,
  sourceId: string,
  pubkeyHex: string,
  status: PublicationStatus,
  eventId: string | null,
  relayMessage: string,
): Promise<void> {
  try {
    await supabase.from('nostr_publications').upsert(
      {
        source_type: sourceType,
        source_id: sourceId,
        pubkey_hex: pubkeyHex,
        event_id: eventId,
        status,
        relay_message: relayMessage.slice(0, 500),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'source_type,source_id' },
    );
  } catch {
    // Parity bookkeeping is not worth failing a user action over.
  }
}

async function publish(
  event: NostrEvent,
  sourceType: string,
  sourceId: string,
): Promise<PublicationStatus> {
  try {
    const result = await citizenRelay().publish(event);
    const status: PublicationStatus = result.ok ? 'published' : 'rejected';
    await recordPublication(
      sourceType,
      sourceId,
      event.pubkey,
      status,
      result.ok ? event.id : null,
      result.message,
    );
    return status;
  } catch {
    await recordPublication(sourceType, sourceId, event.pubkey, 'pending', null, 'relay unreachable');
    return 'pending';
  }
}

/**
 * Mirror a public feed post to the relay.
 *
 * Call AFTER the Supabase insert has succeeded, and do not await it in the UI
 * path. A Citizen who has not yet been allow-listed gets `rejected` with the
 * write-policy message — an expected state while the syncer catches up, not an
 * error worth showing.
 */
export async function publishPost(
  postId: string,
  content: string,
  createdAtSec?: number,
): Promise<PublicationStatus> {
  const identity = await loadStoredIdentity();
  if (!identity) return 'pending';
  // The post's ORIGINAL wall-clock, not "now": a backfilled post from March
  // must appear in March on every Nostr client, not on the day the sweep ran.
  return publish(
    buildNoteEvent(identity.secretKey, content, createdAtSec ? { createdAt: createdAtSec } : {}),
    'post',
    postId,
  );
}

/**
 * Make sure this citizen's kind 0 profile exists on the relay, so clients can
 * show a name instead of a bare key. Publishes once; a kind 0 already on the
 * relay wins (profile edits go through the Settings screen's explicit path).
 */
export async function ensureProfilePublished(walletAddress: string): Promise<void> {
  const identity = await loadStoredIdentity();
  if (!identity) return;
  try {
    const existing = await readFromRelay([identity.publicKey], [0], 1);
    if (existing.length > 0) return;
    const { data: userRow } = await supabase
      .from('users')
      .select('username, bio, profile_picture_url')
      .eq('wallet_address', walletAddress.toLowerCase())
      .maybeSingle();
    if (!userRow?.username) return;
    await publishProfile(
      {
        name: userRow.username as string,
        about: (userRow.bio as string | null) || undefined,
        picture: (userRow.profile_picture_url as string | null) || undefined,
      },
      identity,
    );
  } catch {
    // cosmetic; the next sweep retries
  }
}

/** The parent post's event id on the relay, or null if it was never published. */
async function publishedEventIdOf(sourceType: string, sourceId: string): Promise<string | null> {
  try {
    const { data } = await supabase
      .from('nostr_publications')
      .select('event_id')
      .eq('source_type', sourceType)
      .eq('source_id', sourceId)
      .eq('status', 'published')
      .maybeSingle();
    return (data?.event_id as string | undefined) ?? null;
  } catch {
    return null;
  }
}

/**
 * Mirror a comment as a NIP-10 threaded reply.
 *
 * Only possible when the parent post itself is on the relay — a reply to an
 * event that does not exist is noise no client can thread. Same fire-and-forget
 * contract as publishPost: never awaited in the UI path.
 */
export async function publishComment(
  commentId: string,
  postId: string,
  content: string,
): Promise<PublicationStatus> {
  const identity = await loadStoredIdentity();
  if (!identity) return 'pending';
  const parent = await publishedEventIdOf('post', postId);
  if (!parent) return 'pending';
  const event = buildNoteEvent(identity.secretKey, content, {
    tags: [['e', parent, '', 'root']],
  });
  return publish(event, 'comment', commentId);
}

/**
 * Mirror a like as a NIP-25 reaction ("+").
 *
 * source_id is scoped by the reactor's pubkey: nostr_publications keys on
 * (source_type, source_id), and two citizens liking the same post must not
 * collide.
 */
export async function publishLike(postId: string): Promise<PublicationStatus> {
  const identity = await loadStoredIdentity();
  if (!identity) return 'pending';
  const parent = await publishedEventIdOf('post', postId);
  if (!parent) return 'pending';
  const event = buildEvent(identity.secretKey, 7, '+', { tags: [['e', parent]] });
  return publish(event, 'like', `${postId}:${identity.publicKey.slice(0, 16)}`);
}

/** Unliking retracts the reaction with a NIP-09 deletion request. */
export async function publishUnlike(postId: string): Promise<void> {
  const identity = await loadStoredIdentity();
  if (!identity) return;
  const likeEventId = await publishedEventIdOf('like', `${postId}:${identity.publicKey.slice(0, 16)}`);
  if (!likeEventId) return;
  try {
    await citizenRelay().publish(buildDeletionEvent(identity.secretKey, [likeEventId], { reason: 'Like zurückgenommen' }));
  } catch {
    // Advisory anyway; the app state is authoritative for the UI.
  }
}

/**
 * Mirror a repost. NIP-18: a bare repost is kind 6 referencing the original;
 * a quote-repost with own words is a kind 1 carrying a `q` tag.
 */
export async function publishRepost(
  repostPostId: string,
  originalPostId: string,
  quoteContent?: string,
): Promise<PublicationStatus> {
  const identity = await loadStoredIdentity();
  if (!identity) return 'pending';
  const original = await publishedEventIdOf('post', originalPostId);
  if (!original) return 'pending';
  const event = quoteContent
    ? buildNoteEvent(identity.secretKey, quoteContent, { tags: [['q', original]] })
    : buildEvent(identity.secretKey, 6, '', { tags: [['e', original]] });
  return publish(event, 'repost', repostPostId);
}

/** Publish (or refresh) the Citizen's kind 0 profile. Only already-public fields. */
export async function publishProfile(
  metadata: ProfileMetadata,
  identity?: NostrIdentity,
): Promise<PublicationStatus> {
  const resolved = identity ?? (await loadStoredIdentity());
  if (!resolved) return 'pending';
  return publish(buildProfileEvent(resolved.secretKey, metadata), 'profile', resolved.publicKey);
}

/**
 * Request deletion of previously published events (NIP-09).
 *
 * Advisory by design: relays MAY honour it and clients that already have the
 * event keep it. Used on account deletion and opt-out because it is the correct
 * signal to send — not because it guarantees erasure. Data that must be erasable
 * never goes on the relay in the first place.
 */
export async function publishDeletions(eventIds: string[], reason = 'Konto gelöscht'): Promise<boolean> {
  if (eventIds.length === 0) return true;
  const identity = await loadStoredIdentity();
  if (!identity) return false;
  try {
    const result = await citizenRelay().publish(
      buildDeletionEvent(identity.secretKey, eventIds, { reason }),
    );
    return result.ok;
  } catch {
    return false;
  }
}

/**
 * NIP-62 "request to vanish" — the account-deletion signal. Unlike the kind-5
 * above it is not limited to the ids THIS device remembers: it asks for every
 * event of this key, other devices included. Addressed to ALL_RELAYS so any
 * NIP-62-aware relay may honour it; on our own relay the vanish pipeline turns
 * it into real LMDB deletion (authoring store AND federation mirror), which is
 * the erasure the Datenschutzerklärung promises for our own systems.
 */
export async function publishVanishRequest(reason = 'Konto gelöscht'): Promise<boolean> {
  const identity = await loadStoredIdentity();
  if (!identity) return false;
  try {
    const result = await citizenRelay().publish(
      buildVanishEvent(identity.secretKey, 'ALL_RELAYS', { reason }),
    );
    return result.ok;
  } catch {
    return false;
  }
}

/**
 * Every event id THIS identity published, for the deletion request.
 *
 * Scoped to our own pubkey: the publications table is world-readable, so an
 * unfiltered query would sweep in every other Citizen's events. A relay would
 * reject those deletions anyway (kind 5 only deletes the signer's own events),
 * but asking is still wrong.
 */
export async function publishedEventIds(): Promise<string[]> {
  const identity = await loadStoredIdentity();
  if (!identity) return [];
  try {
    const { data } = await supabase
      .from('nostr_publications')
      .select('event_id')
      .eq('status', 'published')
      .eq('pubkey_hex', identity.publicKey);
    return ((data ?? []) as Array<{ event_id: string | null }>)
      .map((row) => row.event_id)
      .filter((id): id is string => !!id);
  } catch {
    return [];
  }
}

/**
 * Publish a note to the relay ONLY — no Supabase post, no feed entry, no push.
 *
 * Posting to the main feed fires a notification to every user, which makes it a
 * terrible way to check whether the relay works. This writes a real signed kind 1
 * to the relay and nothing else, so the loop can be verified without disturbing
 * the town.
 */
export async function publishTestNote(
  content: string,
): Promise<{ ok: boolean; eventId?: string; message: string }> {
  const identity = await loadStoredIdentity();
  if (!identity) return { ok: false, message: 'Keine Nostr-Identität auf diesem Gerät.' };
  try {
    const event = buildNoteEvent(identity.secretKey, content);
    const result = await citizenRelay().publish(event);
    return result.ok
      ? { ok: true, eventId: event.id, message: 'Auf dem Relay veröffentlicht.' }
      : { ok: false, message: result.message || 'Vom Relay abgelehnt.' };
  } catch {
    return { ok: false, message: 'Relay nicht erreichbar.' };
  }
}

/**
 * Ask an agent a question by mentioning it.
 *
 * The mention is a NIP-01 `p` tag carrying the agent's pubkey — the standard way
 * one Nostr event references an identity. That matters: the mention is legible to
 * ANY Nostr client, not just this app, so an agent on another node could answer it
 * too. Writing "@mecky" as plain text would only work inside Röbel.
 */
export async function publishAgentMention(
  content: string,
  agentPubkey: string,
): Promise<{ ok: boolean; eventId?: string; message: string }> {
  const identity = await loadStoredIdentity();
  if (!identity) return { ok: false, message: 'Keine Nostr-Identität auf diesem Gerät.' };
  try {
    const event = buildNoteEvent(identity.secretKey, content, {
      tags: [['p', agentPubkey.toLowerCase()]],
    });
    const result = await citizenRelay().publish(event);
    return result.ok
      ? { ok: true, eventId: event.id, message: 'Frage gestellt. Mecky antwortet gleich …' }
      : { ok: false, message: result.message || 'Vom Relay abgelehnt.' };
  } catch {
    return { ok: false, message: 'Relay nicht erreichbar.' };
  }
}

/**
 * Mirror an app-visible civic discussion as the exact citizen-signed event the
 * Stadtstack intake adapter accepts. The Supabase post remains the local UI
 * record; this event is the portable signature/provenance record.
 */
export async function publishCivicDiscussion(
  postId: string,
  content: string,
  binding: CivicCaseBinding,
  createdAtSec?: number,
): Promise<PublicationStatus> {
  return (
    await publishCivicDiscussionDetailed(
      postId,
      content,
      binding,
      createdAtSec,
    )
  ).status;
}

export async function publishCivicDiscussionDetailed(
  postId: string,
  content: string,
  binding: CivicCaseBinding,
  createdAtSec?: number,
): Promise<{ status: PublicationStatus; event: NostrEvent | null }> {
  const identity = await loadStoredIdentity();
  if (!identity) return { status: 'pending', event: null };
  const agentPubkey = process.env.EXPO_PUBLIC_MECKY_NOSTR_PUBKEY?.trim().toLowerCase();
  if (!agentPubkey) return { status: 'pending', event: null };
  try {
    const event = buildCivicDiscussionEvent(identity.secretKey, {
      ...binding,
      agentPubkey,
      content,
      ...(createdAtSec === undefined ? {} : { createdAt: createdAtSec }),
    });
    return {
      status: await publish(event, 'civic_discussion', postId),
      event,
    };
  } catch {
    return { status: 'pending', event: null };
  }
}

/**
 * Let the same citizen turn a verified Public Mecky answer into a signed
 * suggestion candidate. Publishing still does not admit it into Stadtstack;
 * the result remains explicitly awaiting a human Case steward.
 */
export async function publishCitizenSignedSuggestion(input: {
  binding: CivicCaseBinding;
  sourceDiscussion: NostrEvent;
  sourceAnswer: NostrEvent;
  title: string;
  summary: string;
  createdAt?: number;
}): Promise<{
  status: PublicationStatus;
  suggestion: CitizenSignedSuggestionV1 | null;
}> {
  const identity = await loadStoredIdentity();
  if (!identity) return { status: 'pending', suggestion: null };
  const agentPubkey = process.env.EXPO_PUBLIC_MECKY_NOSTR_PUBKEY?.trim().toLowerCase();
  if (!agentPubkey) return { status: 'pending', suggestion: null };

  const suggestion = buildCitizenSignedSuggestion(identity.secretKey, {
    binding: input.binding,
    sourceDiscussion: input.sourceDiscussion,
    sourceAnswer: input.sourceAnswer,
    agentPubkey,
    title: input.title,
    summary: input.summary,
    createdAt: input.createdAt ?? Math.floor(Date.now() / 1_000),
  });
  const event: NostrEvent = {
    id: suggestion.event.id,
    pubkey: suggestion.event.pubkey,
    created_at: suggestion.event.createdAt,
    kind: suggestion.event.kind,
    tags: suggestion.event.tags,
    content: suggestion.event.content,
    sig: suggestion.event.signature,
  };
  return {
    status: await publish(
      event,
      'citizen_signed_suggestion',
      suggestion.candidateId,
    ),
    suggestion,
  };
}

/**
 * Look for an agent's reply to a specific event.
 *
 * A reply is a kind 1 carrying an `e` tag pointing at the parent. Filtering by
 * `#e` server-side means the relay does the work rather than the phone.
 */
export async function fetchAgentReply(
  parentEventId: string,
  agentPubkey: string,
): Promise<NostrEvent | null> {
  try {
    const events = await agentRelay().query([
      { kinds: [1], authors: [agentPubkey.toLowerCase()], "#e": [parentEventId], limit: 5 },
    ]);
    return events.sort((a, b) => b.created_at - a.created_at)[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Publish a cinema screening as a NIP-52 calendar event.
 *
 * The first app data type beyond profiles and feed posts to reach the protocol,
 * chosen because it carries NO personal data: a screening time for a business.
 * The worst case for a mistake here is a wrong film time.
 *
 * Replaceable by the movie's own id, so correcting or cancelling a screening is a
 * re-publish rather than a deletion request a relay may ignore.
 */
export async function publishScreening(movie: {
  id: string;
  title: string;
  description?: string | null;
  date: string;
  time?: string | null;
  cover_image_url?: string | null;
  fsk?: string | null;
}): Promise<PublicationStatus> {
  const identity = await loadStoredIdentity();
  if (!identity) return 'pending';

  // Local time: a screening is announced in the town's own timezone, and a date
  // with no clock time is a legitimate all-day entry rather than midnight.
  const start = Math.floor(new Date(`${movie.date}T${movie.time ?? '00:00:00'}`).getTime() / 1000);
  if (!Number.isFinite(start)) return 'pending';

  const event = buildCalendarEvent(identity.secretKey, {
    id: movie.id,
    title: movie.title,
    summary: movie.description ?? null,
    start,
    image: movie.cover_image_url ?? null,
    allDay: !movie.time,
    labels: ['kino', ...(movie.fsk ? [movie.fsk.toLowerCase().replace(/\s+/g, '-')] : [])],
  });

  return publish(event, 'screening', movie.id);
}

/**
 * Read events straight off the relay.
 *
 * No indexer: a chronological feed filtered by kind + author + time is exactly
 * what a relay REQ filter does. An indexer only becomes necessary when the
 * queries outgrow filters — search, threading, cross-node aggregation.
 */
export async function readFromRelay(
  authors: string[],
  kinds: number[] = [0, 1],
  limit = 50,
): Promise<NostrEvent[]> {
  try {
    const filter = authors.length > 0 ? { kinds, authors, limit } : { kinds, limit };
    const events = await citizenRelay().query([filter]);
    return events.sort((a, b) => b.created_at - a.created_at);
  } catch {
    return [];
  }
}

/**
 * Re-publish posts whose mirror never landed.
 *
 * A citizen's very first mirrored post races the allow-list (the syncer runs
 * every 5 minutes), so it records as rejected. This sweep retries everything
 * pending or rejected for THIS device's identity from the app's own posts —
 * scope-limited by design: only publications the app already attempted, which
 * all happened after consent.
 */
/**
 * One-time repair for mirrors published before dates were preserved: an old
 * post that reached the relay stamped "today" is deleted and republished with
 * its original wall-clock, and a post the device mis-signed on an ORG account's
 * behalf is deleted outright (the node republishes those under the org's key).
 * Ledger rows update automatically through publishPost's upsert.
 */
async function repairMisdatedMirrors(identity: NostrIdentity): Promise<void> {
  try {
    const { data: ledger } = await supabase
      .from('nostr_publications')
      .select('source_id, event_id')
      .eq('source_type', 'post')
      .eq('pubkey_hex', identity.publicKey)
      .eq('status', 'published')
      .limit(100);
    if (!ledger?.length) return;
    const onRelay = new Map(
      (await readFromRelay([identity.publicKey], [1], 200)).map((e) => [e.id, e.created_at]),
    );
    for (const row of ledger) {
      const eventId = row.event_id as string | null;
      if (!eventId || !onRelay.has(eventId)) continue;
      const { data: post } = await supabase
        .from('posts')
        .select('id, content, media_urls, created_at, account:account_id(account_type)')
        .eq('id', row.source_id)
        .maybeSingle();
      if (!post?.created_at) continue;
      const originalSec = Math.floor(Date.parse(post.created_at as string) / 1000);
      const isOrgPost = (post.account as { account_type?: string } | null)?.account_type === 'organisation';
      const driftedByADay = Math.abs((onRelay.get(eventId) ?? originalSec) - originalSec) > 86_400;
      if (!isOrgPost && !driftedByADay) continue;
      await citizenRelay().publish(
        buildDeletionEvent(identity.secretKey, [eventId], {
          reason: isOrgPost ? 'Falsche Zuordnung' : 'Datum korrigiert',
        }),
      );
      if (!isOrgPost) {
        const media = ((post.media_urls as string[] | null) ?? []).join('\n');
        const content = media ? `${post.content}\n\n${media}` : (post.content as string);
        await publishPost(post.id as string, content, originalSec);
      }
    }
  } catch {
    // repair is best-effort; the record stays merely mis-dated, not wrong
  }
}

export async function retryPendingPublications(walletAddress?: string): Promise<void> {
  const identity = await loadStoredIdentity();
  if (!identity) return;
  if (walletAddress) await ensureProfilePublished(walletAddress);
  await repairMisdatedMirrors(identity);
  try {
    const { data } = await supabase
      .from('nostr_publications')
      .select('source_id')
      .eq('source_type', 'post')
      .eq('pubkey_hex', identity.publicKey)
      .in('status', ['pending', 'rejected'])
      .limit(20);
    const sourceIds = new Set((data ?? []).map((r) => String(r.source_id)));

    // The very first post races ENROLLMENT itself: published before an identity
    // existed, it has no ledger row at all. Sweep the citizen's recent posts
    // for unledgered ones — all made after the guidelines consent.
    if (walletAddress) {
      // ALL of the citizen's own public posts, oldest first — including those
      // from before the integration existed. Their key, their device, their
      // enrollment; the batch cap spreads the backfill over a few sweeps.
      const { data: recent } = await supabase
        .from('posts')
        .select('id, account:account_id(account_type)')
        .eq('wallet_address', walletAddress.toLowerCase())
        .eq('feed_type', 'main')
        .eq('post_type', 'user')
        .eq('status', 'published')
        .order('created_at', { ascending: true })
        .limit(30);
      // Organisation-account posts are the NODE's to publish under the org's
      // own key — a person's key on an organisation's words is false attribution.
      const recentIds = (recent ?? [])
        .filter((r) => (r.account as { account_type?: string } | null)?.account_type !== 'organisation')
        .map((r) => String(r.id));
      if (recentIds.length) {
        const { data: ledgered } = await supabase
          .from('nostr_publications')
          .select('source_id')
          .eq('source_type', 'post')
          .in('source_id', recentIds);
        const known = new Set((ledgered ?? []).map((r) => String(r.source_id)));
        for (const id of recentIds) if (!known.has(id)) sourceIds.add(id);
      }
    }

    for (const row of [...sourceIds].map((source_id) => ({ source_id }))) {
      const { data: post } = await supabase
        .from('posts')
        .select('id, content, media_urls, created_at, account:account_id(account_type)')
        .eq('id', row.source_id)
        .maybeSingle();
      if (!post) continue;
      if ((post.account as { account_type?: string } | null)?.account_type === 'organisation') continue;
      const media = ((post.media_urls as string[] | null) ?? []).join('\n');
      const content = media ? `${post.content}\n\n${media}` : (post.content as string);
      const originalSec = post.created_at ? Math.floor(Date.parse(post.created_at as string) / 1000) : undefined;
      await publishPost(post.id as string, content, originalSec);
    }
  } catch {
    // Best-effort; the next sweep tries again.
  }
}
