# ADR 0014: Provider-neutral member identity and staged wallet migration

## Status

Accepted for staging design; no production migration authorized.

## Context

The Röbel app currently uses a Thirdweb in-app wallet with email, phone, and social login plus an ERC-4337 smart account and sponsored transactions. Thirdweb is not merely the login button: the resulting smart-account address is used by application hooks, database ownership and RPC paths, Nostr identity binding, CitizenNFT eligibility, Circles, messaging, and governance integrations.

The database already has stable `accounts.id` values for personal and organisation actors, but membership still reaches those accounts through wallet-address rows. Replacing Thirdweb with a passkey-owned Safe would normally produce a different address. Treating that address as a new person would duplicate profiles and histories; silently substituting it would orphan non-transferable eligibility and existing signatures.

The Stadtstack prototype already demonstrates another credible stack: a WebAuthn passkey controls a Safe, and Pimlico supplies ERC-4337 bundler and paymaster infrastructure. Safe supports WebAuthn/ERC-1271 signers, while Pimlico is transaction infrastructure rather than a login identity. A production migration therefore has to separate those concerns.

## Decision

1. A wallet address is an **account credential**, not the canonical person or app account.
2. Röbel introduces a private stable **member identity** for login continuity. Public profiles and authored content continue to use stable `accounts.id` actors. A member may prove more than one credential and may control more than one app account.
3. Application code consumes one deep `CitizenSession` interface. Its small public surface provides:
   - the stable member and selected app-account identifiers;
   - the active credential kind, chain, and address;
   - message and typed-data signing;
   - bounded transaction or call submission;
   - authentication, recovery, and authorization-strength metadata.
4. Thirdweb becomes the first `CitizenSession` adapter. Existing users, addresses, assets, bindings, and permissions remain valid while migration is developed.
5. A passkey-owned Safe with a bounded Pimlico bundler/paymaster route becomes a second staging adapter. It is introduced for an opt-in pilot, not as a hard cutover.
6. Linking the two adapters requires an explicit migration ceremony:
   - authenticate the existing member;
   - prove control of the existing Thirdweb smart account;
   - create or recover the passkey-owned Safe;
   - prove control of the Safe;
   - bind both credentials to the same member identity with a versioned receipt;
   - preserve the existing app account and Nostr identity.
7. Nostr keys are never silently re-derived during credential migration. The existing client-held key is preserved and rebound through a new mutual proof. Loss or rotation follows an explicit recovery or revocation policy.
8. Address-bound state is migrated separately. Soulbound CitizenNFT status, Circles membership, MACI enrolment, XMTP identity, balances, roles, and historical signatures require an inventory and an authority-specific rotation, re-attestation, delegation, or compatibility rule. A successful login link alone does not move them.
9. Thirdweb may expose passkey login as an interim authentication option, but that remains a Thirdweb-managed credential and is not presented as the sovereign Safe/Pimlico migration.
10. Thirdweb retirement is permitted only after linked-account recovery, multi-device/passkey recovery, contract-signature verification, gas sponsorship, Nostr continuity, database ownership, and existing-user rollback have all passed staging and a reviewed migration receipt exists.

## Consequences

- The public product can improve login and custody without rewriting content identities or forcing an immediate migration.
- `users.wallet_address`, wallet-keyed RLS/RPC paths, and `nostr_identities.wallet_address` become migration debt behind the `CitizenSession` seam rather than permanent domain identifiers.
- Existing Thirdweb users remain supported during a deliberately long coexistence period.
- The Safe adapter can reuse proven Stadtstack code, but must not directly import the entire Stadtstack frontend or expose Pimlico credentials in the browser.
- Recovery and credential rotation become explicit product flows instead of accidental side effects of a wallet SDK.
- This ADR does not migrate a user, reissue a CitizenNFT, move funds, or authorize a production wallet transition.

## First staging implementation

The first implementation keeps the Thirdweb SDK inside one adapter and exposes
only the provider-neutral `CitizenSession` to civic-flow callers. A connected
account signs the versioned Nostr derivation message locally, signs a second
canonical wallet↔Nostr binding statement, and submits only the public proof.
The workbench verifies ERC-1271/EOA credential control on Gnosis plus the signed
Nostr binding before the staging relay admits the public key. Posts and civic
promotions are signed in the browser and arrive at the server as complete Nostr
events; the server never signs on behalf of that person.

