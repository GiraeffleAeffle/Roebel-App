# Sovereign Netizen Account — infrastructure design

> **Status:** design approved 2026-08-11. Phase A is implementable from this document;
> Phases B–D are scoped here and get their own specs before they are built.
>
> **Supersedes nothing.** Extends
> [`2026-07-31-netizen-accounts-service-design.md`](2026-07-31-netizen-accounts-service-design.md)
> (v2.2) with the delivery program, the namespace decision, the token seam, and the
> product-surface seams (metering, branding) that later phases need to exist from day one.
>
> **Code homes.** The keystone is `apps/roebel-id` in THIS repo. The signer, accounts SDK,
> protocol and CLI live in the netizen_labs monorepo
> (`~/Documents/privat/side_projects/netizen/netizen_labs`). Both are touched by Phase A.

## 1. Goal

Netizen Accounts is a product, not only plumbing: a sovereign replacement for thirdweb and
Privy that a community or company runs on its own node. It must eventually offer what those
vendors offer — social/email/phone login, invisible smart accounts, gasless transactions,
recovery, a customizable account-creation surface, and usage analytics — with the difference
that the operator holds the keys and the data.

This document defines how we get there without a rewrite, and what Phase A builds now.

### 1.1 What already exists

Substantial parts are built and tested but not deployed:

- `@netizen-labs/signer` — per-user EOAs envelope-encrypted (AES-256-GCM, subject AAD) in a
  node vault; policy engine with rate classes and a kill switch; `FileAuditSink`; HTTP API with
  OIDC/JWKS verification; EIP-712 sponsorship vouchers; fail-closed per-chain gas budgets.
- `@netizen-labs/accounts` — `createNodeAccountClient(manifest)`, `NodeAccount.signMessage`,
  `nostrIdentity`, `exportKey`, `sponsorUserOperation`, typed error codes.
- `NetizenVerifyingPaymaster` (EP v0.7, Foundry, 27 tests) with a cross-language voucher vector.
- `netizen render` emits the signer service, one Alto per declared chain, Caddy vhosts and DNS.
- Account implementation bake-off **decided**: ZeroDev Kernel v3.1 (MIT, ERC-7579, EP v0.7,
  guardians installable inside CREATE2 initcode).

### 1.2 What blocks it

- **C-1:** the signer only ever signs for the member's EOA, but an ERC-4337 `sender` must be a
  contract account. Nothing derives or deploys a smart-account address. No gasless transaction
  can land. (`packages/signer/README.md` §"Gas sponsorship".)
- **Nothing is deployed.** No signer runs anywhere; the live Röbel manifest declares
  `authBridge.provider: "thirdweb"` and no signer block.
- **The keystone speaks the wrong namespace.** It mints `roebel:*` claims; the signer already
  reads `netizen_class` and `netizen_step_up` (`packages/signer/src/auth.ts`) and receives
  neither.
- **The keystone is not tenant-independent.** Its claim readers resolve `email`/`name`/`tier`
  from Röbel's Supabase `users` table, so a non-Röbel principal gets a token with no email.

## 2. Constraints (established, not up for rediscovery)

1. **Existing Röbel citizens do not migrate in this program.** `CitizenNFTv2` is soulbound
   (`_update` override); the Circles trust graph is likewise immobile. Moving the existing 20
   citizens to sovereign addresses requires a governed re-mint plus re-attestation plus trust
   rebuild. Deferred by explicit decision (Max, 2026-08-11).
2. **Therefore two accounts coexist, deliberately.** A citizen's thirdweb smart account remains
   their identity and on-chain account, and its address remains their OIDC `sub`. The sovereign
   Netizen Account is a *new*, node-held account keyed by that same `sub`. This is the migration
   path, not a compromise; it retires itself when the governed migration eventually runs.
3. **A signer trusts exactly one issuer.** `OIDC_ISSUER` is singular by design. One community =
   one node = one issuer = one signer = one vault. Multi-issuer signers are rejected: they
   would pool two communities' keys in one vault, which spec v2.2 forbids ("per-customer master
   key, never pooled").
4. **Everything into the installer.** Every service lands in the manifest and `netizen
   render`/`up`. Every newly rendered service gets a fixture in an example manifest — the
   standing rule from the Alto incident, where a rendered bundler could never boot because no
   example manifest exercised the render path.
