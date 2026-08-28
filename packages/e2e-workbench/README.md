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
`404` in this mode. The deployment must not mount a Case Steward token, a
control-plane URL, fixture personas, or any `GNOSIS_PROXY_*` management input
into this runtime. Presence of any forbidden variable—even an empty string or
`[]`—fails startup.

## GitOps input

The separate `Röbel signed-Nostr E2E runtime publisher` produces one immutable
two-component `roebel_e2e_runtime_pin_v1` artifact. A reviewed operations PR
must consume the two image **digests** from that pin, never a mutable tag:

- `roebel-e2e-workbench`: `WORKBENCH_MODE=public-signed-only`, Mecky public
  key, the exact private Gnosis proxy Service URL, citizen/agent relay URLs,
  and the relay-admission token Secret only;
- `roebel-e2e-workbench` also supplies a separate tokenless
  `ROEBEL_RUNTIME_ROLE=gnosis-rpc-proxy` Deployment from the same immutable
  image digest. It accepts only `eth_chainId`, `eth_blockNumber`,
  `eth_getCode`, and bounded `eth_call`, including only the pinned viem 2.53.1
  deployless signature-verifier form described below, verifies chain `0x64`
  before every forwarded request, and rejects every transaction/debug/admin
  method;
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

Deployment inputs:

- `GNOSIS_RPC_URL`: the exact internal
  `http://gnosis-private-rpc.stadtstack-roebel-web-preview.svc.cluster.local:8545`
  Service URL used for EOA/ERC-1271 verification;
- `CITIZEN_RELAY_ADMISSION_TOKEN`: the same high-entropy value mounted into the
  citizen relay as `RELAY_ADMISSION_TOKEN`;
- the existing relay URLs and Mecky pubkey. Fixture configuration and the
  Case Steward control inputs are only for `isolated-fixture` mode.

The proxy upstream is not secret configuration. Its runtime accepts only
`https://rpc.gnosischain.com`, checks chain ID 100, follows no redirect, forwards
no caller header or credential, and returns only bounded JSON-RPC. The staging
NetworkPolicy separately pins outbound TCP/443 to the reviewed `/32`; if DNS or
the provider address changes, the proxy fails closed until a new review updates
both the policy and its evidence.

The proxy matches only the exact raw request targets `POST /`,
`GET|HEAD /healthz`, and `GET|HEAD /readyz`. One global limit admits at most 16
RPC or readiness operations, an incomplete request body is terminated after two
seconds, and shutdown aborts upstream work and closes every accepted socket.

Normal `eth_call` accepts exactly `{to,data}`. The only contract-creation call
accepts exactly `{data}` plus block tag `latest` and must match viem 2.53.1's
1,684-byte ERC-6492/universal-signature validator creation bytecode (SHA-256
`d46b6085a6558eb925573e4e395ccbc669a1db1b7aa49196cbb1a7540db6a470`),
followed by canonical ABI encoding of `(address,bytes32,bytes)`. Its signature
argument is non-empty and at most 8 KiB. Gas, sender, value, access-list, state
override, alternative bytecode, extra keys, and alternative block tags are all
rejected. This exact exception is required by relay-sync's locked viem
`verifyMessage` path for counterfactual/ERC-6492 and ordinary smart-account
verification. Both relay-sync and the workbench's transport test pin exact
`2.53.1` in their manifests and lock importers. The normal workbench test
command imports those installed workspace dependencies directly, drives the
real verifier through an in-process HTTP proxy, and fails if the version,
bytecode, or emitted request shape drifts. It has no external bundle, fixture
environment variable, or skip path. Both scoped PR CI and the protected runtime
publisher run that command before building. Changing the viem version or
bytecode requires a reviewed source, test fixture, ADR, and activation-evidence
update.

The admission token must be sourced from a Kubernetes Secret and must never be
placed in this repository, an image environment layer, or a browser variable.
An RPC failure rejects admission; it never falls back to trusting the submitted
address.

## Boundary

The real-account path is staging credential assurance only. It does not prove a
CitizenNFT, migrate Thirdweb ownership, create a stable member record, or grant
production relay access. Namespace deletion removes the complete isolated
admission set.
