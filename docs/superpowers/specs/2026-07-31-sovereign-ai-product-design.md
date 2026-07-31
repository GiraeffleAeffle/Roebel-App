# Netizen Sovereign AI — one product, two doors

**Date:** 2026-07-31
**Status:** Design for review.
**Supersedes:** nothing wholesale. It **conditionally supersedes** one line of
[`SOVEREIGN_AI_FUTARCHY.md`](../../future-research/SOVEREIGN_AI_FUTARCHY.md) §5
(the "no fine-tuning on private data" non-goal — see §6.3), and it **writes the
missing reconciliation** between the business plan's "shared cluster" AI pricing
and the Cloud spec's "one box per customer" architecture (see §4.2).
**Builds on:**
[`2026-07-22_NETIZEN_SOVEREIGN_STACK_RESEARCH.md`](../../future-research/2026-07-22_NETIZEN_SOVEREIGN_STACK_RESEARCH.md) §5,
[`2026-07-27_NETIZEN_CLOUD_PRODUCT_SPEC.md`](../../future-research/2026-07-27_NETIZEN_CLOUD_PRODUCT_SPEC.md),
[`2026-07-22_NETIZEN_BUSINESS_PLAN.md`](../../future-research/2026-07-22_NETIZEN_BUSINESS_PLAN.md) (P4),
[`SOVEREIGN_AI_FUTARCHY.md`](../../future-research/SOVEREIGN_AI_FUTARCHY.md),
[`PHYSICAL_INFRA_ENERGY_SHARING.md`](../../future-research/PHYSICAL_INFRA_ENERGY_SHARING.md) §4,
[`2026-07-27_DATA_SOVEREIGNTY_AND_MARKETPLACE.md`](../../future-research/2026-07-27_DATA_SOVEREIGNTY_AND_MARKETPLACE.md) §3.1,
[`2026-07-26_CHAT_PROTOCOL_DECISION.md`](../../future-research/2026-07-26_CHAT_PROTOCOL_DECISION.md),
[`../../SOVEREIGN_AI_COMMUNITY_WEALTH_STUDY.md`](../../SOVEREIGN_AI_COMMUNITY_WEALTH_STUDY.md),
and NSP-6/NSP-8 in `netizen_labs/packages/protocol/src/manifest.ts`.

---

## 0. The product in one line

**Your own AI on your own node:** private models over your own corpus, agents as
chartered members, a data-egress policy your community governs, and an exit that
is drilled and verified — provisioned from one signed manifest, as easy as
Supabase. There is one artifact (the Netizen node) and two doors into it: the
civic door that exists today, and a new **AI-first door** for communities,
SMEs and builders who come for private AI and inherit sovereignty.

## 1. Why now (market facts, 2026-07-31)

- **Sovereign AI became a platform race this week.** Sarvam (India) launched its
  105B model in February and on 2026-07-30 announced the pivot that matters:
  from models to a full-stack sovereign AI *platform* — India-hosted compute,
  enterprise software, an IBM partnership for government and regulated sectors.
  The lesson: the durable business is the platform and operations layer, not the
  model. (business-standard.com, businesstoday.in, apacnewsnetwork.com)
- **Frontier-class open weights arrived.** GLM-5.2 (Z.ai, 2026-06-13, MIT):
  744B-total / ~40B-active MoE, 1M context, matches GPT-5.5 on long-horizon
  coding at roughly one sixth of the cost — the strongest open-weight model
  available. It only runs on serious multi-GPU hardware, which shapes the tier
  design below. (datanorth.ai, kie.ai, technology.org)
- **The private-AI appliance market is forming without our angle.** onprem.ai
  (CH), LLM.co "LLM-in-a-Box", Iternal AirgapAI, Bunker (FR), BearingPoint's
  sovereign stack (Graz DC, 2026-05) — turnkey on-prem LLM infra from ~$10–15k
  hardware, open-weight self-hosting up to ~18x cheaper per token than premium
  APIs at volume. None of them have: a verified exit, governance-gated egress,
  agents as members, a community identity layer, or a live town as reference.
- **Our own proof landed.** The export-and-relaunch drill passed 5/5 checks
  against the live Röbel node on 2026-07-29. "Leave us in an afternoon" is now
  a demonstrated fact, and it is the one claim no appliance vendor can copy
  quickly.

## 2. Decision log (settled 2026-07-31)

