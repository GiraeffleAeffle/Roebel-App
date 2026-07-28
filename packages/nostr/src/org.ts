import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import { KIND, type NostrEvent, type ProfileMetadata, buildEvent } from "./events";
import { deriveNostrSecretKey, getPublicKeyHex, npubEncode } from "./keys";

/**
 * Organisations as Nostr identities.
 *
 * The design question is not "who holds the key" but "who is allowed to use it".
 *
 * A key SHARED between managers cannot be revoked: someone who leaves keeps their
 * copy forever, and the only remedy is re-keying, which throws away the org's
 * identity and its history. So the key is held by the NODE, derived like an
 * agent's, and the org's member roster decides who may publish with it. Removing
 * someone from the roster revokes them instantly, with no re-keying.
 *
 * Accountability is preserved by recording WHICH member authorised each event, so
 * "the cinema published this" and "Anna authorised it" are both true and both
 * checkable.
 *
 * The honest cost: the node can technically publish as any organisation. That is
 * the same trust already placed in it for the citizen registry, and unlike a
 * shared secret it is auditable and instantly revocable.
 */

const ORG_DERIVATION_PREFIX = "Netizen Organisations-Identität v1";

/** Names the member who authorised an org event: ["authorized_by", <npub-or-wallet>]. */
export const AUTHORIZED_BY_TAG = "authorized_by";

export interface OrgIdentity {
  orgId: string;
  nodeId: string;
  secretKey: Uint8Array;
  publicKey: string;
  npub: string;
}

/**
 * Derive an organisation's identity from the node secret.
 *
 * Scoped by node AND org, so the same org id on two nodes is two identities —
 * "Kino am Markt in Röbel" is not the same actor as an org of that name
 * elsewhere, and must not be able to speak for it.
 */
export function deriveOrgIdentity(nodeSecret: string, nodeId: string, orgId: string): OrgIdentity {
  if (!nodeSecret || nodeSecret.length < 32) {
    throw new Error("nodeSecret must be at least 32 characters of high-entropy secret");
  }
  if (!/^[a-z0-9-]+$/.test(nodeId)) throw new Error(`node id must be a lowercase slug: ${nodeId}`);
  // Org ids are UUIDs in this schema; allow them, but nothing that could smuggle
  // a separator into the derivation string.
  if (!/^[a-z0-9-]+$/.test(orgId)) throw new Error(`org id must be lowercase alphanumeric: ${orgId}`);

  const scoped = `${ORG_DERIVATION_PREFIX}\nnode=${nodeId}\norg=${orgId}\nsecret=${nodeSecret}`;
  const secretKey = deriveNostrSecretKey(bytesToHex(keccak_256(utf8ToBytes(scoped))));
  const publicKey = getPublicKeyHex(secretKey);
  return { orgId, nodeId, secretKey, publicKey, npub: npubEncode(publicKey) };
}

/** The organisation's kind 0 profile. */
export function buildOrgProfileEvent(
  org: OrgIdentity,
  metadata: ProfileMetadata,
  options: { createdAt?: number } = {},
): NostrEvent {
  const cleaned = Object.fromEntries(
    Object.entries(metadata).filter(([, v]) => v !== undefined && v !== null && v !== ""),
  );
  return buildEvent(org.secretKey, KIND.profile, JSON.stringify(cleaned), {
    createdAt: options.createdAt,
    tags: [["netizen_org", org.orgId, org.nodeId]],
  });
}

/**
 * Stamp an already-built org event with the member who authorised it.
 *
 * Applied to any event published on an organisation's behalf. Without it the org
 * speaks with no attributable human behind it, which is exactly the accountability
 * a shared key would have destroyed.
 */
export function withAuthorizedBy(tags: string[][], authorizedBy: string): string[][] {
  return [...tags.filter((t) => t[0] !== AUTHORIZED_BY_TAG), [AUTHORIZED_BY_TAG, authorizedBy]];
}

/** Who authorised this org event, or null if it carries no attribution. */
export function authorizedBy(event: NostrEvent): string | null {
  return event.tags?.find((t) => t[0] === AUTHORIZED_BY_TAG)?.[1] ?? null;
}
