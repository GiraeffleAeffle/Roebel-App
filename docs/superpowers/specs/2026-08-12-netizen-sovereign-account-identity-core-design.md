# Netizen Sovereign Account — identity core (C1)

> **Status:** design approved 2026-08-12. Implementable from this document, except §7 (agent
> members), which is scoped here and gets its own spec.
>
> **What this is:** the first slice of Phase C from
> [`2026-08-11-sovereign-netizen-account-infrastructure-design.md`](2026-08-11-sovereign-netizen-account-infrastructure-design.md)
> — the keystone authenticates people **itself**, with no thirdweb in the path. Phase A already
> shipped the other half: the node signer holds the per-user key and derives the Nostr identity.
>
> **Code homes.** The keystone is `apps/roebel-id` in THIS repo. `@netizen-labs/connect-react`,
> `apps/ortis` and `packages/ortis-core` are in the netizen_labs monorepo. The Autar client is
> its own repo, `Netizen-Labs-Org/Autar`.

## 1. Goal

Replace thirdweb as the thing that proves who someone is. thirdweb's `inAppWallet` does two
separable jobs inside the keystone today: it **proves identity** (social OAuth, email and SMS
codes) and it **holds the key** (an enclave-derived, deterministic address).

Job two is already replaced — `@netizen-labs/signer` holds per-user EOAs, envelope-encrypted
with subject-bound AAD, deterministic per subject, returning the Nostr identity at creation.

**Netizen Sovereign Account = that signer + job one, which this spec builds.**

## 2. Decisions (Max, 2026-08-11/12)

| Question | Decision |
|---|---|
| Who does it serve? | **New users and new communities only.** Existing Röbel citizens keep their thirdweb-derived identity until a governed migration. No migration, no broken links. |
| What is `sub`? | **An opaque `usr_…` id** the keystone mints. Email, phone and social become verified identifiers *attached to* a user. |
| How do the two modes coexist? | **Per keystone instance, via `AUTH_MODE`.** Not runtime branching. |
| First method | **Email OTP**, delivered by the node's own SMTP. |
| Scope | **One spec covering Ortis and Autar.** |

## 3. Constraints

1. **`roebel-id` must not change behaviour.** Existing citizens' `sub` stays their wallet
   address; CitizenNFT, Circles, votes, Nextcloud and Matrix accounts all keep resolving.
2. **Autar has no backend of any kind** (confirmed, decision D16): one Next.js app in
   `output: "export"`, wrapped by Tauri v2 for macOS, Windows, Linux, iOS and Android, plus
   browser and PWA from the same bundle. There is no server-side code exchange and no place to
   hold a client secret. **Public client with PKCE is required, not preferred.**
3. **Autar's custody rule, verbatim:** *"keys are client-held; no Autar server ever sees an
   nsec."* See §6.3 — this rules out a path Phase A shipped.
4. **All new files and routes in English.** German only for text a person reads.
5. **No browser-only APIs** where a webview equivalent exists; the same bundle runs in a Tauri
   webview on six platforms.
6. **Parallel-session territory.** `apps/ortis/app/(operator)/**`,
   `apps/ortis/components/operator/**`, `packages/ortis-operator/**`, `packages/router/**`,
   `packages/agent-watcher/**` belong to other sessions. The Connect modal work in
   `apps/ortis/app/login/`, `app/api/auth/*` and `packages/connect-react/` was handed to the
   Ortis session on 2026-08-11.

## 4. Architecture

```
AuthBridge.verifyLogin() -> { subject }        <- generalised from { address }

  roebel-id   AUTH_MODE=thirdweb   subject = wallet address   (unchanged, existing citizens)
  ortis-id    AUTH_MODE=sovereign  subject = usr_…            (new)

then identical in both modes:
  sub -> signer vault -> EOA  (-> npub, see §6.3 for which derivation path)
```

The mode is a per-instance configuration fact, exactly as the accounts spec says
("mode is a manifest fact, not a fork"). Two instances already run from one image, so this adds
no new deployment shape. There is no per-user detection and no branch to get wrong.

The signer is **never called during login** — it derives the account from `sub` afterwards. No
circular dependency.

### 4.1 Data model (new, keystone-owned)

```
users
  id            usr_… (random, stable forever)   <- becomes `sub`
  created_at

identities                         one person, many verified identifiers
  user_id  -> users.id
  kind          'email' | 'phone' | 'oauth:google' | 'oauth:apple' | 'oauth:facebook'
  value         normalised (email lowercased; phone E.164)
  verified_at
  UNIQUE (kind, value)             one identifier belongs to exactly one person

otp_challenges
  id, kind, value, code_hash, expires_at, attempts, consumed_at
```

`identities` is what makes later methods pure additions: a Google login is a new row kind, not a
new identity model. It is also what lets one person hold several identifiers — the property that
a hash-of-email subject would have foreclosed, and the precondition for cross-surface linking.

