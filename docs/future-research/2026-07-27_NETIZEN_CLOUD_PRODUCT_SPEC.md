# Netizen Cloud — product & business spec

**Date:** 2026-07-27
**Status:** Draft for review. Grounded in a **working** Genesis Node (Röbel), not a concept.
**One line:** *Sovereignty as a service — we run the setup and the babysitting; you own the keys, the data and the exit.*

---

## 0. Why this is credible now

Röbel is live on hardware the community controls: its own OIDC keystone, Nextcloud +
Collabora with wallet SSO, a members-only Nostr relay, TLS — brought up by **one
command** from **one signed manifest**. Every fix during that build went into the
installer, not the box, so the second node inherits it.

That is the entire business thesis, already proven once: **deployment #2 is config,
not rewrite.**

---

## 1. What we sell

Not "servers". A **sovereign node**: identity, communication, workspace, money rails
and AI, on infrastructure the customer owns, with an exit that actually works.

### The SKU list is the manifest

Each add-on is a manifest section the installer already understands. This is unusually
clean: the product catalogue and the technical spec are the same artifact.

| Add-on | Manifest | What the customer gets |
|---|---|---|
| **Sovereign Identity** (base) | `identity` | Their own OIDC provider. Wallet + social login. "Sign in with *your node*" |
| **Workspace** | `services.workspace` | Files, live docs, wiki, video, projects — the openDesk-equivalent suite, SSO'd |
| **Communication** | `services.chat` | Matrix/Element for humans, Nostr relay for members and agents |
| **Sovereign AI** | `ai` | Model gateway, EU inference, MCP tool bus, data-egress policy under their control |
| **AI workers** | `ai.workers`, `agents` | Agents as members: own keypair, budget, kill switch, audit trail |
| **Financial rails** | `treasury`, `chain` | Multisig treasury, community currency, onchain payments |
| **Governance** | `governance` | Private voting (MACI), proposals, execution |
| **Durability** | `operations` | Backups, restore drills, hardening |

Customers start with Identity + Workspace and add modules. Every add-on is a manifest
edit followed by `netizen up` — no migration, no re-platforming, no sales engineering.

### Who buys

1. **Municipalities / public bodies (DE/EU)** — EU data residency, openDesk-adjacent
   stack, procurement-friendly. Slowest sales cycle, highest contract value, strongest
   reference effect.
2. **Associations, clubs, cooperatives** — the Röbel shape. Cheap, high volume, low
   support tolerance. This is where "one click" must genuinely be one click.
3. **SMEs / agencies** — want the workspace + AI without US SaaS.
4. **Individuals and AI-native builders** — the long tail; the wedge for developer
   credibility, not revenue.

---

## 2. Architecture: why this is not Fly, and must not become it

**One box per customer.** Not a multi-tenant scheduler over shared capacity.

That single decision removes most of the hard engineering. Fly's complexity —
Firecracker, anycast BGP, global scheduling, live migration — exists to pack many
tenants onto shared hardware. We do not need it: a community's entire backend is a few
GB. The economics are Discourse/Ghost hosting, not hyperscaler.

```
┌──────────────────────────────────────────────────────────┐
│  CONTROL PLANE  (the only multi-tenant component)        │
│  signup · manifest editor · provisioning · monitoring    │
│  billing · scoped credential vault · audit               │
└───────────────┬──────────────────────────────────────────┘
                │  netizen render / up / doctor  (the SAME cli customers can run)
   ┌────────────┼────────────┬────────────┐
   ▼            ▼            ▼            ▼
 node A       node B       node C       node D      ← independent boxes,
 (Röbel)      (a club)     (a Stadt)    (an SME)      independent data, independent keys
```

**The control plane is thin on purpose.** It provisions hardware, writes DNS, holds
scoped credentials, and runs the same open-source installer the customer could run
themselves. That constraint *is* the sovereignty promise: if we disappear, the node
keeps running and the customer has the manifest.

### "Nohau" — the setup agent

What a human did manually for Röbel is exactly what the agent automates:

1. Take the customer's answers → **generate a manifest** (the SKU choices)
2. **Provision** a box (Hetzner API today, any provider later — `services.host`)
3. **Write DNS** and wait for propagation (see `DNS_AUTOMATION.md`)
4. **`netizen up`** → **`netizen doctor`** → report
5. Monitor, patch, take backups, run restore drills

**This is automatable only because the installer is declarative.** An agent cannot
reliably improvise a 40-step runbook; it can absolutely run one validated command and
diff the result against a manifest. Everything we pushed into the installer during the
Röbel build was, in effect, building the agent's hands.

---

## 3. Pricing (hypothesis — validate before publishing)

Cost anchor from the real node: a **CPX42 is ~€82/mo**; smaller communities fit a
~€23–42/mo box. Bandwidth and backups add a little. **Hardware is not the cost driver —
support and on-call are.**

