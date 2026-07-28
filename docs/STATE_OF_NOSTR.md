# State of Nostr

**Last verified: 2026-07-28**, against the running relays. Part of the
[documentation index](README.md); see also
[State of the Netizen Stack](STATE_OF_THE_NETIZEN_STACK.md) and
[State of the Netizen Node](STATE_OF_THE_NETIZEN_NODE.md).

Nostr is how a Netizen node's **public record leaves the node**: signed by its members,
readable by any client in the world, and mirrored between nodes. It is no longer an R&D bet —
it is live, with citizens publishing from the app.

The original four-part decomposition: **identity bridge → query layer → federation → agent
workspace**. Parts 1 and 3 are built. Parts 2 and 4 are not.

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
published here.

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

Opt-in per Citizen, and only data **already public in the app**: kind 0 profiles and kind 1
feed posts. Nothing private, nothing personal, nothing paid.

On delete the app publishes a NIP-09 kind 5 request and says plainly in the UI that erasure
on Nostr is **advisory** — relays may ignore it, and clients that already fetched an event
keep it. That is why data which must be erasable never goes on the relay at all.

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

## 6. Not built

- **Indexer (slice 2).** Queries are relay filters today, which covers chronological feeds
  by kind + author + time. Search, threading and aggregation need an indexer.
- **Agent workspace (slice 4).** Agents as first-class relay members. Blocked in part by the
  missing NIP-29.
- **Metered access (x402).** Needs a self-run facilitator on Gnosis — see
  [State of the Netizen Stack](STATE_OF_THE_NETIZEN_STACK.md) §5.
- **Onchain peer registry.** `peers` is shaped for a contract to populate it later.

## 7. Where the code is

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
