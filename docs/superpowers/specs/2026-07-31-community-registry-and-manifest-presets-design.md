# Community Registry + Manifest Presets — design

> 2026-07-31. First build tranche of the Conduit-study roadmap
> ([`docs/future-research/2026-07-31_CONDUIT_RAAS_STRATEGY.md`](../../future-research/2026-07-31_CONDUIT_RAAS_STRATEGY.md) §6.2:
> blueprint Phase 3 pulled forward). Goal state: template selection + a few clicks → a live
> governance + identity system. This tranche builds the two load-bearing foundations; the factory
> script and `netizen deploy` CLI consume them in the next tranche.
>
> Session context: written and executed autonomously on the user's "go build". Judgment calls
> flagged **[review]** for async approval. Parallel sessions active on the accounts/signer plane
> (netizen_labs) and proof0-sovereign-mecky (this repo) — this work touches neither; commits are
> pathspec-only.

## What ships in this tranche

1. **`CommunityRegistry.sol`** — one per chain (Gnosis first): `communityId → full contract set +
   manifest URI`. Kills address-sprawl ("every client, SDK, indexer and agent resolves a tenant's
   entire deployment from one onchain read" — `NETIZEN_STACK_ARCHITECTURE_PLAN.md` L0) and answers
   the standing NSP discovery question (roadmap #6: `peers` is "already shaped for a contract to
   populate it"). With Hardhat tests + a staged (not executed) Gnosis deploy script.
2. **Manifest presets** in `@netizen-labs/protocol` — `town`, `verein`, `genossenschaft`,
   `company`: each yields a schema-valid pre-deploy manifest skeleton plus a typed **deploy plan**
   (the contract between template selection and the future factory). With tests.

Deferred to the next tranche (interfaces fixed here): the TenantFactory guided deploy script
(MACI orchestration is heavy — zkeys, VkRegistry, verifier) and `netizen deploy` in the CLI.

## 1. CommunityRegistry.sol

**Location**: `contracts/governor-contract/contracts/verification-system/CommunityRegistry.sol`
(the Hardhat `sources` path). Solidity 0.8.28, no external dependencies. Dogfooded here first per
the strangler-fig rule; extraction to a Netizen contracts package comes with the factory tranche.

**Record** mirrors the manifest `contracts` block exactly (manifest.ts:442-451), so
registry-resolution and manifest-declaration stay one vocabulary:

```solidity
struct Community {
    address citizenNft;
    address attesterNft;
    address governor;
    address timelock;
    address maci;
    address safe;
    address gatekeeper;     // optional → address(0)
    address circlesGroup;   // optional → address(0)
    string  manifestURI;    // where the signed NSP-0 manifest lives
    address controller;     // who may update — the community's timelock or Safe
}
```

**Rules**:
- `register(bytes32 id, Community calldata c)` — first-come-first-served on `id`
  (`keccak256` of the community slug by convention); reverts if taken. `controller` is taken from
  the struct (deployer registers, then hands control to the community's timelock — "updated only
  by the tenant's own timelock"); `controller == address(0)` defaults to `msg.sender`.
- `update(bytes32 id, Community calldata c)` — controller only. The controller field inside `c` is
  ignored on update (rotation goes through `setController` so it is always an explicit event).
- `setController(bytes32 id, address next)` — controller only, `next != 0`.
- Enumeration for Atlas/indexers: `count()`, `idAt(uint256)`, `get(bytes32)`.
- Events: `CommunityRegistered(id, controller)`, `CommunityUpdated(id)`,
  `ControllerChanged(id, previous, next)`.
- **No owner, no admin, not upgradeable.** [review] Credible neutrality: the registry is an
  unowned public directory. Squatting a `bytes32` id is possible and accepted — trust never comes
  from the registry; it comes from the manifest signature and the membership contracts the record
  points at. Clients treat it as a phone book, not a root of trust.

**Tests** (`test/CommunityRegistry.test.js`, chai/mocha matching `CitizenNFTv2.test.js` style):
register happy path + event; duplicate id reverts; zero-controller defaults to sender; update by
controller succeeds / by stranger reverts; controller field ignored on update; setController
rotates and old controller loses access; zero next-controller reverts; enumeration across ≥2
communities; get() of unknown id reverts (distinguishable from a zeroed record).

**Deploy**: `scripts/deploy-community-registry.cjs` (gnosis network, verify hint printed).
**Staged, not executed** — deployment costs gas and uses `DEPLOYER_PRIVATE_KEY`; the user runs it
(standing pattern: stage outward-facing actions for the user).

## 2. Manifest presets (`@netizen-labs/protocol`)

**Location**: `packages/protocol/src/presets.ts`, exported from `index.ts` (`./presets.js` ESM
import, matching package style). Tests in `test/presets.test.ts` (`tsx --test`, matching
`manifest.test.ts`).

**Shape** — a preset is intent, not deployment output. `chain`/`contracts` are the factory's
OUTPUT ("addresses are written INTO the manifest, not typed in"), so presets never contain them:

```ts
type NetizenPreset = {
  id: "town" | "verein" | "genossenschaft" | "company";
  label: { de: string; en: string };
  /** Schema-valid pre-deploy manifest skeleton: type, modules, governance. */
  manifest: (opts: { id: string; name: string }) => NetizenManifest;
  /** What the factory must deploy — typed by DeployPlanSchema (zod). */
  deploy: DeployPlan;
};
```

`DeployPlan` (zod schema, exported — the preset↔factory contract):
membership threshold bands per action (attestation/revocation/rejection × attester/citizen —
`[bps, floor, cap]`, the `ThresholdBands` vocabulary from `CitizenNFTv2`), governance params
(quorum bps, timelock min-delay seconds), treasury (safe threshold, splits), and
`registry: boolean` (register in CommunityRegistry after deploy — default true).

**Per-template defaults** [review — all four are proposals, tuned later per real customer]:

| | type | governance | membership bands | treasury |
|---|---|---|---|---|
| `town` | `town` | MACI + shamir coordinator | production Röbel bands (join 30%/2/7 + 1 citizen; revoke 67%/3/∞ + 1; reject 25%/2/5) | splits 50/30/20, safe 3-of-5 |
| `verein` | `club` | MACI + single coordinator | join 50%/1/3; revoke 67%/2/∞; reject 50%/1/3 | no splits, safe 2-of-3 |
| `genossenschaft` | `community` | MACI + shamir (1-member-1-vote is the legal point) | join 50%/2/5 + 1 member; revoke 67%/3/∞ | splits 50/30/20, safe 3-of-5 |
| `company` | `business` | simple engine (public voting; MACI opt-in later) | join 50%/1/3 (board admits) | no splits, safe 2-of-3 |

Modules per preset: all declare `governance`, `treasury`; `town` + `genossenschaft` add
`workspace`, `chat`, `ai`; `verein` stays minimal; `company` adds `workspace`, `ai` (the
"sovereign Microsoft 365" buyer).

**Tests**: every preset's `manifest()` passes `parseManifest` (the schema gate); presets contain
no `chain`/`contracts` block; `DeployPlanSchema` accepts each preset's `deploy` and rejects a
malformed band; splits sum to 100 where present; ids/labels unique.

## Out of scope (next tranche, interfaces now fixed)

- **TenantFactory script**: consumes a preset's `DeployPlan` + a community slug → deterministic
  deploy (CREATE2 salts from `communityId`) of NFTs → gatekeeper → MACI set → governor → timelock
  → Safe wiring → explorer verify → `register()` in CommunityRegistry → emit the completed
  manifest `contracts` block as JSON (the manifest-as-output moment).
- **`netizen deploy`**: CLI wrapper — pick preset → run factory → merge output into the manifest
  → hand to `netizen render|up`.
- Registry population of `peers` (roadmap #6) and Atlas reading the registry.
