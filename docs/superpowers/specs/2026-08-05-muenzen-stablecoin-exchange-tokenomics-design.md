# Röbel Münzen ↔ Stablecoin Exchange — Sustainable Tokenomics Design

**Date:** 2026-08-05
**Status:** DRAFT — designed autonomously from repo context + external research; awaiting Max's review (open questions in §12)
**Related:** `docs/CIRCLES_TOKENOMICS.md` (current economy), `docs/superpowers/specs/2026-06-20-roebel-muenzen-economy-design.md` (Phase 5 was "EURe on/off-ramp" — this spec IS Phase 5), `docs/SOVEREIGN_AI_COMMUNITY_WEALTH_STUDY.md` §5 (epoch dividend auction, 50/30/20), `docs/superpowers/specs/2026-08-05-x402-metered-data-access-design.md` (treasury inflow #1), `docs/MONERIUM_FIAT_TREASURY_RESEARCH.md` (EURe rails + German legal)

## 1. Goal

Make the Röbel Münzen every citizen mints exchangeable against stablecoins (EURe)
from the Gemeinschaftskasse — **without draining the treasury, without a false
par promise, and in a way that makes holding and spending Münzen more attractive
over time** (network effects). The exchange itself must be the visible proof that
community revenue flows back to citizens.

## 2. The constraint that shapes everything: the faucet problem

Münzen are not purchased — they are **issued**. Every citizen mints up to
24/day (~720/month) from the Circles protocol, demurraged at ~7%/year. Any
fixed exchange rate against a finite treasury is therefore an **unbounded
liability**: the faucet never stops, the treasury does. The wealth study calls
this the honesty constraint — "if citizens were paid from a closed loop of
self-minted tokens, it would net to zero."

Two consequences:

1. **The stablecoin outflow must be bounded by real external revenue**, never
   by demand for exchange.
2. **The rate must float.** A fixed rate is both economically indefensible and
   legally dangerous (a token redeemable at par on demand looks like e-money /
   Einlagengeschäft; see §9).

Demurrage helps: supply per always-minting citizen asymptotes at roughly
8,760 CRC/year ÷ ~7%/year ≈ **~120k Münzen** — bounded, but far above any
realistic backing. The design never relies on full backing.

## 3. Approaches considered

### A — Fixed-rate redemption desk (rejected as the citizen rail)

Post a rate (e.g. 100 Münzen = 1 EURe), cap per citizen per month.
*Pro:* predictable, easy to explain. *Contra:* the rate is arbitrary and
becomes a permanent governance fight; a standing par-ish promise is the worst
legal posture (e-money perimeter); caps must be tuned constantly to protect
the treasury; over-generous = drained, under-generous = dead letter.

### B — Epoch dividend auction (CHOSEN as the citizen rail)

The wealth study §5 mechanism, operationalized: each epoch the treasury funds
a **fixed EURe pool D from realized revenue**; citizens deposit Münzen during
the window; the rate **emerges** as `rate = D ÷ total deposited`; everyone
claims pro-rata. Self-balancing (heavy selling → low rate → holding becomes
rational), **un-drainable by construction** (never pays out more than D),
oracle-free, and credibly neutral (per-capita claim lane, sybil-resistant via
CitizenNFT). It reframes exchange as what it economically is: **the citizen
dividend, priced by demand and indexed to community revenue.**

### C — AMM / public market only (deferred, additive later)

Wrap RCRC (ERC-1155 → ERC-20 demurrage wrapper), seed an RCRC/sDAI or
RCRC/EURe LBP, let the market price it; treasury does discretionary buybacks.
*Pro:* continuous price signal; Circles v2 ships native backing/LBP tooling
(CowSwap integration). *Contra as the primary rail:* value leaks to
non-citizens and bots (anyone can sell into treasury buy-support), no
per-capita fairness, LP + wrapper complexity, and a thin pool at today's scale
is trivially manipulable. Useful **later** as a public price signal once the
auction has established a track record.

### The chosen shape: three rails, one treasury

| Rail | Who | Mechanism | Bounded by |
|---|---|---|---|
| **Bürgerdividende** (epoch auction) | verified citizens | deposit Münzen → pro-rata share of a fixed EURe pool | the pool D = f(revenue) |
| **Merchant desk** (Chiemgauer model) | registered local businesses | redeem Münzen received from sales at **95%**, 5% fee to the community | their actual Münzen sales |
| **Public market** (deferred) | anyone | RCRC/sDAI LBP seeded small | seeded liquidity only |

Merchants get the fixed-rate desk *because their Münzen were earned by selling
real goods, not minted* — their redemption volume is naturally bounded by real
economic activity, and predictability is what makes a shop say yes. This is
the proven Chiemgauer mechanic (5% Rücktauschgebühr; there: 2% system, 3% to a
Verein the customer chose — 289 Vereine funded that way).

## 4. Rail 1 — the Bürgerdividende (epoch auction)

**Epoch cadence:** monthly (manifest/config-tunable).

**Pool funding (the constitution):** every epoch, net treasury inflows of the
*prior* epoch split per the wealth study's constitutional rule:

```
50%  Bürgerdividende pool D   ·   30%  endowment (sDAI)   ·   20%  reinvest
```

Never principal, only realized inflows. If inflows were €0, D is €0 and the
epoch simply doesn't open (published as such — honesty is the product).
A donor/bootstrap floor (e.g. €100/epoch from earmarked donations) can keep
the loop visibly alive in the first year.

**Mechanics per epoch:**

1. **Announce:** pool D (EURe), window (e.g. last 7 days of the month),
   per-citizen deposit cap (anti-whale; start flat, e.g. 200 Münzen).
2. **Deposit:** citizen sends RCRC to the epoch collector (one tap in the app;
   ERC-1155 `safeTransferFrom`, gasless via smart account — same UX as the
   existing lootbox spend).
3. **Close:** `rate = D ÷ totalDeposited`. Published immediately.
4. **Payout:** one **batched EURe Safe transaction proposed** from the GK
   (identical pattern to the x402 payout job — the job proposes, 3-of-5 owners
   confirm; it cannot self-execute). Dust threshold €1, sub-threshold rolls
   to next epoch.
5. **Recycle & burn:** deposited Münzen first refill the **funder float** up
   to its target (civic rewards get funded with bought-back, revenue-backed
   Münzen — the earn rail stops being pure emission), any excess is burned
   (group burn; collateral stays in the vault → remaining supply becomes
   over-collateralized, strengthening backing).

**Eligibility:** CitizenNFT holders, one lane per human. v1 uses the plain
NFT-gated claim (public linkage, acceptable at launch); the Semaphore v4
per-epoch-nullifier upgrade from the ZK assessment restores anonymity later.

**Why citizens can't farm it:** minting hard to dump into the auction only
lowers the rate for everyone including yourself — D is fixed. The cap keeps
any single wallet from dominating. Demurrage taxes hoarding-for-later-epochs.

**The rate is the progress index.** Rising D (more revenue) with steady
deposits = visibly rising rate. Publish the full history — this chart *is*
the "technology makes us richer" claim, on-chain.

## 5. Rail 2 — the merchant desk (the circulation engine)

The auction gives Münzen a *floor of expectations*; the merchant loop gives
them *daily usefulness* — this is where network effects actually come from.

- **Acceptance:** registered local businesses accept Münzen at the posted
  face value (see next point) for a self-chosen share of the bill (start
  partial, e.g. 10–30%, merchant's choice — limits their exposure while the
  system proves itself). Payment QR already exists in the mini-app (Flow tab)
  and Metri.
- **Face value:** the *posted* face value for acceptance is set per epoch to
  the trailing average auction rate (e.g. "1 Münze = 5 ct this month") — so
  merchant acceptance and citizen dividend can never drift into two
  incompatible prices.
- **Redemption:** quarterly (or on demand above a minimum), a business
  redeems accumulated Münzen at **95% of face value in EURe** from the GK.
  The **5% fee splits: 3% → GK treasury, 2% → a Verein the business picks**
  (Chiemgauer-proven; instantly makes every local Verein an ally of the
  currency).
- **Bounded:** a merchant can only redeem what customers actually spent —
  redemption liability scales with real local commerce, and each redemption
  *feeds* the treasury 3%.
- **Merchant Münzen can also be spent, not redeemed** — at other merchants,
  as employee perks, or into the auction like any holder. Redemption is the
  exit, not the point.

## 6. Treasury value-add — where the EURe comes from

Ranked by time-to-euro; all land in the GK Safe
(`0x3A08c86Efc5ff38CC35d850F1D4d564e497bFDEa`) and are published on the
Prosperity Ledger:

1. **x402 metered data access** (designed, slice 1 planned): machine-scale
   reads of the community record, 50% treasury share. USDC.e on Gnosis +
   Base + Stripe rails.
2. **Monerium donation rail** (Phase-0 rail, KYB gating): SEPA → EURe
   auto-mint into the Safe, zero fees. "Unterstützen", not "Spende", until
   the e.V. exists.
3. **Bootstrap software revenue** (wealth study §6.4): Fördermittel agent,
   sovereign SME AI, white-label civic OS — the lines modelled at
   €10.5k/month in study Year 1.
4. **Merchant desk fee:** 3% of every business redemption.
5. **Treasury yield:** idle EURe → **sDAI on Gnosis (~4–5% APY currently)**.
   Endowment tranche (30%) lives here by default. Gated on the
   Anlagerichtlinie / gemeinnützigkeits question (Monerium research §6 —
   unresolved; keep inside freie Rücklage once the e.V. exists).
6. **App sinks that charge real money** (tourists/outsiders): event tickets,
   marketplace fees, mini-app platform fees — euro in, Münzen out as change
   or rewards.
7. **Grants** (Fördermittel agent running for Röbel itself).
8. **Later:** embodied-data exports, robot/energy income (study §6) — the
   compounding engine; not load-bearing for this design.

**Currency policy:** the GK will hold USDC.e (x402) and EURe (donations,
payouts). The dividend and merchant desk pay **EURe** (euro-denominated,
Monerium-redeemable). A small ops task converts USDC.e → EURe per epoch
(CowSwap on Gnosis) or holds it as diversification — treasury policy, Safe
owners' call, published either way.

## 7. Sinks — what Münzen buy (demand side of the loop)

Every sink reduces auction sell-pressure and raises the equilibrium rate.
Existing: lootbox keys, tips, in-chat payments. Add, in rough order of value:

1. **Citizen AI quota** (Floor 3 of the wealth study): pay Münzen for extra
   sovereign-AI usage (Mecky pro features, image gen, agent runs). Marginal
   cost to the treasury is near zero on already-provisioned compute — the
   highest-margin sink available, and it ties the currency directly to the
   community's AI capital.
2. **Event tickets & town services:** citizen-organized events priced in
   Münzen; priority booking; Amt-adjacent perks where legally clean.
3. **Data credits:** x402 paid tiers purchasable with Münzen at face value
   (outsiders effectively buy Münzen to read the record → real demand).
4. **Marketplace escrow:** the existing marketplace settles in Münzen.
5. **Verein donations:** one-tap Münzen donation to local Vereine (they
   redeem via the merchant desk → 5% fee cycle even on charity).

## 8. Sustainability math (worked example, honest numbers)

Today: ~20 verified citizens, RCRC supply ~138 (June), revenue ≈ €0 until
x402/donations ship. The design activates *proportionally* — it cannot run
ahead of revenue.

**Bootstrap epoch (Year 0):** donations floor €100 → D = €100. 10 citizens
deposit the 200-Münzen cap → 2,000 deposited → rate = 5 ct/Münze. Max payout
€10/citizen. Small, real, published. Total annual exposure: ≤ €1,200 — less
than one grant.

**Study Year-1 epoch:** net inflows €12,500/month (wealth study base case) →
D ≈ €6,250. 150 citizens, cap 500: if 60,000 deposited → ~10 ct/Münze; a
fully active citizen (720 minted/month, deposits 500) receives ~€52/month —
the study's €42–48 dividend band, derived instead of assumed.

**Failure mode check:** revenue halves → D halves → rate halves → holding
and spending beat selling → deposits fall → rate partially recovers. The system
degrades to "small dividend", never to "insolvent treasury". There is no
bank-run state: nothing is owed until a pool is funded.

**Merchant desk exposure:** self-limiting — redemptions ≤ face value of
actual local sales, minus 5%, of which 3% returns to the GK. At €1,000/month
local Münzen commerce with full redemption: €950 out, €30 back, €20 to
Vereine. The treasury's *net* cost of the entire merchant loop is ~92% of
merchant sales — and every one of those euros bought real local goods first.

## 9. Legal guardrails (Germany — sequencing, not blockers)

Follows the wealth study Phase plan and the Monerium research findings:

1. **No par promise, ever.** Copy never says "Umtausch 1:1", "einlösbar",
   or guarantees a rate. The citizen rail is a **"Bürgerdividende"** /
   **"Ausschüttung"** the treasury funds from revenue; the rate is an outcome,
   not an offer. This keeps distance from E-Geld (§1a ZAG) and
   Einlagengeschäft (§1 KWG) — final wording needs the Rechtsanwalt pass the
   study already mandates.
2. **Stage 1 = Abundance Coupons** (study Phase 1): before legal clearance of
   euro-out, the auction pays **coupons** (AI quota, event tickets, energy
   credits, below-market essentials) instead of EURe. Identical mechanics,
   zero e-money surface. EURe payout is a config flip once cleared.
3. **Merchant desk under the limited-network exemption** (§2 Abs. 1 Nr. 10
   ZAG): clearly bounded acceptance network, published merchant list. The
   Chiemgauer/Regios structure (association or eG operates the desk) is the
   template; note the EBA limited-network guidelines and the ~€250/month
   thresholds when the desk grows.
4. **Entity:** the gemeinnütziger e.V. (Monerium research §6) should own the
   desk + donation rail; Schenkungsteuer and Mittelverwendung constraints as
   researched. Keep the treasury non-municipal.
5. **Not investment marketing:** the dividend is framed as community revenue
   sharing to verified residents, no purchase price, no profit expectation
   from a purchase → outside prospectus/VermAnlG territory; confirm in the
   legal pass.
6. **sDAI yield** stays an open legal question (no guidance for gemeinnützige
   stablecoin/DeFi holdings) — board-approved Anlagerichtlinie, freie
   Rücklage, revisit per BMF guidance.

## 10. Implementation slices

Reuses the funder/claim/payout patterns that already exist — no new
infrastructure class.

- **Slice 0 — rails + policy (ops, mostly gated on Max):** x402 slice 1
  ships (inflow #1); Monerium KYB + IBAN (inflow #2); constitutional split +
  epoch parameters as an `app_settings`/manifest block; legal wording pass;
  decide coupon-first vs EURe-first.
- **Slice 1 — the epoch engine:** `dividend_epochs`, `epoch_deposits`
  tables + edge fn (announce/deposit-verify/close); deposit = RCRC transfer
  to the epoch collector address, verified by `TransferSingle` log exactly
  like `spend-muenzen`; close computes rate; payout job **proposes** the
  batched EURe Safe tx (x402 payout-job pattern); recycle-to-funder + burn
  step; Expo UI: "Ausschüttung" card in the rewards home (pool, countdown,
  deposit, claim, rate history chart). CitizenNFT-gated.
- **Slice 2 — coupons (if coupon-first):** payout in AI-quota/ticket coupons
  via the existing rewards infra instead of EURe; everything else identical.
- **Slice 3 — merchant desk:** merchant registry (org accounts exist),
  acceptance QR (mini-app Flow tab reuse), redemption request + quarterly
  batched Safe payout at 95%, 3/2 fee split, Verein picker; public merchant
  map in app + web ("Hier gilt die Münze" — the acceptance map IS the
  marketing).
- **Slice 4 — sinks:** AI-quota purchase with Münzen (highest-margin sink);
  x402-tier purchase with Münzen; ticket sink.
- **Slice 5 — public price signal (deferred):** small RCRC/sDAI LBP via the
  Circles backing tooling; Prosperity Ledger publishes auction-rate vs
  market-rate.
- **Privacy upgrade (parallel track):** Semaphore v4 claim lane per the ZK
  assessment.

Each slice gets its own implementation plan (writing-plans) after spec
approval.

## 11. Metrics (Prosperity Ledger integration)

Publish per epoch: pool D + its revenue sources, total deposited, rate,
participants, funder-recycle vs burn amounts, merchant redemptions + fee
income, sink volume, velocity, treasury balance by asset. The rate history
chart is the headline number of the whole experiment (H2/H6 instrumentation).

## 12. Open questions for Max

1. **Coupon-first or EURe-first?** The study's legally-clean sequencing says
   coupons until cleared; EURe is the stronger felt-prosperity signal.
   Recommendation: build Slice 1 payout-agnostic, launch coupon-first, flip
   after the legal pass.
2. **Constitutional split now or later?** Adopt 50/30/20 from epoch 1 (even
   at €100 scale) or start 100% → dividend and introduce the split when
   inflows are real? Recommendation: from epoch 1 — the constitution is the
   product.
3. **Epoch cap value** (flat 200 Münzen?) and cadence (monthly?).
4. **Merchant face-value anchor:** trailing auction rate (proposed) vs a
   governance-set value — comfortable with a floating face value?
5. **Burn vs recycle ratio** for deposited Münzen (proposed: refill funder
   to target, burn excess).
6. **Entity timing:** does the e.V. formation (needed for desk + receipts)
   start now, and who are the ≥7 members?
7. **Does the dividend auction run on-chain eventually** (trustless contract)
   or stay in the edge-fn + Safe-proposal pattern permanently? (v1 pattern is
   fine; on-chain is the credible-neutrality endgame.)
