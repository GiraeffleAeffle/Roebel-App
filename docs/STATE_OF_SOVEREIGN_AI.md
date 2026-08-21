# State of Sovereign AI

**Last verified: 2026-08-11.** Part of the [documentation index](README.md); the third pillar
next to [State of the Netizen Stack](STATE_OF_THE_NETIZEN_STACK.md),
[State of the Netizen Node](STATE_OF_THE_NETIZEN_NODE.md) and
[State of Nostr](STATE_OF_NOSTR.md). Roadmap and skills:
[Mecky agent roadmap](MECKY_AGENT_ROADMAP.md). Long-arc economics:
[Sovereign-AI community wealth study](SOVEREIGN_AI_COMMUNITY_WEALTH_STUDY.md). Legal duties:
[DSGVO & AI Act compliance](DSGVO_AI_ACT_COMPLIANCE.md).

---

## The thesis: the pillars are in order for a reason

The stack has three pillars, and the order is the argument:

1. **An open protocol** — the town's public record as signed, attested, federated events.
2. **Sovereign hardware** — a machine the community owns, running that record.
3. **Sovereign AI** — agents that work *on* the first two.

AI amplifies whatever substrate it stands on. Stand it on an extractive substrate — scraped
data, rented identity, a platform's terms — and it amplifies extraction: the community's
information flows out, intelligence is sold back, and the surplus lands elsewhere. Stand it on
a substrate the community owns and it amplifies the community.

"Positive sum" is therefore not a property of a model. It is a property of **where the value
lands and who holds the off-switch**. The first two pillars are how a town of 5,000 gets both:
the record the AI reads is theirs, the identity the AI speaks with is theirs, the budget it
spends is theirs, and the authority to stop it is theirs. What the AI then contributes is labor
the town could never staff — a 24/7 Bürgerbüro, a newsroom, a grant-writing office — which is
new capacity, not redistributed attention.

One more design commitment follows from this: **AI here is polytheistic, not monotheistic —
but all interoperable.** No single model, vendor or agent is the system. Many minds — frontier
models, local models, other communities' agents — participate in one record, on one protocol,
under one rule: speech is signed, labelled and bounded regardless of what produced it. §2
spells out why the protocol is what makes that plurality safe.

## 1. What is true today

| Surface | What it does | Model actually used |
|---|---|---|
| **Mecky in-app** (`apps/expo/app/mecky.tsx`) | German chat assistant, 11 tools into the backend | Claude via API |
| **Public Mecky on Nostr** (`packages/agent-watcher`) | Answers `p`-tag mentions only from checksum-bound, reviewed Stadtstack evidence; every answer cites its public case | Pi agent core `0.84.1` with zero tools and fresh bounded runs; Röbel declares Hetzner Inference as the replaceable provider (deployment pending) |
| **Story engine / newsroom** | Co-writes local stories, self-publishes to feed + blog | Claude via API |
| **Fördermittel outreach** | Finds funding programmes, drafts honest banded reports, daily cron, opt-out | Claude via API |
| **Image generation** (flyers, menu photos, store images) | kie.ai `nano-banana-2-lite` via shared `lib/images/kie.ts` | — |

The agent's **identity** is where sovereignty is already real rather than aspirational:

- Mecky's Nostr key derives from `NODE_AGENT_SECRET` + node id + agent name — scoped so
  *Mecky of Röbel* can never speak for *Mecky of anywhere else*.
- Every machine-authored event carries NIP-24 `bot: true` plus a `netizen_agent` tag. On the
  protocol, machine speech is **always** distinguishable from a resident's.
- The secret is escrow-grade and community-owned: on 2026-07-29 the identity was re-derived
  from the secret alone by code sharing nothing with our libraries, and matched. A community
  leaving a managed host takes its agent — name, npub, history, followers — with it.
- The watcher introduces itself (kind 0 on startup) and answers under explicit bounds:
  kill switch, already-answered, self, other-agents, 5/author/hour, 100/day.
- Public Mecky does not need a new administrative approval for every reply. Administration
  reviews the public civic evidence once at the Stadtstack boundary; Mecky may then answer
  automatically from that reviewed projection. Missing evidence, provider failure, or an
  unverified citation produces no reply.

The manifest declares the AI layer as first-class node configuration
([`roebel.netizen.json`](../packages/protocol/examples/roebel.netizen.json) → `ai`, `agents`):
model roles, an agent charter with scopes and an audit sink, a treasury budget cap
(newsroom: 50 EURe/month), and a `dataEgressPolicy`. Declared is not the same as enforced —
§6 is honest about which is which.

