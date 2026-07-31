/**
 * NIP-62 "Request to Vanish" + NIP-09 deletion — the pure half.
 *
 * The Datenschutzerklärung (v1.1) promises that deletion requests are HONOURED
 * in our own systems, and the EDPB blockchain guidelines make erasure a duty
 * where it is enforceable. On our own relay it is enforceable — strfry applies
 * NIP-09 natively on its ingest path, but has no NIP-62 support and no
 * guarantee that sync-ingested kind-5s trigger deletion on the mirror. This
 * module turns those requests into an explicit work queue that a sh executor
 * inside the strfry image drains with `strfry delete`.
 *
 * Everything here is deliberately paranoid: a deletion routine that can be
 * steered by attacker-controlled event content deletes other people's record.
 * Rules enforced:
 *  - a vanish request only ever deletes the REQUESTER's own events (author
 *    filter = the kind-62 event's verified pubkey, until = its created_at);
 *  - a kind-5 only deletes referenced events whose author IS the kind-5
 *    author (NIP-09 rule) — ownership is checked against fetched events,
 *    never trusted from tags;
 *  - every id/pubkey is validated as exactly 64 lowercase hex before it may
 *    enter the queue, and the executor validates again before shelling out.
 */

export type NostrEvent = {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
};

export type VanishWork =
  | { op: "author"; store: "auth" | "mirror"; pubkey: string; until: number }
  | { op: "ids"; store: "auth" | "mirror"; ids: string[] };

export const KIND_VANISH = 62;
export const KIND_DELETE = 5;

const HEX64 = /^[0-9a-f]{64}$/;

export function isHex64(s: unknown): s is string {
  return typeof s === "string" && HEX64.test(s);
}

/** Normalise a relay URL for comparison: lowercase, no trailing slash. */
export function normalizeRelayUrl(url: string): string {
  return url.trim().toLowerCase().replace(/\/+$/, "");
}

/**
 * A kind-62 event → an author-purge instruction, or null if it is not a valid
 * vanish request addressed to one of OUR relays.
 *
 * NIP-62: `relay` tags name the relays asked to forget the author; the value
 * `ALL_RELAYS` (case-insensitive here, the spec writes it uppercase) addresses
 * every relay that sees the event. The request covers events up to its own
 * created_at — not future ones, so a re-joining author is not silently muted.
 */
export function parseVanishRequest(
  evt: NostrEvent,
  ourRelayUrls: string[],
): { pubkey: string; until: number } | null {
  if (evt.kind !== KIND_VANISH) return null;
  if (!isHex64(evt.pubkey)) return null;
  if (!Number.isInteger(evt.created_at) || evt.created_at <= 0) return null;
  const ours = ourRelayUrls.map(normalizeRelayUrl).filter(Boolean);
  const addressed = (evt.tags ?? []).some((t) => {
    if (!Array.isArray(t) || t[0] !== "relay" || typeof t[1] !== "string") return false;
    const v = t[1].trim();
    if (v.toUpperCase() === "ALL_RELAYS") return true;
    return ours.includes(normalizeRelayUrl(v));
  });
  if (!addressed) return null;
  return { pubkey: evt.pubkey, until: evt.created_at };
}

/** The e-tag ids a kind-5 asks to delete — validated shape only, NOT ownership. */
export function referencedIds(kind5: NostrEvent): string[] {
  if (kind5.kind !== KIND_DELETE) return [];
  const ids = (kind5.tags ?? [])
    .filter((t) => Array.isArray(t) && t[0] === "e" && isHex64(t[1]))
    .map((t) => t[1]);
  return [...new Set(ids)];
}

/**
 * NIP-09 ownership check: of the referenced ids, keep only those whose FETCHED
 * event is authored by the kind-5's own pubkey. Ids that could not be fetched
 * are dropped — an unfetchable event cannot be verified, so it is not deleted.
 */
export function ownedDeletionIds(
  kind5: NostrEvent,
  authorById: ReadonlyMap<string, string>,
): string[] {
  if (!isHex64(kind5.pubkey)) return [];
  return referencedIds(kind5).filter((id) => authorById.get(id) === kind5.pubkey);
}

/** One queue line. Space-separated, fixed shape — the sh executor re-validates. */
export function encodeWork(w: VanishWork): string {
  if (w.op === "author") {
    if (!isHex64(w.pubkey) || !Number.isInteger(w.until) || w.until <= 0) {
      throw new Error("invalid author work");
    }
    return `author ${w.store} ${w.pubkey} ${w.until}`;
  }
  if (!w.ids.length || !w.ids.every(isHex64)) throw new Error("invalid ids work");
  return `ids ${w.store} ${w.ids.join(",")}`;
}

export function decodeWork(line: string): VanishWork | null {
  const parts = line.trim().split(" ");
  if (parts.length !== 4 && !(parts.length === 3 && parts[0] === "ids")) return null;
  const [op, store] = parts;
  if (store !== "auth" && store !== "mirror") return null;
  if (op === "author" && parts.length === 4) {
    const [, , pubkey, untilRaw] = parts;
    const until = Number(untilRaw);
    if (!isHex64(pubkey) || !Number.isInteger(until) || until <= 0) return null;
    return { op: "author", store, pubkey, until };
  }
  if (op === "ids" && parts.length === 3) {
    const ids = parts[2].split(",");
    if (!ids.length || !ids.every(isHex64)) return null;
    return { op: "ids", store, ids };
  }
  return null;
}
