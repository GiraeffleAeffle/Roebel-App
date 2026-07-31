# MACI v3 vs v2.5 — migration decision

> **Decision research, 2026-07-31.** Closes the open question flagged in
> [`2026-07-22_NETIZEN_SOVEREIGN_STACK_RESEARCH.md`](2026-07-22_NETIZEN_SOVEREIGN_STACK_RESEARCH.md) (§ Private voting, Open Q #2)
> and [`2026-07-31_CONDUIT_RAAS_STRATEGY.md`](2026-07-31_CONDUIT_RAAS_STRATEGY.md) (§7).
> Method: parallel web research on MACI v3's actual state (primary sources: repo at tag v3.0.0,
> maci.pse.dev docs, HashCloak report, npm registry) + a full map of the live v2.5 integration
> seams in this repo. Sources inline; local claims carry file:line.

## Verdict

**Stay on MACI v2.5 for Röbel production. Build the TenantFactory against v2.5 and record the
protocol version in the manifest. Adopt v3 only when a defined trigger fires (below) — and take
the cheap v3 hedges now.**

The one question that would have *forced* the decision resolves in v3's favor — and it still
doesn't justify migrating today.

## The blocking question is answered: the Shamir federation survives v3

- v3 keeps the coordinator keypair format: Baby Jubjub EdDSA, same `macisk.` serialization, same
  domainobjs `Keypair` (verified in `apps/coordinator/.env.example` at tag v3.0.0). **Existing
  Shamir shares remain valid in format** — no share-key re-registration ceremony forced by the
  version change itself.
- v3 tooling still accepts an externally supplied private key: `maci-cli` lives on as
  `@maci-protocol/cli`; `genProofs` → `generateProofs` with `-k, --private-key <privateKey>`, and
  the SDK exports `generateProofs`/`proveOnChain` as plain library functions (verified in
  `packages/cli/ts/index.ts` at tag v3.0.0). The reconstructed key can be passed in-process
  exactly as `apps/coordinator/scripts/reconstructor.js:355` does today. Nothing couples proof
  generation to PSE's hosted coordinator service (which is optional automation, and whose
  env-resident `COORDINATOR_MACI_PRIVATE_KEY` model is *weaker* than our Shamir flow — we would
  skip it regardless).

## Why stay anyway

**1. Nobody maintains either version — so "migrate for support" is off the table.**
v3.0.0 shipped 2026-06-16; the Ethereum Foundation wound down PSE one week later (2026-06-23
restructuring). The GitHub org moved to `privacy-ethereum`; activity since release: an audit-docs
commit and **switching off nightly CI** (2026-07-21). Zero 3.x patches. No successor maintainer
announced, no v3 release blog post, roadmap page frozen at 2025-04. v2.5 (Nov 2024) is equally
frozen — its docs carry a "no longer actively maintained" banner. Between two orphaned versions,
the one **battle-tested in this exact deployment** wins: the runbook's §10 catalogues ten
production bugs already found and fixed against v2.5 on Gnosis.

