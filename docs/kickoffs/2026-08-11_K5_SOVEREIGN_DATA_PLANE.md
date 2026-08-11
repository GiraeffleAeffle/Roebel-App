# K5 — The sovereign data plane: a node database instead of external Supabase

**Date:** 2026-08-11 · **Status:** architecture proposal for review · **Owner:** unassigned agent
**Supersedes:** the "one Supabase project per tenant" decision in [Strategy §7.1](2026-08-11_STRATEGY_ORTIS_ONE_CLICK_COMMUNITY.md) — see §7 below.

## 1. The thesis

*"Postgres on your own node, fed by Nostr."* An operator who launches a community
gets a database on a Netizen node — not an account with a US SaaS vendor. That is
the sovereignty Netizen Labs sells, and it is what makes the free tier viable,
because the resource being provisioned is ours.

## 2. The insight that makes this cheap

**Supabase is not a product you must replace — it is a bundle of open-source
components you can run yourself.** Postgres, PostgREST, GoTrue (auth), Realtime,
Storage API, and the Deno edge runtime are all self-hostable.

That matters because the app talks to it through `supabase-js` with a URL and an
anon key ([`apps/expo/lib/supabase.ts`](../../apps/expo/lib/supabase.ts) already reads both from
config). Pointing a tenant at a self-hosted instance on a Netizen node is a
**configuration change, not a rewrite** — RLS, Storage, Realtime, and all 17
existing Deno functions keep working on day one.

So the migration is: **self-host first, then swap components for Netizen-native
ones one at a time**, with the app never noticing:

| Layer | Day 1 (self-hosted) | Then |
|---|---|---|
| Database | Postgres on the node | unchanged — this is the endpoint, not a stepping stone |
| Auth | GoTrue | **Netizen Accounts** issues the JWT; Postgres RLS consumes it exactly as it does today |
| Storage | Storage API on node disk | node object store (Garage/MinIO), CID-addressed |
| Functions | Deno runtime, same sources | + event watchers (§5) |
| Realtime | Supabase Realtime | + relay subscriptions (§6) |
| Public read model | — | Nostr relay → `packages/indexer` → Postgres → HTTP (already built) |

**RLS is a Postgres feature, not a Supabase feature.** It works identically on our
own node. Netizen Accounts does not replace RLS; it supplies the verified identity
that RLS policies read. That is the same shape Supabase uses internally.

## 3. The two planes (get this right or nothing else works)

| | Public record | Personal data |
|---|---|---|
| Lives in | Nostr relay, mirrored to the Postgres index | Node Postgres **only** |
| Examples | Published decisions, events, news, org profiles, proposals | Accounts, DMs, orders, drafts, moderation records, anything about a person |
| Access control | None needed — it is public by definition | RLS + encryption |
| Deletion | Advisory (NIP-09); other relays may retain | Real, immediate, verifiable |

**This split is a legal requirement, not a preference.** An append-only,
replicated event log cannot satisfy DSGVO erasure. Röbel already carries a DPIA
and a deletion runbook. Personal data must never enter the public log — and
"pseudonymous" (an npub, a wallet address) is still personal data under GDPR.

Corollary: RLS matters *only* on the private plane. The public index needs no
row-level policy because everything in it is already published.

## 4. Media storage

Primary: **object storage on the node** (Garage or MinIO, S3-compatible) so the
Storage API keeps working and deletion is real.

IPFS/Arweave/Irys are for **public, permanent artifacts only** — published
flyers, decision records, anything the community *wants* immutable. Never user
photos, never anything personal: content addressing plus pinning by strangers is
the opposite of a right to erasure, and Irys/Arweave are explicitly permanent.
The app already has `@irys/sdk` and Cloudflare Stream in use; keep them for the
cases that genuinely want permanence and CDN reach.

Rule to encode in the manifest: a bucket declares `deletable: true|false`, and
personal data may only target deletable buckets.

## 5. Edge functions — the actual answer

The 17 functions in `apps/expo/supabase/functions/` fall into four archetypes.
Replacement is per-archetype, not per-function:

