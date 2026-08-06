# State of Nostr

**Last verified: 2026-07-28**, against the running relays. Part of the
[documentation index](README.md); see also
[State of the Netizen Stack](STATE_OF_THE_NETIZEN_STACK.md) and
[State of the Netizen Node](STATE_OF_THE_NETIZEN_NODE.md).

Nostr is how a Netizen node's **public record leaves the node**: signed by its members,
readable by any client in the world, and mirrored between nodes. It is no longer an R&D bet —
it is live, with citizens publishing from the app.

The original four-part decomposition — **identity bridge → query layer → federation → agents** —
is complete as of 2026-07-28. What remains is listed in §8 and in
[Roadmap and deferred work](ROADMAP_AND_DEFERRED.md).

---

## 1. What is live

| | |
|---|---|
| Authoring relay | `wss://relay.roebel.app` — strfry 1.1.0 |
| Federation mirror | `roebel-mirror` container (peers' events, read-only) |
| Write access | CitizenNFTv2 holders only, synced from chain every 5 min |
| Supported NIPs | 1, 2, 4, 9, 11, 28, 40, 45, 70, **77** |
| Node #2 | `testnode-strfry` + its own mirror — a full second node, rendered from `testnode.netizen.json` |

**NIP-77 (negentropy) is the load-bearing one**: it makes cross-node sync set-reconciliation
rather than log-shipping, so a pass costs the difference rather than the history, and a
bidirectional link cannot ping-pong.

**Absent and consequential: no NIP-42, no NIP-29.** No AUTH means **no gated reads** —
everything on the relay is world-readable, permanently. No relay-enforced groups means the
Buzz-style channel model is not reachable on this binary. Both constrain what may ever be
published here. One nuance (2026-07-29): upstream strfry **does** support NIP-42, so
enabling AUTH here is configuration work, not a software swap — NIP-29 is what genuinely
needs different relay software. See
[Roadmap §7](ROADMAP_AND_DEFERRED.md) for the trigger.

**Still true and deliberate — and unchanged by the metering layer (§6b, shipped
2026-08-05, not yet deployed):** x402 wraps the **index's**
HTTP API behind a paid gateway; the authoring relay itself gains no AUTH, no gated reads, no
member-only anything. Decision recorded 2026-08-05 in [Roadmap
§7](ROADMAP_AND_DEFERRED.md#7-gated-reads-nip-42) after considering NIP-42 as the metering
mechanism and rejecting it: the civic record STAYS public. NIP-42 remains a possible paid
*transport* later, not a paywall around the record.

## 2. Identity — wallet → npub

A Nostr key is secp256k1 **Schnorr/BIP-340**; an Ethereum address is not one, and an
ERC-4337 smart account has no key at all. So a Citizen's Nostr key is **derived** from a
signature their wallet makes over one fixed message:

```
"Netizen Nostr-Identität v1"  →  keccak256(signature)  →  secp256k1 key  →  npub
```

Deterministic, so the same wallet reproduces the same npub on any device, forever. The
message is **node-independent by design**: one wallet has one Nostr identity across every
Netizen node, which is the portable identity federation depends on. **Changing that string
re-keys every Citizen**, so it is pinned by a test.

**The private key never leaves the device.** It is cached in `expo-secure-store` and is never
sent to the node — on a world-readable relay, a node holding members' keys could impersonate
any of them. Content generated server-side publishes under the **agent's own** npub instead.

There is a migration shim, mirroring MACI's voting keys: once a key is persisted it is never
re-derived over, so a change in the smart-account implementation cannot silently orphan an
identity the relay already knows.

### The binding

Nobody has to trust that an npub was *derived* from a wallet — derivation is unverifiable
from outside. Instead **both keys attest to the same statement**: the wallet signs it
(ERC-1271, since Citizens hold smart accounts) and the Nostr key signs it inside a real
event. Two signatures over one string prove joint control.

Registration goes through the `nostr-identity-register` Edge Function, which verifies both
halves before writing. Verifying the Ethereum half *there* — not only in the syncer — is what
stops a griefing upsert knocking a Citizen off the allow-list.

## 3. Write access — membership, enforced

`packages/cli/policies/nostr-citizen-write/` gates writes; reads are open to everyone.
`@netizen-labs/relay-sync` keeps the allow-list in step with the chain: every pass it reads
the private wallet↔npub registry, verifies both halves of each binding, confirms the wallet
still holds a **CitizenNFTv2**, and atomically rewrites `members.txt`.

**Revocation is not a special case** — a wallet that no longer holds the NFT simply fails
verification and is absent from the next write.

**The fail-closed rule:** any registry or RPC failure aborts the pass and leaves the
allow-list untouched. Treating an error as "no members" would let one outage write an empty
file and revoke write access for the entire town. A stale allow-list is a far better failure
than an empty one.

### The registry is private, deliberately

`nostr_identities` is the schema's **one exception** to permissive RLS: RLS enabled with **no
policies**, plus an explicit REVOKE. Everywhere else the data is already public; here it maps
`wallet_address ↔ npub`, and the anon key ships inside the app bundle. A readable version
would hand anyone a bulk index linking every Citizen's Nostr activity to their Gnosis wallet,
and so to their MACI signup and Circles balance.

**Honest limit:** this protects the *bulk mapping*, not every inference. A Citizen who mirrors
public posts can still be correlated by matching content between the app feed and the relay.
What stays protected is the clean lookup table, and Citizens who register but never publish.

## 4. What is published

Two rails, distinguished by **who holds the key**:

- **Citizen-signed** (device-held keys, opt-in): kind 0 profiles and kind 1 feed posts —
  only data already public in the app. Nothing private, nothing personal, nothing paid.
- **Node-signed** (node-held per-organisation keys, since 2026-07-30): the public CMS
  datasets, mirrored by `@netizen-labs/publisher` (`services.publisher` in the manifest).
  Events and cinema as NIP-52 `31923`, organisation profiles as kind 0 — the cinema's
  screenings signed by the cinema's derived key, an org's events by that org's key. Three
  civic kinds round out the CMS datasets: town news as NIP-23 `30023` (`d=news:<uuid>`),
  restaurant menus as **kind `32101`** (one replaceable event per restaurant, `d=restaurant:<id>`),
  civic notices as **kind `32102`** (town-signed, a resolved alert is an edit, never a
  deletion), and governance proposals as **kind `32100`** — a discoverable pointer only, body
  stays on Irys and tallies stay on-chain. relay-sync merges the publisher's pubkeys into the
  allow-list each pass (`EXTRA_KEYS_FILE`). Details and the privacy boundary: [Public data on
  Nostr](PUBLIC_DATA_ON_NOSTR.md) §1.

On delete the app publishes a NIP-09 kind 5 request and says plainly in the UI that erasure
on Nostr is **advisory** — relays may ignore it, and clients that already fetched an event
keep it. That is why data which must be erasable never goes on the relay at all.

## 4a. Every event traces back to a wallet

The record is pseudonymous to read, attributable on demand — by design, and the mechanism
differs by rail:

- **Citizen-signed events** (posts, comments, likes, reposts): the Nostr key derives
  deterministically from one wallet signature, and registration stores a **mutual binding
  proof** — the wallet's ETH signature over `account=…\nnpub=…` plus the npub-signed binding
  event. Anyone holding both can verify the link cryptographically; neither can be forged
  alone. The registry (`nostr_identities`) is deliberately private, so the wallet↔npub mapping
  is *disclosable* (to the citizen themselves, or where legally required) rather than
  *broadcast* — publishing it would let anyone correlate a person's speech with their entire
  on-chain financial history, which is a decision only the citizen may take.
- **Node-signed events** (events, cinema, articles, listings): the signing scope names the
  owning organisation (`org-<account-id>`), and marketplace listings additionally carry the
  seller's own npub as a `p` tag — which chains back to their wallet via the same binding.
- **Backfed content**: a post arriving from a third-party client enters the app attributed to
  the **owner wallet** resolved through the binding — `posts.wallet_address` is the wallet,
  not a guess. An event by an unbound key is refused entirely: no binding, no attribution, no
  ingest.

What is deliberately NOT done: publishing per-event wallet signatures. The binding already
makes every event wallet-attributable transitively, and a smart account's ERC-1271 signature
cannot be verified offline anyway — it would fatten every event for a guarantee the binding
provides once.

## 4b. Multi-client interop — live 2026-07-30

The app dual-writes posts, comments (NIP-10 replies), likes (NIP-25 reactions, retracted via
NIP-09) and reposts (NIP-18, `q`-tag for quotes) to the relay, and the node's **backfeed**
ingests the reverse direction: kind 1/7 events by bound citizens, written in ANY Nostr client,
land in the app's own tables. `nostr_publications` is the dedupe ledger in both directions,
and a cutover fence keeps pre-ledger history out. Trust rules, each pinned by a test: bound
citizens only, agent-labelled events never enter the feed as people, unknown parents thread
nowhere.

## 5. Federation (NSP-9) — live 2026-07-28

Peers are **declared in the manifest** (`peers`: id, name, relay, kinds, why) and rendered by
the installer, so a contributor gets federation by editing a file. Declaring a peer *is* the
authorisation, and it is auditable in a git diff.

Relay URLs must be `wss://`, except that plaintext `ws://` is allowed for a host with no dot
— a container name or `localhost` — which cannot route off the machine. The rule is "never
plaintext across a network you do not control", not "always TLS": requiring public DNS and a
certificate for a same-host fixture would only push people toward disabling the check.

**Federated events land in a separate relay, never the authoring one.**

| | authoring relay | federation mirror |
|---|---|---|
| holds | this node's members' events | peers' public events |
| writes | members only — unchanged | rejected, read-only |
| filled by | citizens publishing | the local syncer only |

**Why**, and this was the discovery that shaped the design: **`strfry sync` enforces the
destination's write policy**, and the policy plugin **cannot tell a peer from a stranger** — a
synced event arrives as `{"sourceType":"IP4","sourceInfo":"<peer ip>"}`. There is no `Sync`
source type. Writing peers into the authoring relay would mean weakening the members-only
gate that relay exists to enforce.

**The mechanism:** one LMDB, **two configs**. The mirror's relay config installs a
reject-everything write policy; the syncer uses a second config over the same store with no
policy. A policy that blocks strangers would otherwise block the syncer too.

**Pull-only.** A node reads a peer's public record into its own mirror and never writes into
a peer's database. Each node decides what it ingests, and both ends still converge — so there
is no `direction` to configure.

Verified on the node, four properties: a peer event by an author Röbel has never heard of
lands in the mirror; the authoring relay still lacks that author; a direct push at the mirror
socket is refused; an unreachable peer does not abort the sweep.

**Bidirectional as of 2026-07-28.** Both nodes run from rendered manifests and each declares
the other as a peer, so each pulls the other into its own mirror. Neither writes into the
other. What is deliberately still missing is listed in
[Roadmap and deferred work](ROADMAP_AND_DEFERRED.md).

## 6. The index (slice 2) — live 2026-07-28

`@netizen-labs/indexer` reads this node's own relay **and** its federation mirror into
Postgres, and answers what relay filters cannot: full-text search, time ranges, per-author
history, and **provenance** — which node an event came from.

`GET /events?q=&kinds=&authors=&since=&until=&node=&limit=` · `GET /stats` · `GET /health`

**`/events` also takes `e`, `p` and `d` tag filters**, added 2026-08-02 for the fork-with-fallback
read path (§13a of the roadmap): `e`/`p` match via a GIN-indexed `tags @> …` JSONB containment
query (`idx_nostr_events_tags`), so replies and reactions to a given event or author are
queryable without a full scan; `d` filters on the `d_tag` column directly — the same column the
replaceable-event collapse ([Roadmap §13](ROADMAP_AND_DEFERRED.md)) already maintains — so a
client can ask for one stable record (a restaurant's menu, a proposal pointer) by its `d` tag
alone. This is what lets
`@netizen-labs/record-client` (and so a keyless `apps/web`) fetch a specific parameterised
replaceable event instead of paging through everything of a kind.

Public read by design. Everything in it came off world-readable relays, so publishing leaks
nothing new, and it is what lets a **peer's** agent query this node.

**The protocol is the source of truth; the index is a derived view.** Every row is a signed
event whose signature is re-verified on ingest rather than trusted from a peer, and the whole
store is rebuildable by re-reading the relays. Drop the database and nothing is lost — that is
what keeps query efficiency from turning into lock-in.

## 6a. Fork-with-fallback: the web app reads the index — live 2026-08-02

The other end of publishing is consuming. **`apps/web` now has a record-mode read path**: every
public route reads through `@netizen-labs/record-client` against a node's `/events` index
instead of PostgREST whenever Supabase credentials are absent, so a fork with no backend at all
still renders the town's real public record — read-only, slightly slower, same data. This closes
[Roadmap §13a](ROADMAP_AND_DEFERRED.md), previously the largest gap in §8/§9 below: until now,
publishing to the relay proved the record was *public*, not that an outside app could actually
*consume* it end to end.

The mechanism: the three Supabase client factories construct a throw-on-access `Proxy` when
keyless rather than crash on import, every public data-fetching function branches on
`hasSupabase` and falls back to the record-client, and `NEXT_PUBLIC_NODE_INDEX_URL` (default
Röbel's own `https://index.roebel.app`) is the one variable a fork sets to point at a different
node. A navy banner marks the instance read-only and every write affordance is hidden rather
than left to fail. [`apps/web/scripts/keyless-smoke.sh`](../apps/web/scripts/keyless-smoke.sh)
is the acceptance test — it builds and boots the app with the Supabase env genuinely absent and
asserts all 8 public routes return HTTP 200 with the record-mode notice present. See [Forking
Guide → Ohne Supabase starten](FORKING_GUIDE.md#ohne-supabase-starten-record-mode) for how to
run it yourself.

Scoped to `apps/web` only — Expo still requires Supabase env to run — and honest gaps remain:
roughly 60 of the ~127 `apps/web/src/app/api/**` handlers are unaudited for keyless behaviour
(a page rendering does not prove every API route it might call degrades gracefully), and
interaction counts (likes, comments, reposts) shown in record mode are advisory, reflecting
whatever the index last mirrored rather than a live tally.

## 6b. Metered access (x402) — slice 1 shipped 2026-08-05, not yet deployed

The free tier is **unchanged**: the relay stays world-readable, `/events` / `/stats` /
`/manifest` / `/media/<sha>` stay public and free. What is new sits in front of it as a
separate paid tier, not a wall around the existing one — `packages/gateway` puts three
metered endpoints on the same index host, path-routed by Caddy so the free API is untouched:
`/bulk/events` (keyset-paginated bulk query), `/export` (NDJSON stream) and `/firehose` (SSE,
sold as a 24h pass). Each request is a standard x402 handshake — 402, sign, retry — settled
by `packages/facilitator`, a self-run x402 facilitator (exact scheme, EIP-3009
`transferWithAuthorization`) rather than Coinbase's, because Gnosis is not on Coinbase's
facilitator network list (see [Roadmap §11](ROADMAP_AND_DEFERRED.md)).

**Where the money goes:** every paid response is logged (`access_ledger`, `serving_log`)
against the authors whose events it served, and a pro-rata `metering_accruals` view splits
the sale 50/50 between those authors and the community treasury — `payTo` is the
Gemeinschaftskasse Safe. A `/pay` page explains the handshake to a human, and
`/metering/stats` publishes the aggregate numbers so the split is legible, not just claimed.
An author can opt a pubkey out of monetisation entirely via
`strfry-policy/metering-excluded.txt`.

**Merged to `main`, not yet deployed to the live node.** Shipping it live still needs: the
`gateway`/`facilitator` builds copied as artifacts the way the indexer's is, a funded
`METERING_SETTLER_PRIV` (gas-only key) in the box `.env`, and a `netizen render` +
`netizen up` pass to pick up the new compose services and Caddy routes.

Design: [x402 metered data access
design](superpowers/specs/2026-08-05-x402-metered-data-access-design.md); implementation
plan: [slice 1](superpowers/plans/2026-08-05-x402-metering-slice1.md); code:
`packages/gateway`, `packages/facilitator`.

## 7. Agents on the record (slice 4) — live 2026-07-28

An agent has no wallet, so it cannot derive a key from a wallet signature the way a Citizen
does. `deriveAgentIdentity(nodeSecret, nodeId, name)` derives from a secret the **node** holds,
scoped by both node and agent: the same agent recovers the same npub after losing its state,
two agents on a node never collide, and *Mecky of Röbel* is a different identity from *Mecky of
another town* — different actors, which must not be able to speak for each other.

**Every agent event is labelled.** The kind 0 profile carries NIP-24 `bot: true`, and every
note carries a `netizen_agent` tag naming the agent and its node, so a single event is
self-describing without fetching the profile.

That labelling is the point, not a detail. A town's public record has to let anyone — human or
machine — tell *"a citizen wrote this"* from *"an AI generated this"*. An unlabelled agent in a
civic feed is indistinguishable from a resident.

Relay access is declared in `agents.a2a.relayPubkeys` and honoured by the syncer's
`alwaysAllow`. Adding a key by hand to `members.txt` does **not** work: the next sync pass
deletes it. Declaring it is the only durable path.

## 8. Not built
- **Agent workspace (slice 4)** — RESOLVED 2026-08-01, by a second relay rather than new
  relay software: the node now runs **stock block/buzz** at `buzz.roebel.app`
  (`services.buzz` in the manifest), whose own relay implements NIP-29 groups + NIP-42
  auth + NIP-43 membership. The civic strfry relay is deliberately unchanged — public
  record stays world-readable there; the workspace is the members-only plane. Channels
  are relay-gated, NOT E2EE (DMs inside Buzz are NIP-17 gift-wrapped). See the B-track:
  `docs/superpowers/plans/2026-08-01-buzz-b0-b1-deploy-and-identity.md`.
- **Metered access (x402) — slice 1 shipped 2026-08-05**, merged but not yet deployed to
  the live node. See §6b above. Still not built: the payout job, `/metering/stats` display
  names, Base/Stripe accept and a NIP-42 paid transport (see [Roadmap
  §11](ROADMAP_AND_DEFERRED.md)).
- **Onchain peer registry.** `peers` is shaped for a contract to populate it later.

## 9. Ecosystem check — 2026-07-29

A research pass against the July-2026 ecosystem
([full report](future-research/2026-07-29_NOSTR_OIDC_OPENDESK_LANDSCAPE.md)) confirmed the
architecture and produced a short adoption list:

- **NIP-77 is now a merged NIP** with implementations beyond strfry — our federation
  pattern is protocol-standard, not strfry-proprietary.
- **strfry 1.1.1** (2026-07-21) is out; we run 1.1.0. Update carries sync and stability fixes.
- **Adopt next:** NIP-65 relay lists + NIP-05 under `roebel.app` (without them, outbox-model
  clients — the 2026 majority — cannot discover this relay's content), NIP-52 for town
  events, Blossom for any Nostr-side media (NIP-96 is officially deprecated).
- **Deletion is now a duty, not a courtesy:** on our own relay NIP-09/NIP-62 requests must
  become real LMDB deletion, mirror included — the obligation and procedure live in
  [DSGVO_AI_ACT_COMPLIANCE](DSGVO_AI_ACT_COMPLIANCE.md) §2.1. **Built 2026-07-31, not yet
  deployed:** the installer now renders a vanish pipeline — `vanish-scan` (node: JSON
  parsing, NIP-62 addressing, NIP-09 ownership verification) feeding `vanish-exec`
  (strfry image: hex re-validation → `strfry delete`, both stores) over a durable queue
  volume. Ships with the next `netizen render/up`; the first run must confirm the
  installed strfry supports `delete` (the script logs it loudly).
- **No other municipality runs its own relay** as far as a targeted search could find —
  worth telling in funding applications.
- Nostr's network-wide usage is flat (~17k DAU): treat the relay as sovereignty
  infrastructure, not a reach channel; reach would come via Ditto/Mostr mirroring.

## 10. Where the code is

| | |
|---|---|
| `packages/nostr` | identity derivation, NIP-01 events, binding proof, relay client |
| `packages/relay-sync` | membership → allow-list, fail-closed |
| `packages/cli` | relay config, write policy, federation mirror + syncer |
| `apps/expo/lib/nostr/` | key custody, publishing, relay reads |
| `apps/expo/supabase/functions/nostr-identity-register/` | binding verification |

Specs: [identity bridge](superpowers/specs/2026-07-27-nostr-citizen-identity-bridge-design.md),
[NSP-9 federation](superpowers/specs/2026-07-27-nsp9-federation-design.md).
Runbook: [Nostr relay setup](NOSTR_RELAY_SETUP.md).
