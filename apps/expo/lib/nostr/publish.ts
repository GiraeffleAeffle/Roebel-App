import {
  type NostrEvent,
  type ProfileMetadata,
  RelayClient,
  buildDeletionEvent,
  buildNoteEvent,
  buildProfileEvent,
} from '@netizen-labs/nostr';
import { supabase } from '../supabase';
import { type NostrIdentity, loadStoredIdentity } from './identity';

/**
 * Publishing app content to the sovereign relay.
 *
 * Everything here is BEST-EFFORT and must never block or fail a user action.
 * Supabase remains the app's source of truth for this slice; the relay is a
 * parallel, signed, portable copy that other nodes and agents can read.
 */

export const ROEBEL_RELAY_URL = 'wss://relay.roebel.app';

let client: RelayClient | null = null;

function relay(): RelayClient {
  if (!client) client = new RelayClient(ROEBEL_RELAY_URL, { timeoutMs: 8000 });
  return client;
}

/** Drop the pooled connection — call on sign-out. */
export function closeRelay(): void {
  client?.close();
  client = null;
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
    const result = await relay().publish(event);
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
export async function publishPost(postId: string, content: string): Promise<PublicationStatus> {
  const identity = await loadStoredIdentity();
  if (!identity) return 'pending';
  return publish(buildNoteEvent(identity.secretKey, content), 'post', postId);
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
    const result = await relay().publish(
      buildDeletionEvent(identity.secretKey, eventIds, { reason }),
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
    const events = await relay().query([filter]);
    return events.sort((a, b) => b.created_at - a.created_at);
  } catch {
    return [];
  }
}
