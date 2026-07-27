import { KIND, type NostrEvent, buildEvent, verifyEvent } from "./events";
import { getPublicKeyHex, npubEncode } from "./keys";

/**
 * The wallet ↔ npub binding.
 *
 * Nobody has to trust that an npub was *derived* from a given wallet — derivation
 * is unverifiable from the outside. Instead both keys attest to the same
 * statement: the wallet signs it (ERC-1271, since Citizens hold smart accounts)
 * and the Nostr key signs it inside a real event. Two signatures over one string
 * prove joint control, which is all the relay allow-list needs.
 *
 * The Nostr side is a genuine signed event rather than a bare signature so that a
 * relay-native bootstrap (Citizens publishing their own binding, the syncer
 * reading it back off the relay) stays possible later without a redesign.
 */

/** NIP-78 `d` tag identifying a Netizen binding. Replaceable: re-binding overwrites. */
export const BINDING_D_TAG = "netizen:binding:v1";

/** Tag carrying the bound account, so a relay query can filter on it. */
export const BINDING_ACCOUNT_TAG = "netizen_account";

export interface BindingSubject {
  /** The Citizen's smart-account address. Case-insensitive; normalized to lowercase. */
  account: string;
  /** The Nostr identity being bound, bech32. */
  npub: string;
}

/**
 * The exact string both keys sign. Deterministic and newline-delimited — no JSON,
 * because JSON key ordering is not guaranteed across implementations and this
 * string must reproduce byte-for-byte on the verifying side.
 */
export function bindingStatement({ account, npub }: BindingSubject): string {
  if (!/^0x[a-fA-F0-9]{40}$/.test(account)) {
    throw new Error(`not an EVM address: ${account}`);
  }
  return ["Netizen Nostr-Binding v1", `account=${account.toLowerCase()}`, `npub=${npub}`].join(
    "\n",
  );
}

/** Build the Nostr half of the binding: a signed NIP-78 event over the statement. */
export function buildBindingEvent(
  secretKey: Uint8Array,
  account: string,
  options: { createdAt?: number } = {},
): NostrEvent {
  const npub = npubEncode(getPublicKeyHex(secretKey));
  return buildEvent(secretKey, KIND.appData, bindingStatement({ account, npub }), {
    createdAt: options.createdAt,
    tags: [
      ["d", BINDING_D_TAG],
      [BINDING_ACCOUNT_TAG, account.toLowerCase()],
    ],
  });
}

export type BindingFailure =
  | "wrong-kind"
  | "wrong-d-tag"
  | "account-mismatch"
  | "statement-mismatch"
  | "bad-signature";

export type BindingResult =
  | { valid: true; account: string; pubkey: string; npub: string }
  | { valid: false; reason: BindingFailure };

/**
 * Verify the Nostr half of a binding — pure, no network.
 *
 * The Ethereum half (ERC-1271 `isValidSignature` against the smart account) needs
 * an RPC call and is verified by the caller; see `@netizen-labs/relay-sync`.
 */
export function verifyBindingEvent(event: NostrEvent, expectedAccount: string): BindingResult {
  if (event.kind !== KIND.appData) return { valid: false, reason: "wrong-kind" };

  const dTag = event.tags.find((t) => t[0] === "d")?.[1];
  if (dTag !== BINDING_D_TAG) return { valid: false, reason: "wrong-d-tag" };

  const account = expectedAccount.toLowerCase();
  const taggedAccount = event.tags.find((t) => t[0] === BINDING_ACCOUNT_TAG)?.[1]?.toLowerCase();
  if (taggedAccount !== account) return { valid: false, reason: "account-mismatch" };

  // Recompute the statement from the event's OWN pubkey. This is what stops a
  // valid binding being replayed under someone else's identity: the content must
  // name the key that signed it.
  const npub = npubEncode(event.pubkey);
  if (event.content !== bindingStatement({ account: expectedAccount, npub })) {
    return { valid: false, reason: "statement-mismatch" };
  }

  if (!verifyEvent(event)) return { valid: false, reason: "bad-signature" };

  return { valid: true, account, pubkey: event.pubkey, npub };
}
