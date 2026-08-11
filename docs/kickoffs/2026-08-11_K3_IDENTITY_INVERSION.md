# K3 — Identity inversion: make the sovereign key the root

**Date:** 2026-08-11 · **Status:** kickoff, not yet designed · **Owner:** unassigned agent
**Sequencing:** depends on [K1](2026-08-11_K1_NETIZEN_ACCOUNTS_REPLACES_THIRDWEB.md) Slice 0. Do not implement before that memo is decided.

## 1. Mission

Today every sovereign identity in the app hangs off a vendor's smart account.
Invert it: a key the user actually owns becomes the root, and the chain account,
the Nostr identity, and the app's derived secrets hang off **that**.

## 2. The problem, precisely

[`apps/expo/lib/nostr/identity.ts:73`](../../apps/expo/lib/nostr/identity.ts#L73) derives the
Nostr secret key from a thirdweb wallet signature:

```ts
const signature = await account.signMessage({ message: NOSTR_KEY_DERIVATION_MESSAGE });
const identity = deriveNostrIdentity(signature);
```

So the "sovereign" public record is **downstream** of thirdweb: no vendor
account, no npub. The same pattern binds the MACI voting keys
([`lib/maci.ts`](../../apps/expo/lib/maci.ts)) and the citizen commitment
([`lib/citizen-commitment.ts`](../../apps/expo/lib/citizen-commitment.ts)).

The file's own doc comment states the risk: *"if the smart-account implementation
ever changed, the signature — and therefore the npub — would change too.
Re-deriving over an existing key would silently orphan the identity the relay
already knows."* That is not hypothetical — it is exactly what K1 proposes to do.

## 3. Hard constraints

1. **No existing npub may be orphaned.** Identities are already registered on `relay.roebel.app` and referenced by published events; a new key means a new author with no history. Migration must carry keys forward or publish a verifiable link between old and new (NIP-26-style delegation or an explicit signed migration event — evaluate).
2. **`lib/encryption.ts`'s chain id 8453 is a derivation constant.** Never change it. Existing ciphertext depends on it.
3. `deriveAndStoreIdentity` must keep its never-re-derive property for existing devices.
4. Web + native parity: on the PWA the root key material lives in `localStorage` via the SecureStore facade (see [the design spec's threat-model note](../superpowers/specs/2026-08-05-expo-web-pwa-design.md)). If the root key becomes non-re-derivable, that trade-off no longer holds and the storage decision **must** be revisited — a re-derivable secret is what makes localStorage acceptable today.

That last point is the crux: today's storage model is safe *because* secrets are
re-derivable from the wallet. Inverting the root can invalidate that reasoning.

## 4. Directions to evaluate (produce a recommendation, do not presume)

- **Passkey root (WebAuthn/PRF).** Hardware-backed, no server custody, native + browser support, and it fits store-free distribution. Check: PRF extension availability across iOS/Android/desktop, recovery when a device is lost, and whether `react-native-passkey` (already a dependency) covers the native side.
- **Nostr key root.** The npub becomes the identity; the chain account is derived or linked from it. Maximally aligned with the public-record architecture; puts a raw secret key in device storage with no hardware backing.
- **Netizen Accounts custody with a user-held recovery secret.** Easiest UX, reintroduces a custodian — weigh against the whole point of this track.

For each: how does a citizen recover after losing their phone, and what does
recovery cost the community (re-attestation? a Safe transaction? nothing)?

## 5. Deliverables

1. **Design memo** in `docs/future-research/` comparing the routes against §3, with a recommendation and an explicit recovery story. Must be consistent with K1's chosen migration route.
2. **Derivation map** — one table listing every secret derived from a signature today (Nostr, MACI, citizen commitment, encryption, XMTP identity), its consumer, and what breaks if it changes. This artifact is independently useful; produce it early.
3. Implementation only after Max signs off on 1 and 2.

## 6. Verification

- For an existing citizen on a real device: npub, MACI `stateIndex`, and decryptability of existing content must all survive the change (or have a documented, executed migration).
- `pnpm smoke:web` green; no global `tsc`.
- Native and PWA both exercised — this touches the storage layer that differs per platform.

## 7. Open questions for Max

1. Is losing chat history / encrypted content acceptable in any migration path, or is continuity absolute?
2. Should recovery be self-service, or is attester-assisted recovery (social recovery through the existing 5 attesters) acceptable and even desirable?
3. Passkeys make store-free distribution stronger but exclude older devices — is that trade acceptable for Röbel's demographics?