5. **In sovereign mode the operator cannot be metered.** Usage-based pricing is possible only in
   hosted mode. This is structural and shapes §7.
6. **Parallel-session discipline.** Phase A spans two repos and netizen_labs has heavy
   concurrent traffic; one session's `git clean -fd` has already wiped an implementer's
   untracked files mid-task. Commit with explicit pathspecs only, never `git add -A`, and run
   `git log` plus `git status` in both repos before starting.

## 3. The program

| Phase | Delivers | Independence reached |
|---|---|---|
| **A** | Namespace flip, resource-scoped access tokens, signer deployed, `OIDC_AUDIENCE` defect fixed, metering + branding seams | Signer live and correctly scoped. thirdweb still mints accounts. |
| **B** | Kernel v3 counterfactual accounts (closes C-1); paymaster deployed, staked, funded; Alto rails up | New accounts are thirdweb-free and gasless |
| **C** | Keystone-owned login: social federation + own email/phone OTP; step-up auth | No thirdweb in the path for new users |
| **D** | Per-community issuer and signer as pure config; keystone claims decoupled from Röbel's Supabase | Scalable: a new community is a manifest plus `netizen render` |

Later, each on its own spec, enabled by the Phase A seams: **E** customizable account-creation
modal (SDK-UI), **F** metering and pricing, **G** operator dashboard.

### 3.1 Parity checklist

| thirdweb/Privy capability | Netizen replacement | Phase |
|---|---|---|
| Google / Apple / Facebook login | OIDC federation in the keystone | C |
| Email and phone OTP | Keystone-owned OTP | C |
| Invisible key custody | Signer vault — **built** | A |
| Deterministic smart account | Kernel v3 counterfactual — decided, unbuilt | B |
| Gasless (ERC-4337) | Alto + `NetizenVerifyingPaymaster` — **built**, undeployed | B |
| Account recovery | Guardian owner-rotation in initcode | B |
| Customizable connect modal | SDK-UI reading a served branding document | E (seam in A) |
| Usage dashboard (MAU, wallets) | `EventSink` aggregates | G (seam in A) |

## 4. Phase A architecture

```
id.roebel.app  (keystone, Fly)
  authenticates the human, then mints a JWT access token:
      iss  https://id.roebel.app
      aud  https://signer.roebel.app     <- resource indicator
      sub  0xabc…                        <- citizen's thirdweb account (unchanged)
      scope            netizen
      netizen_class    citizen
      netizen_step_up  false

Röbel Genesis node (Hetzner)
  signer.roebel.app   OIDC_ISSUER=https://id.roebel.app
                      OIDC_AUDIENCE=https://signer.roebel.app
    vault EOA keyed by sub               <- the sovereign account (new)
    POST /v1/accounts       ✓
    POST /v1/sign/message   ✓  -> npub derivation for Autar
    POST /v1/sponsor        ✗  blocked on C-1 (Phase B)
    POST /v1/export         ✗  blocked on step-up (Phase C)
```

The manifest keeps `provider: "thirdweb"` and gains `authBridge.signer`. This is legal:
`isSignerEnabled` inspects only the signer block, and `doctor` warns only in the other
direction (`provider: "netizen"` without a signer). The standing warning — *"a third-party
mints accounts; flip to 'netizen' for full wallet sovereignty"* — is accurate until Phase B and
must not be silenced.

**Consequence to record:** a member's Nostr identity derives from the vault EOA, not from their
thirdweb address. Autar's npub is therefore anchored to the sovereign account rather than to the
address holding their votes, balances and NFTs. This is intended.

## 5. Phase A components

### 5.1 Namespace — dual scope, hard claim flip

The scope named `roebel` carries `groups`, the ACL every relying party gates on, and Nextcloud
(`cloud.roebel.app`) and Matrix (`auth.roebel.app`) request it from configs that live on the
node, outside this repo. Renaming it out from under them stops `groups` being issued — the exact
failure already recorded in `provider.ts`: *"login succeeded, the claim never arrived, and the
workspace refused them."*

- **Claims flip hard.** `roebel:citizen|attester|tier|actor_type` become `netizen:*`. Verified:
  no consumer outside the keystone reads them.
