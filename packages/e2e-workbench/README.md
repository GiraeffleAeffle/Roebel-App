# Röbel isolated staging workbench

This service joins the isolated citizen relay, Mecky reply relay, and
Stadtstack control plane behind the `/stadtstack-test` same-origin route. It
supports both clearly labelled synthetic fixtures and a real browser-held
`CitizenSession`. It has no civic, voting, or treasury authority.

## Public signed-only runtime

Deploy the real browser tracer with `WORKBENCH_MODE=public-signed-only`.
That mode deliberately accepts no `SYNTHETIC_CITIZENS_JSON`, does not publish
fixtures, and requires neither `CASE_STEWARD_TOKEN`,
`STADTSTACK_CONTROL_BASE_URL`, nor `STADTSTACK_PUBLIC_BASE_URL`. It exposes
only health/config/feed/thread/conversation reads and the two browser-facing
writes: `POST /api/session/admit` and `POST /api/signed-event` (both beneath
`/stadtstack-test` and both with the exact staging header).

Administrative projection reads and every fixture-only mutation route return
`404` in this mode. The deployment must not mount a Case Steward token or a
control-plane URL into this runtime. Presence of any of those four forbidden
variables—even an empty string or `[]`—fails startup.

## GitOps input

The separate `Röbel signed-Nostr E2E runtime publisher` produces one immutable
two-component `roebel_e2e_runtime_pin_v1` artifact. A reviewed operations PR
must consume the two image **digests** from that pin, never a mutable tag:

- `roebel-e2e-workbench`: `WORKBENCH_MODE=public-signed-only`, Mecky public
  key, Gnosis RPC, citizen/agent relay URLs, and the relay-admission token
  Secret only;
- `roebel-staging-relay`: separate citizen and agent deployments, each with a
  bounded owned event volume; only the citizen relay receives the internal
  admission token and admission volume;
- public Ingress: exact `/stadtstack-test` path only, with POST limited to
  `/stadtstack-test/api/session/admit` and
  `/stadtstack-test/api/signed-event`; all fixture/admin paths remain denied.

The runtime pin is evidence for a later reviewed render only. It creates no
cluster object and does not alter the normal Web + Public Mecky Release Set.

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
- the existing relay URLs and Mecky pubkey. Fixture configuration and the
  Case Steward control inputs are only for `isolated-fixture` mode.

The admission token must be sourced from a Kubernetes Secret and must never be
placed in this repository, an image environment layer, or a browser variable.
An RPC failure rejects admission; it never falls back to trusting the submitted
address.

## Boundary

The real-account path is staging credential assurance only. It does not prove a
CitizenNFT, migrate Thirdweb ownership, create a stable member record, or grant
production relay access. Namespace deletion removes the complete isolated
admission set.
