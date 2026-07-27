# Nostr Slice 1 — Citizen identity bridge + public feed mirror

**Date:** 2026-07-27
**Status:** approved design, implementation in progress
**Parent plan:** [`docs/NOSTR_AGENT_ECOSYSTEM_PLAN.md`](../../NOSTR_AGENT_ECOSYSTEM_PLAN.md) §2 + §3 phases 1–2
**Read alongside:** [Nostr relay setup](../../NOSTR_RELAY_SETUP.md),
[write policy](../../../packages/cli/policies/nostr-citizen-write/README.md),
[chat-protocol decision](../../future-research/2026-07-26_CHAT_PROTOCOL_DECISION.md)

---

## 0. Why this slice

The end goal is a scalable network of independent sovereign nodes that trade data with each
other, so that humans and AI agents can make better-informed, better-coordinated decisions.
That goal decomposes into four independent subsystems: **identity bridge**, **query layer**,
**federation**, **agent workspace**. This spec is the first — and it is the hard gate, because
until Citizens can write to the relay, none of the others have anything to operate on.

### The state this starts from (verified 2026-07-27)

| Fact | Consequence |
|---|---|
| `wss://relay.roebel.app` live (strfry 1.1.0, NIPs 1,2,4,9,11,28,40,45,70,77) | Data plane exists |
| `citizens.txt` allow-list **empty** | **Nobody can write.** The relay is live but functionally read-only |
| **NIP-42 absent** | No AUTH → no gated reads. Everything published is world-readable |
| **NIP-29 absent** | No relay-enforced groups; the Buzz-like channel model is not reachable on this binary |
| **NIP-77 negentropy present** | Cross-node set reconciliation exists natively — the federation phase inherits a working sync primitive |
| Zero Nostr code in `apps/expo` / `apps/web` | The identity bridge of plan §2 is unbuilt |
| `renderStrfryConf` emits `writePolicy { plugin = "" }` | **Config drift**: a `netizen up` re-apply would un-gate the live relay |

## 1. Scope

**In scope.** Citizens derive a Nostr identity from their wallet; the CitizenNFT allow-list
populates itself from on-chain ownership; kind 0 profiles and kind 1 public feed posts are
dual-written to the relay; the app reads them back directly off the relay.

**Out of scope**, each deferred to its own spec: the indexer, federation/peers, x402 metering,
NIP-29 groups, NIP-42 read-auth, agent npubs, media → Blossom, retiring any Supabase table,
and reactions / comments / events / stories.

**Success condition.** A Citizen posts in the app, and an unrelated Nostr client anywhere in
the world reads that post, signed by them, off Röbel's own relay.

## 2. Decisions

| Decision | Choice | Why |
|---|---|---|
| First data class | kind 0 profiles + kind 1 feed posts | Already public, highest volume, exercises the whole loop |
| Key custody | **Client-held.** Derived on device, cached in SecureStore, never leaves it | The node must not be able to impersonate a Citizen on an open relay |
| Server-generated content | Publishes under the **agent's own** npub, never the human's | "Agents are members, not tools" — and it is the only honest option given client-held keys |
| Indexer | **Deferred.** Read the relay directly | A chronological feed by kind + author + time is exactly a relay `REQ` filter. Build the indexer when filters genuinely fall short (search, threads, cross-node), specced against real events |
| Allow-list | **Pull-based syncer on the box** | No new inbound surface on the node; revocation falls out of the same pass |
| Registry visibility | **Private** | See §4.1 — a public mapping would deanonymize wallets |
| Derivation message | **Node-independent** | One wallet = one npub across every Netizen node: the portable identity the federation phase needs |
| App surface | **expo only** | Publishing happens in the mobile app; the package is isomorphic so web is cheap later |
| Consent | **Opt-in per Citizen** | Publishing to a public append-only log is irreversible in practice |

## 3. `@netizen-labs/nostr` — the shared package

Isomorphic, no app coupling, dependencies limited to `@noble/curves`, `@noble/hashes`,
`@scure/base`. No `nostr-tools`: NIP-01 is JSON over WebSocket, and a small explicit client
keeps the package dependency-light and React-Native-safe.

- **`deriveNostrSecretKey(signature)`** — `keccak256(signature)` reduced into the secp256k1
  field → BIP-340 x-only public key. Deterministic: the same wallet yields the same npub on
  every device, forever.
- **Canonical derivation message** — `"Netizen Nostr-Identität v1"`, deliberately **without**
  a node name, so one wallet has one Nostr identity across all Netizen nodes.
- **`buildBindingEvent()` / `verifyBinding()`** — the mutual proof. The wallet signs a
  statement naming the npub; the Nostr key signs a **real Nostr event** naming the wallet.
  Making the Nostr side a genuine signed event (not a bare signature) keeps the relay-native
  bootstrap path open later with no redesign.
- **`buildProfileEvent()` (kind 0), `buildNoteEvent()` (kind 1), `buildDeletionEvent()` (kind 5)**
- **`signEvent()` / `verifyEvent()`** — NIP-01 id = sha256 of the canonical serialization;
  signature = BIP-340 Schnorr over that id.
- **`npubEncode()` / `npubDecode()`** — NIP-19 bech32.
- **`RelayClient`** — minimal `EVENT` / `REQ` / `CLOSE` over WebSocket, with `publish()` and
  `query()`.

**Migration shim (mirrors MACI).** Once a key is persisted it is **never** re-derived over.
If the smart-account implementation ever changed, the signature — and therefore the npub —
would change; the shim is what stops that silently orphaning an identity.
Precedent: [`MaciContext.tsx:312-335`](../../../apps/expo/context/MaciContext.tsx).

## 4. Registry + syncer

### 4.1 `nostr_identities` (Supabase) — private

