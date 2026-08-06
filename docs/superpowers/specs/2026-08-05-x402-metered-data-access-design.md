# x402 Metered Data Access + Author Revenue Share — Design

**Date:** 2026-08-05
**Status:** APPROVED — slice 1 implemented (see docs/superpowers/plans/2026-08-05-x402-metering-slice1.md)
**Scope:** Netizen stack feature, dogfooded on the Röbel node
**Related:** `docs/ROADMAP_AND_DEFERRED.md` §7 (gated reads), §11 (x402 facilitator), §12 (data-sale legality); `docs/STATE_OF_NOSTR.md`; `docs/future-research/2026-07-27_DATA_SOVEREIGNTY_AND_MARKETPLACE.md`; NSP-9 federation spec; NSP-12 decision record spec

## 1. Vision and decision trail

The community record should earn for the people who write it. Today every
event on `relay.roebel.app` and `index.roebel.app` is world-readable and free
at any scale; the value of machine-scale consumption (AI agents, crawlers,
commercial apps) accrues entirely to the consumer.

This design meters **machine-scale access** to the record and splits the
revenue between the **authors of the data** and the **community treasury**
(Gemeinschaftskasse Safe). It is the X.com API model with one structural
difference: the platform does not keep 100% — the split to authors is
protocol-level, automatic, and publicly legible. That legibility is the
network-effect pitch for every community that adopts the Netizen stack.

### Rejected: private-by-default (NIP-42 walls around the record)

Considered and rejected in-session, for three reasons already documented in
this repo:

1. **No exclusivity on signed events.** Nostr events are self-verifying; any
   paying customer or federation peer can re-serve everything fetched. What is
   sellable is freshness, completeness, and bulk convenience — not secrecy.
   Promising citizens "your posts are private now" when any member or €1
   payer can leak them would be a false privacy promise.
2. **EU law.** Personal data cannot be sold with irrevocable effect
   (roadmap §12). Metering machine access to an already-public record — with
   authors as beneficiaries — is the defensible position; a paywall around
   citizens' posts is not.
3. **It breaks the stack's own architecture:** fork-with-fallback (keyless
   apps read the public index), NSP-9 federation (declared peers pull
   freely), and the NSP-12 *Public* Decision Record.

The roadmap's standing note — "gated reads: treat with suspicion" — survives
this design intact. NIP-42 appears only in a deferred, additive role (§7).

### Chosen: metered gateway, free record, author split

