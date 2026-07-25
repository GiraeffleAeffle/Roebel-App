# Sovereign Workplace Suite — Identity-Gated, AI-Agent-Automated (Design)

> **Status:** DRAFT for review · 2026-07-25 · the proposal for **Goal G6**
> ([MISSION_AND_GOALS.md](../../MISSION_AND_GOALS.md)). *Current-state Buzz / openDesk / zk-residency
> detail is being refreshed by parallel research; this synthesis is grounded in the already-verified
> corpus and will be reconciled on any material delta.*
> **Builds on (does NOT duplicate):**
> [sovereign-community-os](2026-07-05-sovereign-community-os-design.md) (the 4-layer foundation + cockpit) ·
> [Röbel ID keystone](2026-07-24-roebel-id-sso-keystone-design.md) (**approved for build** — the OIDC
> identity plumbing, incl. openDesk coexistence §0/§6 + the buzz-derived agent on-ramp §10) ·
> [Netizen blueprint](2026-07-21-netizen-stack-design.md) (L7 Intelligence, L8 Interface, the Node) ·
> [Hetzner infra migration](2026-07-25-hetzner-sovereign-infra-migration-design.md) (where it runs) ·
> [suite portfolio](2026-07-07-roebel-suite-product-portfolio.md) (the full module catalog).

## 1. What we're building, in one paragraph

A **workplace suite that an organisation or a single sovereign person owns** — documents, mail,
calendar, tasks, chat, video, sheets — **gated by their own wallet identity**, running on
infrastructure they control (EU/Hetzner), where **AI agents are first-class members that automate the
office and cross-party coordination work.** We **reuse the mature open office stack** (the openDesk
components) behind our identity rather than rebuild it, and we spend our build budget only on the
differentiators the open stack structurally lacks: **self-sovereign identity, an agent runtime,
on-chain money, and cross-node coordination.** Röbel is the Genesis deployment; the same thing forks
to any org, Gemeinde, or person (Goal G7).

This is Goal G6 as the *productivity face* of the whole thesis: sovereign nodes own their data (G1/G2)
→ **agents read across them and automate work (G5/G6)** → humans decide technodemocratically (G3) →
money executes on-chain (G4) → metric predictions guide the next decision → all of it forkable (G7).

## 2. Research digest — what to adopt, what to avoid

*(From the corpus's verified research — [Röbel ID §0/§6/§10](2026-07-24-roebel-id-sso-keystone-design.md),
[NETIZEN_SOVEREIGN_STACK_RESEARCH](../../future-research/2026-07-22_NETIZEN_SOVEREIGN_STACK_RESEARCH.md);
being refreshed by the Fizz/Honey/Bumble agents.)*

### openDesk (ZenDiS) — reuse the components, coexist via OIDC, don't compete
- **What it is:** the German sovereign workplace suite (ZenDiS GmbH, sole shareholder = the Federal
  Republic; Apache-2.0; production, ~v1.17 mid-2026). A bundle of mature open tools — **Nextcloud**
  (files) · **Collabora** (documents) · **Open-Xchange** (mail/calendar) · **OpenProject** (tasks) ·
  **XWiki** (wiki) · **Element/Matrix** (chat) · **Jitsi** (video) · **CryptPad** — glued by
  **Univention Nubus (OpenLDAP)** + **Keycloak SSO**.
- **Who it serves / the hole it leaves:** built for **large public institutions with real IT**
  (Kubernetes + ~5–6 servers min; 500+ employee orgs). It structurally **cannot** serve individual
  citizens, SMEs, small towns *as communities*, mobile-first, integrated AI, payments/treasury, or
  wallet/self-sovereign identity. **That hole is exactly Röbel's target.**
