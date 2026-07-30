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

### 5b. `@mecky` mentions — LIVE 2026-07-28

Tag Mecky in the app's Nostr test section and it answers in place.

- The mention is a NIP-01 **`p` tag**, not the literal text "@mecky", so the question is legible
  to any Nostr client — an agent on another node could answer it too.
- The reply is a threaded kind 1 (`e` tag on the parent, `p` tag back to the asker), and it is
  automatically labelled `netizen_agent` because it is built as an agent event.
- `@netizen-labs/agent-watcher` runs beside the relay. Its **bounds are enforced before any
  answer is produced**, and before the model is even called: never answers itself, never answers
  another agent (two bots would talk until someone sees the bill), one answer per question,
  5/author/hour, 100/day, and a kill switch.
- The system prompt carries the one instruction that matters in a civic feed: say plainly when
  you do not know, and never invent a decision, date, figure or municipal responsibility. An
  agent that confabulates municipal facts is worse than none, because it does so wearing the
  town's identity.

**Verified live:** a citizen asked "was ist Nostr in einem Satz?" and Mecky answered on the
relay — threaded onto the question, addressed back to the asker, and tagged `netizen_agent`.

**Rotate the `ANTHROPIC_API_KEY`** — it was pasted into a chat log on 2026-07-28.

**Rotate `NODE_AGENT_SECRET` before this is public.** It currently holds a demonstration value
that appeared in a chat log, and it determines Mecky's identity — someone holding it could
impersonate the town's agent on the relay. Rotating it changes the pubkey, so all three must
move together: the box `.env`, `agents.a2a.relayPubkeys` in the manifest, and `MECKY_PUBKEY` in
`apps/expo/app/settings/nostr.tsx`. Making the app read that value from config instead of a
constant would remove the third step.

### 6. On-chain peer registry

Peers are declared in each manifest today, which is auditable in a git diff and needs no
contract. A `CommunityRegistry` on Gnosis would make discovery permissionless instead.

The `peers` schema is **already shaped for a contract to populate it**, so this is additive.
**Trigger:** more nodes than a human wants to maintain by hand, or a node you want discovered
without asking anyone.

### 7. Gated reads (NIP-42)

The relay has no AUTH, so **everything published is world-readable, permanently**. This is
why only already-public data goes on it. Private or member-only content would need NIP-42 or
a different relay. Nuance (2026-07-29): upstream strfry supports NIP-42, so this is
configuration work on the existing binary, optionally paired with NIP-70 protected events.

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

### 11. Discoverability — NIP-65 relay lists and NIP-05 names

Outbox-model clients (the 2026 majority) find an author's content through their kind-10002
relay list; without one, nothing published here is discoverable from outside. NIP-05
(`name@roebel.app`) adds the human-readable identity on our own domain. Small work: publish
kind 10002 for each opted-in account and serve `/.well-known/nostr.json`.
**Trigger:** the first push for external reach — mirroring to Fediverse/Bluesky via
Ditto/Mostr counts. (Context: [ecosystem check 2026-07-29](future-research/2026-07-29_NOSTR_OIDC_OPENDESK_LANDSCAPE.md).)

### 12. Standard kinds for town data — NIP-52 events, Blossom media

When the [Public data on Nostr](PUBLIC_DATA_ON_NOSTR.md) migration reaches events and
media: calendar data should use NIP-52 kinds rather than invented ones, and media should be
served from a Blossom server next to strfry — NIP-96 is officially deprecated in its
favour. **Trigger:** publishing the events/cinema/org datasets, or any media, to the relay.

### 13. The index does not honour replaceable events

Found 2026-07-29, during the node-secret rotation. strfry correctly keeps **one** kind 0 per
pubkey — that is NIP-01 replaceable-event semantics. The index keys on event id, so it keeps
**every version**: after two watcher restarts the relay held 1 profile and the index returned 2.

Harmless today, because the only consumer sorts newest-first and both versions were identical.
It is not harmless for the plan in [Data placement and CRUD](DATA_PLACEMENT_AND_CRUD.md), where
**edit** is expressed as a parameterised replaceable event (kinds 30000–39999 keyed by their `d`
tag). Under the current index an edited event would be returned alongside the version it was
meant to replace, and a reader has no way to know which is current — an edit that does not
replace anything is not an edit.

The fix is to collapse on read or on ingest: newest `created_at` wins per `(pubkey, kind)` for
kinds 0/3/10000–19999, and per `(pubkey, kind, d)` for 30000–39999, with ties broken by the
lexicographically smaller id as NIP-01 specifies. Deletions (kind 5) need the same treatment.

**Trigger:** before shipping edit or delete for any Nostr-published dataset. Doing it after
would mean rewriting rows readers had already been served.

---

## For the Netizen project repo

`~/Documents/privat/side_projects/netizen_labs` becomes the real Netizen repo (possibly private
on GitHub). These belong there rather than in Röbel's monorepo.

### E. Netizen Network States Explorer — the open-data proof