Approach C from the session: build the HTTP metering gateway now (the
indexer's own comment anticipated this: "Metering, when it comes, wraps this
rather than replacing it"); roadmap a Nostr-native NIP-42 paid socket with a
demand trigger.

## 2. Principles

- **P1 — Free at human scale.** Reading the record as a person, a forked
  app, or a declared federation peer stays free, forever. Only scale pays.
- **P2 — Paying is near-frictionless.** No signup, no sales call: one
  request, one 402, one signed payment, data flows. Launch prices are
  symbolic (cents). The free tier is generous enough that no human or small
  app ever hits the wall. Adoption comes before revenue — the project must
  scale no matter what.
- **P3 — Individuals earn.** Every paid response logs which authors' events
  were served; the author share splits pro-rata and pays out in real money
  (EURe), not scrip. Ownership-as-control (device-held keys, exit, vanish)
  already exists; this adds ownership-as-earnings.
- **P4 — Everything into the installer.** The feature ships as manifest
  config + rendered services. A fresh Netizen community node gets the earn
  loop out of the box.
- **P5 — The public record stays public.** The paid tier serves the same
  already-public events; deletions and vanish apply identically. Nothing
  previously private is exposed, and nothing public becomes private.
- **P6 — Identity display.** Accruals and payouts are shown by display name
  or npub — never raw wallet addresses.

## 3. Product surface

### Free tier (unchanged in substance, limits made explicit)

- Relay reads on `wss://relay.roebel.app` — untouched.
- Index API `/events`, `/stats`, `/manifest`, `/media/<sha>` — unchanged. The
  existing per-query `limit` cap (`MAX_LIMIT = 200`) is the slice-1 free-tier
  boundary; per-IP rate limiting (e.g. 60 req/min) is deferred until abuse is
  observed (Caddy has no built-in rate limiter — it needs a plugin or a
  gateway proxy, neither worth building speculatively; P2 wants the free tier
  generous anyway).
- NSP-9 federation sync for declared peers — untouched, free.
- Backfeed, agent-watcher, publisher — untouched.

### Paid tier — three gateway endpoints

| Endpoint | What | Pricing unit (defaults, manifest-tunable) |
|---|---|---|
| `GET /bulk/events` | Same query grammar as `/events`, `limit` up to 10 000, cursor pagination | €0.50 per 1 000 events |
| `GET /export/<dataset>` | Full-history NDJSON dump per dataset (events, articles, marketplace, …) | €5 per dump |
| `GET /firehose?since=` | SSE stream of new events as ingested | €1 per 24 h pass |

Defaults are placeholders; real numbers are an open question (§11). All
prices start symbolic per P2.

Unpaid requests receive `402 Payment Required` with:
- machine-readable x402 V2 `accepts` array (all currently-live rails), and
- a human-readable `Link` header + JSON field pointing to a "how to pay"
  docs page.

Paid endpoints are listed in x402 discovery (Bazaar) so agents find them
without prior knowledge of Röbel.

## 4. Payment layer

### Rails (as open as possible — multichain, crypto, fiat)

All rails pay **directly** into the Gemeinschaftskasse on the chain where
the payment happens. No sweeping. Making the GK multichain (deploying the
Safe on Base, etc.) is **Max's task** and gates the corresponding accept.

| Rail | Slice | Mechanism |
|---|---|---|
| Gnosis (own facilitator) | 1 | `packages/facilitator`: self-run x402 verify+settle service on the node. Token: **USDC.e on Gnosis if the EIP-3009 probe passes** (probe method identical to the 2026-07-27 EURe probe), **else EURe via Permit2 two-step**. `payTo` = GK Safe `0x3A08c86Efc5ff38CC35d850F1D4d564e497bFDEa`. |
| Base USDC (Coinbase facilitator) | 2 | Added to the `accepts` array the moment the GK exists on Base. Zero extra ops. |
| Stripe fiat (API keys) | 3 | Reuse the donations Stripe checkout; a purchased key is presented as `Authorization: Bearer <key>` instead of `X-PAYMENT`. Stripe revenue reaches the GK via the existing Monerium IBAN → EURe path. |
| Solana | deferred | Safe is EVM-only; waits for a Solana treasury. Roadmap entry. |

### Facilitator notes

- Small HTTP service (verify + settle), one container among the node's
  others; rendered from the manifest like everything else.
- Constraints already established: Gnosis is not on Coinbase's facilitator
  network; EURe has no EIP-3009 (`permit` only); Circles CRC is ERC-1155 and
  cannot settle.
- Facilitator downtime degrades gracefully: its accept drops out of the 402;
  other rails remain (§8).

## 5. Metering, ledger, payout

### Tables (indexer Postgres)

- `access_ledger` — one row per paid request: timestamp, endpoint, payer
  identity (chain + address, or API-key id), amount, currency, settlement tx
  reference.
- `serving_log` — ledger row → author pubkey → events-served count.

### Author attribution

Event pubkey resolves to a beneficiary:
- citizen key → wallet via the `nostr_identities` binding;
- org key (`deriveOrgIdentity` scope) → the organisation's account;
- town/agent keys → treasury (their share simply stays in the GK).

### Split

Manifest-configured, validated to sum to 100. Default:
`metering.split = { authors: 50, treasury: 50 }`.

### Payout job (slice 2)

Monthly cron container: aggregate `serving_log` pro-rata per author →
shares above a €1 dust threshold → **propose one batched EURe Safe
transaction** from the GK (the job cannot self-execute against a 3-of-5
Safe; it proposes exactly as the admin dashboard's `useProposeMetaTx` does,
owners confirm). Sub-threshold amounts accrue to the next round. The ledger
accounts from day one (slice 1) so the first payout is retroactively
complete.

### Consent and anonymity (added 2026-08-05 after review question)

An individual can stay completely out of this system, in layers:

1. **Being on the record is already opt-in** — a citizen without a Nostr
   binding publishes nothing and has nothing here to meter.
2. **On the record, identity is pseudonymous** (npub + self-chosen profile);
   no part of this design adds linkage on its own.
3. **Earning is claim-based.** Accruals are computed per npub from
   already-public data. The npub→wallet resolution and the payout happen
   only when the citizen actively claims their earnings in the app; a
   payout is an on-chain transfer and therefore a deliberate, revocable
   step out of pseudonymity. Unclaimed accruals roll to the treasury after
   12 months (manifest-tunable).
4. **Monetization opt-out.** A citizen can exclude their npub entirely:
   excluded authors' events are dropped from `/bulk`, `/export` and
   `/firehose` and never appear in `serving_log`. Their events remain on
   the free public record (they are public either way) but never
   participate in the paid product. The exclusion list lives beside the
   relay allow-list machinery and is enforced in the gateway's queries.

### Transparency

Public `GET /metering/stats`: total revenue, split percentages, amounts paid
out, per-author accruals — authors shown by display name/npub, never raw
addresses (P6). This page is the proof behind the pitch: "when anyone pays
to read this community's record, the money flows to the people who wrote
it."

## 6. Manifest + installer

- New optional top-level `metering` block in `packages/protocol`'s manifest
  schema: `{ enabled, prices, split, rails, freeTier: { rpm, maxLimit } }`.
- `netizen render` emits: gateway container, facilitator container, payout
  cron (slice 2), and Caddy routes — paid paths (`/bulk`, `/export`,
  `/firehose`, `/metering`) route to the gateway on the same index host; the
  free indexer API keeps its existing routes and behavior.
- `examples/roebel.netizen.json` dogfoods the block (and per the standing
  rule, `packages/cli` tests run when the example changes).
- The known preset gap (presets declare no relay/publisher/indexer services)
  is fixed in the same slice so a preset node ships the earn loop.

## 7. Non-goals (explicit)

- No NIP-42 on the civic relay; no private-by-default; no per-kind privacy
  tiers.
- Federation stays free for declared peers (declaring the peer IS the
  authorisation).
- No paid writes yet — the policy README's "x402 paid-write for external
  agents" idea goes to the roadmap.
- No instant per-request on-chain splits (dust + gas + ops).
- No selling of personal data — this meters machine access to an
  already-public record, with authors as beneficiaries.
- **Deferred with trigger** (add to `ROADMAP_AND_DEFERRED.md`): Nostr-native
  paid transport — a NIP-42 AUTH'd read socket for paying customers.
  Trigger: a real customer asks for raw Nostr protocol access. The 402
  pricing metadata and ledger design are transport-agnostic so this becomes
  additive.

## 8. Failure modes

- **Facilitator down** → its accept is omitted from 402 responses; other
  rails still offered; alert fires.
- **Payment verification** is fail-closed: no data on unverifiable payment.
- **Ledger write failure** is fail-open: a paid request is always served
  (never charge without delivering); the settlement tx on-chain allows
  reconciliation; loud error log.
- **Settle-after-serve race:** verify precedes serving; settlement is
  submitted before the response body streams. If settlement ultimately
  fails after verify passed, the event is logged for reconciliation — an
  accepted, bounded risk at cent-scale prices.
- **Rate-limit + 402 interplay:** free-tier limits return `429` with a
  pointer to the paid endpoints — the upsell is the error message.

## 9. Testing

- Facilitator verify/settle unit tests against fixtures (valid payment,
  wrong amount, wrong token, replayed authorization).
- Gateway integration test: full 402 → pay → 200 handshake against a local
  facilitator on a fork/test chain.
- Split math property tests: shares sum exactly to revenue, dust threshold
  behavior, determinism across runs.
- Render tests for the `metering` block, following the
  `packages/cli/test/federation.test.ts` pattern; example-manifest fixture
  updated (standing rule: every rendered service needs one).
- Free-tier regression: `keyless-smoke.sh` still passes — fork-with-fallback
  must be provably unaffected.

## 10. Slices

1. **Slice 1 — the meter and the money socket:** gateway (3 paid endpoints,
   free-tier limits, 402 multi-accept), Gnosis facilitator, USDC.e probe
   (fallback EURe/Permit2), `access_ledger` + `serving_log`, manifest block +
   render + Caddy, discovery listing.
2. **Slice 2 — the earn loop closes:** payout cron (Safe proposal batch),
   `/metering/stats` transparency page, Base-USDC accept (gated on Max's
   multichain GK).
3. **Slice 3 — fiat:** Stripe checkout for API keys, key auth on the
   gateway.
4. **Roadmap:** NIP-42 paid socket (trigger above), x402 paid writes,
   Solana rail.

Each slice gets its own implementation plan.

## 11. Open questions

1. ~~**USDC.e on Gnosis: EIP-3009?**~~ **RESOLVED 2026-08-05 — probe
   PASSED.** `0x2a22f9c3b484C3629090FeED35F17Ff8F88f76F0` ("Bridged USDC
   (Gnosis)", 6 decimals) sits behind a non-EIP-1967 proxy
   (`implementation()` → `0x107CF7fb73EA48D1D200989b156Ce1894d7AfEC7`); the
   implementation bytecode contains `transferWithAuthorization` (both
   overloads), `receiveWithAuthorization`, `authorizationState`, and
   `permit`. EIP-712 domain: name `Bridged USDC (Gnosis)`, version `2`,
   chainId 100. Slice 1 settles USDC.e via the standard x402 `exact`
   scheme — no Permit2 fallback needed. (Lesson: probe via
   `implementation()`, not only the EIP-1967 slot.)
2. **Real prices** for bulk/export/firehose — defaults above are
   placeholders; P2 says start symbolic.
3. **Firehose pass duration** (24 h default) and whether `/export` dumps are
   cached/rate-limited per payer.
4. **GK multichain rollout order** (Max's task): Base first? Which else?
5. **Org share routing:** does an organisation's author-share pay to the
   org's own account/wallet, or accrue in the GK earmarked? (Slice-2
   decision; slice 1 only records attribution.)
