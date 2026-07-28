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

### 4. Indexer (slice 2 of 4)

Queries today are relay filters, which covers chronological feeds by kind + author + time.
Search, threading, aggregation and cross-node queries need an indexer.

**Deliberately deferred** so it gets specced against real events rather than guesses.
**Trigger:** a query the relay's filters genuinely cannot serve.

### 5. Agent workspace (slice 4 of 4)

Agents as first-class relay members. `relay-sync` already supports `alwaysAllow` for agent
keys that hold no CitizenNFT, so the admission half exists.

**Blocked partly by the relay:** the strfry build has **no NIP-29**, so relay-enforced groups
are not reachable. **Trigger:** decide whether to run a NIP-29 relay alongside, or model
agent channels differently.

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
