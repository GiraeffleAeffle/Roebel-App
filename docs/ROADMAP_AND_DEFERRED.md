# Roadmap and deferred work

**Last updated: 2026-07-28.** Part of the [documentation index](README.md).

Everything here was **deliberately not built**, with a reason. This document exists so that
"we decided that later" survives the conversation it was decided in. Each entry says what it
is, why it waits, and **what has to be true before it makes sense** — a trigger, not a date.

An item without a trigger is a wish. An item without a reason is an oversight.

---

## Blocking the open-source goal

### 1. ~~A minimal node is not expressible~~ — DONE 2026-07-28

The manifest used to require `contracts`, `identity`, `governance` and `treasury`, so a
contributor wanting **a relay that federates** had to declare a Safe, a MACI deployment, an
OIDC issuer and six contract addresses first. That turned "fork this" into "reproduce a whole
town first".

**Fixed.** The civic stack is now optional. A minimal node is `nsp`, `manifestVersion`, `id`,
`name` and `services` — anything else is what a *community* node adds. The installer emits
nothing for what is absent: no keystone env, no keystone plan step, and no allow-list syncer
(there is no onchain credential to sync from; such a node grants writes by hand with
`add-member.sh`, or simply mirrors peers and authors nothing).

`netizen doctor` **omits** layers a node never declared rather than scoring them false. The
score reads "N layers under own control", so counting an identity layer a relay-only node
deliberately does not run would penalise it for a choice. Durability is deliberately different:
absence there is the finding.

Node #2 now runs on a genuinely minimal manifest — no chain, no contracts, no identity, no
governance, no treasury — and it federates. It is the template a contributor copies.

### 2. Extract the `@netizen-labs/*` packages into their own repo

Netizen gets its own repo; Röbel is the proof of concept. The packages live in the Röbel
monorepo as a strangler fig, so the tooling was built against a real town.

**The trigger has fired** (2026-07-28): a second node exists and a contributor is expected.
What makes it tractable is that every package is already node-agnostic — none import Röbel
constants. See [State of the Netizen Stack](STATE_OF_THE_NETIZEN_STACK.md) §3 for the split.

### 3. Node #2 is not independent

Both nodes run on one box. That proves the **protocol**, not the network: the concentration
ratio is 1, and cross-node anonymity sets are meaningless at this scale.

**Trigger:** an outside operator runs one. Then publish the concentration ratio, as the
[data-sovereignty research](future-research/2026-07-27_DATA_SOVEREIGNTY_AND_MARKETPLACE.md)
recommends.

---

## Nostr and federation

### 4. ~~Indexer (slice 2 of 4)~~ — DONE 2026-07-28

