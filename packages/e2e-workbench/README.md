# Röbel isolated staging workbench

This service joins the isolated citizen relay, Mecky reply relay, and
Stadtstack control plane behind the `/stadtstack-test` same-origin route. It
supports both clearly labelled synthetic fixtures and a real browser-held
`CitizenSession`. It has no civic, voting, or treasury authority.

## Real citizen admission

A real account submits `roebel_citizen_admission_proof_v1`: one Gnosis account
signature and one signed Nostr binding event over the same canonical statement.
The workbench verifies both signatures, then sends only the admitted public key
to the relay's internal endpoint. Posts and promotions arrive as complete
browser-signed Nostr events; this service never receives a Nostr secret.

Private deployment inputs:

- `GNOSIS_RPC_URL`: server-only Gnosis RPC used for EOA/ERC-1271 verification;
- `CITIZEN_RELAY_ADMISSION_TOKEN`: the same high-entropy value mounted into the
  citizen relay as `RELAY_ADMISSION_TOKEN`;
- the existing relay URLs, case-steward token, Mecky pubkey, and synthetic
  fixture configuration.

The admission token must be sourced from a Kubernetes Secret and must never be
placed in this repository, an image environment layer, or a browser variable.
An RPC failure rejects admission; it never falls back to trusting the submitted
address.

## Boundary

The real-account path is staging credential assurance only. It does not prove a
CitizenNFT, migrate Thirdweb ownership, create a stable member record, or grant
production relay access. Namespace deletion removes the complete isolated
admission set.
