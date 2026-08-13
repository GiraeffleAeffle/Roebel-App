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
