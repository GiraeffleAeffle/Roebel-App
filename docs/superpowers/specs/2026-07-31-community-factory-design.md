# Community Factory — design (tranche 2 of the Conduit roadmap)

> 2026-07-31, autonomous continuation ("go build" → registry + presets shipped → this).
> Consumes: `CommunityRegistry.sol` (tranche 1), `@netizen-labs/protocol` presets/DeployPlan
> (tranche 1), and the **MACI v2.5 decision** —
> [`docs/future-research/2026-07-31_MACI_V3_MIGRATION_DECISION.md`](../../future-research/2026-07-31_MACI_V3_MIGRATION_DECISION.md):
> the factory targets v2.5 and records `maciVersion` in its output. Judgment calls flagged **[review]**.

## What this is

The guided deploy that makes "template selection + a few clicks → a live governance + identity
system" real: **one command deploys a community's full civic contract set on Gnosis, registers it
in the CommunityRegistry, and emits the manifest `contracts` block as output.** It generalizes the
proven Röbel sequence (`deploy-gnosis-v2.cjs` + `deploy-maci-gnosis-v2.cjs` — same order, same
ceremony params) from hardcoded constants to a preset's DeployPlan.

Blueprint Phase 3 exit test: *"A new community deploys its full contract set in one guided flow."*
The factory's integration test runs that flow end-to-end on the in-process chain — the exit test
becomes a CI-checkable fact.

## Schema extension first (netizen_labs, `@netizen-labs/protocol`)

The tranche-1 `DeployPlan` misses two things the real constructors need:

- `membership.attesterBands: { approval: band, rejection: band }` — AttesterNFTv2's own
  mint/revoke bands (Röbel production: `[5000,3,7]` both). Presets: town keeps production values;
  small orgs `[5000,1,3]` / `[5000,1,3]`.
- `governance.quorumAbsolute: int ≥ 0` — the Governor's absolute quorum floor (Röbel: 2). All
  presets default 2. **[review]**
- `membership.validityPeriodSeconds: int ≥ 0, default 0` — CitizenNFTv2 re-attestation dormancy
  (0 = off, matching launch posture).

Note on units: DeployPlan carries `quorumBps`; `MaciAttesterGovernor` takes integer *percent*
(`numSignUps * quorumPercentage / 100`). The factory converts `bps/100` and **fails if the bps
value is not a whole percent** — silently flooring 250bps→2% would misstate a constitution.

## The factory script

**Location**: `contracts/governor-contract/scripts/community-factory.cjs`. Callable two ways:
`COMMUNITY_CONFIG=<path> npx hardhat run scripts/community-factory.cjs --network gnosis|hardhat`,
and as a module (`module.exports = { runFactory }`) so the integration test drives it in-process.

**Input** — one JSON config file (the "few clicks" serialized):

```jsonc
{
  "slug": "waren",                       // communityId = keccak256(slug)
  "name": "Waren (Müritz)",
  "manifestURI": "https://waren.example/.well-known/netizen.json",
  "deployPlan": { /* verbatim getPreset(id).deploy from @netizen-labs/protocol */ },
  "attesterFounders": ["0x…", "0x…", "0x…"],   // ≥3 (AttesterNFTv2 constructor floor)
  "citizenFounders": ["0x…", "0x…", "0x…"],    // ≥3 (CitizenNFTv2 constructor floor)
  "safe": "0x…",                         // EXISTING Safe — NFT owner after deploy
  "coordinator": { "address": "0x…", "pubKey": { "x": "…", "y": "…" } },
  "votingPeriodSeconds": 3600,
  "tallyGracePeriodSeconds": 604800,     // optional, default 7 days (production value)
  "registry": "0x…",                     // optional — CommunityRegistry; omit to skip stage C
  "skipVk": false                        // true = skip zkey extraction/registration (dry-runs)
}
```

