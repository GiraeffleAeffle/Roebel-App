# ADR 0021: Verify staging wallets through one private read-only Gnosis proxy

- Status: Accepted boundary for staging; source implemented, activation blocked
- Date: 2026-08-24

## Context

The signed-Nostr tracer must verify a browser-held Gnosis account signature
before admitting its public Nostr key to the isolated citizen relay. The public
workbench therefore needs `eth_getCode`, bounded `eth_call`, and a node health
check. Giving that Pod unrestricted HTTPS egress would also let any future code
reach arbitrary hosts and JSON-RPC methods. The Talos cluster currently uses
Flannel plus Kubernetes NetworkPolicy rather than an FQDN-aware CNI, so a
policy cannot safely express only `rpc.gnosischain.com` by name.

The existing activation evidence closes the workbench-to-Service hop but does
not yet bind the proxy Deployment, its method allow-list, its upstream, or the
proxy's own egress. A ClusterIP Service by itself is not an adequate security
or release boundary.

## Decision

1. The workbench receives only the exact internal URL
   `http://gnosis-private-rpc.stadtstack-roebel-web-preview.svc.cluster.local:8545`.
   Public-signed mode rejects a public RPC URL, another namespace, or another
   port at startup.
2. A separate tokenless `gnosis-private-rpc` Deployment runs
   `ROEBEL_RUNTIME_ROLE=gnosis-rpc-proxy` from the same immutable and attested
   `roebel-e2e-workbench` image digest. Reusing the digest avoids a third image
   build without putting the proxy in the workbench Pod or network identity.
3. The proxy compares the raw HTTP request target before URL parsing and accepts
   only `POST /`, `GET|HEAD /healthz`, and `GET|HEAD /readyz`. It rejects
   batches, notifications, transaction methods, debug/admin methods, state
   overrides, oversized bodies, oversized upstream responses, and unexpected
   fields. It follows no redirect and forwards no caller header or credential.
4. The only admitted methods are `eth_chainId`, `eth_blockNumber`,
   `eth_getCode`, and bounded `eth_call`. A normal call must contain exactly
   `to` and `data`. The sole no-`to` exception is viem 2.53.1's deployless
   ERC-6492/universal-signature verifier: exact `{data}` at block tag `latest`,
   exact 1,684-byte creation bytecode with SHA-256
   `d46b6085a6558eb925573e4e395ccbc669a1db1b7aa49196cbb1a7540db6a470`,
   canonical constructor ABI `(address,bytes32,bytes)`, and a non-empty
   signature of at most 8 KiB. No caller-selected gas, sender, value, access
   list, state override, alternative bytecode, extra field, or block tag is
   admitted on that path. Before forwarding either call form, the proxy
   independently requires upstream chain ID `0x64`. A network fault or chain
   mismatch rejects admission; it never turns into a negative signature
   verdict.
5. One global 16-request permit bounds RPC and readiness upstream calls. An
   incomplete request body is terminated after two seconds; shutdown aborts
   every upstream request and closes every accepted socket before returning.
6. The upstream is exactly `https://rpc.gnosischain.com`. The proxy follows no
   redirect and sends no secret. NetworkPolicy permits DNS plus TCP/443 to one
   reviewed `/32` only. A provider address change intentionally makes staging
   unavailable until a reviewed policy/evidence update; it cannot widen to
   `0.0.0.0/0`, a hostname wildcard, or a second provider silently.
7. Only the exact workbench Pod selector may reach the proxy Service. The
   workbench may reach only the two isolated relays, DNS, and this proxy. The
   proxy has no Ingress, ServiceAccount token, PVC, Secret, civic credential,
   inference credential, voting capability, treasury capability, or Case
   Steward capability.
8. The operations activation record must checksum-bind the exact proxy
   Deployment, Service, NetworkPolicy, workbench NetworkPolicy, immutable image
   digest, upstream host/port/IP, chain ID, allowed methods, deployless verifier
   bytecode digest/version and signature bound, request/response size limits,
   both timeouts, concurrency limit, and three namespace-scoped Flux
   identities. The Kustomization objects live in
   `flux-roebel-staging`; their impersonated ServiceAccounts also live there,
   while Roles and RoleBindings remain in the two workload namespaces.
9. A one-time administrator bootstrap may create the exact absent resources
   and named patch/update RBAC. Routine Flux reconciliation gets no Secret,
   ConfigMap, arbitrary create/delete, cluster-wide, or wildcard-resource
   authority. Existing synthetic relay names may be adopted or replaced only
   from separately recorded live UIDs with rollback; the old `e2e-workbench`
   resource is not silently renamed or deleted.

## Authority boundary

This proxy verifies control of the submitted wallet for a staging relay
admission. It does not verify residence, CitizenNFT eligibility, proposal
authority, administration status, or voting rights. It does not create a
member profile and it is not the passkey/Safe/Pimlico migration from ADR 0014.
Every response and deployment remains `authorityBinding: none`.

## Consequences

- The real post → Mecky → discussion tracer can verify Thirdweb smart accounts
  without giving the workbench public network egress.
- The no-`to` verifier contract is deliberately coupled to the locked viem
  version. Relay-sync and the workbench's integration dependency both pin exact
  `2.53.1` in their manifests and lock importers. The normal workbench test
  command imports that installed graph directly and must drive the real
  `createGnosisWalletVerifier` transport through the HTTP proxy; there is no
  external bundle, environment-variable opt-in, or skip path. Scoped PR CI and
  the protected runtime publisher both run the command before building. A viem
  upgrade that changes its bytecode or transport shape fails closed until
  source, adversarial fixture, ADR, and activation evidence are reviewed
  together.
- A pinned provider IP is intentionally operationally brittle but auditable on
  the current CNI. Moving to an egress gateway or FQDN-aware policy requires a
  new reviewed adapter, not a silent policy relaxation.
- The operations policy must be extended before any signed-Nostr activation;
  source support alone creates no cluster object and publishes no image.
- Provider-neutral passkey/Safe coexistence follows the complete
  Thirdweb-backed tracer rather than becoming a hidden signup prerequisite.
