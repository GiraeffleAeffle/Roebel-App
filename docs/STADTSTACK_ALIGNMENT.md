# Röbel × Netizen × Stadtstack — alignment

**Date: 2026-07-28.** Part of the [documentation index](README.md). Companions:
[State of the Netizen Stack](STATE_OF_THE_NETIZEN_STACK.md),
[State of Nostr](STATE_OF_NOSTR.md), [Roadmap and deferred work](ROADMAP_AND_DEFERRED.md).

An open-source contributor is building **Stadtstack**: a deterministic decision-and-evidence
pipeline for municipal cases, running on Talos/Kubernetes. This document records that vision,
maps it against what Netizen has actually built, and states plainly where the two designs
agree, where they diverge, and what has to be decided.

It is a working alignment document, not an agreement. Where a claim is theirs, it is marked as
theirs. Where our own state contradicts a shared assumption, that is called out rather than
smoothed over.

---

## 1. The shared picture

The division of labour they propose is coherent and worth adopting:

- **The Röbel app is the public community space.** Discussion, participation, membership.
- **Stadtstack is the traceable decision and evidence pipeline.** Case state, departmental work
  packages, evidence with provenance, decisions, impact receipts.
- **openDesk (Nextcloud/Matrix/Collabora) is the administration's workspace.** Human work.
- **Mecky is a family of role-bounded companions**, not one omniscient bot.
- **A Netizen node can later bundle these as a sovereign, operable profile.**

And the lifecycle that ties them together:

```
discussion → topic → proposal → departmental packages → evidence and answers
  → options → decision → implementation → measured impact → back to discussion
```

Every surface references the **same case ID, the same versions, the same checksums**, and a
reader can always see what is confirmed, disputed, missing, private, or merely AI-assisted.

**The first success is explicitly not a global autonomous agent network.** It is one fully
visible Röbel case, end to end. That framing is right, and it is a healthier target than
anything on our own roadmap at the moment.

## 2. Their honest limit, restated

The end-to-end case they demonstrate is **synthetic and has no municipal mandate**. Public
evidence stands at **0/7**; no Röbel department has accepted or published a real answer. They
keep that limit visible in the UI, the APIs and the receipts.

That is the right instinct and it matches how this repo documents its own gaps. A demo that
hides its own synthetic-ness is worse than no demo.

## 3. Where their design and ours already agree

Several things they propose, Netizen shipped in the last two days — which is a good sign for
the alignment, and means less to negotiate:

| Their design | What exists here today |
|---|---|
| Nostr carries signed public discussion, readable off-client | Live. Citizens publish from the app; verified by `nak` off `wss://relay.roebel.app` |
| Own relay, replication between nodes | Live. NSP-9 federation, NIP-77 negentropy, pull-only into a separate mirror |
| Citizens hold their own key identity, with verifiable attestations | Live. Wallet-derived npub, client-held key, mutual wallet↔npub binding, CitizenNFT-gated writes |
| Agents are fallible contractors, never authorities | Live, and enforced in the data: every agent event carries NIP-24 `bot: true` and a `netizen_agent` tag |
| Agents get explicit, revocable capabilities rather than user rights | Partially. Relay write access is declared per agent key in the manifest and revoked by removing it |
| x402 only for voluntary, non-personal value-add data | Agreed, and independently reached. See [the marketplace research](future-research/2026-07-27_DATA_SOVEREIGNTY_AND_MARKETPLACE.md): personal data cannot be sold in the EU because consent is revocable |
| `netizen up` selects declarative profiles | Partially. The manifest is declarative and the civic stack is now optional, so a minimal node is expressible — but there is no profile *vocabulary* yet |

**The agent-labelling agreement is the most important one.** They argue AI may explain, draft
and find gaps, but adoption, publication, voting, payment and official decisions stay explicit
human transitions. We reached the same conclusion from the other direction — that an unlabelled
agent in a civic feed is indistinguishable from a resident — and enforced it at the event level.