**The end goal, and the real test of open data access.** Not a dashboard: a working client that
proves someone outside Röbel can build on the node's public record.

**The bar: it should be possible to build an entire Röbel-App clone with its own UI, where
everything works the same as the original** — using only the node's public interfaces, with no
Supabase credentials and no permission from anyone.

That is what makes this a test rather than a demo. Everything the app currently shows from
Supabase that is legitimately public has to be reachable from the protocol and the index first
(see [Public data on Nostr](PUBLIC_DATA_ON_NOSTR.md)), which is why that migration is the
dependency: today only profiles and feed posts are published, so a clone could render a feed
and nothing else.

Building the Explorer against the same interfaces an outside builder would use is the honest
way to find what is missing — every gap shows up as "the clone cannot render X".

Plus the network view itself: which nodes exist, what each publishes, how they federate, how
alive they are. A globe with node locations makes "a network of sovereign nodes" legible.

**Most of the data is already public**, which makes this a front-end problem rather than a
protocol one:

- each node exposes `/stats` — what it knows, by source node and kind
- `/events` answers search, kinds, authors, time range and provenance
- each manifest declares its `peers`, so the federation graph is derivable
- relays answer NIP-11 with name, description and supported NIPs

**Design constraint worth fixing now:** derive location from the **declared** region, never from
IP geolocation. A sovereignty project that silently geolocates its own operators has undermined
the thing it sells.

**Trigger:** node #3, or the first node run by someone outside Röbel. With n=2 on one box a
globe would be theatre.

### F. A setup guide for contributors and builders

There is `CONTRIBUTOR_ONBOARDING.md`, but it is about working on the Röbel app — not about
standing up a node. A builder currently has to read the manifest spec, the installer spec and
three State documents to get started.

What it needs to cover, in this order: a minimal manifest (now possible — see item 1), what
`render` / `doctor` / `up` each do, the DNS records the node needs, which secrets the box needs
and why, and how to federate with an existing node.

**Trigger: before inviting the first outside operator.** They are the test of whether the
documentation works, and a failed first attempt is expensive goodwill.

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

### 19. A physical node in the town — "Netizen OS" first, a box second

Measured 2026-07-30: the entire stack uses **2.1 GiB RAM, 11 GB disk, ~0% CPU** — a €150–250
fanless N100 mini-PC runs a full node; a €50 thin client runs a light mirror (relay +
federation + indexer: under 100 MB combined). Break-even against the Hetzner box is inside a
year. The real obstacles are ingress (CGNAT, dynamic IPs, TLS — solvable with a static-IP
business line at the Rathaus, DNS-01 challenges, or a €4/mo WireGuard ingress VPS) and the
fact that home hardware makes **off-site backups more urgent, not less**.

The path deliberately does not start with manufacturing: **(1)** a flashable "Netizen OS"
image — Ubuntu + Docker + the `netizen` CLI + a first-boot wizard, weeks of work, zero
capital; **(2)** a white-labelled ODM mini-PC pre-flashed in 50–100 unit batches (the
Umbrel/Start9 category, ~€300–500 retail); **(3)** custom hardware only at real volume. Local
AI inference, not the civic stack, is what would actually size a future box (see
[State of Sovereign AI §3](STATE_OF_SOVEREIGN_AI.md)).

**Trigger:** the first community or business that wants the node in its own building — or
the assisted tier getting its first taker.

### 20. Peer-escrowed off-site backups

`offsite` is unconfigured: every dump shares the fate of the box. The restic scaffolding
exists (`BACKUP_RESTIC_REPOSITORY` / `BACKUP_RESTIC_PASSWORD`); the *right* long-term shape
for a network of town nodes is **peers holding each other's encrypted dumps** — declared in
the manifest like any other peer relationship, so backup trust is reviewable in a git diff
too. **Trigger:** immediately for restic-to-any-target; peer escrow when node #3 exists on
independent hardware.

---

## Sovereign AI

The state and thesis live in [State of Sovereign AI](STATE_OF_SOVEREIGN_AI.md); these are the
deliberately-deferred pieces.

### 21. Egress logging, then egress gating

Every agent question today transits Anthropic's API; the manifest's
`dataEgressPolicy: governance-gated` is a field, not a control. The cheap first step is an
**audit log of what leaves the node** (which surface, which destination, how many tokens) —
honesty before enforcement. Gating comes after there is something measured to gate.
**Trigger:** before any agent tool reads personal data beyond the asking user's own scope.

### 22. LiteLLM gateway on the node, then local inference

One seam through which every model call passes is the precondition for swapping any model
without touching agent code — the polytheistic design depends on this seam existing. Local
inference (EuroLLM on an eu-gpu tier or a shared regional node) comes after the gateway,
because without the seam a local model is just one more hardcoded integration.
**Trigger for the gateway:** the second distinct model provider in production use. **Trigger
for local inference:** a model that meets the German-language civic bar on hardware a region
can afford — re-evaluate quarterly, this moves fast.