**Storage:** sovereign mode needs its own Postgres. `ortis-id` today reads *Röbel's* Supabase,
which is the coupling that blocks a second tenant. Use Ortis's existing Postgres instance under a
**separate schema** for the pilot — no shared tables, and a clean split into its own database
later without application changes. **This closes the tenant-independence gap open since Phase A.**

**Connectivity is a real prerequisite, not a detail.** `ortis-id` runs on Fly while Ortis runs on
Vercel, so the keystone needs its own `DATABASE_URL` and network reachability to that Postgres
from Fly. Confirm this before building: if the instance is not reachable from Fly, sovereign mode
needs its own Postgres and the shared-schema plan is moot. In sovereign mode the keystone must
also stop requiring `SUPABASE_URL` / `SUPABASE_SERVICE_KEY`, which are currently mandatory at
boot — a sovereign instance holding another community's service-role key is precisely the coupling
being removed.

## 5. Email OTP

Both endpoints live **inside an OIDC interaction**, not beside it. The keystone's login page is
already served at `/interaction/:uid`; these are called from that page and carry its `uid`, and a
successful verify finishes *that* interaction via `provider.interactionFinished`. They are not a
standalone login API, and there is no way to obtain a session without an interaction to complete.

```
POST /interaction/:uid/otp/start   { email }
   -> 202 with an identical body whether or not the address is known
   -> create challenge, send mail

POST /interaction/:uid/otp/verify  { email, code }
   -> find-or-create user, upsert verified identity,
      finish THAT interaction with sub = users.id
```

An expired or unknown `uid` is rejected before any challenge is created — otherwise the endpoint
sends mail on behalf of a login nobody started.

**Delivery:** nodemailer over the node's own SMTP, Mailhog in dev — the approach ORTIS_KICKOFF
already settled, keeping Verwaltungsdaten metadata off a vendor.

### 5.1 The security contract

You are building auth rather than buying it. thirdweb did all of this invisibly; none of it is
optional, and each item gets a test.

| Requirement | Why |
|---|---|
| 6-digit code from `crypto.randomInt` | `Math.random` is predictable; a guessable code is no code |
| Code **hashed at rest** | A database leak must not yield live codes |
| Constant-time comparison | Timing leaks recover a code digit by digit |
| 10-minute TTL, single use | Limits the window and stops replay |
| **Max 5 attempts, then burn the challenge** | Without attempt counting, 10⁶ is brute-forceable |
| Rate limit per identifier **and** per IP | Per-identifier stops targeting one mayor; per-IP stops spraying |
| `/otp/start` responds identically for known and unknown addresses | Otherwise it is a membership oracle for a Verwaltung's staff list |
| Codes never in logs, audit records or error messages | An audit trail must not become the credential store |

## 6. What each product needs

### 6.1 Ortis — the community door, concrete today

Ortis is a Next.js server and stays a **confidential client**: `client_secret_basic`,
server-side code exchange, httpOnly session cookie. Unchanged by this spec.

**Ortis needs no application changes at all.** `findOrBindMemberByOidc(sub, email)` already binds
an invited member by verified email on first login and records the `sub` thereafter — the path
was built for exactly this shape. What changes is only that `sub` is now `usr_…` rather than an
address, and Ortis never inspected its format.

Claims in sovereign mode come from the keystone's own store (`email`, `email_verified`,
`preferred_username`), not from Röbel's Supabase.

### 6.2 Autar — public client, and not in the first shell

**The first Autar shell is the direct door, and has no OIDC in it.** Users generate a new Nostr
identity or bring their own npub. The sovereign account arrives with the **community door**
(Autar embedded in Ortis/Röbel surfaces), which is explicitly second. This spec does not claim
otherwise, and no one should build an Autar login screen expecting it on day one.

When the community door arrives, the keystone must already support:

- **Public client:** `token_endpoint_auth_method: "none"`, PKCE required, **no client secret**.
  The keystone today requires `<PREFIX>_CLIENT_SECRET` for every relying party; sovereign mode
  must allow an RP to declare itself public. PKCE is already mandatory for every client
  (`pkce: { required: () => true }`), so the protection is in place.
- **Both origins registered, and they are not interchangeable:** `autar.app` is the brand
  (STRATEGY still says `autar.xyz` and is stale). A proposal exists to repurpose `autar.xyz` as
  the **tenant** domain (`your-client.autar.xyz`) so a subdomain takeover on one tenant stays out
  of the platform's cookie scope — the `googleusercontent.com` pattern. **That is a decision for
  Max, not an implementation detail**; if it lands, both registrable domains need redirect URIs.