| Question | Decision | Why |
|---|---|---|
| Product shape | **C: one product, two doors** — the node is the only artifact; an AI-first minimal manifest is the second door | Captures the sovereign-AI wedge without a second product motion; node #2 can arrive through the AI door |
| "Custom model" | **RAG-first; LoRA fine-tuning reserved and gated** behind AI Act counsel | Corpus access is the value for ~90% of workloads; fine-tuning may flip deployer→provider under the AI Act |
| Model policy | **The router is the product**, not any model — multi-model by governed policy | The governed egress policy is the differentiator; models commoditize |
| Hardware | **Netizen Box = certified BOM via the Assisted tier**, no inventory, no racks | Hardware revenue as setup+support; H4 (rent-first) unviolated; energy-coop container stays Phase 2 |
| Deliverable | This design doc first; public essay later | Reversals of written decisions must be explicit before they become marketing |

## 3. The two doors

**Door 1 — civic (exists).** Full node: identity, governance, treasury,
currency, workspace, relay, AI. Röbel is the living proof.

**Door 2 — AI-first (new).** A minimal manifest: `identity` + `ai` +
`services.workspace` (relay optional). The README already establishes the
principle: "a relay that federates is a legitimate node." The same principle
makes an AI-first node legitimate. The buyer gets a private AI workspace —
RAG over their own corpus, chartered agents, governed egress — and every other
capability (governance, treasury, currency, federation) is one manifest edit
plus `netizen up` away. No migration, no re-platforming.

**The discipline rule:** door 2 is a door, not a fork. Same manifest schema,
same installer, same `doctor`, same export drill, same registry. The day the AI
door needs an artifact the civic door doesn't have, this design has failed.

## 4. Architecture

### 4.1 What lives on the customer's node (always)

The node is single-tenant (one box, per the Cloud spec) and holds everything
that makes AI private:

- the **corpus** — pgvector RAG partitions over the customer's documents,
  declared in the manifest (§5),
- the **keys** — node agent, org keys, citizen keys never touch the node,
- the **LiteLLM gateway** — the router, with the egress policy compiled in,
- the **egress policy** — which data class may reach which sovereignty tier;
  governance-controlled where the node has governance, operator-controlled
  otherwise,
- the **agent workers** — NSP-6 charters: scopes, kill switch, audit sink,
  bounds engine (the agent-watcher pattern: pure, testable rules).

### 4.2 Three rails, chosen per data class

This section is the reconciliation the corpus was missing. The business plan
prices "Sovereign AI, shared cluster" (one GEX box multiplexed across many
orgs); the Cloud spec commits to "one box per customer, not a multi-tenant
scheduler." Both are right, at different layers:

**The node is never shared. The GPU rail is a service the node routes to.**

- **Tier 4 — pinned local.** 7B–30B-class open models on the customer's own
  GPU or a Netizen Box (§7). Data physically cannot egress. This is the only
  tier `doctor` scores as sovereign for AI ("it already runs on our hardware").
- **Tier 3 — the shared Netizen GPU rail.** GEX131-class boxes (96 GB,
  €1,197/mo verified 2026-07-22) multiplexed across nodes via LiteLLM.
  Model menu: **GLM-5.2** as the high-IQ option (MIT, strongest open weights;
  cluster-scale only), **EuroLLM-22B / SOOFI-S-on-release / Gemma-class** for
  German-sovereign workloads. The rail is **optional and replaceable**: the
  manifest declares it as an endpoint, and any OpenAI-compatible EU endpoint
  (IONOS AI Model Hub, a peer node's rail, the customer's own cluster)
  satisfies the same slot. A node must pass `doctor` with a third-party rail
  configured — otherwise the rail is the chokepoint §3.1 of the marketplace
  doc warns about.
- **Tier 1/2 — frontier fallback.** Claude, zero-retention / EU endpoint, for
  what the policy explicitly allows out.

The egress policy — not the model list — is the product. "Cryptographically
governed data-egress policy" (futarchy doc §1) remains the unique feature; the
AI door generalizes it from a DAO vote to whatever authority the node's
manifest declares (a DAO, a Geschäftsführung, a Vereinsvorstand).

### 4.3 What "custom private model" means, honestly

v1 (sellable now): **custom corpus + custom persona + custom routing + custom
agents.** RAG over the customer's documents with per-data-class visibility,
per-role model selection, system prompts and agent charters under version
control in the manifest. The corpus's capability claim stands: local 70B-class
is frontier-minus-one-generation, and the gap is irrelevant for ~90% of
town/Mittelstand workloads because the value is corpus access, not raw IQ.

