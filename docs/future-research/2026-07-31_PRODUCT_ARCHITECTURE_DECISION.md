# One platform vs. focused products — the Netizen product-architecture decision

> 2026-07-31, asked by Max directly: *"should everything run under a single Platform called
> Netizen Labs, or should Netizen Labs publish single focused products that are all
> interoperable?"* — for a line that spans identity, governance, financial infrastructure,
> workspace, sovereign AI, and later possibly robotics/BCI, all onchain. This doc records the
> answer so every parallel workstream builds against the same shape.

## The decision

**Focused, standalone products · one open protocol as the composition layer · one identity ·
one brand house · the "platform" sold only as a packaging tier (Netizen Cloud).**

In one sentence: **sell products, ship a protocol, operate a cloud.**

## The four rules

1. **Every product must stand alone.** Accounts (wallets + governance-gated paymaster),
   Coordinator-as-a-service (private voting), Registry + Factory (one-guided-flow civic
   deployment), Workspace, Sovereign AI — each adoptable without the rest, each priced alone,
   each honest against its best-of-breed single-product competitor (Privy, Aragon-class tooling,
   Nextcloud hosting, etc.). Precedents this corpus already follows: Conduit's AA/RPC/Indexing
   "work on any rollup, not just Conduit chains"; the minimum-viable-node decision ("a relay
   that federates is a legitimate node") is the same rule stated as protocol. Standalone-ness is
   also the GTM: "give away the tool that finds the customer" requires the tool to work alone.

2. **Interoperability is the manifest, not an integrations page.** The NSP manifest is
   simultaneously the product catalogue, the deployment unit, and the conformance contract —
   adopting a second product is a manifest edit + `netizen up`. Identity (keystone/OIDC +
   membership NFTs) and the CommunityRegistry make products compose by construction. The
   compound is the moat ("everyone builds agent payments, nobody ships agent authorization" —
   an identity×governance×treasury compound no point product can copy). Single products are
   doors; one house stands behind every door.

3. **The bundle is a packaging tier, never the architecture.** The Microsoft-365-shaped buyer
   (Kommune, SME) wants one vendor, one bill, one DPA — that is **Netizen Cloud**, and it is a
   *pricing/packaging* construct over the same standalone products. What must never become "the
   platform" is Netizen Labs itself: the client invariant ("if netizen.xyz disappears, every
   node keeps running") and the openDesk lesson (its unswappable Nubus IAM is exactly why we
   stay component-compatible and never adopt the suite) both say the platform is the **open
   protocol**; the company sells convenience, integration, operations, accountability — never
   lock-in.

4. **One brand house, light sub-brands, spin-outs only on structural breaks.** "Netizen
   Accounts", "Netizen Coordinator" — sub-brands under Netizen Labs, the way Conduit runs
   G3/Elector/AA/Privacy Suite under one name and no token. No separate companies at one-person
   scale; brand trust compounds and the fork covenant must cover everything. A future line spins
   out only when it becomes a structurally different business (robotics/hardware capex — the
   wealth study's own warning that racks convert software margin into a capital-intensive ops
   business), not when it merely has a different buyer.

## Why not the two pure alternatives

- **Monolithic platform**: procurement reads it as lock-in (the Decidim path wins on
  "compatibility, not superiority"); it violates the AGPL/fork covenant that makes the paid tier
  trustworthy; a one-person company cannot hold a monolith's quality bar across six domains; and
  the support-load warning (cheapest tier generates the most tickets) gets multiplied by every
  domain the monolith drags into every sale.
- **Fully separate products/brands**: forfeits the compound moat (rule 2), fragments trust and
  the credible-neutrality story across brands, and multiplies fixed cost (sites, docs, legal)
  at exactly the scale that cannot afford it. Voting UIs alone are a dying category — the
  corpus already leads with treasury/compliance/cash-flow value, which is a compound.

## Brand architecture (addendum, same day — Max's follow-up: "Ortis powered by Netizen Labs?")

**Endorsed-brand house: one company, one earned product brand, everything else under Netizen.**
The test: *a segment earns a brand only when the existing brand would actively hurt the sale* —
never because the roadmap grew a line.

- **Netizen Labs** — the company, the protocol (NSP), the dev surface: Atlas, `@netizen-labs/*`,
  Accounts SDK, the operator console. This answers the standing "what is app.netizen" question:
  **app.netizenlabs = the operator/builder console; the citizen door gets the product brand.**
  Dev wedge to build here: Accounts as the *agent-installable* SDK (llms.txt + MCP + docs
  written for AI agents to execute — "tell your AI to add Netizen identity").
- **"Ortis" (working name), powered by Netizen** — the ONE justified separate brand: the
  civic/workspace suite (Proton/Workspace/M365-shaped; openDesk alternative-or-extension in
  Germany, onchain privacy-preserving workspace worldwide). Justified three ways: the standing
  rule *never frame civic work as a Blockchain-Verwaltungsprojekt* (the Kommune buyer must meet
  a calm German product, not a crypto lab); the consumer-privacy story rejects crypto branding;
  "Ortis" (Ort) fits the market. **Gates before the name is real**: EUIPO/DPMA search (an EU
  "Ortis" mark exists in supplements — different Nice class, verify), domain, and — hard gate —
  **brand launches when the first non-Röbel customer signs, not before.** Reserve now, build
  one brand's web presence at a time.
- **Enterprise = a tier of the suite** (SLA/DPA/audit attachments), never a third brand.
- **Nohau = the model's name inside both surfaces** (as Gemini inside Workspace) — a component
  brand, never a company.
- **Robots / BCI / AR / digital twins / futarchy / RWA** — unnamed R&D under Netizen Labs until
  a line has a paying customer AND a structural break (hardware capex is the spin-out trigger,
  per the wealth study). Naming pre-revenue lines is playing company instead of building one.
- **The invariant thread: the Netizen Account.** "Sign in with Netizen" is identical in Ortis,
  mini-apps, indie apps, and every future surface — the one brand element that must never fork,
  because it is both the UX glue and the actual moat.

## What this changes in practice

- Product specs must state their standalone story AND their manifest module in the same doc
  (the accounts and coordinator-aaS specs already do — this doc makes it the rule).
- Pricing pages: per-product prices plus Cloud bundle tiers; never "platform seats".
- New far-out lines (robotics, BCI, embodied data) enter as **manifest modules + standalone
  products** first, under the same identity and treasury rails; spin-out is a later, explicit
  decision with a structural trigger.
- Marketplace posture stays two-way: third parties ship manifest modules into the Netizen
  ecosystem; Netizen products get listed in other ecosystems' marketplaces (the empty
  identity/governance slot in RaaS marketplaces is a distribution channel).
