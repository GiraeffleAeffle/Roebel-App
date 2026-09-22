# Citizen verification and account access

## Legacy registration flow retired — 2026-09-22

The unused residence → SMS OTP → wallet registration flow is removed from
Next Web. `/login` and the three former `/api/auth/link-wallet`,
`/api/auth/verify-phone/send` and `/api/auth/verify-phone/verify` routes no longer
exist. There is no compatibility writer or redirect to the old flow.

The wallet-link handler accepted a caller-supplied user ID, phone number and
wallet address without proving their shared ownership. Its application code
could set phone/email verification fields without consuming an authenticated
subject or wallet signature. The explicit staging guard rejected this writer;
that guard was not a production authentication implementation. Historical SQL
and the read-only staging database have different permissions, so the source
finding does not establish a deployed exploit.

Local verification used the actual Next handler with an isolated loopback
Supabase HTTP fixture and no inherited service credentials. An unsigned request
reached the fixture's user update before retirement. Afterwards the old page
and all three POST endpoints returned 404, with no additional fixture requests.
The ordinary `/app` surface still displayed its existing account sign-in entry.
No OTP was sent and no real database, identity, credential or grant was changed.

The separate Expo comment prompt now uses the existing `requireAuth` gate to
open the comment composer after account connection instead of navigating to a
disabled login placeholder. That obsolete mobile route and its screenshot-list
entry are removed. Verification is limited to the actual post component and auth
gate in a local component harness with mocked provider and child UI boundaries;
no native-device visual acceptance or mobile distribution was performed.
Publishing the Web image does not distribute an updated mobile binary.

## Current access boundary

Web account connection remains in the existing app/landing headers through
Thirdweb and the shared `src/lib/wallet-config.ts`. The provider-neutral civic
Interface remains `CitizenSession`. Removing the legacy flow does not replace
Thirdweb, change an account address, persist a credential link or migrate a
member identity.

Account authentication is not municipal eligibility, a staff role, a review
attestation or permission to publish. Municipal review access still depends on
the existing issuer, subject binding and scoped, expiring grants. Independent
user-controlled enrollment, recovery/revocation and browser acceptance remain
separate gates; a local fixture is not evidence of those outcomes.

The historical SQL files and verification data are retained for provenance,
not instructions to replay setup or renew credentials. Current identity and
migration boundaries are in
[ADR 0014](../../../docs/adr/0014-provider-neutral-member-identity-and-staged-wallet-migration.md).
A future phone-to-wallet linkage would need its own reviewed, purpose-bound
ownership proof and persistence contract; the retired endpoint must not be
restored by trusting a supplied ID or repurposing an organization signature.