- **Scopes are dual.** `scopes: ['openid','email','profile','netizen','roebel']`. Both `netizen`
  and `roebel` resolve the **same** claim list (`groups` plus the `netizen:*` set). Nextcloud and
  Matrix keep working with zero node-side change. `roebel` is marked deprecated in-code with its
  removal condition: both RP configs updated to request `netizen`.
- Files: `src/claims/types.ts`, `src/claims/resolver.ts`, `src/oidc/provider.ts`, their tests;
  `idp.scopes`/`idp.claims` in `roebel.netizen.json` (netizen_labs); and
  `apps/ortis/lib/oidc.ts` in netizen_labs (scope string → `netizen`).
- **Do not hand-edit `packages/cli/bundle/`** in this repo. It is rendered output
  (`docker-compose.yml`, `Caddyfile`, `SECRETS.md`, `bootstrap.sh`, plus a copy of the manifest),
  untracked, and regenerated by `netizen render`. It is a *verification surface*, not a source:
  after re-rendering it must show the signer service carrying `OIDC_AUDIENCE`.

### 5.2 Token seam — resource-indicator access tokens

An ID token is an assertion about a login, not a bearer credential for a third service.
Forwarding one to the signer is audience confusion and ties the signer's trust to each app's
client id. Instead:

- Enable `features.resourceIndicators` with `accessTokenFormat: 'jwt'`.
- **Allowlist, never wildcard.** Permitted resource indicators come from config
  (`SIGNER_RESOURCE_URL`); a client must not be able to mint a token for an arbitrary audience.
- `extraTokenClaims` adds `netizen_class` and `netizen_step_up` to the access token.
- `netizen_class` is `citizen` for every human login in this phase. `agent` and `org` remain
  reserved and unminted — the same posture as today's hardcoded `actor_type: 'human'`, so agent
  principals stay additive.
- `netizen_step_up` is `false`, always and explicitly. Never absent, so nothing can default it
  wrong. Export therefore 403s by design until Phase C.
- **Boot-time coherence check:** the keystone fails to start if `SIGNER_RESOURCE_URL` is set to
  something that is not a valid absolute URL. Its value must equal `authBridge.signer.url`; the
  mismatch is documented in both READMEs, since the two values live in different repos.

### 5.3 The `OIDC_AUDIENCE` defect

`render.ts` emits `OIDC_ISSUER` for the signer container but **never emits `OIDC_AUDIENCE`**,
which `cli.ts` reads. Because the audience check is optional-by-design, a rendered signer
silently accepts *any* token from its issuer — including Nextcloud's or Matrix's ID token. That
nullifies the reason for §5.2.

This is the dead-bundler failure shape again: correct binary, green tests, config never passed,
no example manifest exercising the path.

**Fix:** derive the audience from `signer.url` and emit it. The audience *is* the signer's URL —
that is what a resource indicator means — so deriving it makes keystone and signer read the same
field and prevents drift. When `signer.url` is absent (a local-only signer), no audience is
emitted and the signer is not externally reachable anyway.

### 5.4 Metering seam — `EventSink`

A dashboard reporting MAU and wallets-created cannot be retrofitted; it requires countable
events at each action. The existing `FileAuditSink` is hash-only and deliberately
privacy-preserving, so it cannot answer "how many wallets exist".

Add an `EventSink` interface alongside it, emitting a small closed set:

| Event | Fields |
|---|---|
| `account.created` | subject, timestamp |
| `message.signed` | subject, timestamp |
| `userop.sponsored` | subject, timestamp, chainId |

File-backed default implementation, matching `FileAuditSink`'s JSONL shape. Aggregation, a
Postgres sink and export live in Phase G. The point of doing it now is only that the call sites
exist and are correct.

**Privacy rule, binding on Phase G:** in sovereign mode events never leave the node. Only hosted
mode may export aggregates, and only aggregates.

### 5.5 Branding seam

A customizable account-creation modal (Phase E) must read branding from the node rather than
hardcode it. The keystone already resolves per-client branding presets (I2). Expose the resolved
preset as JSON at a well-known path so a future SDK consumes it. No UI work in Phase A.

### 5.6 Deployment