**2. Zero known v3 production deployments.**
No case study, no fund round, no DAO found running v3 (the Gitcoin privacy-round spec explicitly
chose v2.5; Aragon's MACI plugin is demo-stage; clr.fund is v1-era). A circuit-adjacent issue
(#2808, integer-vs-field division in Merkle path indices) sits open from Nov 2025. Being the
first production user of a 6-week-old major version whose team was just disbanded is a risk a
5,000-person town's voting system should not take.

**3. Migration cost is a full rebuild — including a problem this stack hasn't solved.**
No official v2→v3 migration guide exists; there is no state migration. Concretely it would mean:
- **Third citizen re-signup** (fresh MACI, fresh state tree) — the second was 2026-06-25.
- **Per-poll `joinPoll` with client-side Groth16 proving in the Expo app** — every citizen
  generates a ZK proof on their phone per poll (PollJoining circuit; zkeys distributed to
  clients). Mobile in-app proving is unbuilt and unproven in this stack, and one extra tx +
  proving step per poll is a real participation-UX regression for exactly the users Röbel serves.
- **Governor rewrite**: `MaciAttesterGovernor` is v2-exact at six call sites
  (`_deployPollFor`, `MaciAttesterGovernor.sol:216-237` — `deployPoll` returning void +
  `nextPollId()-1` inference, `getPoll` struct, `Ownable` handoffs) and reads the v2 Tally shape
  (`ITallyRead`, `:43-52`); v3 renames the registry (`VkRegistry`→`VerifyingKeysRegistry`),
  restructures Tally reads (`getTallyResults` struct, `isTallied()`), and moves polls to
  start/end timestamps. `maci` is `immutable` on the Governor (`:89`), so the swap cascades:
  Governor redeploy → Timelock re-wire → address updates in three apps.
- **Gatekeeper → excubiae policy**: `SignUpTokenGatekeeper` has no v3 equivalent; the
  CitizenNFTv2 gate would be re-implemented as an excubiae Checker+Policy pair.
- **Coordinator pipeline rewrite**: all five `maci-cli` imports in
  `apps/coordinator/scripts/lib/finalize-helpers.js:12-19`, plus the hand-rolled
  `Tally.addTallyResults` ABI patch (`:84-129`) that exists because upstream's call exceeds L2
  gas limits — a v2.5-struct-exact fork point that would need re-derivation against v3.
- New zkey artifacts (v2 ceremony artifacts are not v3-compatible).

**4. The headline motivation was wrong.**
The corpus claimed v3 "eliminates the deploy-per-vote pattern." **Refuted**: v2 already had one
MACI + `deployPoll`; v3 keeps deploying polls per proposal. What v3 actually adds is per-poll
*configurability* (policies, voice credits, relayers, vote-option counts) and hash-chain message
accumulation (no `mergeMessages`, no message cap). The ~15.7M-gas proposal transaction that
forced the dedicated high-gas bundler (`apps/web/src/lib/highgas-bundler.ts:45-67`) is not
clearly solved by v3. The prior research docs are corrected by this one.

## What v3 genuinely offers (why the door stays open)

- **External audit** — HashCloak, Jan–Mar 2026 (final 2026-03-17), contracts + circuits +
  excubiae; 18 findings, all resolved, incl. 1 critical. Better third-party coverage than v2 ever
  had (v2 was audited internally by PSE only).
- **Completed production trusted setup** — artifacts downloadable
  (`v3.0.0/maci_artifacts_prod.tar.gz`); params (2^14 users, batch 25, 125 options) far exceed
  any small-community need.
- **Per-poll policies** — the CitizenNFTv2 gate as a *poll* policy is exactly what a future
  shared-MACI, multi-community coordinator-as-a-service tier wants (one MACI core serving many
  communities' polls with different gates). v2 structurally cannot do this; it is the one
  feature that eventually matters for Netizen Cloud scale.
- **State-index lookup** — kills the 9,000-block `SignUp` event-scan workaround
  (`apps/expo/context/MaciContext.tsx:180-269`).
- **Gnosis is pre-provisioned** — PSE deployed shared v3 infra on Gnosis mainnet before
  disbanding (Verifier `0xB40079…`, Poseidons, Poll/MP/Tally factories, VerifyingKeysRegistry
  `0x294110…`, FreeForAll policy factories; `default-deployed-contracts.json` at tag v3.0.0). A
  future v3 deployment on Gnosis is materially cheaper than the v2 one was.

## Adoption triggers (any one → reassess; two → migrate)

1. **A maintainer appears** — a successor org/team announces stewardship of MACI (the single
   strongest signal; without it there will never be a 3.0.1).
2. **Someone else runs v3 in production** for a governance use case through at least one full
   tally cycle.
3. **Mobile proving proven** — a spike shows PollJoining proof generation works acceptably on
   mid-range phones from the Expo app (budget: a day; do this before any commitment regardless).
4. **Shared-MACI demand** — a real Netizen Cloud customer needs per-poll policies (multiple
   communities on one MACI core), which v2 cannot express.
5. **Security event** — any disclosed vulnerability in v2 circuits/contracts flips the default:
   v3's external audit then dominates, and this doc's verdict is void.

## Hedges to take now (cheap, no migration)

- **Record the protocol version**: the TenantFactory writes `maciVersion: "2.5.0"` into its
  output and the community's manifest `governance` block. Upgrades become explicit manifest
  changes, per community — never a silent global assumption.
- **Keep the tally pipeline's maci surface in one module** — already true
  (`finalize-helpers.js` is the only importer); preserve that during the coordinator
  re-architecture so a future swap to `@maci-protocol/sdk` is one file.
- **Keep the Shamir ceremony unchanged** — key format is v3-compatible; nothing to do.
- **Pin what exists**: `maci-*@2.5.0` exact pins stay (already exact everywhere, including the
  coordinator Dockerfile); the v2 zkey tarball URL is on PSE's S3 — mirror
  `maci_artifacts_14-9-2-3_prod.tar.gz` (~1.5 GB) to our own storage before that bucket follows
  PSE into the sunset. Same for a copy of the v3 prod artifacts (hedge for trigger 4/5).
- **Fix the stale coordinator env while touching nothing else**: `apps/coordinator/Dockerfile:69`
  still sets `HARDHAT_NETWORK=base` and `hardhat.config.js` defines only a `base` network — the
  stack votes on Gnosis. (Known bug, also flagged in the accounts-service design M1.)

## Corrections this doc makes to earlier corpus claims

- "v3 would eliminate the deploy-per-vote pattern"
  (`2026-07-22_NETIZEN_SOVEREIGN_STACK_RESEARCH.md` §Private voting;
  `2026-07-31_CONDUIT_RAAS_STRATEGY.md` §3.5, §7) — **refuted**, see "Why stay" #4.
- "voters join per-poll via ZK membership proof, same key" — confirmed, but note it is a *cost*
  (client-side proving per poll), not only a feature.
- "one MACI contract serving many polls" — true in v2 as well; the v3 novelty is per-poll
  policies/credits/relayers, not the topology.