| Tier | Target | Node | Price/mo (hypothesis) |
|---|---|---|---|
| **Community** | clubs, small associations | shared-spec small box | €99 |
| **Town** | Gemeinde, larger org | CPX42-class | €299 |
| **Institution** | municipality, SLA, DPA, custom domain, priority | dedicated + standby | €900+ |
| **Self-host** | anyone | their hardware | **€0** — open source, paid support optional |

Add-ons (AI, agents, governance) as per-module uplifts, since they carry real marginal
cost (inference, RPC, coordinator ops).

**Margin reality:** infrastructure gross margin looks excellent (~70-90%). It is also
*not the real number*. One serious support incident or a restore-under-pressure can
consume a year of a Community-tier subscription. Price for **operations**, not for
compute, and cap low-tier support to asynchronous channels or the tier is a loss leader.

**Free self-hosting is strategy, not charity.** It creates the credibility and the exit
guarantee that makes the paid tier trustworthy. Discourse, Ghost, Matrix and Nextcloud
all run this model.

---

## 4. Hosting path

`services.host` already abstracts the provider, so this is config, not architecture:

1. **Hetzner (today)** — cheap, EU, excellent price/performance.
2. **EU sovereign clouds (Schwarz Digits, Ionos, OVH, Scaleway)** — matters for public
   procurement, where "German operator" can be a hard requirement. Partnership >
   reselling: they want workloads, we bring a differentiated one.
3. **Own hardware** — only when volume justifies capex, and only with a partner for
   datacentre operations. This is a *later* narrative asset, not an early move.

**Honest caution:** owning racks converts a software margin into a capital-intensive
operations business. Do it when customers demand it contractually, not for the story.

---

## 5. The hard parts (do not skip these)

1. **You become a data processor.** Multi-tenant hosting of citizen data means DPAs,
   subprocessor lists, breach notification duties, and audits. A single-node
   assumption does not survive contact with this. Budget for legal, not just code.
2. **On-call is the product.** Non-technical customers cannot debug a failed cert or a
   full disk. Monitoring, alerting and a real response process are table stakes.
3. **Restore, not backup.** The first customer restore will happen under pressure.
   Run drills before you sell the tier that promises it.
4. **The keystone's blast radius** (see `NODE_SECURITY_POLICY.md`): compromise of a
   node's signing key impersonates every user on that node. Running many nodes
   multiplies this, and makes the control plane a very attractive target.
5. **Support load scales with non-technical users**, not with revenue. The cheapest
   tier generates the most tickets. Automate or restrict it.
6. **Upgrade treadmill.** Nextcloud, Synapse, Collabora and Postgres all ship security
   releases. Someone must own patching across every customer node.

---

## 6. Positioning and copy

Working line: **"The sovereign stack. Your identity, your data, your infrastructure."**

- **openDesk:** we reuse the same open components (Nextcloud, Collabora, XWiki, Jitsi,
  OpenProject, Matrix). Say that factually — *"the same open stack the German
  administration uses, on infrastructure you own"* — and do **not** imply partnership,
  endorsement or certification we do not have.
- **EUDI / eIDAS 2.0:** roadmap, not shipped. Keep it in "where we are going" or it
  becomes the first thing a public buyer tests.
- **AI:** claim sovereignty only where the manifest enforces it. Röbel's own
  `ai.selfHosted` is `false` today and `doctor` says so out loud — that honesty is an
  asset with this buyer, not a weakness.
- Copy rules: no em-dashes, "Onchain" as one word, never name Optimism publicly.

---

## 7. Build order

| Phase | Deliverable | Gate |
|---|---|---|
| **P0** *(done)* | Manifest + installer + a live Genesis Node | ✅ Röbel |
| **P1** | `netizen dns` + provisioning API → a node from zero without a human | node #2 exists |
| **P2** | Control plane: signup, manifest editor, credential vault, status | first paying customer |
| **P3** | Monitoring, patching, backup/restore automation | first SLA tier |
| **P4** | Nohau end to end: conversational signup → live node | non-technical self-serve |
| **P5** | Marketplace: add-ons, agent skills, community templates | network effects |

**The next real milestone is node #2**, and it should be a *stranger's* node, not
another of ours. Everything before that is still one deployment with good tooling.

---

## 8. Open questions

- Which customer is node #2, and can they be onboarded without us touching a terminal?
- Do we operate customer nodes under our Hetzner account (simpler, we are the
  controller) or theirs (more sovereign, harder support)? **This choice defines the
  legal shape of the company.**
- What does exit look like concretely — we hand over the manifest, the box and the
  keys? Write and publish that guarantee; it is the strongest differentiator against
  every SaaS competitor, and it is worthless unless it is specific.