This is staging credential assurance, not CitizenNFT eligibility and not a
stable member migration. The relay admission token, Gnosis RPC configuration,
and durable admission file are private deployment inputs. A passkey/Safe adapter
can reuse the same proof and event interface without changing feed or civic
journey callers.

The second adapter seam and the first coexistence proof are now implemented as
an effect-free staging contract. A passkey-owned Safe is adapted structurally
to the same `CitizenSession`; WebAuthn, Safe Protocol Kit, and Pimlico remain
behind that adapter. Linking begins only from a short-lived, one-time server
challenge bound to one stable member UUID, one existing app-account UUID, the
current Thirdweb credential, and the existing Nostr public key. The current
credential and the candidate Safe sign the same checksum-bound statement, while
the current session also supplies its existing wallet↔Nostr admission proof.
The resulting receipt explicitly preserves the member, app account, Nostr
identity, address-bound rights, and Thirdweb credential and remains
`awaiting_server_verification` with `authorityBinding: none`.

The client envelope itself does **not** create or recover a passkey, deploy a
Safe, call Pimlico, verify either wallet signature, write a member/credential
mapping, or migrate a user. It can only remain
`awaiting_server_verification`.

The server verification boundary is now implemented behind two injected deep
interfaces: an atomic challenge store and a Gnosis credential-control verifier.
It issues a short-lived challenge only from a trusted authenticated subject,
consumes the exact challenge before remote verification, and independently
checks the current wallet↔Nostr admission signature, the current credential's
link signature, and the candidate Safe's link signature. Its only output is a
closed `verified_no_effect` receipt with `persistence: not_written`; failure
burns the nonce and replay is rejected.

That module is not yet an HTTP route and its in-memory store is test-only. A
production slice still needs an authenticated app/OIDC session binding, a
multi-replica atomic challenge store, a reviewed database transaction for the
stable member/credential mapping, explicit recovery, and deployed opt-in E2E.
Until those gates pass, no credential link exists and Thirdweb remains the only
provider selected by the app shell.

## Implementation slices from the current code

The existing seam is intentionally deeper than either provider. The app-facing
module remains `CitizenSession`; WebAuthn ceremony details, Safe account
construction and Pimlico transport must not leak into feed, discussion,
proposal or governance callers. The Stadtstack prototype is a reference for
those mechanics, not a module to copy wholesale: its current passkey account
file also owns residency, governance, recovery and local-development concerns.

The opt-in coexistence path is split into four separately reviewable effects:

1. **Authenticated no-effect verification.** Add challenge and verification
   HTTP routes bound to the current authenticated Thirdweb subject. Replace the
   in-memory challenge store with an atomic multi-replica store. A successful
   request still returns only `verified_no_effect`; it must not write an
   identity link or deploy a Safe.
2. **Stable-member persistence.** In one reviewed transaction, bind the current
   credential and candidate Safe credential to one private stable member and
   preserve the existing `accounts.id`, Nostr public key and Thirdweb
   credential. Unique constraints must reject one credential being attached to
   two members. No address-bound right moves in this transaction.
3. **Passkey-owned Safe adapter.** Implement three private modules behind
   `CitizenSession`: a WebAuthn credential provider, a deterministic Safe
   account controller and a bounded user-operation transport. Pimlico keys stay
   behind the existing same-origin bundler route; the browser receives neither
   a provider secret nor general transaction authority.
4. **Recovery and staging coexistence.** Prove create, sign, recover, revoke and
   rollback on a second device; then run one Thirdweb session and one passkey
   Safe session through the same ordinary-post and civic-promotion contract.
   The test fails if it creates a second app account, changes the Nostr identity
   or implies that CitizenNFT, Circles, MACI, XMTP, balances or roles migrated.

Only slice 1 may begin before the first complete Thirdweb-backed civic journey
has passed staging. Slices 2–4 remain opt-in migration work and cannot become a
signup prerequisite.
