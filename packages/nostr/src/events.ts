import { schnorr } from "@noble/curves/secp256k1";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils";
import { getPublicKeyHex } from "./keys";

/** NIP-01 event kinds this package builds. */
export const KIND = {
  profile: 0,
  note: 1,
  deletion: 5,
  /** NIP-78 application-specific data — carries the wallet↔npub binding. */
  appData: 30078,
} as const;

export type NostrTag = string[];

export interface UnsignedEvent {
  pubkey: string;
  created_at: number;
  kind: number;
  tags: NostrTag[];
  content: string;
}

export interface NostrEvent extends UnsignedEvent {
  id: string;
  sig: string;
}

/**
 * NIP-01 event id: sha256 over the canonical serialization
 * `[0, pubkey, created_at, kind, tags, content]`. JSON.stringify produces exactly
 * the required form — no whitespace, standard JSON string escaping.
 */
export function eventId(event: UnsignedEvent): string {
  const serialized = JSON.stringify([
    0,
    event.pubkey,
    event.created_at,
    event.kind,
    event.tags,
    event.content,
  ]);
  return bytesToHex(sha256(utf8ToBytes(serialized)));
}

/** Sign an unsigned event, producing its id and BIP-340 signature. */
export function signEvent(event: UnsignedEvent, secretKey: Uint8Array): NostrEvent {
  const id = eventId(event);
  const sig = bytesToHex(schnorr.sign(hexToBytes(id), secretKey));
  return { ...event, id, sig };
}

/** Verify an event's id and signature. Never throws — a malformed event is just invalid. */
export function verifyEvent(event: NostrEvent): boolean {
  try {
    if (eventId(event) !== event.id) return false;
    return schnorr.verify(hexToBytes(event.sig), hexToBytes(event.id), hexToBytes(event.pubkey));
  } catch {
    return false;
  }
}

function unixNow(): number {
  return Math.floor(Date.now() / 1000);
}

interface BuildOptions {
  /** Injectable for deterministic tests; defaults to now. */
  createdAt?: number;
  tags?: NostrTag[];
}

/** Build + sign any event. */
export function buildEvent(
  secretKey: Uint8Array,
  kind: number,
  content: string,
  options: BuildOptions = {},
): NostrEvent {
  return signEvent(
    {
      pubkey: getPublicKeyHex(secretKey),
      created_at: options.createdAt ?? unixNow(),
      kind,
      tags: options.tags ?? [],
      content,
    },
    secretKey,
  );
}

export interface ProfileMetadata {
  name?: string;
  about?: string;
  picture?: string;
  /** NIP-05 style identifier, if the node ever serves one. */
  nip05?: string;
}

/**
 * kind 0 — profile metadata. Only fields that are already public in the app go
 * here; the relay is world-readable and has no NIP-42 AUTH.
 */
export function buildProfileEvent(
  secretKey: Uint8Array,
  metadata: ProfileMetadata,
  options: BuildOptions = {},
): NostrEvent {
  const cleaned = Object.fromEntries(
    Object.entries(metadata).filter(([, v]) => v !== undefined && v !== null && v !== ""),
  );
  return buildEvent(secretKey, KIND.profile, JSON.stringify(cleaned), options);
}

/** kind 1 — a public feed post. */
export function buildNoteEvent(
  secretKey: Uint8Array,
  content: string,
  options: BuildOptions = {},
): NostrEvent {
  return buildEvent(secretKey, KIND.note, content, options);
}

/**
 * kind 5 — NIP-09 deletion request for the caller's own events.
 *
 * Honest limit: deletion on Nostr is **advisory**. Relays may ignore it and any
 * client that already fetched the event keeps it. Never rely on this for GDPR
 * erasure — that is why private data does not go on the relay in the first place.
 */
export function buildDeletionEvent(
  secretKey: Uint8Array,
  eventIds: string[],
  options: BuildOptions & { reason?: string } = {},
): NostrEvent {
  const tags = [...eventIds.map((id) => ["e", id]), ...(options.tags ?? [])];
  return buildEvent(secretKey, KIND.deletion, options.reason ?? "", { ...options, tags });
}
