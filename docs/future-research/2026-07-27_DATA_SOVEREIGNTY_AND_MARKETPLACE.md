# Privacy for the individual, transparency for the powerful: the data layer

> **2026-07-27.** Companion to [the sovereign client research](2026-07-27_SOVEREIGN_CLIENT_RESEARCH.md).
> Written in response to the thesis: *individual, community, institutional and business data
> should always be cryptographically private and secure, so that data access can be sold via x402
> between nodes, a decentralized data marketplace evolves, and global interdependence through
> trade produces peace.*
>
> This document does three things: corrects a claim I made in the client research, tests the
> marketplace thesis against what actually shipped, and states the strongest objection to the
> peace mechanism along with the version of it that survives.

---

## 1. A correction

In the client research I wrote that privacy primitives "were never going to be your
differentiator." That was imprecise, and as stated it is wrong.

The precise version:

- **Ethereum financial-privacy primitives are commoditizing, fast.** Shielded transfers, Privacy
  Pools, Railgun integration: the Ethereum Foundation is giving these away in the Kohaku SDK
  (released 2026-05-25, GPL-3.0). Reimplementing them would be waste. **This part stands.**
- **Asymmetric transparency as an architectural rule is a differentiator**, and Netizen already
  implements it without having named it. Nobody in the wallet or workspace space holds this
  position, because nobody else has both a citizen and an institution in the same system.

The rule is: **the smaller the actor, the stronger the privacy default; the more power an actor
holds, the stronger the transparency obligation.** That is not a feature. It is a property of a
whole deployment, and it is checkable.

### 1.1 Röbel already implements it

| Actor / data | Visibility today | Which side of the rule |
|---|---|---|
| Individual vote (MACI) | Encrypted, only the aggregate tally is public | Individual: private |
| Citizen PII | Off-chain, access-controlled, never onchain | Individual: private |
| Direct messages | E2E (XMTP v3/MLS) | Individual: private |
| Gemeinschaftskasse treasury | Fully public Safe, every transfer auditable | Power: transparent |
| Attester decisions, thresholds | Onchain, auditable, governance-mutable | Power: transparent |
| Governance proposals and outcomes | Public | Power: transparent |
| Membership roster (soulbound NFTs) | **Public.** See the objection in §1.3 | **Unresolved** |

### 1.2 The concrete recommendation: make it a declared, checkable property

The Node Manifest already declares services. It should also declare, **per data class, a
visibility class**, and `netizen doctor` should verify the deployment matches the declaration.
Something in the shape of:

```
data:
  citizen_pii:        { visibility: private,     basis: art6-1e, retention: … }
  votes:              { visibility: private-aggregate-public }
  treasury:           { visibility: public }
  attestation_events: { visibility: public }
  sensor_energy:      { visibility: sellable, licence: …, price: … }
```

This turns a value statement into an audit artifact. It is the difference between "we believe in
privacy" and "this node cryptographically cannot do the thing you are worried about, and here is
the check that proves it." For a German municipality, and later for a Land agency, the second is
worth money and the first is worth nothing. It also satisfies the standing rule that anything
true of a node must live in the manifest rather than in a hand-configured box.

### 1.3 The objection that must be resolved first

**The membership roster is the hole in the rule.** CitizenNFTv2 holders are a public list. For a
town of 5,000 where citizenship is voluntary and visible, that is a *public register of who
joined a political platform*, permanently, immutably, in a jurisdiction with a specific history
around registers of who belongs to what.

This is flagged as high severity in the client research risk list and it is worth restating here,
because it directly contradicts the principle this document is about. Options, roughly in
increasing order of cost:

1. Onchain commitment only (hash), credential body off-chain. Membership becomes provable but not
   enumerable.
2. Semaphore group over the holder set for all member-facing actions. Note the honest limit: at
   20 to 100 members the anonymity set is too small to mean much on its own.
3. Cross-node anonymity sets, so a proof is "member of some Netizen node" over thousands. This is
   a genuine product reason to want many nodes, and it does not work at n=1.

Nothing else in this document should be built before this is decided.

---

## 2. The marketplace thesis, tested against what shipped

The good news is that the regulatory ground is more favourable than for the client question, and
it is more favourable in a direction that has little to do with crypto.

### 2.1 The EU Data Act is the legal substrate, and it is already in force