**Token storage is Autar's concern, not the keystone's**, and it is platform-split: the OS
keychain via Tauri's secure store on desktop and mobile; browser and PWA have neither Tauri nor a
server, so they need their own adapter. Worth recording why this is less alarming than it sounds:
**Autar's durable identity is a Nostr keypair, not an OIDC session.** The npub persists; tokens
are a community-door concern.

### 6.3 The custody rule rules out a path Phase A shipped

Phase A's Task 9 made `POST /v1/accounts` return the member's `npub`. To do that, **the signer
derives the secret key server-side** and drops it. It never leaves, is never logged and is never
returned — but the node computed it.

Under *"no Autar server ever sees an nsec, in every path"*, that endpoint does not qualify.
"Never leaves and is never logged" is a weaker claim than "never existed there", and only the
second is what is written down.

**The compliant path exists and was deliberately kept:** `NodeAccount.nostrIdentity()` asks the
signer only for a **signature**, then derives the key **in the client**. Same npub, same
determinism, but the nsec only ever exists on the user's device.

| Product | Path |
|---|---|
| Ortis | May use the server-derived `npub` from `POST /v1/accounts` |
| **Autar** | **Client-side `nostrIdentity()` only** |

Do not argue that a community's own node is not "an Autar server". That distinction reads fine
today and badly in a year.

### 6.4 Bring-your-own-npub — a method-registry entry

The direct door is a purely local key operation: generate a Nostr keypair or import one. **No
keystone involvement whatsoever.** It appears in `@netizen-labs/connect-react` as a new method
kind, `local`, rendered like any other button, with a callback that does everything client-side.

The registry already carries `redirect | qr | inline`; `local` is a fourth. The modal's structure
does not change — that is what the registry is for.

**UX rule, binding:** no surface may invite a user to copy a private key anywhere except a
client's import field. An nsec that lands in a chat, a form or a note is burned and must be
treated as compromised.

## 7. Agent members — scoped, not designed here

Autar's README states: *"Agents are members, not bots. They hold identity, budgets, and audit
trails."* That is a **third identity class**, and it is not a login: an agent is provisioned with
a credential and acts continuously.

The plumbing exists — the signer's policy engine already understands
`netizen_class: 'citizen' | 'agent' | 'org'` with per-class rate limits, and the keystone reserves
`actor_type` while only ever issuing `human`. What does not exist is provisioning, budget binding,
revocation, or the audit model.

**This gets its own spec.** Folding it in here would put an interactive-login design and a
machine-credential design in one document, and they share almost nothing but a claim name.

## 8. Out of scope, with the reason

| Item | Why not here |
|---|---|
| Social federation (Google/Apple/Facebook) | C2. `identities` makes it a new row kind, not a new model. |
| SMS OTP | C3. Needs a provider and carries per-message cost. |
| QR app-connect | C4, already specced as I3. Independent of this work. |
| Kernel v3 smart account | Phase B (C-1). This spec's accounts are the signer's EOAs. |
| Passkey, WalletConnect | Both reverse or extend recorded decisions; decide deliberately. |
| Migrating existing Röbel citizens | Soulbound CitizenNFT plus an immobile Circles trust graph — a governance operation. |
| Agent members | §7. |

## 9. Testing and definition of done

1. A person signs in at `ortis-id` with an email code, **with no thirdweb code in the path**, and
   receives a token whose `sub` is a `usr_…` id.
2. The same person signing in again gets the **same** `sub`.
3. `roebel-id` behaviour is byte-identical: the golden-file login-page test still passes, and a
   thirdweb-mode login still yields a wallet-address `sub`.
4. Every row of §5.1 has a test. Specifically: a wrong code five times burns the challenge; a
   sixth attempt with the *correct* code fails; `/otp/start` returns an identical response for a
   known and an unknown address; and no test fixture or log assertion ever contains a live code.
5. An RP declared public registers with `token_endpoint_auth_method: "none"` and completes an
   authorization-code + PKCE flow **without a client secret**; a confidential RP is unaffected.
6. Ortis signs in end to end against sovereign mode with **no change to `apps/ortis`**, and an
   invited member is bound by verified email on first login.
7. Claims in sovereign mode are served from the keystone's own store, with **no Supabase read** —
   and a sovereign instance boots with `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` unset, proving
   the dependency is gone rather than merely unused.
8. An OTP endpoint called with an expired or unknown interaction `uid` sends no mail and creates
   no challenge.

## 10. Open questions

- **`autar.xyz` as the tenant domain** (§6.2). A security boundary, and Max's decision.
- **Whether `roebel-id` ever flips to sovereign mode.** This spec does not require it and the
  soulbound constraint argues against it, but leaving it permanently on thirdweb means one
  product keeps a vendor dependency indefinitely.
- **Cross-surface linking.** Now load-bearing sooner than expected: per-tenant key isolation
  means a person serving two Ämter has two accounts, and the direct/community doors give an Autar
  user two identities. `identities` is the table that makes linking expressible; the policy is
  not designed.