## 4. What their design adds that we do not have

These are genuine gaps in Netizen, not differences of opinion.

### 4.1 A civic data contract

They propose ten versioned handover objects rather than aligning whole internal models:

`civic_topic_v1` · `civic_proposal_v1` · `participation_snapshot_v1` · `evidence_request_v1` ·
`evidence_return_v1` · `department_work_package_v1` · `department_response_v1` ·
`decision_dossier_v1` · `decision_commitment_v1` · `activity_event_v1`

Each carrying: schema version, jurisdiction, topic/case ID, timestamp, producer, checksum,
provenance, visibility class, review status, authority binding, and a correction/revocation
reference.

**Netizen has nothing at this layer.** NSP-0…10 describe a *node* — its services, peers, index.
Nothing describes a *civic process*. This is the right shape (few, versioned, at the boundary)
and it is additive to what exists.

Two fields deserve emphasis because they encode the whole ethic: **visibility class** and
**authority binding**. The first says who may see it; the second says who is entitled to assert
it. An event without authority binding is an opinion wearing a uniform.

### 4.2 Canonical IDs across surfaces

Nothing in Netizen today gives a topic, proposal or case a stable identity that survives
crossing from the app to a relay to an administrative system. Their `participation_snapshot_v1`
(aggregated, never raw votes) is also the correct privacy shape for a system that already runs
MACI.

### 4.3 An evidence and dossier graph

Options, sources, assumptions, counter-positions, uncertainty. Netizen has proposals and votes;
it has no representation of *why* a decision was defensible. This is what makes a decision
auditable after the fact rather than merely recorded.

### 4.4 Identity as a federation, not a super-account

Their formulation is sharper than ours: citizen, administration, politics, organisation,
merchant, agent and workload **must not collapse into a role flag on one account**. Municipal
and political roles come later from municipal SSO (e.g. Keycloak), time- and
organisation-bounded. Kubernetes workloads get their own service identities. Links between
identities are auditable claims, and private identities are not automatically correlated in
public.

This is compatible with Röbel ID and with our npub work, and it is a better articulation of the
target than anything currently in our docs. It also names a risk we have live: the wallet↔npub
registry is private precisely so identities are not bulk-correlated.

### 4.5 An activity journal of metadata only

Append-only records that something happened — never chat content, tool inputs, secrets or
internal documents — with current state always read from the responsible system. That
separation is what lets an audit trail be public without the underlying work being public.

## 5. Where the two genuinely diverge

Naming these now is cheaper than discovering them during integration.

### 5.1 Deployment substrate: Talos/Kubernetes vs docker compose

Stadtstack runs on Talos/Kubernetes with three control-plane nodes, WireGuard management,
private registry, Barman backups. `netizen up` renders a manifest into **docker compose** and
applies it over SSH.

**Their critique lands:** "before an installer there must be reproducible deployments, updates,
backup, recovery, key rotation and conformance tests." Netizen has backup/restore and hardening
rendered from the manifest, and no key rotation or conformance suite.

But the goals differ, and that is fine:

- Netizen's target is **a small community that can run its own node** — a single box a town can
  afford and a contributor can reproduce. Kubernetes is a real operational tax for that reader.
- Stadtstack's target is **a municipality's evidence pipeline**, where HA and formal operations
  are the requirement.

**These do not have to converge.** The interoperability surface is the data contract and the
protocols, not the orchestrator. A profile could target either substrate. What must not happen
is Netizen silently acquiring a Kubernetes dependency, or Stadtstack being asked to run on
compose. **Decision needed:** is `netizen` ever expected to emit Kubernetes manifests, or does
it stay compose-first with Stadtstack as a peer system reachable over the contract?

### 5.2 Who owns which surface