## 2. What the protocol gives the AI

**Verifiable ground truth.** The failure mode of civic AI is confident fabrication. An agent
grounded in the public record can cite the event id of every claim — and an event id is the
hash of signed content, so "a citizen said this on this date" is *checkable*, not asserted.
The public index is precisely a provenance-preserving retrieval layer: query, get signed
events, verify. An answer that cites signatures is auditable; an answer that cites vibes is
not.

**Accountable speech.** The agent's output is signed by its own key, labelled as machine
speech, rate-limited by the bounds, and revocable at the transport layer: remove the pubkey
from `agents.a2a.relayPubkeys` and the next sync pass strips its write access. Verified live
during the 2026-07-29 rotation — the retired key lost the ability to publish within one pass.

**Compounding federation.** Every dataset a town publishes makes every *neighbouring* town's
agent smarter — "what's on this weekend in the region" answered across nodes with per-claim
provenance — and no aggregator sits in the middle to capture the surplus. This is the
positive-sum mechanism in one sentence: published data raises everyone's capability while
remaining owned by whoever signed it.

**Polytheistic, not monotheistic — but all interoperable.** Because the agent's interface is
the protocol — its identity a derived key, its memory the node, its speech signed events —
the model behind it is a *component*, not the foundation. That enables two things at once.
Substitution: Claude can be swapped for EuroLLM without the agent losing its name, its
history, or a single follower — the same strangler-fig seam as thirdweb→Safe, sovereignty of
the harness first, the weights can follow. And **plurality**: there is no reason every role,
every agent, or every town should run the same mind. The manifest already declares different
models for reasoning, chat and classification; a neighbouring node can run an entirely
different stack; a research collective's agent and a town's agent can answer the same
question side by side. What makes this safe is that the unit of trust is never the model —
it is the **signed, labelled, provenance-carrying event**. A civic record served by one
god-model inherits that model's blind spots, biases and owner; a record that many minds
read and write, all speaking the same verifiable protocol, inherits none of them
structurally. Interoperability is what turns plurality from fragmentation into resilience.

## 3. What the hardware gives the AI

**A home the community controls.** The identity root lives on community hardware, escrowed to
the community. The agent's memory (context graph, audit log) belongs on the same box. An AI
whose identity, memory and audit trail sit on someone else's platform is a tenant; this one is
a resident.

**A path to local inference.** Today the node runs the entire civic stack in **2.1 GiB of RAM
at ~0% CPU** (measured 2026-07-30) — the box is nearly idle. The thing that would actually
consume a sovereign machine is inference, which makes it the real sizing driver for any future
town hardware: a relay mirror runs on a €50 thin client, but *local* model serving needs a GPU
tier — a shared regional inference node first, per-town accelerators only when models and
demand justify it. Until then the manifest's `sovereignty.tier: eu-gpu` + EuroLLM entry is a
declared destination, not a deployment.

**Survivability.** The export test proved the agent survives a host change intact. An AI that
can move with its community — rather than being a feature of wherever they happen to be
hosted — is the difference between civic infrastructure and a subscription.

## 4. Privacy — structural boundaries first, policy second

The strongest privacy properties here are **structural**: they hold because the data is
cryptographically out of reach, not because a prompt asks nicely.

| Data | Why no agent can read it |
|---|---|
| **Votes** | MACI ballots are encrypted; decryption requires 3-of-5 Attester Shamir shares. No operator — and therefore no agent — can see a vote |
| **Direct messages** | XMTP is end-to-end encrypted; the node never holds plaintext |
| **Verification evidence** | Only a Poseidon commitment is on chain; the preimage stays in the citizen's device secure-store |
| **Wallet↔npub registry** | Private table; the allow-list syncer reads it, the agent does not |

The second-strongest property is **safe by construction**: Public Mecky's answer context is
the checksum-bound public Stadtstack projection. It cannot leak what never crossed that
reviewed boundary, and the
publish-the-minimum rule ([Public data on Nostr §2](PUBLIC_DATA_ON_NOSTR.md)) keeps that
corpus clean — no emails, no addresses, no contact persons in published events. Grounding
agents in the public record is not just good retrieval; it is the cleanest privacy stance
available, because it needs no filter to fail.

The honest tier below that is **policy, not structure**:

- **In-app Mecky reads backend data through its 11 tools.** Its scope is enforced by the tool
  implementations, not by cryptography. Every new tool is a privacy decision, not a feature.