**[review] The Safe is an input, not a deployment.** Communities create their Safe in the Safe
app (minutes, battle-tested UX); the factory wires ownership to it. Consistent with the standing
"use Safe's infrastructure, don't rebuild it" decision. Factory-deployed Safes can come later.

**Stages** (mirroring the proven scripts; every stage logs its address; failure aborts before
ownership handoff, same safety order as `deploy-gnosis-v2.cjs`):

- **A — identity**: AttesterNFTv2(deployer, `"<name> Attester"`, symbol from slug,
  attesterFounders, plan attester bands) → CitizenNFTv2(attesterNFT, deployer, citizenFounders,
  plan's 6 citizen bands in struct order, validityPeriodSeconds). Founders are minted by the
  constructors — **no migrationMint** (that was Röbel's Base-migration special case, not part of
  a fresh community). Verify founder counts, then transferOwnership of both NFTs → Safe.
- **B — governance**: SignUpTokenGatekeeper(citizenNFT) → ConstantInitialVoiceCreditProxy(1) →
  Poseidon T3–T6 (prebuilt artifacts) → Poll/MP/Tally factories → MACI core
  (stateTreeDepth 14 + genEmptyBallotRoots) → gatekeeper.setMaciInstance → Verifier → VkRegistry
  (+ setVerifyingKeysBatch from zkeys unless `skipVk`) → TimelockController(plan
  timelockMinDelaySeconds, proposers=[], executors=[address(0)], admin=deployer) →
  MaciAttesterGovernor(full InitArgs from plan/config; ceremony treeDepths constants 14/5/9/2/3,
  NON_QV) → Timelock lockdown (Governor = proposer+canceller, deployer renounces admin).
  Ceremony params stay the Röbel constants — they are bound to the one production zkey artifact
  (`14-9-2-3`), and per the MACI decision this doesn't change until a v3 trigger fires.
- **C — registry + output**: if `registry` set: `register(keccak256(slug), record)` with
  `controller = timelock` **[review]** (the community's governance controls its record from
  block one; the deployer never does). Write
  `contracts/governor-contract/deployments/communities/<slug>.json`:

```jsonc
{
  "slug": "waren", "chainId": 100, "maciVersion": "2.5.0",
  "deployedAt": "…", "communityId": "0x…",
  "contracts": {                        // EXACTLY the manifest `contracts` block
    "citizenNft": "0x…", "attesterNft": "0x…", "governor": "0x…",
    "timelock": "0x…", "maci": "0x…", "safe": "0x…", "gatekeeper": "0x…"
  },
  "registry": "0x…", "parameters": { /* plan + ceremony params, incl. maciDeployBlock */ }
}
```

The `contracts` object is copy-paste-valid against the manifest schema — the
"addresses written INTO the manifest as output" moment. `netizen deploy` (next tranche) merges it
mechanically.

## Testing

`contracts/governor-contract/test/CommunityFactory.test.js` — an **integration test running the
whole factory in-process** (skipVk, EOA stand-ins for Safe/coordinator): asserts NFT founder
counts + Safe ownership, gatekeeper→MACI binding, Timelock role wiring (governor
proposer+canceller, deployer admin renounced), registry record resolves the full set with
controller == timelock, output file shape, and the whole-percent quorum guard (250bps rejects).
This is the Phase-3 exit test in executable form. VK registration and explorer verification stay
manual/live-only (zkeys are a 1.5 GB artifact; `register-vk-batch25.cjs` pattern already exists).

## Out of scope

- CREATE2/deterministic addresses **[review]** — the 2026-06 sketch wanted salted addresses; v1
  ships without (MACI's linked-library deploys make it disproportionate; the registry makes
  vanity addresses unnecessary). Revisit if a cross-chain same-address story is ever needed.
- Safe deployment, explorer verification automation, `netizen deploy` CLI (next tranche),
  Circles group creation (`circlesGroup` stays zero — Circles stays a Röbel-specific rail for
  now), coordinator provisioning (coordinator-as-a-service tranche).