They ask it directly ("Welche Oberfläche besitzt welchen Schritt"). It is the question most
likely to cause duplicated work, and both projects currently have a plausible claim on
proposals and participation.

### 5.3 Node profiles as a vocabulary

Their profiles (Community / Participation / Administration / Evidence / Companion / Operations)
are a good abstraction and Netizen has no equivalent. Today a manifest declares services
individually. A profile is a named bundle — worth adopting, and it composes cleanly with the
now-optional civic stack.

## 6. Answers we can already give to their seven questions

Four of their seven open decisions have concrete answers from what is built. Offering these
should shorten the conversation.

**Q2 — which Nostr event kinds/tags carry topic, reference and correction?**
Partly settled by what is live:

| Purpose | Convention in use |
|---|---|
| Profile | kind 0; agents additionally carry NIP-24 `bot: true` |
| Public post | kind 1 |
| Correction/retraction | kind 5 (NIP-09), **advisory** — relays may ignore it |
| App-specific structured data | kind 30078 (NIP-78), as used for the wallet↔npub binding |
| Agent attribution | `["netizen_agent", "<agent>", "<node>"]` |

A `civic_topic` would most naturally be a **parameterised replaceable event** (kind 30xxx) with
a `d` tag holding the canonical topic ID — that is exactly the shape used for the identity
binding, and it makes correction a re-publish rather than a delete.

**Q3 — which fields does Röbel read from the public Stadtstack projection?**
Whatever is chosen, it is queryable today: the node runs a public cross-node index at
`https://index.roebel.app` with `/events` (search, kinds, authors, time range, **provenance**)
and `/stats`. A Stadtstack projection published as signed events is readable by Röbel, by any
peer node, and by any Nostr client, with no bespoke integration.

**Q5 — how do citizen/attester roles link to later administrative SSO without mixing identities?**
The seam exists. Röbel ID is the node's own OIDC issuer and `identity.federation.trustedIssuers`
is where a municipal issuer would be declared. Membership is an on-chain CitizenNFT, and the
wallet↔npub mapping is deliberately **private** so identities are not bulk-correlated. What is
missing is the municipal issuer itself — which is theirs to bring.

**Q6 — which surface owns which step?** Open, and the most important one. See §5.2.

## 7. What we suggest building first

Their sequencing — one synthetic case, end to end, over stable IDs, before any autonomous
payment or global federation — is right. Two additions from our side:

1. **Freeze the canonical ID and the first two objects (`civic_topic_v1`, `civic_proposal_v1`)
   before anything else.** Every other object references them. Getting the ID wrong is the one
   mistake that is expensive to reverse, because it is embedded in every published event.
2. **Publish the Stadtstack public projection as signed Nostr events.** Then the Röbel app, any
   peer node, and any external client read it through infrastructure that already exists and is
   already federating, rather than through a bespoke API binding. Their own table already
   assigns Nostr the role of "signed public contributions, replication, open readability" — this
   is that role applied to the projection.

**Not blockers, and we agree they are not:** x402 metering, agent wallets, global node
federation. Netizen has federation running between two nodes, which makes it a compatible
extension rather than a prerequisite.

## 8. Open decisions, consolidated

Theirs, plus what this document adds:

1. Canonical ID for topic, proposal, case.
2. Nostr kinds and tags for topic, reference, correction. *(Partly answered, §6.)*
3. Which fields Röbel reads from the public projection. *(Transport answered, §6.)*
4. Which writes the Röbel app may initiate, and under which role or approval.
5. How citizen/attester roles link to municipal SSO. *(Seam answered, §6.)*
6. Which surface owns which step. **Most likely to cause duplicated work.**
7. Which synthetic demo-town case is the shared conformance test.
8. **Added:** does `netizen` ever emit Kubernetes, or stay compose-first with Stadtstack as a
   peer system over the contract? *(§5.1.)*
9. **Added:** are node profiles adopted as a manifest concept, and with which names? *(§5.3.)*
