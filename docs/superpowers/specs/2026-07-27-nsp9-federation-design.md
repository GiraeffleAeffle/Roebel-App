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

## 5. The load-bearing risk, and its fallback

**Does `strfry sync` bypass the relay's write policy?**

Röbel's policy admits only CitizenNFT holders listed in `members.txt`. A peer's events are
authored by *their* citizens, who are not in that list. If sync writes are subject to the
policy, **every federated event is rejected and this slice does not work at all**.

The expectation is that `sync` writes directly to the LMDB store and bypasses the plugin, which
governs the relay's WebSocket ingress. **This is unverified.** It is therefore step one of
implementation, before anything else is built — this session has twice paid for an assumption
that looked obviously true.

**Fallback if the policy does apply:** extend `policy.awk` to accept an author present in
`members.txt` **or** in a rendered `federated.txt` of peer member pubkeys. Tractable, but it
changes the shape of the work, which is precisely why it is tested first.

## 6. Loops and provenance

Negentropy reconciles **sets**, so bidirectional sync is idempotent and cannot ping-pong: an
event either exists in the store or it does not. No sequence numbers, no echo suppression.

Transitive relaying is out of scope (§1) and must stay explicitly out until decided.

## 7. Testing

- **Unit** — manifest schema accepts a valid `peers` block and rejects a malformed one; render
  emits one sync invocation per peer with the right direction and kind filter; a node with no
  `peers` gets no federation service at all.
- **Integration**, on the box — publish on node #2, assert it appears on Röbel's relay; assert a
  kind **not** declared on the link does **not** cross; assert re-running sync is a no-op.
- **Manual** — read a federated event with `nak` against the receiving relay and verify its
  signature, exactly as the identity bridge was verified.

## 8. What this leaves for later

`peers` is shaped for a registry to populate. Negentropy is proven between two real relays, so
adding a third node is configuration rather than engineering. And once nodes demonstrably
exchange a public record, metered access has something concrete to meter — which is the point at
which the x402 facilitator slice becomes worth its cost.