1. **Secret-holding proxies** — `kie-proxy`, `generate-menu-image`, `moderate-post`, `send-notification`, `video-upload-url`. They exist only because an API key cannot ship to a client. → Any HTTP service on the node. **Zero design work; just needs a host.**
2. **Privileged writers / business rules** — `claim-reward`, `spend-muenzen`, `miniapp-grant-reward`, `buyer-card-interest`, `create-reward-event`, `org-membership`, `event-onboard`. They enforce rules the client cannot be trusted with. → Same Deno host short-term. Longer-term the interesting move: with a signed event log, several become **validated projections** — the client publishes a signed intent, and the indexer applies the rule when materialising. The rule moves from a privileged endpoint into the projection, which is auditable by anyone replaying the log.
3. **Chain signers** — `circles-invite`, `nostr-identity-register`. Hold a key, verify a signature, submit a transaction. → Netizen Accounts' signer, once [K1](2026-08-11_K1_NETIZEN_ACCOUNTS_REPLACES_THIRDWEB.md) lands. Note `nostr-identity-register` verifies ERC-1271 signatures, so it is coupled to K1's chain-id domain decision.
4. **Scheduled jobs** — `sync-abfallkalender`. → A timer unit rendered by the installer. `packages/agent-watcher` is already this pattern.

**Recommended host: self-hosted Deno.** Supabase edge functions *are* Deno modules,
so a Deno server plus a thin router runs the existing sources close to unmodified —
the cheapest possible port. Reach for WASM isolation (Spin/wasmtime) only if
tenants are ever allowed to run their own code; that is a different threat model
and not needed for v1.

## 6. Realtime

Three mechanisms, chosen by data type — do not build one generic bus:

1. **Public events → the relay itself.** A Nostr `REQ` subscription is already a live push over the same WebSocket that carries writes. Anything on the public plane gets realtime for free, with no extra infrastructure.
2. **Presence / typing / ephemeral** → Nostr ephemeral events (kinds 20000–29999) are broadcast and never stored. Exactly the right semantics, and no retention question.
3. **Private, derived state** → Supabase Realtime on the node (day 1), or Postgres `LISTEN/NOTIFY` behind a small WebSocket fanout. Only for things the relay cannot express because they must stay private.

Human chat is a separate rail already decided (Matrix for humans, XMTP for agents/DMs) — do not re-solve it here.

## 7. What this changes

The tenant-backend decision recorded earlier today (one external Supabase project
per community) is **replaced**: a tenant gets a **database on a Netizen node**.
Consequences:

- The "every self-serve signup provisions a paid vendor resource" problem
  disappears; the cost becomes our own capacity, which is schedulable and cheap
  per tenant (a database per tenant on a shared cluster).
- A genuine free tier becomes possible, so [K4](2026-08-11_K4_ORTIS_DASHBOARD.md)'s launch policy gate can default to
  permissive instead of payment-walled.
- **New burden: we are now the operator.** Backups, upgrades, HA, monitoring, and
  incident response for every tenant's database. This is a business-model change,
  not just an architecture change — and under DSGVO it likely makes Netizen Labs
  the *processor* for each community's data, with the community as controller.
  That needs a data-processing agreement per tenant.
- Tenants who want full sovereignty run their own node via `netizen up` and point
  their community at it. Same software, different operator. That option should
  exist from day one, because it is the product's whole claim.

## 8. Slices

1. **Decision memo + isolation design** — database-per-tenant vs schema-per-tenant on a shared cluster; backup/restore story; what an operator can reach directly (psql? a console?). Stop for review.
2. **Self-hosted stack in the manifest** — Postgres + PostgREST/GoTrue/Storage/Realtime + Deno host rendered by `netizen render`/`up`, with an example manifest fixture (standing project rule).
3. **Point one tenant at it** — a throwaway community running end to end on a node database, app unmodified except config.
4. **Swap auth to Netizen Accounts** — GoTrue out, Netizen-issued JWT in, RLS policies unchanged. Depends on K1.
5. **Public read model** — wire `packages/indexer` per tenant so the public plane is portable and fast ([K2](2026-08-11_K2_NOSTR_READ_FALLBACK.md)).
6. **Media** — node object store with the `deletable` bucket rule.

## 9. Open questions for Max

1. **Who operates tenant nodes?** Netizen Labs for everyone (processor role, DPA per tenant, real ops burden) vs operator-runs-own-node (sovereign, high support cost) vs both tiers? This decides the business model more than the architecture.
2. **Database-per-tenant or schema-per-tenant?** Per-database isolates cleanly and makes "export/delete my community" trivial; per-schema is cheaper at scale. Given the DSGVO story is a selling point, per-database looks right — confirm.
3. Does Röbel migrate off hosted Supabase too, and when? It is the reference deployment; staying on hosted Supabase while selling node databases is a credibility gap.
4. Is a tenant allowed to run **only** the public plane (record-only, no personal data at all)? That is the cheapest tier and the strongest privacy claim.