Reserved (gated): **LoRA fine-tuning** on customer data, on tier-4 hardware or
the rail with compute-to-data discipline (the job goes to the data, only
weights deltas leave — never the corpus). Gate: §6.3.

Never: training on citizen data, cross-tenant retrieval, selling the corpus.
"Sell the answer, never the corpus" (marketplace doc §2.4) binds this product.

## 5. Protocol changes (NSP-8 extensions)

NSP-8 already declares `gateway`, `selfHosted`, `gpuHost`, per-role `models`,
`sovereignty { tier, model, dataEgressPolicy }`, `mcp.toolBus`, `contextGraph`,
`workers`. Three additions:

1. **`ai.rail`** — the declared upstream shared rail: endpoint, operator,
   jurisdiction, terms hash. Replaceability is a schema property: the field is
   a URL + attestation, never a Netizen-specific type. `doctor` warns when the
   rail operator equals the host operator (concentration disclosure).
2. **`ai.corpus`** — declared RAG sources with visibility classes, following
   the manifest-declares-visibility pattern from the marketplace doc §1.2
   (`internal | members | sellable-as-answers`). `doctor` verifies the
   deployment matches the declaration; the DPIA inventory reads from it.
3. **`ai.tuning`** — reserved block, `enabled: false` until §6.3 clears.
   Declaring it early keeps the schema honest about intent and gives counsel a
   concrete object to review.

