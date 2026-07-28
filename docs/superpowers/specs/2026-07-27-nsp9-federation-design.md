# NSP-9 Federation — slice 1: two nodes, mirrored public record

**Date:** 2026-07-27
**Status:** approved design, implementation in progress
**Follows:** [Nostr Citizen identity bridge](2026-07-27-nostr-citizen-identity-bridge-design.md) (slice 1 of 4)
**Constrained by:** [`docs/future-research/2026-07-27_DATA_SOVEREIGNTY_AND_MARKETPLACE.md`](../../future-research/2026-07-27_DATA_SOVEREIGNTY_AND_MARKETPLACE.md)

---

## 0. Why this slice

The end goal is a network of independent sovereign nodes trading data so that humans and
agents can make better-informed, better-coordinated decisions. The identity bridge made a
node's public record **portable and verifiable**. This slice makes it **reach another node**.

Everything else in the federation story — metered access, an on-chain registry, cross-node
anonymity sets — has the same unmet prerequisite: **more than one node**. Several threads in
the research converge on it ("cross-node anonymity sets… do not work at n=1"; "publish the
concentration ratio once node #2 exists"). So node #2 is the deliverable, not a detail.

## 1. Scope

**In.** Two independent Netizen nodes, each with its own manifest, relay, and member set,
mirroring each other's **public civic events** over NIP-77 negentropy. Peers are declared in
the manifest and rendered by the installer.

**Out**, each deferred deliberately:

| Deferred | Why |
|---|---|
| x402 metered access | Needs a self-run facilitator on Gnosis + the Permit2 path (EURe lacks EIP-3009, verified on-chain). Its own slice. |
| On-chain peer registry | A contract to write, deploy and govern. The schema below is shaped so it can populate `peers` later without redesign. |
| Identity federation | Recognising another node's members is a different question from exchanging content. |
| Transitive relaying | Whether a node re-exports what it mirrored is a real policy decision, not something to let emerge by accident. |
| Anything private, personal or paid | Under GDPR a citizen's consent is revocable at any time, so "permanent access sold" is undeliverable. Public civic signal only. |

**Success condition.** An event published by a member of node #2 appears on Röbel's relay, and
vice versa — verified with an unrelated client (`nak`) against both relays independently.

## 2. Node #2

A second full node in containers **on the same box**: its own relay, manifest, member list and
policy. Federation is a property of configuration and keys, not of hosting, so two separate
relays with separate member sets exercise the protocol honestly.

It is also the permanent test fixture for every future federation change. An open-source
contributor will stand up a genuinely independent node later — which is the real validation,
and the reason every part of this must be **reproducible from a manifest** rather than
hand-wired. Nothing here may require copying commands out of a chat log.

## 3. Manifest schema — top-level `peers`

```json
"peers": [
  {
    "id": "testnode",
    "name": "Netizen Test Node",
    "relay": "wss://relay.example.app",
    "kinds": [0, 1],
    "direction": "both",
    "why": "Federation test fixture"
  }
]
```

**Top-level `peers`, deliberately not inside `identity.federation`.** That block already means
OIDC trusted issuers — *who may log in*. Which nodes exchange data is a different question, and
two things called "federation" in one manifest is a trap for the next reader.

- `kinds` — the event kinds this link carries. Absent means none; there is no implicit "all".
- `direction` — `both` | `down` (pull only) | `up` (push only).
- `why` — **required**, human-readable. A trust decision with no stated reason is one nobody can
  review later, and this is the file a contributor reads to understand who Röbel talks to.

A future `peerRegistry` field can name a contract that populates the same shape, so adopting
on-chain discovery later is additive.

## 4. The sync service

`netizen render` emits a `federation` compose service that loops over declared peers, running
`strfry sync <relay> --dir <direction>` with a kind filter, on an interval. Negentropy transfers
only the set difference, so cost stays proportional to what changed, not to history.

Pull-based, like the allow-list syncer: **outbound connections only**, no new inbound surface on
the node.

## 5. RESOLVED — sync enforces the write policy, so peers land in a separate mirror

**Verified on the box 2026-07-28. The assumption in the first draft was wrong.**

`strfry sync` **does** enforce the destination's write policy. Negentropy transported the event
correctly (`Have 0 need 1` → `DOWN: 1 events`), and the writer then rejected it:

```
write policy blocked event 33a34b4b…: blocked: only Röbel / Müritz members may publish
Writer: added: 0
```

Worse for the original fallback: the plugin cannot tell a peer from a stranger. A synced event
arrives as `{"sourceType":"IP4","sourceInfo":"<peer ip>","type":"new"}` — from the receiving
relay's view a syncing peer is just another WebSocket client. Author allow-lists would need a
roster-exchange mechanism that does not exist, and would still dilute the members-only guarantee.

**The design instead: each node runs a second, separate relay — the federation mirror.**

| | authoring relay | federation mirror |
|---|---|---|
| holds | what this node's own members wrote | peers' public events |
| writes | members only (CitizenNFT gate, unchanged) | rejected — read-only to the world |
| filled by | citizens publishing | the local syncer only |

The two share nothing. The authoring relay's guarantee — *only Röbel members publish here* —
stays absolutely true, because federation never writes to it.

**The mechanism that makes a read-only-but-writable store possible:** one LMDB, two configs.
The mirror's relay config installs a reject-everything write policy; the syncer uses a second
config over the same store with no policy at all. A policy that blocks strangers would otherwise
block the syncer too, since both arrive as ordinary IP4 writes.

**Federation is pull-only.** A node reads a peer's public record into its own mirror and never
writes into a peer's database. Each node decides what it ingests, and both ends still converge on
the same set — so `direction` disappears from the schema entirely.

## 6. Loops and provenance

Negentropy reconciles **sets**, so bidirectional sync is idempotent and cannot ping-pong: an
event either exists in the store or it does not. No sequence numbers, no echo suppression.

Transitive relaying is out of scope (§1) and must stay explicitly out until decided.

## 7. Testing

- **Unit** — manifest schema accepts a valid `peers` block and rejects a malformed one; render
  emits one sync invocation per peer with the right direction and kind filter; a node with no
  `peers` gets no federation service at all.
- **Integration**, on the box — VERIFIED 2026-07-28, four properties:
  1. a peer event by an author Röbel has never heard of lands in the mirror (`added: 3`)
  2. the authoring relay is untouched — that author is still absent from it
  3. a direct push at the mirror socket is refused (`write policy blocked … read-only`)
  4. an unreachable peer logs and the sweep continues
- **Manual** — read a federated event with `nak` against the receiving relay and verify its
  signature, exactly as the identity bridge was verified.

## 8. What this leaves for later

`peers` is shaped for a registry to populate. Negentropy is proven between two real relays, so
adding a third node is configuration rather than engineering. And once nodes demonstrably
exchange a public record, metered access has something concrete to meter — which is the point at
which the x402 facilitator slice becomes worth its cost.