| Milestone | Date | What |
|---|---|---|
| Applies | **2025-09-12** | Users can access and share data generated by connected products (Arts. 4 and 5) |
| FRAND obligation | from 2025-09-12 | Users may authorise **third parties** to access their product data, and data holders **must** enable it on fair, reasonable and non-discriminatory terms, with a **reverse burden of proof** on the holder to show terms are non-discriminatory |
| Access by design | **2026-09-12** | Products must be built so the data is accessible |
| Cloud switching | **2027-01-12** | Egress fees must be dropped |
| Legacy contracts | 2027-09-12 | Unfair-terms rules extend to pre-2025 contracts |

([Latham](https://www.lw.com/en/insights/eu-data-act-what-businesses-need-to-know), [Travers Smith](https://www.traverssmith.com/knowledge/knowledge-container/the-eu-data-act-compliance-countdown-for-connected-products/), [Eraneos on Art. 5 FRAND](https://www.eraneos.com/articles/eu-data-act-article-5-and-third-party-data-sharing-on-frand-terms-how-to-comply-and-compete-now/))

Read what that actually is: **a legal right to redirect your data to a third party of your
choosing, plus a statutory pricing discipline on the incumbent who holds it.** That is the market
structure a data marketplace needs, legislated, in force, ahead of anything Netizen would ship.
It is the same shape as the EUDI finding in the client research: the channel is regulatory, not
consumer.

### 2.2 The institutional interface is a data-space connector, not an x402 endpoint

Europe has been building the plumbing for this for six years, and institutions will ask for it by
name:

- **Gaia-X** (AISBL, 2019), **Data Space Business Alliance** (2021), **Data Spaces Support Centre**
  (2022).
- **Eclipse Dataspace Components** (the connector implementation) and the **Dataspace Protocol**,
  which is moving through the IDSA Architecture working group, into the Eclipse Dataspace Working
  Group, and toward final standardization at **ISO/IEC JTC 1**.
- **Catena-X** is the pilot that shows the model works across multiple data spaces at once.

([IDSA](https://internationaldataspaces.org/), [Eclipse Dataspace Components and IDSA](https://internationaldataspaces.org/eclipse-dataspace-components-and-idsa-lets-build-our-data-driven-future-together/))

**Implication:** if a Netizen node is to trade data with a Stadtwerk, a Kreis, a hospital or a
Mittelstand supplier, the counterparty's procurement will ask for a **Dataspace Protocol
connector**, not an HTTP 402 handler. x402 is the right rail for agent-to-agent micropayments.
The Dataspace Protocol is the right rail for institution-to-institution contracts. A sovereign
node should speak both, and the manifest should declare which.

### 2.3 x402 is real, and there are two concrete gotchas

Scale, as of 2026: **119M+ transactions on Base and 35M on Solana by March 2026**, roughly **$600M
annualized volume**, zero protocol fees, x402 Foundation co-governed by **Coinbase and Cloudflare**,
with Visa, Stripe and AWS in the ecosystem. By April 2026, ~165M transactions across ~69,000 active
agents.

**Honest caveat from the same reporting: roughly half of that volume appears to be testing rather
than genuine commerce.** Treat the transaction count as a measure of developer interest, not of a
functioning data economy.

Two engineering facts that matter specifically for Netizen:

1. **Gnosis is not on the Coinbase facilitator's network list** (Base, Polygon, Arbitrum, World,
   plus Solana; Stellar shipped a production facilitator March 2026). Netizen runs everything on
   Gnosis. **To do x402 on Gnosis, Netizen must run its own facilitator.** That is entirely
   feasible, the facilitator model is open, and it is arguably on-brand for a sovereignty project,
   but it is work that must be scoped rather than assumed.
2. **Token support: VERIFIED ONCHAIN 2026-07-27. EURe does not implement EIP-3009.**
   The gasless x402 fast path via `transferWithAuthorization` works natively for USDC and EURC.
   EURe does not have it. Probed against Gnosis mainnet:

   | Check | Result |
   |---|---|
   | `symbol()` on `0x420CA0f9B9b604cE0fd9C18EF134C705e5Fa3430` | `EURe` (right contract) |
   | EIP-1967 implementation | `0x60cb9fdd0fcfd9bb3b2b721864db5e7c07f4635d`, 16,630 bytes |
   | `authorizationState(address,bytes32)` (`0xe94a0102`) | **execution reverted**, selector **absent** from implementation bytecode |
   | `transferWithAuthorization(...)` (`0xe3ee160e`) | **absent** |
   | `receiveWithAuthorization(...)` (`0xef55bec6`) | **absent** |
   | `permit(...)` (`0xd505accf`) | **present** |
   | `DOMAIN_SEPARATOR()` (`0x3644e515`) | **present**, returns `0x861e4d4b…d078` |
   | `nonces(address)` (`0x7ecebe00`) | **present**, returns 0 |

   **So: EIP-2612 permit yes, EIP-3009 no.** x402 supports arbitrary ERC-20s via Permit2, and
   EURe's `permit` makes the Permit2 approval flow workable, but it is the slower two-step path
   (approve Permit2 once, then signature-based transfers) rather than the single-signature
   gasless flow USDC gets. Combined with Gnosis being absent from the Coinbase facilitator's
   network list, **an x402 rail for EURe means running your own facilitator and taking the
   Permit2 path.** Scope it before promising agent-to-agent EURe payments.
   ([x402 network and token support](https://docs.x402.org/core-concepts/network-and-token-support))

### 2.4 Sell the answer, never the corpus

The only version of this that survives GDPR for a German municipality is **compute-to-data**: the
node holds the data, the buyer submits a query or a training job, and only the result leaves.

- **Ocean Protocol** is the reference implementation of this pattern and it is **alive but
  politically messy**: it exited the ASI Alliance in October 2025 amid governance disputes and
  litigation, and is now independent. Development is genuinely active (`ocean-node` v1.0.3 March
  2026, `ocean.js` v6.0.0 February 2026, ~3,400 and ~3,600 commits respectively).
- **Verdict: take the pattern, be careful with the dependency.** Compute-to-data as an
  architectural primitive is correct. Coupling a municipal platform's data economy to a token
  ecosystem in active litigation is not. This matches the earlier stack research, which already
  flagged Ocean and C2D for verification.

### 2.5 The constraint the thesis has to absorb: you cannot sell personal data in the EU

This is the sharpest limit on "individual data can be sold," and it is not a technical one.

Under GDPR, consent must be freely given, specific, informed and **revocable at any time**, and
generally cannot be made a condition of receiving a service. Erasure rights under Art. 17 cannot
be contracted away. A cryptographic access-sale does not change any of that: if a citizen can
withdraw consent tomorrow, "I sold you permanent access to my data" is not a thing the seller can
actually deliver. *(This is settled GDPR doctrine rather than a novel finding, but it is the
constraint most data-marketplace pitches quietly skip.)*

So the marketplace works, in descending order of legal comfort:

1. **Non-personal data**: sensor, energy, mobility, environmental, waste, parking, grid, municipal
   operations. This is where the Data Act actually bites, and it is the larger market anyway.
2. **Business and institutional data**: exactly the European Business Wallet and data-space lane.
3. **Aggregate and derived statistics** over personal data, with a defensible k-anonymity or DP
   story.
4. **Compute-to-data over personal data**, where only the answer leaves and the query is logged
   and auditable. Feasible, but each use needs a lawful basis.
5. **"Citizens sell their personal data" as a consumer product.** Not available. Do not build the
   pitch around it.

Reframing 1 to 4 as the product is not a retreat. A town that can sell auditable access to its
energy, mobility and environmental data, on FRAND terms, under a manifest that proves what is and
is not exposed, is a genuinely new and legally clean thing. No incumbent offers it.

---

## 3. The peace mechanism, and the correction it needs

The stated mechanism is *doux commerce*: global dependence through trade produces peace. It has a
real literature behind it (the capitalist peace / commercial peace thesis) and it also has a
serious, specific rebuttal that the architecture should be designed against rather than around.

**The rebuttal:**

- Norman Angell argued in 1910 that economic interdependence had made war irrational. Four years
  later, the most interdependent economies in history went to war with each other.
- **Grinberg (International Security, 2021)** found states frequently trade *while* fighting each
  other, which undercuts trade as a preventive mechanism.
- **Farrell and Newman, "Weaponized Interdependence" (International Security, 2019)** is the
  strongest version: states with political authority over the central **hubs** of a global network
  exploit that position to coerce. Interdependence can *spur* conflict by creating competition to
  control important nodes. Their charge against the liberal account is that it "avoided the
  question of power" by assuming vulnerabilities are reciprocal when they are in fact asymmetric.
  ([Brookings, ch.1](https://www.brookings.edu/wp-content/uploads/2020/05/9780815738374_ch1.pdf),
  [Weaponized interdependence](https://en.wikipedia.org/wiki/Weaponized_interdependence))

**The correction, and it strengthens rather than weakens the project:**

> Interdependence pacifies only when it is **symmetric and hard to weaponize**. Concentrated
> chokepoints convert interdependence into coercion. The peace-relevant variable is not the volume
> of trade. It is **the absence of a chokepoint.**

Every real case of weaponized interdependence runs through a hub someone controls: dollar
clearing, SWIFT, a handful of clouds, a frontier-model API, one country's chip lithography. More
trade *through a hub* increases the hub's coercive power. More trade *across a mesh with no hub*
does not.

Which means the correct statement of the Netizen thesis is not "data trade produces peace." It is:

> **A federation of many small sovereign nodes, each holding its own data and selling access on
> its own terms, is an anti-chokepoint architecture. It makes interdependence harder to
> weaponize.**

That version is defensible against the best available critique, it is architecturally testable
(does adding a node reduce or increase concentration?), and it pitches far better to European
institutions, because de-risking from chokepoints is precisely what EU digital-sovereignty policy
is already about. "Trade brings peace" reads as naive to a Land CIO. "No single party can cut you
off" reads as procurement criteria.

### 3.1 The self-critique this implies

**Netizen Cloud is a candidate chokepoint.** If the managed-hosting business succeeds and most
nodes run on it, Netizen becomes the hub, and the thesis eats itself. The business model is in
direct tension with the stated mission, and pretending otherwise would be dishonest.

The mitigation is not modesty about the business. It is **credible exit, engineered and provable**:

- The Node Manifest must be sufficient to reconstruct a node elsewhere, and `netizen render` must
  be reproducible against a third-party host. If a customer cannot leave in an afternoon, Netizen
  is a hub.
- No proprietary component may sit on the path between a node and its own data.
- Key custody stays with the node operator, never with Netizen Cloud.
- Concentration should be *measured and published*: what share of live nodes does Netizen host?
  A project whose thesis is anti-chokepoint should report its own concentration ratio the way a
  bank reports capital adequacy.

That last item is a small thing to build and it is the single most credible signal that the
mission is real rather than marketing.

---

## 4. What follows for the build

Ordered, and every item is independent of the client question:

1. **Resolve the public-roster problem** (§1.3). Nothing else here is coherent until it is decided.
2. **Add visibility classes to the Node Manifest** and a `netizen doctor` check that verifies them.
   Turns the principle into an audit artifact.
3. **Scope a self-run x402 facilitator on Gnosis**, and verify onchain whether EURe implements
   EIP-3009. Both are blockers for the payment rail and both are cheap to check.
4. **Evaluate a Dataspace Protocol connector** for the node. This is the institutional interface,
   and it is the same category of bet as the EUDI relying-party work: unglamorous, standards-shaped,
   and the actual reason an institution can buy.
5. **Adopt compute-to-data as the pattern**, borrowing the architecture from Ocean without taking
   the token dependency.
6. **Start with non-personal municipal data** (energy, mobility, environment). It is where the Data
   Act bites, it is legally clean, and Röbel plausibly already generates some of it.
7. **Publish the concentration ratio** once node #2 exists.

---

## 5. Unverified

- ~~Whether EURe implements EIP-3009~~ **RESOLVED 2026-07-27: it does not.** EIP-2612 permit only.
  See §2.3, verified onchain against Gnosis mainnet.
- ~~Railgun's Gnosis support~~ **RESOLVED: not supported.** Railgun is live on Ethereum, BSC,
  Polygon and Arbitrum; announced 2026 expansions are Solana, NEAR, Arbitrum and Metis. Gnosis is
  neither supported nor announced, and Kohaku's "mainnet then L2s" path does not cover an
  independent L1 sidechain.
- Whether any **x402 facilitator supports Gnosis** today, or whether self-hosting is the only path.
- The **$600M annualized x402 volume** and the "roughly half is testing" characterization both come
  from secondary analysis, not protocol telemetry.
- **Ocean Protocol's litigation status** and what it means for depending on their contracts.
- Whether any **German municipality has actually sold data access** under the Data Act since
  2025-09-12. If the answer is none, that is the single most important thing to learn before
  building item 6, and it is a phone call rather than a research project.
