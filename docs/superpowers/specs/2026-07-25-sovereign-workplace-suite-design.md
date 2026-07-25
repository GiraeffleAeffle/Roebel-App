# Sovereign Workplace Suite — Identity-Gated, AI-Agent-Automated (Design)

> **Status:** DRAFT for review · 2026-07-25 · the proposal for **Goal G6**
> ([MISSION_AND_GOALS.md](../../MISSION_AND_GOALS.md)). *Reconciled 2026-07-25 with fresh, cited
> Buzz / openDesk / zk-residency research (Fizz / Honey / Bumble).*
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

*(Verified 2026-07-25 by parallel research — Fizz (Buzz), Honey (openDesk), Bumble (zk-residency) — and
reconciled into the corpus. Key sources cited inline.)*

### openDesk (ZenDiS) — reuse the components, coexist via OIDC; its missing AI is our wedge
- **What/who:** BMI-owned, **ZenDiS**-run sovereign MS-365 alternative; ~**€45M** funded; **live and
  scaling** — Bundeswehr/BWI (7-yr deal), Robert-Koch-Institut (~7k users), the **ICC dropped M365 for
  it**, social-insurer "crisis-workplace" pilots passed. Current **v1.17 (22 Jul 2026)**, monthly
  releases. *(opendesk.eu, en.wikipedia.org/wiki/OpenDesk)*