- **How we use it:** **(a) coexist** — because openDesk's SSO is Keycloak and it supports **external
  OIDC IdP brokering since v1.4.0**, a town running openDesk registers **Röbel ID** as an external
  OIDC provider → its citizens log into openDesk with their **town wallet**. Correction from research:
  brokering is **OIDC-only**, users matched by **username**, and openDesk's **record-of-truth is
  OpenLDAP (Nubus), SCIM-inbound not live** — so coexistence needs the **Nubus Directory Importer**
  (or JIT-provision-without-deprovision for a pilot): **low-new-build, not zero.**
  **(b) compose** — for small orgs that don't run openDesk's mega-deployment, **compose 2–3 upstream
  components** (Nextcloud + Collabora + OpenProject) **behind Röbel ID**, mobile-wrapped. Reuse, not rebuild.
- **Verdict:** openDesk is an *ally and a component supplier*, not a competitor. Adopt its components;
  adopt nothing of its heavy deployment model.

### Buzz (Block) — adopt the "agents as members" pattern, keep our differentiators below it
- **What it is:** Block's open (Apache-2.0) agent framework (launched 2026-07-21) built on the thesis
  that **agent identity is "the most fundamental problem in multi-agent collaboration."** Every agent
  gets **its own keypair** and acts with *"the same audit trail, a different keypair."* Block chose
  **Nostr** for agent identity + messaging.
- **What we adopt:** the **pattern** — agents are principals with their own identity, attributable and
  auditable actions, and cross-agent messaging. We already own a **stronger** identity primitive than a
  raw Nostr keypair: a **gasless smart account with on-chain governance + treasury.** So we implement
  the buzz pattern over **standard OIDC + smart accounts**, not Nostr (Röbel ID §10).
- **What buzz deliberately omits — and we keep as our moat:** **payments** and **cross-org
  federation.** Those layer *below* identity and are precisely G4 (on-chain money) + G7 (federation).
- **Interop, not dependency:** a Röbel agent principal (Röbel ID token + scoped smart account) maps
  cleanly onto a buzz-style agent world later — we can interoperate without depending on it.

## 3. Proposed architecture — five layers

Extends the [sovereign-community-os](2026-07-05-sovereign-community-os-design.md) foundation; **L4 (Agent
Runtime) is the new focus of this spec.**

```
┌────────────────────────────────────────────────────────────────────────┐
│ L5  COORDINATION (cross-node)   agents read across sovereign nodes under │
│     consent → propose → humans decide (MACI) → money executes (Safe) →   │
│     metric predictions (futarchy) guide next decision            (G3/G4) │
├────────────────────────────────────────────────────────────────────────┤
│ L4  AGENT RUNTIME  ★THE FOCUS★  agents = members: own identity + scoped  │
│     treasury + governance bounds + MCP tools + audit. They AUTOMATE the  │
│     office & coordination work (the "flows").                    (G5/G6) │
├────────────────────────────────────────────────────────────────────────┤
│ L3  WORKPLACE APPS   reused open components behind our identity:         │
│     Nextcloud·Collabora·OpenProject·OX·Element/Matrix·Jitsi + the        │
│     mini-app runtime + the cockpit modules (forms/flows)          (G6)   │
├────────────────────────────────────────────────────────────────────────┤
│ L2  DATA / VAULT   per-org & per-person data; Supabase node + Nextcloud  │
│     files; owner-encrypted vault for sensitive docs               (G1)   │
├────────────────────────────────────────────────────────────────────────┤
│ L1  IDENTITY  Röbel ID (OIDC IdP) — humans AND agents (actor_type).      │
│     Wallet login → SSO into every component. sub = smart-account addr    │
│     (G2)  [APPROVED FOR BUILD]                                           │
└────────────────────────────────────────────────────────────────────────┘
        hosted sovereignly on Hetzner/EU (G1) · anchored to Gnosis·Safe·Circles·MACI
```

## 4. The AI-agent-automation layer (L4) — the differentiator, concretely

An **agent is a member** with the same four things a human member has (COORDINATION_PROTOCOL_THESIS,
layer 05): **identity, governance bounds, a scoped treasury, a currency.** Concretely:

1. **Identity** — the agent authenticates through **Röbel ID** (the keystone already reserves
   `roebel:actor_type = 'agent'`). It has its **own smart-account address** (`sub`), so every action is
   attributable — buzz's "same audit trail, different keypair," but over our stronger primitive.
2. **Delegation (the key mechanism)** — the agent's token carries the OIDC **`act` (actor) claim**
   (RFC 8693 token-exchange): *"agent X acting on behalf of principal Y."* Every automated action traces
   to the **authorising human/org**. This is the trust backbone of the whole automation layer.
3. **Scoped treasury** — the agent gets a **Zodiac Roles-bounded budget** on its org's Safe (NSP-3 /
   Fiscal Constitution "scoped agent budgets"): it can spend/transact *only* within governance-set
   limits, every move on-chain and audited.
4. **Tools via MCP** — the agent acts through the **MCP tool bus** (the public/dev MCP servers already
   exist): read the Vault, draft a document in Collabora, create an OpenProject task, file to an Amt,
   propose a treasury payment, post to the feed.
5. **Governance bounds + kill switch** — an **Agent Charter** (NSP-6): registered identity, granted
   scopes, mandatory audit trail, a governance kill switch. Agents are members the DAO can revoke.
6. **What they automate — the "flows"** (the cockpit thesis made general):
   - *Intra-org:* the boring forms fill themselves (Verwendungsnachweis, Anträge) from data already in
     the Vault; calendar/event ops; document + mail drafting; task creation; treasury-payment proposals.
   - *Inter-org / inter-node (the coordination payoff):* a business files to the Amt; a Verein requests
     funds; an agent on node A reads (consented) data on node B to route/negotiate/reconcile; agents
     draft the cross-party paperwork and queue the on-chain execution for human approval.
   - **Mecky becomes the reference org agent** — the configurable community agent the blueprint (L7)
     already names.

**Trust model in one line:** every agent action is **attributable** (`act`), **bounded** (scoped
budget + scopes), **auditable** (logged), and **killable** (governance) — automation you can trust
because it can't exceed what a human granted it.

## 5. Build order — strangler-fig, ships value each step

Never pause Röbel to build infra (blueprint §7). Each phase is usable on its own.

| Phase | Ships | Depends on | Exit test |
|---|---|---|---|
| **P1 — Identity keystone** *(approved, in build)* | Röbel ID OIDC IdP; wallet login → SSO into **Nextcloud + Collabora** | Röbel ID spec | a citizen opens a Collabora doc via wallet login; `groups` mapped |
| **P2 — Cockpit v0.1** (first real automation) | the program-runner flow: ingest a mess → auto-draft a real submittable form from Vault data | P1, existing events/agent rails | one recurring form auto-drafted end-to-end for a pilot |
| **P3 — Agent Runtime v0** ★ | agent principal: `actor_type`→**`act` delegation** + **client-credentials grant** + **Zodiac-scoped Safe budget** + MCP tools + audit; Mecky as the reference agent | P1, Safe/Zodiac, MCP | an agent, on behalf of an org, drafts a doc + proposes a bounded treasury payment, fully audited, within limits |
| **P4 — Suite assembly / openDesk coexist** | compose Nextcloud+Collabora+OpenProject behind Röbel ID for small orgs; **and** the Keycloak-brokering + Nubus-importer runbook to federate into a town's openDesk | P1 | a small org gets docs+tasks+files SSO'd under its wallet; a town's openDesk accepts Röbel ID logins |
| **P5 — Cross-node coordination** | agents read across nodes under consent (permissioned MCP) → propose → **MACI** decide → **Safe** execute → **futarchy** predictions advise | P3, MACI, Node API (NSP-4) | a two-node flow: an agent reconciles data across nodes and queues an on-chain action for a human vote |