- `roebel.netizen.json` gains
  `authBridge.signer = { url: "https://signer.roebel.app", masterKey: "$SIGNER_MASTER_KEY", enabled: true }`,
  and keeps `provider: "thirdweb"`.
- A signer fixture is added to an example manifest so the render path runs against real input.
- Operator steps (Max's, per the standing rule that deploys are not the agent's): generate
  `SIGNER_MASTER_KEY`, add DNS for `signer.roebel.app`, run `netizen render` then `netizen up`,
  set `SIGNER_RESOURCE_URL` on the keystone and redeploy it.

**Deploy-order hazard.** The keystone must be deployed *before* the signer is pointed at it, and
`SIGNER_RESOURCE_URL` must be set in the same deploy that enables resource indicators. A keystone
deployed with resource indicators enabled but no allowlisted resource issues tokens with no
audience, which the signer then rejects — presenting as a total outage of an otherwise healthy
service.

**Pre-deploy check on `roebel-id`:** `loadConfig()` validates redirect URIs at boot since
`d9ce3651`. Confirm no stale invalid `*_REDIRECT_URIS` secret is set before deploying, or the app
will refuse to start.

## 6. Testing and definition of done

Phase A is done when, against the **deployed** signer:

1. A real login at `id.roebel.app` yields a JWT access token with `aud: https://signer.roebel.app`,
   `netizen_class: citizen`, `netizen_step_up: false`.
2. That token against `POST /v1/accounts` returns a stable vault address; a second call returns
   the same address.
3. `POST /v1/sign/message` returns a signature, and the derived npub is stable across calls.
4. **A Nextcloud or Matrix ID token is rejected by the signer.** This is the test that proves
   §5.3 landed, and the one that would have caught the defect.
5. Nextcloud and Matrix logins still work unchanged, and still receive `groups`.
6. `netizen doctor` reports the signer, and the example manifest carries a signer fixture.
7. A fresh `netizen render` produces a bundle whose `docker-compose.yml` shows the signer
   service with both `OIDC_ISSUER` and `OIDC_AUDIENCE` set to real values.

Automated coverage:

- Unit — claims resolver emits `netizen:*`; resource-indicator config rejects a
  non-allowlisted resource; `netizen_step_up` is present and `false`.
- Golden file — the `roebel` branding preset still renders byte-for-byte (existing test).
- Render — `OIDC_AUDIENCE` is emitted and equals `signer.url`; absent when `signer.url` is absent.
- E2E — extend `apps/roebel-id/test/e2e-flow.test.ts`: authorize → token → assert access-token
  claims; assert a token minted for a different audience fails `OidcTokenVerifier`.

## 7. Deferred, with the reason

| Item | Phase | Why not now |
|---|---|---|
| Kernel v3 account layer (C-1) | B | Large, independent; Phase A is useful without it (`signMessage`, npub) |
| Paymaster deploy + stake + fund | B | Requires B's accounts to be worth sponsoring; owner must be Safe/Timelock |
| Step-up auth and `/v1/export` | C | New interaction flow; nothing in Ortis or Autar development needs it |
| Keystone-owned social/OTP login | C | The largest single piece of thirdweb replacement |
| Claims decoupled from Röbel's Supabase | D | Blocks a second tenant, not the account stack |
| Agent principals, wallet→npub for Autar M1 | after A | Additive once `netizen_class` is plumbed |
| Existing-citizen migration | future | Soulbound NFT + Circles trust graph; a governance operation |
| SDK-UI modal / pricing / dashboard | E–G | Seams built in A (§5.4, §5.5); products in their own specs |

## 8. Open questions for later phases

- **Phase B:** which address does a Kernel v3 account derive from — the vault EOA as sole owner,
  or vault EOA plus guardians at initialization? The bake-off requires guardians inside the
  CREATE2 initcode for recovery to work on chains never transacted on, so guardian *policy* must
  be settled before the first account is created, since it is baked into the address.
- **Phase C:** does keystone-owned login keep `sub` as a wallet address, or move to an opaque
  user id with the address derived? Wallet-as-`sub` is what makes Phase A's two-account bridge
  work; an opaque `sub` is what a vendor-independent product wants. This decision cannot be
  deferred past Phase C without a migration.
- **Phase F:** sovereign-mode pricing shape, given §2.5 — licence or support, not usage.
