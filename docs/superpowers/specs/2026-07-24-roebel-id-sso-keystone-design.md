# Röbel ID — Wallet-Identity SSO Keystone (Design)

**Date:** 2026-07-24
**Status:** Design (brainstorming output) · **Amended 2026-07-25** — agent-ready identity shaping (§10) + openDesk LDAP-tax correction (§6), from buzz.xyz + openDesk deep research. **Approved for build.**
**Scope of THIS spec:** the **SSO keystone** — a standards-compliant OIDC Identity Provider ("Röbel ID") that turns the existing wallet login into a login for open-source office components, proven end-to-end against **Nextcloud**. Plus a strategic preamble (§0) capturing the **openDesk coexistence thesis**. Everything else in the Sovereign Suite is out of scope and lives in the companion docs.

**Where this sits in the corpus (build on, do not duplicate):**
- Implements the concrete *how* for Decision #4 of [2026-07-05-sovereign-community-os-design.md](2026-07-05-sovereign-community-os-design.md) ("Nextcloud backbone, **wallet identity as the auth/permission layer**, Fileverse-style E2E for sensitive data") — that doc decided it in principle; this spec is the mechanism.
- Realizes L1 "SIWE (EIP-4361)" + L0 "thirdweb is a SPOF, not a spec" from [2026-07-21-netizen-stack-design.md](2026-07-21-netizen-stack-design.md).
- The full product catalog (Docs, Sheets, Calendar, Mail, Commerce…) is already cataloged in [2026-07-07-roebel-suite-product-portfolio.md](2026-07-07-roebel-suite-product-portfolio.md); this keystone is the identity plumbing those surfaces sit on.

---

## 0. Strategic context — why a keystone, not a competitor to openDesk

**Verdict: building a sovereign suite is not wasted competition with openDesk — because openDesk structurally cannot serve who Röbel serves, and Röbel already owns the substrate openDesk lacks. The winning move is to reuse the mature open office stack behind our wallet identity, and to be able to sit *on top of* openDesk rather than fight it.**

**Who openDesk serves.** openDesk (ZenDiS, sole shareholder = Federal Republic; Apache-2.0; production, v1.17 as of mid-2026) is a bundle of mature tools — Nextcloud (files), Collabora (docs), Open-Xchange (mail), OpenProject (tasks), XWiki (wiki), Element/Matrix (chat), Jitsi (video), CryptPad, glued by Univention Nubus + Keycloak SSO — aimed at **large public institutions with real IT** (Bundeswehr/BWI 7-year deal, RKI, the ICC). Deployment bar: Kubernetes + ~5–6 servers minimum; prioritized for 500+ employee orgs.

**The hole openDesk leaves, by design:** individual citizens, small businesses/SMEs, small towns as *communities*, mobile-first, integrated AI, payments/currency/treasury, wallet/self-sovereign identity, low-friction onboarding. That list **is** Röbel's target: a town's whole community — citizens + local businesses + administration — as one system. Different segment, different job.

**What Röbel already has that openDesk never will** (verified from code — the substrate map): one self-custodial, gasless smart-account identity (same address across Base↔Gnosis and web↔Expo, keyed as `users.wallet_address`); multi-tenant workspaces with RBAC (`account_owners`); XMTP E2E messaging bound to that identity; Irys/Arweave permanent storage + client-side NaCl encryption (keys from an EIP-712 signature); a mini-app SDK app-platform; a Münzen + Monerium/EURe + Safe-treasury value spine; Mecky (Claude tool-calling AI) + public/developer MCP servers.

**The keystone thesis.** Every mature open component — Nextcloud, Collabora, OpenProject, and openDesk's own bundle — authenticates via **OIDC/SAML** (openDesk's entire SSO layer is Keycloak). So if the town's wallet becomes a standard **OIDC provider**, a citizen or business logs in **once, with their town identity**, and gets a full office suite behind it — no directory provisioning, no admin, gasless, self-custodial. openDesk can't make identity the citizen's own wallet; that is precisely the differentiated layer Röbel owns. Because Röbel ID is a standard OIDC IdP, a town could even run openDesk's actual components federated to it — **coexistence and interop, not a zero-sum fight.**