**Gate:** P1–P2 are justified for Röbel alone (SSO + form automation are immediate wins). P3 is the
differentiator. P4–P5 generalise — gated on real second-org/second-node adoption (blueprint's N=1 gate).

## 6. Reuse-vs-build discipline (the moat)

| Reuse (rent the maturity) | Build (the differentiators — where our budget goes) |
|---|---|
| Nextcloud, Collabora, OpenProject, Open-Xchange, Element/Matrix, Jitsi, CryptPad (the openDesk components) | **Röbel ID** identity + SSO (wallet as OIDC IdP) |
| Keycloak brokering, Nubus provisioning (for openDesk coexist) | **Agent Runtime** (delegation, scoped budgets, charter, audit) |
| Safe, Zodiac, Circles, Monerium, MACI (trust + money rails) | **On-chain money in the workflow** (agent budgets, RBL routing) |
| MCP (tool bus), LiteLLM + EuroLLM (sovereign inference) | **Cross-node coordination** + the AI glue (Town Context Graph) |

The open office stack is production-grade and crypto-native document editing is still experimental —
so **reuse documents/sheets/mail/calendar/tasks; build identity, agents, money, coordination.**

## 7. Sovereignty & GDPR posture

- Runs on **Hetzner/EU** ([infra migration spec](2026-07-25-hetzner-sovereign-infra-migration-design.md));
  each node's operator = **data controller for exactly its community** (locality as a compliance feature).
- **Agent data-egress is governance-controlled** (FUTARCHY §1): citizen-linked data pins to **local
  inference**; only non-sensitive data may burst to a frontier model. Automation never silently exfiltrates.
- **Sensitive documents** owner-encrypted (Vault); everyday collaborative docs render server-side behind
  SSO (the Collabora tradeoff, accepted per document class — Röbel ID §0).
- Real-money phases gated by the **Legal Masterplan** (Fachanwalt + Steuerberater); EU AI Act
  deployer/provider duties apply once we self-host/fine-tune a model.

## 8. Risks & open questions

- **openDesk coexistence is low-build, not zero** — needs the Nubus Directory Importer / a
  JIT-provisioning decision; SCIM-inbound isn't live (deprovisioning propagation is manual until then).
- **Agent trust at scale** — the `act`+scoped-budget+charter model is sound in design but unproven at
  volume; start with tightly-scoped, low-value automations and widen as audit confidence grows.
- **Real-time collab vs E2E encryption** tension (server-side editors need plaintext) — resolved per
  document class, not globally.
- **Key-management & recovery UX** for non-crypto users remains "the biggest UX risk of the whole
  sovereignty thesis" (OS-SPEC §9) — passkeys + Safe guardians are the path.
- **Cross-node data-sharing consent + schema** (NSP-4 Node API) is the hard protocol work behind L5.
- **Model quality** — EuroLLM trails frontier; keep the frontier fallback behind LiteLLM for
  non-sensitive automation.

## 9. Decisions for Max

1. **Confirm the layering** — is L4 (Agent Runtime) the right next investment after the Röbel ID
   keystone (P1) + cockpit (P2), i.e. *identity → first automation → agent runtime*?
2. **Suite assembly vs coexistence first (P4):** compose our own 2–3-component "Röbel Suite" for small
   orgs, *or* prioritise federating into a town's existing openDesk? (Different first customers.)
3. **First automation target (P2):** the program-runner forms flow (per OS-SPEC), or a different
   high-overwhelm workflow?
4. **Agent charter scope:** how conservative should v0 agent budgets/scopes be — read-only + draft-only
   at first, or allow bounded treasury proposals immediately (human-approved)?
5. **buzz interop:** treat buzz purely as a pattern source, or invest early in actual ACP/MCP interop so
   Röbel agents can operate in buzz workspaces (and vice-versa)?

---

*Next step after approval + the incoming research reconciliation: superpowers **writing-plans** for
**P3 (Agent Runtime v0)** — the differentiator — since P1 (Röbel ID) is already an approved build and
P2 (cockpit) has its own plan in the OS-SPEC track.*