- **Egress is the open flank.** In-app Mecky and other AI features still use external model
  APIs. Public Mecky's provider receives only the public question and reviewed public evidence,
  through Pi's replaceable OpenAI-compatible provider adapter; the Röbel manifest currently selects Hetzner's
  experimental Inference API. The manifest's `dataEgressPolicy: governance-gated` names the intent —
  *what leaves the node is a governed, auditable decision* — but no code enforces it yet.
  Local inference (§3) is the structural fix; until then this is the gap to be honest about
  in every conversation about "sovereign" AI.

GDPR consequence, stated once: an agent must never be handed personal data whose erasure
might later be demanded, because agent outputs propagate (Nostr events, sent messages,
generated stories) and *propagation is where erasure goes to die*. The same boundary that
makes the relay GDPR-safe makes the agent GDPR-safe.

## 5. Who governs the agent

Authority over the agent is designed to be **legible, local and revocable** — not solved
alignment, but the civic version of it:

- **The charter is in the manifest** — scopes (`read:feed`, `write:story`, `spend:foerder`),
  kill switch, audit sink. Changing what the agent may do is a reviewable git diff, the same
  property peer trust already has.
- **Budgets are caps, not vibes.** The treasury assigns the newsroom 50 EURe/month. An agent
  that can spend is governed where it hurts — at the money.
- **The kill switch is a data flag** (`AGENT_ENABLED`, `app_settings`), flippable without a
  deploy.
- **The natural end state is a MACI proposal amending the charter**: the town votes, by
  encrypted ballot, on what its AI may do. Nothing else in the stack needs to be invented for
  this — the Governor executes manifest-affecting decisions like any other proposal.

Which of these are *enforcement* and which are *promises* matters: the relay allow-list and
the treasury cap are enforcement (a stripped key cannot publish; an empty budget cannot
spend). Charter scopes and system prompts are promises — real bounds for today's models,
not barriers for arbitrarily capable ones. The design principle is to keep moving bounds from
the promise column into the enforcement column.

## 6. Honest gaps

1. **⚠️ AI Act Art. 50 applies from 2026-08-02 — in three days — and the in-app disclosure is
   not coded.** Mecky needs a permanent "Mecky ist eine KI" in the chat surfaces, stories need
   the label or a named human editorial check, and generated images need machine-readable
   marking. Details and the cheapest compliant order:
   [DSGVO & AI Act compliance §4](DSGVO_AI_ACT_COMPLIANCE.md). The irony worth noticing: the
   *protocol* side already complies in spirit — every Nostr event Mecky signs is labelled
   `bot: true` — while the app's own chat window does not yet say what the law requires.
2. **Cognition is rented.** Pi can switch Public Mecky's OpenAI-compatible provider without
   changing its closed civic evidence contract, but inference still leaves the node. The in-app and
   newsroom paths remain separately tied to external providers. Sovereign today = identity,
   bounds, evidence, audit, memory, budget. Not the model.
3. **Egress is unenforced** (§4). `dataEgressPolicy` is a field, not a control.
4. **The context graph does not exist.** Mecky's town memory is thin; the
   [agent roadmap](MECKY_AGENT_ROADMAP.md) backbone (Town Context Graph + Outbound Runtime)
   is designed, not built. An agent without durable local memory leans harder on the rented
   model — the opposite of the direction this document argues.
5. ~~**The agent-watcher is not in the manifest.**~~ Fixed: the watcher, its reviewed public
   evidence origin, provider endpoint/model and secret reference are declared and rendered.
6. **One agent, one node.** Every claim about federation of agents is currently tested at
   n=1 town. The first cross-node agent answer with real provenance is still ahead.

## 7. What to build next, in order

1. **AI Act disclosure** — legal deadline, smallest effort, three days
   ([compliance doc §4](DSGVO_AI_ACT_COMPLIANCE.md)).
2. **Deploy and browser-test the evidence-gated watcher** — publish an immutable Röbel image,
   supply the scoped inference secret, and prove cited answers and fail-closed refusals live.
3. **Town Context Graph** — moves memory onto the node; prerequisite for everything agentic
   ([roadmap](MECKY_AGENT_ROADMAP.md)).
4. **Egress logging before egress gating** — an honest audit of what leaves the node is the
   cheap first step toward governing it.
5. **LiteLLM gateway on the node** — one seam through which all model calls pass; the
   precondition for ever swapping in a local model without touching agent code.

The through-line: every step moves something from the promise column to the enforcement
column, or from the rented column to the owned column — without waiting for the day the
weights themselves come home.