Agent workers stay NSP-6. Cross-node agent interop (the "AI routers on the
Netizen network" ambition) remains the declared R&D bet per the chat-protocol
decision: Nostr/DVM job market when Buzz matures past v0.x. The manifest
declares the a2a surface now (`agents.a2a`), so nodes are addressable the day
the marketplace exists — but no marketplace is built in this design.

## 6. Legal gates (before selling, not after)

1. **AI Act deployer-vs-provider opinion** — the unresolved question the stack
   research routed to counsel. Decisive for §6.3. Art. 50 transparency applies
   from **2026-08-02** (two days after this spec's date); the `ai_generated`
   labeling rule in `CONSUMING_THE_RECORD.md` extends to every AI-door tenant.
2. **Data-processor posture** — AI-door customers make Netizen Cloud a
   processor for corpus data: DPA template, subprocessor list that names the
   rail operator and GPU host, breach process, restore drill. (Cloud spec §5
   already demands this; the corpus adds the AV-register entry per the DPIA.)
3. **§6.3 The fine-tuning gate.** The futarchy doc's non-goal ("no fine-tuning
   on private data") stays in force **until** (a) counsel confirms the
   deployer/provider boundary for LoRA-on-customer-data, and (b) a leakage
   review of the tuning pipeline exists. When both clear, `ai.tuning` ships as
   an enterprise tier and this spec formally supersedes that line. Until then,
   sales language says "custom AI", never "custom model training".
4. **Model licenses** — GLM-5.2 MIT: clear. SOOFI-S: final license is the
   declared upgrade trigger; do not build on the gated beta.

## 7. Hardware: the Netizen Box

A **certified BOM, not inventory.** Publish a tested parts list at two sizes:

- **Box S** (~€2–4k class): workstation GPU, 7B–13B-class models — Verein,
  small SME, single-org RAG.
- **Box L** (~€10–15k class): 96 GB-GPU server, 30B unquantized / 70B FP8 —
  Kommune, Mittelstand, multi-org node.

Customers buy from vendors; `netizen render`/`up` target the box through the
existing Assisted tier (`services.host: own`). Netizen revenue = setup +
support/SLA subscription. No stock, no logistics, no capex — H4 (rent-first)
and the Cloud spec's "do not own racks for the story" both hold. The Phase-2
energy-coop compute container ("energy in, answers + heat out") is untouched
by this spec: it is the eG's story for 2027–28, not this product's launch.

## 8. Pricing hypotheses (inherited, not invented)

| Offer | Price hypothesis | Source |
|---|---|---|
| AI door node (managed) | node tier (€99/€299/€900+) + AI uplift | Cloud spec §3 |
| Shared rail access | metered per-1M tokens or €99–499/mo per org | Business plan §6 |
| Sovereign SME AI (RAG + agents) | €150–220/SME/mo | Wealth study Table 1 |
| Netizen Box assisted setup | one-time setup + support/SLA subscription | this spec §7 |
| Fördermittel agent | free scan + success fee | Business plan §6 (flagship, unchanged) |
| Self-host | €0 | Cloud spec (strategy, not charity) |

Price for operations, not compute. Rail margin scales with utilization and is
the only line with real COGS discipline required.

## 9. Sequencing (one motion per phase, preserved)

- **Proof 0 — Sovereign Mecky.** Flip Röbel's `ai.selfHosted` to `true`:
  GEX-class box, mid-size open model, RAG over Ratsprotokolle/budgets/
  Satzungen, LiteLLM pinning citizen-linked queries local. Already the
  corpus's named first deliverable (futarchy doc §1, "days of proxy config +
  weeks of RAG plumbing"). Until this lands, every sovereign-AI sentence in
  public copy carries the `doctor` honesty caveat.
- **Proof 1 — the AI door renders.** The minimal manifest
  (`identity + ai + workspace`) renders, comes up with one command, passes
  `doctor` including the third-party-rail check. **Nohau-lite** ships here:
  a scoped onboarding agent for the minimal manifest only (questions →
  manifest → provisioned node; see §11.4). AI-first landing narrative on the
  Netizen Labs site.
- **Proof 2 — node #2 through the AI door.** A *stranger's* node — the
  roadmap's own next-milestone rule. An SME or community that came for
  private AI, not for civic tech.
- **Then** rail buildout follows demand (one GEX131 serves many orgs before a
  second is rented), Box BOM publishes alongside the first assisted-tier
  request, LoRA tier waits at gate §6.3.

**Deferred, with named triggers** (ROADMAP_AND_DEFERRED convention):

| Deferred | Trigger |
|---|---|
| Voice/call AI workflows | first paying customer demand → dedicated research pass (EU STT/TTS stack, telephony law); zero research exists today |
| "Recursive self-improvement" → reframed as *agents that learn from the node's record* | legal clarity; autonomous self-modification collides with the human-in-the-loop architecture that makes the stack legally deployable (futarchy doc §3) |
| Cross-node agent marketplace (DVM/Buzz, x402 settlement) | Buzz maturity past v0.x per chat-protocol decision; x402-on-Gnosis facilitator scoped per marketplace doc §4 |
| Fine-tuning (LoRA) tier | gate §6.3 |

## 10. Honesty instrumentation

- `doctor` is the acceptance harness: AI sovereignty scored per tier;
  egress-policy verification; **rail-replaceability check** (node passes with
  a third-party endpoint configured); `ai.corpus` declaration matches
  deployment.
- The export drill extends to AI: corpus, LiteLLM config, and agent charters
  join the irreplaceable set in `EXPORT_AND_RELAUNCH.md`; restore verified.
- Publish the **concentration ratio including the rail**: share of live nodes
  Netizen hosts, and share of nodes routing through the Netizen rail. The
  anti-chokepoint critique (marketplace doc §3.1) applies to the rail exactly
  as it applies to hosting.
- Copy rule: claim sovereignty only where the manifest enforces it and
  `doctor` confirms it. Röbel's `ai.selfHosted: false` stays visible until
  Proof 0 lands.

## 11. Resolved questions (decided 2026-07-31, review session)

1. **Rail operating entity: per-jurisdiction partners first, Netizen Labs
   GmbH later.** Launch the rail on partner infrastructure (Schwarz Digits /
   IONOS-class, per Cloud spec §4's "partnership over reselling"); the GmbH
   takes over rail operation when volume and the company's legal shape (the
   "whose Hetzner account" question) justify it. Partners-first also keeps
   the concentration ratio honest from day one.
2. **Box vendors: certified-BOM-only at launch; named integrator later.**
   Publishing the BOM costs nothing and violates no rule. A named integrator
   shipping pre-imaged boxes comes only once assisted-tier demand is proven
   (roughly: after the first ~3 assisted requests) — and under the
   integrator's brand and inventory, never Netizen's, so demand-first holds.
3. **GLM-5.2: on the menu with provenance disclosed; excluded from the
   Kommune preset by default.** SMEs get the strongest open model on the
   governed rail. Public-sector presets default to the European-sovereign
   menu; a Kommune that wants GLM opts in via a manifest edit under its own
   egress governance — the product's governance mechanism working as
   designed, not an exception to it.
4. **Nohau-lite ships with the AI door at Proof 1.** A scoped onboarding
   agent for the minimal manifest only: a handful of questions → rendered
   manifest → provisioned node. Full Nohau (every SKU, civic door included)
   stays at Cloud build-phase P4 as planned. Nohau-lite is the "as easy as
   Supabase" claim made literal, and its scope is small precisely because
   the minimal manifest is small.