Columns: `wallet_address` (lowercase), `pubkey_hex`, `npub`, `eth_signature`,
`binding_event` (jsonb), `created_at`, `revoked_at`, `last_verified_at`.

**The table is not publicly readable.** This schema does not use Supabase Auth for RLS —
every other table carries a permissive `USING (true)` policy, because auth is thirdweb wallets
and the anon key has direct table access. Following that pattern here would publish the
registry. So this table is the deliberate exception: **RLS enabled with no policies at all**,
plus an explicit `REVOKE`, leaving only `service_role` (which bypasses RLS) able to touch it.

The reason is that the registry maps `wallet_address ↔ npub`, and the anon key ships inside
the app bundle — a readable version would hand anyone a bulk index linking every Citizen's
Nostr activity to their Gnosis wallet, and therefore to their MACI signup and Circles balance.
That inverts the project's "never show wallet addresses" rule.

**Honest limit:** this protects the *bulk mapping*, not every individual inference. A Citizen
who dual-writes public posts can still be correlated by matching post content between the app
feed and the relay. What stays protected is the clean lookup table, and the identities of
Citizens who register but never publish. The consent copy in the app says so plainly.

**Write path:** the app cannot insert directly, so registration goes through the
`nostr-identity-register` Edge Function (service role), which verifies **both** halves of the
binding before writing. Verifying the Ethereum half there — not only in the syncer — is what
stops a griefing upsert: otherwise anyone could overwrite a Citizen's row with a binding made
by their own Nostr key naming the victim's wallet, and knock the victim off the allow-list.

### 4.2 `@netizen-labs/relay-sync` — runs on the node

Published like the existing `@netizen-labs/*` packages and run on the box as a compose
service (`npx -y @netizen-labs/relay-sync`, loop interval configurable, default 5 min).
Each pass:

1. Fetch the registry with a **scoped service key** (never the anon key).
2. Verify the binding event's Schnorr signature offline, and that its content names the wallet.
3. Verify the wallet signature via **ERC-1271 `isValidSignature`** — Citizens hold ERC-4337
   smart accounts, so this is an `eth_call`, not an `ecrecover`.
4. Verify `CitizenNFTv2.balanceOf(wallet) > 0` on Gnosis.
5. Write `citizens.txt.tmp` and atomically `mv` it into place — same directory, so the
   directory-mount inode fix continues to hold.

**Fail-closed rule.** Any fetch or RPC error aborts the pass without touching `citizens.txt`.
Otherwise a single Supabase outage would write an empty allow-list and revoke write access for
the entire town. Revocation is the same code path: lose the NFT, lose the line, within one
interval.

**Box secrets added:** `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `GNOSIS_RPC_URL`.

## 5. App integration (expo)

- **Settings → "Nostr-Identität"** — opt-in. Shows the npub, a status
  (`registriert` → `wartet auf Relay-Zugang` → `aktiv`), and plain-German copy stating that
  published events are public and effectively permanent.
- **Post creation** — after the Supabase insert succeeds, best-effort sign + publish kind 1.
  Failure never blocks the user and never surfaces as an error. A `nostr_publications` row
  records `(source_type, source_id, event_id, status)` for parity checking and later retry;
  a separate table rather than columns on `posts`, so events/stories/comments generalize
  later without another migration.
- **Read-back view** — subscribes to the relay with `{kinds:[0,1], authors:[…]}` and lists
  what is genuinely there. This is the verification surface, **not** a production read path:
  Supabase remains the app's read path throughout this slice.

## 6. Privacy posture

Opt-in per Citizen, and only data that is **already public in the app** (display name, avatar
URL, bio; public feed post text and media URLs). On delete, publish a NIP-09 kind 5 and state
honestly in the copy that erasure on Nostr is advisory — relays may ignore it.

Account deletion ([`supabase-account-deletion.ts`](../../../apps/expo/lib/supabase-account-deletion.ts))
must also emit kind 5 deletions and drop the allow-list line. Otherwise "delete my account"
leaves signed events on a public relay — the GDPR exposure plan §5 warns about.

## 7. Testing

- **Derivation** — determinism (same signature → same npub), field reduction, npub round-trip.
- **Events** — NIP-01 id and signature verified against known vectors; kind 0/1/5 shapes.
- **Binding** — verifies in both directions; rejects a mismatched wallet, a tampered event,
  and a bad signature.
- **Syncer** — mocked RPC and registry: valid/invalid signature, holds/does-not-hold the NFT,
  revocation removes the line, and **the fail-closed path leaves the file untouched**.
- **Render** — `strfry.conf` contains the plugin line when the manifest declares a write policy.
- **Integration** — manual checklist against the live relay (needs the box).

## 8. Config drift — resolved upstream

The drift identified at the top of this spec (`renderStrfryConf` emitting an empty
`writePolicy`) was **fixed independently in `53bc182`** while this slice was being built.
`netizen render` now ships the whole `strfry-policy/` directory — `policy.awk`,
`write-policy.sh`, `members.txt`, `add-member.sh` — mounts it read-only in compose, and points
`strfry.conf` at the plugin. No further CLI change is needed here.

One consequence to track: the installer standardizes on **`members.txt`**, while the currently
live Röbel box predates that and reads `citizens.txt`. `@netizen-labs/relay-sync` therefore
defaults to `/etc/strfry/members.txt` and takes an `ALLOWLIST_PATH` override for the live box
until it is re-applied from a fresh bundle.

## 9. What this leaves for the federation phase

The npub is node-independent (portable identity), the binding is already a publishable event
(relay-native bootstrap needs no redesign), and the syncer is a generic Netizen package rather
than a Röbel script. Combined with the relay's NIP-77 negentropy support, cross-node sync has
a working primitive waiting whenever the federation spec is written.