`@netizen-labs/indexer`. Its trigger fired the moment federation shipped: a node now has
**two stores** (its own relay and its peers' mirror) and relay filters cannot ask a question
across them.

Indexes both into Postgres and serves `/events` (search, kinds, authors, time range,
provenance), `/stats` and `/health`. Public read by design — everything in it came off
world-readable relays, so publishing leaks nothing new, and it is what lets a **peer's** agent
query this node. Verified live: a cross-node query returning Röbel's own record alongside node
#2's, full-text search, and a provenance filter.

**Design rule worth keeping: the protocol is the source of truth, the database is a derived
index.** The index holds nothing authoritative — every row is a signed event that came off a
relay, its signature is re-verified on ingest rather than trusted from a peer, and the whole
store is rebuildable by re-reading the relays. So the database buys query efficiency without
buying lock-in: drop it and nothing is lost. Keep it that way as more data moves onto
protocols — the moment the index holds something the relays do not, it stops being a cache and
becomes a second source of truth to reconcile.

### 5. ~~Agent workspace (slice 4 of 4)~~ — agents can publish; groups still blocked

**Done 2026-07-28: agents are first-class, labelled members of the public record.**

- `deriveAgentIdentity(nodeSecret, nodeId, name)` — deterministic, scoped by BOTH node and
  agent. So an agent that loses its state recovers the same npub, two agents on one node never
  collide, and "Mecky of Röbel" is a different identity from "Mecky of another town" — those
  are different actors and must not be able to speak for each other.
- **Every agent event is labelled.** The profile carries NIP-24 `bot: true` (the standard field
  clients already understand) and every note carries a `netizen_agent` tag, so a single event
  is self-describing without fetching the profile. A town's public record has to let anyone
  tell "a citizen wrote this" from "an AI generated this"; an unlabelled agent in a civic feed
  is indistinguishable from a resident, and that is what erodes trust in the whole record.
- Relay access comes from `agents.a2a.relayPubkeys` in the manifest, honoured by the syncer's
  `alwaysAllow`. Verified the hard way: a key added by hand to `members.txt` was **deleted by
  the next sync pass**, exactly as that design predicts. Declared is the only durable path.

Verified live: Mecky published to `wss://relay.roebel.app`, was read back by `nak`, and appears
in the public index tagged `agent:mecky` beside citizen posts.

**Still deferred — relay-enforced groups.** The strfry build has no NIP-29, so agent *channels*
(a Slack-like workspace on the relay) are not reachable. **Trigger:** decide between running a
NIP-29 relay alongside, or modelling agent conversations as tagged threads on the existing
relay. Note this is unrelated to the openDesk workspace interoperability work, which is about
Nextcloud/Matrix/Collabora for humans.

### 5b. `@mecky` — mention an agent in the feed and get an answer

Tag an agent in a post or comment and it replies in place, the way Grok does on X.

**Most of this already exists**, which is why it is a small build rather than a new subsystem:

- Mecky has a Nostr identity and relay write access (§5) — it can already publish.
- Its replies are automatically labelled `bot: true` + `netizen_agent`, so nobody can mistake
  the answer for a neighbour's.
- The node's index can find mentions, and Mecky already has the MCP tool bus for context.

**What to build:**

1. **A mention convention.** Nostr's `p` tag already means "this event references this pubkey" —
   so `@mecky` in the app resolves to a `p` tag carrying Mecky's pubkey. That makes the mention
   readable by any Nostr client, not just Röbel's app.
2. **A watcher** that queries the index for events tagging Mecky's pubkey since its last reply,
   and answers as a kind 1 with an `e` tag referencing the parent. One reply per mention,
   tracked by the parent event id so a restart cannot double-answer.
3. **Bounds, before it is switched on.** An agent that replies to anything it is tagged in is a
   spam vector and a cost centre. It needs: a rate limit per author, a refusal to answer other
   agents (or two bots will talk to each other forever), a daily cap, and a kill switch — the
   manifest's `agents.charter.killSwitch` already exists for this.

**Design constraint worth stating now:** Mecky answers from *published sources* and says when
it does not know. The public companion is deterministic and source-bound — an agent that
confabulates municipal facts in a civic feed is worse than no agent, because it wears the
town's identity while doing it.

**Trigger:** ready to build. The dependency is not technical — it is deciding the bounds above,
because they are much harder to add after people are used to unlimited replies.

### 6. On-chain peer registry

Peers are declared in each manifest today, which is auditable in a git diff and needs no
contract. A `CommunityRegistry` on Gnosis would make discovery permissionless instead.

The `peers` schema is **already shaped for a contract to populate it**, so this is additive.
**Trigger:** more nodes than a human wants to maintain by hand, or a node you want discovered
without asking anyone.

### 7. Gated reads (NIP-42)

The relay has no AUTH, so **everything published is world-readable, permanently**. This is
why only already-public data goes on it. Private or member-only content would need NIP-42 or
a different relay.

**Trigger:** a genuine requirement to publish something that is not public. Treat with
suspicion — the append-only log makes GDPR erasure advisory at best.

### 8. Identity federation between nodes

Recognising another node's members (so a Citizen of node A is known on node B) is a different
question from mirroring content, and was explicitly out of NSP-9 slice 1.
`identity.federation.trustedIssuers` reserves the space. **Trigger:** a cross-node action that
needs to know *who* someone is, not just read what they wrote.

### 9. Transitive relaying

Whether a node re-exports what it mirrored from a third node. Left out on purpose: it is a
**policy** decision about republishing other communities' records, and it should be decided,
not emerge by accident.

### 10. Nostr publishing from the web app

The identity bridge is Expo-only. The same wallet derives the **same npub** on the web —
the key is re-derived, never transferred — so this is a small addition:
`@netizen-labs/nostr` is isomorphic, and only the storage differs (WebCrypto instead of
SecureStore). **Trigger:** Citizens asking to post from desktop.

---

## Interoperability with Stadtstack

### C. A civic data contract (topics, proposals, cases, evidence, decisions)

An outside contributor is building **Stadtstack**, a deterministic decision-and-evidence
pipeline, and proposes ten versioned handover objects — `civic_topic_v1`, `civic_proposal_v1`,
`evidence_return_v1`, `decision_dossier_v1`, `impact_receipt_v1` and others — each carrying
provenance, visibility class, review status and **authority binding**.

**Netizen has nothing at this layer.** NSP-0…10 describe a *node*; nothing describes a *civic
process*. The proposal is the right shape (few objects, versioned, at the boundary rather than
aligning whole internal models) and additive to what exists.

**Trigger: freeze the canonical topic/proposal/case ID and the first two objects before
anything else.** Every other object references them, and the ID ends up embedded in every
published event — it is the one mistake that is expensive to reverse.

See [the alignment document](STADTSTACK_ALIGNMENT.md) for what already agrees, what genuinely
diverges (Talos/Kubernetes vs compose; who owns which surface), and the answers we can already
give to four of their seven open questions.

### D. Node profiles as a manifest concept

Stadtstack proposes named bundles — Community, Participation, Administration, Evidence,
Companion, Operations — rather than declaring every service individually. Netizen's manifest is
already declarative and its civic stack is now optional, so a profile is a naming layer on top
rather than new machinery. **Trigger:** the second or third contributor node, when "which
services do I need" becomes a real question rather than a copy-paste.

---

## Making a node trivial to stand up

These two are the difference between "a contributor *can* run a node" and "a contributor
*does*". Both were raised 2026-07-28.

### A. Node-hosted identity, generically

Every node should be able to run its own OIDC provider without inheriting Röbel's. The
machinery mostly exists and is closer than it looks:

- the manifest already has `identity.idp.hosted: "node" | "external"`
- `netizen render` already emits a keystone compose service and its env when `hosted: "node"`
- Röbel itself runs `external` (on Fly), which is why the node-hosted path is under-exercised

**What is actually missing** is the last mile, and it is mostly naming and bootstrap:

1. The service, image and env file are called **`roebel-id`**. A contributor standing up
   "Waren ID" should not be running something branded for another town. Rename to a generic
   `netizen-id` (or take the name from `manifest.id`), keeping `roebel-id` as an alias so the
   live node does not break.
2. **JWKS has to be generated**, not pasted. `apps/roebel-id/scripts/generate-jwks.ts` exists;
   the installer should call it and write the secret to the box's own `.env`, so a new
   operator never handles key material by hand.
3. The relying-party list is currently hand-written per node. It could be **derived** from the
   services a manifest already declares — Nextcloud, Matrix and the web app each imply their
   own redirect URI.

**Trigger:** the first contributor who wants their own login rather than federating into
Röbel's. Do it together with the package extraction (item 2) so the generic name lands once.

### B. Domain registration and DNS as part of the installer

Today `netizen render` tells you which A records to create, and a human goes to a registrar
and types them. Vercel does this for its users; a sovereignty stack has less excuse not to.

**Why this is small, and worth doing:** the installer **already knows every hostname the node
needs** — it renders the Caddyfile and the plan's `dns` step lists them. So DNS reconciliation
is a narrow function: *take the hostnames render already computed, ensure an A record for each
points at the node's IP, report the diff.* No new source of truth, and it is the same
declare-then-reconcile shape as the relay allow-list and federation.

Sketch:

```json
"services": { "dns": { "provider": "ionos", "zone": "roebel.app", "apiKey": "$IONOS_API_KEY" } }
```

```
netizen dns plan     # what records are missing or wrong — read-only
netizen dns apply    # reconcile, idempotent
```

**Design constraints worth fixing now, before it is built:**

- **Plan before apply, always.** DNS is the one layer where a bad write takes every service
  down at once, including the way back in. `plan` must be the default and `apply` explicit.
- **Never delete a record it did not create.** A zone usually has MX, TXT and records for
  things the node knows nothing about. Reconcile *additively*; report strays rather than
  removing them.
- **The operator can always override by hand.** The agent sets things up; the human keeps the
  final say and the manifest records intent, not exclusive ownership.
- Registration (buying a domain) is a separate, rarer, money-spending action from DNS
  configuration. Keep them separate commands even if one agent drives both.

**Trigger:** the same first contributor. Standing up a node currently means editing DNS at a
registrar by hand, which is the least sovereign-feeling step in an otherwise declarative flow.

---

## Money and data economy

### 11. x402 facilitator on Gnosis

Metered node-to-node data access, the monetisation half of the federation thesis.

Two verified obstacles: **Gnosis is not on Coinbase's facilitator network list**, and
**EURe does not implement EIP-3009** (probed onchain 2026-07-27: `transferWithAuthorization`
absent from the implementation bytecode; `permit` present). So an EURe rail means **running
your own facilitator** and taking the **Permit2 two-step path** rather than the single
signature gasless flow USDC gets.

Running your own is arguably on-brand — a facilitator settling in EURe on your own chain is
the "thin protocol fee on flows that pass through" from the coordination thesis, rather than
renting Coinbase's rails. **Note Circles CRC is ERC-1155 and cannot be the settlement token.**

**Trigger:** nodes exchanging something worth metering. Federation now exists, so this is no
longer blocked on infrastructure — only on demand.

### 12. Compute-to-data, and what may legally be sold

**You cannot sell personal data in the EU.** Consent is revocable at any time, so "permanent
access sold" is undeliverable. The marketplace works, in descending order of legal comfort:
non-personal (sensor, energy, mobility, environment) → business/institutional → aggregate
statistics → compute-to-data over personal data. Not "citizens sell their data".

**Trigger:** start with non-personal municipal data, which is where the EU Data Act bites.
Take the compute-to-data *pattern* from Ocean; avoid the token dependency.

### 13. Dataspace Protocol connector

The institutional interface. Unglamorous, standards-shaped, and the actual reason an
institution can buy. **Trigger:** an institution that wants to.

---

## Security and governance

### 14. Rotate the Supabase service-role key

It was pasted into a chat log on 2026-07-28. It bypasses RLS on the entire project.

On legacy Supabase keys, rotating `service_role` means rotating the JWT secret, which
invalidates `anon` too and forces an update everywhere (app, Vercel, Fly). If the project has
the newer publishable/secret keys, they rotate individually and it is cheap.
**Trigger: as soon as the blast radius is understood.**

### 15. Write the threat model

One page, named adversaries, stated capabilities. Every privacy-shaped decision is
unevaluable without it, and it will probably **shrink** the work — the
[research](future-research/2026-07-27_DATA_SOVEREIGNTY_AND_MARKETPLACE.md) §1.3 argues only
one adversary (a subpoena-capable authority acting retroactively) justifies engineering.

### 16. Visibility classes in the manifest, checked by `doctor`

Declare per data class whether it is public, member-only or private, and have `netizen doctor`
verify the deployment matches. Turns "privacy for the individual, transparency for the
powerful" from a principle into an audit artifact. The check must report honestly: on today's
contracts `membership` is **public** and cannot be declared otherwise.

---

## Operational

### 17. Matrix (Synapse + MAS)

Has needed attention and should be checked before anyone relies on it. Not part of the Nostr
or federation work.

### 18. Node #2's containers are not compose-managed

Röbel's are. Node #2 runs from a **rendered manifest** but was started with `docker run`.
**Trigger:** when node #2 becomes a template a contributor copies.