**Design guardrails that fall out of the research (apply throughout the Suite):**
- **Reuse, don't reinvent** documents/sheets/mail/calendar/tasks — that's where the open stack is production-grade and crypto-native is still experimental. Spend build budget only on the differentiators (identity, money, AI, the mini-app platform).
- **Client-side E2E and real-time collaborative editing are in tension** — Collabora/OnlyOffice render server-side and need plaintext. Accept the tradeoff per document class (sensitive → owner-encrypted, view/download; everyday collab → server-side behind our SSO). *(Out of scope for the keystone; recorded for the Docs slice.)*
- **GDPR erasure vs. permanence** — only ciphertext/hashes on permanent storage; keep erasable plaintext/keys crypto-shreddable. *(Hosting-layer concern, not the keystone's.)*
- **Depend only on stable primitives** — Safe, ERC-4337/EIP-7702, XMTP, EAS, Arweave, thirdweb-for-now. The crypto-identity landscape churned hard in 2025–26 (ENS cancelled its L2, Ceramic pivoted, Lens/Farcaster changed hands, World ID hit EU/German regulatory walls). For verifiable citizen/business credentials prefer **EAS** (MIT, tokenless, live on Gnosis) over World ID; keep threshold-encryption networks (Lit/TACo) swappable, never foundational.

---

## 1. Goal & scope

**Goal.** Ship "Röbel ID": an owned, standards-compliant OIDC Identity Provider whose login step reuses the existing thirdweb wallet session, so that **one wallet login provisions and authenticates a real Nextcloud account** (Files + Collabora Office + Calendar + Deck), with citizen/attester/org status flowing through as OIDC groups.

**In scope.**
- The Röbel ID service (OIDC provider) with a clean, swappable wallet-auth seam.
- Claims + group mapping from Röbel identity → OIDC token.
- Nextcloud `user_oidc` integration, proven end-to-end.
- A generic-OIDC-client conformance path for isolating IdP correctness.

**Out of scope (explicit).**
- Standalone SIWE/ERC-1271 backend without thirdweb (that's the v2 seam swap — designed for, not built).
- Production Nextcloud hosting/ops (dev + managed instance only for the proof).
- Key recovery hardening (passkeys / Safe guardians), real-time-collab work, storage encryption, and any other Suite surface.
- Keycloak — not run in v1; §6 notes how a town's Keycloak federates to Röbel ID later for openDesk coexistence.

**Success criteria.** A scripted E2E run: user signs in with email/social → smart account connects → Nextcloud auto-provisions the account keyed on the wallet address → `groups` claim maps to Nextcloud groups → the user opens a Collabora document. Green = keystone proven.

---

## 2. Architecture & components

```
   Nextcloud (user_oidc)  ──OIDC──▶  Röbel ID  ──reads──▶  Supabase (users, account_owners)
        │  (client)                   (IdP)     ──reads──▶  Gnosis (CitizenNFT/AttesterNFT)
        │                               │
        └────────── redirect ───────────┘
                                        │  interactive login
                                        ▼
                                 Wallet-auth bridge  ──▶  thirdweb wallet session
                                 (verifyLogin → address)     (email/social/passkey → SCW)
```

- **Client app — Nextcloud.** The `user_oidc` app configured with Röbel ID's discovery URL, client id/secret, PKCE, `groups` claim mapping, auto-provisioning, unique-id = `sub`.
- **Röbel ID (IdP).** Owned Node service on panva [`oidc-provider`](https://github.com/panva/node-oidc-provider) (the certified reference implementation). Standard endpoints: discovery, JWKS, `/auth`, `/token`, `/me`, `/interaction/:uid`.
- **Wallet-auth bridge.** The interactive login step and **the one swappable seam** (see §6). v1 reuses the thirdweb in-app-wallet session; asserts the authenticated smart-account address.
- **Claims resolver.** Address → claims from Supabase + chain + `account_owners`.
- **Store.** panva Adapter over Supabase Postgres (sessions, grants, keys); JWKS rotation.
- **Hosting.** A small always-on Node service (Fly, like `apps/coordinator`) — **not** Vercel serverless: an OIDC provider is stateful and needs a stable process and signing keys.

---

## 3. Login flow (OIDC authorization-code + PKCE)

```
1. User clicks "Login with Röbel" in Nextcloud
2. Nextcloud → redirect → Röbel ID /auth  (PKCE challenge)
3. No IdP session → Röbel ID renders /interaction/:uid login page
4. Login page runs thirdweb connect → smart account connected
   → SIWE (EIP-4361) message signed by the account (ERC-1271 verified on Gnosis)
5. Röbel ID: auth-bridge.verifyLogin() → { address }
   → accountId = address → claims-resolver assembles claims
6. Consent auto-granted (first-party client) → redirect back with auth code
7. Nextcloud exchanges code at /token → id_token + access_token
8. Nextcloud calls /me (userinfo) → { sub, email, name, groups }
   → provisions/logs in the user, maps groups → Nextcloud groups
```

---

## 4. The IdP service — modules & interfaces

Each module has one purpose, a defined interface, and is independently testable.

| Module | Purpose | Interface | Depends on |
|---|---|---|---|
| `oidc/` | panva provider config: Nextcloud client (redirect URIs, secret), PKCE, claims, JWKS, cookie/TTL policy | standard OIDC HTTP endpoints | store, Account model |
| `interaction/` | render login+consent; finish the interaction with `accountId = address` | `GET/POST /interaction/:uid` | auth-bridge, claims-resolver |
| **`auth-bridge/`** | **the swappable seam** — verify the wallet login, return the address | `verifyLogin(req) → { address }` | v1: thirdweb session + ERC-1271 (Gnosis RPC) |
| `claims-resolver/` | assemble OIDC claims for an address | `resolveClaims(address) → Claims` | Supabase `users`, `account_owners`, `lib/citizen-registry` |
| `store/` | panva Adapter + signing-key storage/rotation | panva `Adapter` contract | Supabase Postgres |
| `account` | panva `findAccount` → `{ accountId, claims() }` | panva Account contract | claims-resolver |

**`auth-bridge` interface (the seam):**
```ts
interface AuthBridge {
  // Verifies the interactive login and returns the authenticated smart-account address.
  verifyLogin(req: InteractionRequest): Promise<{ address: string }>
}
// v1: ThirdwebAuthBridge — thirdweb is the wallet *connector* (email/social/passkey → SCW);
//     the connected smart account signs a fresh SIWE (EIP-4361) message, which Röbel ID
//     verifies via ERC-1271 on Gnosis. Verification is already standard; thirdweb is not trusted
//     as an auth authority, only as the signer UX.
// v2: SiweAuthBridge — same SIWE/ERC-1271 verification with a non-thirdweb connector. Because
//     v1 already verifies SIWE, the swap changes only the connect/signing UX, not verification.
```

---

## 5. Claims & group mapping contract

The OIDC token Röbel ID issues:

| Claim | Value | Source |
|---|---|---|
| `sub` | smart-account address, lowercased (consistent with `users.wallet_address` keying) | wallet session |
| `email`, `email_verified` | from thirdweb social/email login | thirdweb → Supabase `users` |
| `name` | display name | Supabase `users` |
| `preferred_username` | ENS name if present, else display name | chain / Supabase |
| `picture` | avatar | Supabase `users` |
| `groups` | array: `citizen`, `attester`, `org:<accountId>:<role>` (owner/admin/member) | on-chain NFTs + `account_owners` |
| `roebel:citizen` / `roebel:attester` / `roebel:tier` | namespaced custom claims (kept out of standard claims to avoid collisions) | `lib/citizen-registry` (chain truth, self-healing) |

**Nextcloud mapping.** `user_oidc`: unique-id = `sub`; email/name auto-filled; `groups` claim → Nextcloud groups → drives group folders, app access, and admin scoping. Citizen/attester/org-role become Nextcloud groups the town can attach permissions to.

**Citizen/attester status must reflect chain truth, never the drifting DB flag** — reuse the existing self-healing `lib/citizen-registry` path (the repo already treats `users.is_verified_citizen` as advisory only).

---

## 6. Sovereignty seam & swap path

- **What is owned vs. rented.** Everything auth-*correctness* depends on is owned: the IdP, its signing keys, the claims logic, the store. thirdweb is confined to `ThirdwebAuthBridge` behind the one-function `verifyLogin → {address}` interface.
- **The de-thirdweb migration (v2).** Replace `ThirdwebAuthBridge` with `SiweAuthBridge` (standalone EIP-4361 + ERC-1271). No other module changes — this is exactly netizen-stack L0's "make thirdweb swappable, not enshrined," and it makes the migration a backend change, not a rewrite.
- **openDesk coexistence (later, low new build — corrected 2026-07-25).** Because Röbel ID is a standard OIDC IdP, a town running openDesk registers Röbel ID as an **external OIDC identity provider in its Keycloak** — its citizens then authenticate to openDesk's components with their town wallet. **openDesk research correction:** this is supported since openDesk **v1.4.0** via Keycloak external-IdP brokering — but **OIDC only** (not SAML), users matched by **username**, and, critically, openDesk's **backend of record is OpenLDAP (Univention Nubus), not Keycloak**. Federation *authenticates*, but each user must **also exist in LDAP**, and **SCIM inbound is not live** (roadmap only). So coexistence is **low-new-build, not zero**: it needs the **Nubus Directory Importer** for user lifecycle (or accepting **JIT provisioning without deprovisioning** for a pilot) alongside the OIDC broker. This is still the "sit on top of openDesk" path from §0 — available once the IdP exists **plus that LDAP provisioning is wired** — and confirms the §0 posture: don't adopt openDesk's Kubernetes/Helmfile mega-deployment; compose 2–3 upstream apps behind Röbel ID and *federate to* openDesk where a town already runs it.
- **Forkable as a Netizen Node component.** Röbel ID's only per-community config is: clients, `chainId`, contract addresses, and the Supabase URL. Built product-first for Röbel; clean enough to become the identity module of a Netizen Node.

---

## 7. Constraints & non-goals (honest)

- **Auth only.** The keystone authenticates; it does not solve content data-residency/GDPR for Nextcloud files — that's the hosting layer's job (the Suite's "sovereignty hardening" stage).
- **Recovery inherits the wallet.** v1 relies on thirdweb's email/social login for recovery; passkeys + Safe guardians are future hardening, out of scope.
- **No production Nextcloud hosting** in this spec — dev (docker) + a managed instance for the proof; production ops is separate.
- **No real-time-collab or storage-encryption work** — Collabora's server-side collab is reused as-is.
- **Security requirements (mandatory):** PKCE required; exact redirect-URI matching; short auth-code TTL; rotating JWKS; HTTPS-only; signed/encrypted session cookies; client secret + signing keys in a secrets store (Fly secrets); ERC-1271 verification pinned to Gnosis via a trusted RPC; SIWE nonce single-use with replay protection and short expiry.

---

## 8. Testing strategy

1. **IdP conformance first** — validate discovery/PKCE/token/userinfo against a generic OIDC test/debugger client, before Nextcloud, to isolate provider correctness.
2. **`auth-bridge` unit tests** — `verifyLogin` accepts a valid ERC-1271 signature from a Gnosis smart account; rejects bad/expired/replayed nonces; rejects EOA-only where a smart account is required.
3. **`claims-resolver` tests** — address → correct email/name/`groups`; citizen/attester reflect chain (not the DB flag); org roles from `account_owners`.
4. **E2E** — docker Nextcloud + `user_oidc` pointed at a Röbel ID instance: wallet login → account auto-provisioned (keyed on `sub`) → `groups` mapped to Nextcloud groups → open a Collabora document. Green = keystone proven (the success criteria in §1).

---

## 9. Open questions / future slices

- **v2 seam swap** — standalone `SiweAuthBridge`; its own spec when de-thirdweb becomes a priority.
- **Keycloak-federation guide** — a short runbook for towns coexisting with openDesk (register Röbel ID as external OIDC IdP).
- **Recovery hardening** — passkeys + Safe Recovery Module; a wallet-layer slice, not identity-service.
- **EAS-backed portable credentials** — "verified Röbel resident / verified local business" as EAS attestations a third party can check without Röbel's DB (safer than World ID for EU civic use).
- **SCIM / deprovisioning** — how loss of citizen status or org membership propagates to Nextcloud (group removal) beyond next-login refresh.

---

## 10. Agent principals — the AI-automation on-ramp (shaped now, built later)

**Amendment 2026-07-25** — from the buzz.xyz deep research + the user's stated priority ("focusing on AI Agent automation"). This section makes the keystone provably the foundation the future Agent-Runtime layer plugs into, at near-zero v1 build cost.

**Why this belongs in the keystone.** The project's north star treats AI agents as *members*, not tools: an economic agent needs the same four things a human member needs — a verified identity, governance bounds, a scoped treasury, and a currency ([COORDINATION_PROTOCOL_THESIS](../../future-research/COORDINATION_PROTOCOL_THESIS.md), layer 05). Block's **buzz** (Apache-2.0, launched 2026-07-21) ships exactly this pattern in production: every agent gets its own keypair and acts with *"the same audit trail, a different keypair,"* and Block chose Nostr specifically because agent **identity** is "the most fundamental problem in multi-agent collaboration." Röbel already owns a *stronger* identity primitive than buzz's raw Nostr keypair — a gasless smart-account (secp256k1) with on-chain governance and treasury — so the keystone is the natural place agents get their identity.

**The design consequence (why it's nearly free).** Röbel ID's `sub = smart-account address` **already generalizes to agents**: an agent is just a principal that owns its own address. So the IdP is the identity layer for humans *and* agents with **no model change** — only additive claims.

**What v1 does (shaped, minimal — the only agent-related code in this build):**
- Reserve a `roebel:actor_type` claim (`'human' | 'agent'`), defaulting to `'human'`, in the claims model (Task 4) and in the `roebel` claims scope (Task 6), so it flows to relying parties from day one. Adding agents later then needs **no claims-schema or Nextcloud-mapping migration**.

**What a later Agent-Runtime spec builds (reserved seams, NOT built here):**
- **Delegation via the OIDC `act` (actor) claim** (RFC 8693 token-exchange semantics): an agent token asserts *"agent X acting on behalf of principal Y,"* giving buzz-style attributable, auditable agent actions — every agent action traces to its authorizing human/org.
- **A client-credentials / service-account grant** for non-interactive agent auth, distinct from the human `authorization_code` interactive flow, issuing **bounded scopes** per the thesis's "governance bounds."
- **Audit**: every issued token (human or agent) logged; agent tokens carry `act`. This reproduces buzz's "same audit trail, different keypair" property over standard OIDC instead of Nostr.

**Explicit v1 non-goals:** no service-account grant, no agent onboarding, no ACP/MCP wiring, no scope-bounding engine — those are the Agent-Runtime layer's own spec. The keystone only **reserves the seam** (`actor_type`) and records the on-ramp so the foundation is provably agent-ready.

**Interop note.** Because this is standard OIDC over a smart-account identity, a Röbel agent principal maps cleanly onto buzz's ACP/MCP agent world later: an agent holding a Röbel ID token + a scoped smart account can act inside the sovereign suite (or a buzz-style workspace) identically. buzz deliberately omits payments and cross-org federation — those remain Röbel's differentiators, layered *below* this identity, not borrowed from buzz.