- **Components (shipped):** Nextcloud (files) · Collabora (office docs) · Open-Xchange (mail/cal/
  contacts) · La Suite **Docs** (collab notes, Franco-German/DINUM) · Element/**Matrix** (chat) ·
  **Jitsi** (video) · Nordeck **NeoBoard** (whiteboard)+NeoDateFix (scheduling) · **OpenProject**
  (tasks) · **XWiki** (wiki) · **Nubus** IAM = OpenLDAP + **Keycloak** + UMC. Deploy = Kubernetes/Helm/
  Helmfile on SCS/STACKIT (heavy). *(docs.opendesk.eu/operations/architecture)*
- **The load-bearing finding — identity brokering is a *documented config*:** openDesk **explicitly
  supports federating an external OIDC IdP via Keycloak** (`functional.authentication.ssoFederation`).
  A standard-OIDC **Röbel ID** issuer registers as an upstream IdP → wallet-authenticated users reach
  openDesk with **ad-hoc (JIT) provisioning on first login — no forking, no source changes.** Matched
  by username; **deprovisioning (SCIM) is the only gap** (roadmap; Nubus Directory Importer covers
  lifecycle meanwhile). *This strengthens the Röbel ID §6 coexistence path — JIT works out of the box.*
  *(docs.opendesk.eu/operations/enhanced/idp-federation)*
- **openDesk has NO AI shipped — this is our wedge.** AI is **roadmap only** (KIPITZ partnership;
  self-hosted EU models; human-in-the-loop; doc-sorting, citizen chatbots, forecasting, compliance
  pre-screen). **The AI-agent-automation layer openDesk lacks is exactly G6/L4.**
  *(opendesk.eu/blog/ai-in-public-administration)*
- **Licensing:** Apache-2.0 orchestration over **mostly-AGPL** components (Nextcloud/Element/Nubus
  AGPL-3.0) — each independently reusable behind your own OIDC; AGPL network-copyleft applies if you
  modify+serve them.
- **Go-to-market opening:** ZenDiS is launching a **Vertriebspartner (sales-partner) program**
  (applications Q2 2026, onboarding fall 2026) letting private providers resell openDesk Enterprise
  Europe-wide — a possible public-sector channel for Netizen. *(zendis.de/newsroom)*
- **Verdict (confirmed):** ally + component supplier, not competitor. Reuse the components; coexist via
  OIDC brokering; **be the AI-automation + wallet-identity + payments layer it structurally lacks.**

### Buzz (Block) — bigger than "a pattern": a shippable agent-native workspace (the comms plane)
- **What it actually is (corrected):** an **open-source Slack + GitHub replacement** on **Nostr** —
  team chat + git hosting/review (NIP-34) + YAML workflows + search + a **signed audit log**, where
  **humans AND AI agents are first-class members.** Apache-2.0, **Block/Dorsey**, launched 2026-07-21,
  **early** (v0.4.x, ~11.7k stars, Rust). Explicitly **"Not blockchain," no payments.**
  *(github.com/block/buzz, block.xyz)*
- **Self-hostable relay = a sovereign node:** an org runs its own relay; "code never touches Block's
  servers." Mesh/multi-tenant-relay crates hint at cross-node federation. **This maps directly onto a
  Netizen Node's comms/coordination plane.**
- **Agent model (adopt this):** the **ACP (Agent Client Protocol)** harness `buzz-acp` listens for
  @mentions and drives **any ACP agent — goose, Codex, Claude Code** — each with its own keypair;
  **MCP is first-class** (`buzz-dev-mcp` + MCP-driven hooks); agents run tools, execute approved
  workflows, submit patches; **per-channel membership + owner kill-switches** (`!shutdown`/`!cancel`/
  `!rotate`); every action a **signed event = provenance.** A *shipping* version of "agents as bounded,
  auditable members" — exactly L4.
- **Identity mismatch (bridgeable):** Buzz identity = **Nostr secp256k1** keypairs; ours = **EVM smart
  accounts + OIDC.** Both secp256k1 → bridgeable, but needs an **AuthBridge seam** (Buzz has no EVM/SCW
  notion). Payments + on-chain governance + cross-org federation = **absent → our moat, layered below.**
- **Office coverage:** comms + code + agent workflows — **NOT docs/sheets/tasks.** So **Buzz and
  openDesk are complementary halves,** not competitors.

### The synthesis — a sovereign workplace suite is THREE complementary planes
The two researches make the shape obvious. Röbel/Netizen's job is the **identity + money + governance +
AI glue** that unifies them — the part neither has:

| Plane | Best-in-class sovereign option | What it LACKS → Röbel supplies |
|---|---|---|
| **Office / documents / tasks** | **openDesk** components (Nextcloud, Collabora, OpenProject, OX, Docs, XWiki) | **AI**, wallet identity, payments |
| **Coordination / comms / agent workflows** | **Buzz** (self-host relay, ACP+MCP, agents-as-members, audit) | payments, on-chain governance, office docs |
| **Identity · money · governance · AI-automation** | **Röbel / Netizen** (Röbel ID OIDC, smart accounts, Safe/Zodiac + scoped agent budgets, Circles/Monerium, MACI, LiteLLM+EuroLLM, MCP, cross-node federation) | — *(the moat)* |

**Röbel is the spine that turns openDesk (office) + optionally Buzz (agent-comms) into one
identity-gated, AI-agent-automated, on-chain-settling sovereign workplace — supplying each plane exactly
what it structurally lacks.**

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
5. **Buzz — pattern, adopt, or run it?** (a) adopt its **ACP + agents-as-members** model in our own
   runtime; (b) **run self-hosted Buzz relays** as the node's comms/agent plane + bridge Röbel ID↔Nostr
   identity; or (c) both, phased?
6. **openDesk go-to-market:** apply to the ZenDiS **Vertriebspartner** program (a public-sector reseller
   channel, onboarding fall 2026) — or stay community/self-host and reach institutions via coexistence only?
7. **zk-residency identity lesson (G2):** adopt the peer's **anchor-tier + wallet-independent-nullifier**
   Sybil model (design, not code — respecting the MIT↔AGPL boundary) as Röbel's admission architecture?

---

*Next step after approval + the incoming research reconciliation: superpowers **writing-plans** for
**P3 (Agent Runtime v0)** — the differentiator — since P1 (Röbel ID) is already an approved build and
P2 (cockpit) has its own plan in the OS-SPEC track.*
