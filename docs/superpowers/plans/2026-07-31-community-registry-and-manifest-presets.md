# CommunityRegistry + Manifest Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the two foundations of "template selection + few clicks → live governance + identity": the onchain CommunityRegistry (one read resolves a community's full contract set) and the four manifest presets with typed deploy plans.

**Architecture:** An unowned, admin-free Solidity registry in the Röbel Hardhat workspace (dogfood-first; FCFS bytes32 ids, self-sovereign records controlled by each community's timelock/Safe), plus a `presets.ts` module in `@netizen-labs/protocol` where each preset yields a schema-valid pre-deploy manifest skeleton and a zod-typed `DeployPlan` — the contract the future TenantFactory script consumes. Spec: `docs/superpowers/specs/2026-07-31-community-registry-and-manifest-presets-design.md`.

**Tech Stack:** Solidity 0.8.28 (no external deps), Hardhat + chai/mocha (`.test.js`, matching `CitizenNFTv2.test.js`), zod 3 + node:test via `tsx --test` (matching `manifest.test.ts`).

## Global Constraints

- Two repos: registry work in `/Users/maxbrych/Documents/privat/side_projects/DAO_test`, presets work in `/Users/maxbrych/Documents/privat/side_projects/netizen_labs`. Parallel sessions are active in BOTH — commit with explicit pathspecs only, never a bare `git add .`; `git pull --ff-only` before each commit in netizen_labs.
- Registry record fields mirror `packages/protocol/src/manifest.ts:442-451` (`citizenNft, attesterNft, governor, timelock, maci, safe, gatekeeper, circlesGroup`) + `manifestURI` + `controller`.
- Presets NEVER contain `chain` or `contracts` blocks (those are factory output).
- Manifest constants: `nsp: "0"`, `manifestVersion: "1.0.0"`; minimal required fields are `nsp, manifestVersion, id, name, services`; `services.host` requires `{provider, region}`.
- The registry contract is unowned: no Ownable, no admin, not upgradeable.
- Do NOT run `eas update`, do NOT deploy contracts to any network (staging the script is the deliverable; the user deploys).
- Copy rules: never name Optimism/OP Stack in public-facing text; "Onchain" as one word.
- Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`; push after every commit.

---

### Task 1: CommunityRegistry.sol with tests

**Files:**
- Create: `contracts/governor-contract/contracts/verification-system/CommunityRegistry.sol`
- Test: `contracts/governor-contract/test/CommunityRegistry.test.js`

**Interfaces:**
- Consumes: nothing (leaf contract, no imports).
- Produces: `CommunityRegistry` with `register(bytes32,Community)`, `update(bytes32,Community)`, `setController(bytes32,address)`, `get(bytes32) → Community`, `count() → uint256`, `idAt(uint256) → bytes32`; struct `Community {citizenNft, attesterNft, governor, timelock, maci, safe, gatekeeper, circlesGroup, manifestURI, controller}`; events `CommunityRegistered(bytes32 indexed, address indexed)`, `CommunityUpdated(bytes32 indexed)`, `ControllerChanged(bytes32 indexed, address indexed, address indexed)`; custom errors `IdTaken(bytes32)`, `UnknownId(bytes32)`, `NotController(bytes32,address)`, `ZeroController()`. Task 2's script and the future factory deploy/read exactly this.

- [ ] **Step 1: Write the failing test**

`contracts/governor-contract/test/CommunityRegistry.test.js`:

```js
const { expect } = require("chai");
const { ethers } = require("hardhat");

// A registry record is the manifest `contracts` block plus manifestURI and
// controller. addr(n) fabricates distinct checksummed addresses per slot.
const addr = (n) => ethers.getAddress("0x" + String(n).padStart(40, "0"));

const ID_A = ethers.id("roebel");
const ID_B = ethers.id("waren");

function record(controller, n = 1) {
  return {
    citizenNft: addr(n),
    attesterNft: addr(n + 1),
    governor: addr(n + 2),
    timelock: addr(n + 3),
    maci: addr(n + 4),
    safe: addr(n + 5),
    gatekeeper: ethers.ZeroAddress, // optional slots stay zero
    circlesGroup: ethers.ZeroAddress,
    manifestURI: "https://roebel.app/.well-known/netizen.json",
    controller,
  };
}

async function deploy() {
  const [deployer, community, stranger, next] = await ethers.getSigners();
  const Registry = await ethers.getContractFactory("CommunityRegistry");
  const registry = await Registry.deploy();
  await registry.waitForDeployment();
  return { registry, deployer, community, stranger, next };
}

describe("CommunityRegistry — register", function () {
  it("registers a community and emits, with explicit controller", async function () {
    const { registry, deployer, community } = await deploy();
    await expect(registry.register(ID_A, record(community.address)))
      .to.emit(registry, "CommunityRegistered")
      .withArgs(ID_A, community.address);
    const c = await registry.get(ID_A);
    expect(c.citizenNft).to.equal(addr(1));
    expect(c.manifestURI).to.equal("https://roebel.app/.well-known/netizen.json");
    expect(c.controller).to.equal(community.address);
    // deployer registered but is NOT the controller — handoff happened at register time
    expect(c.controller).to.not.equal(deployer.address);
  });

  it("defaults a zero controller to msg.sender", async function () {
    const { registry, deployer } = await deploy();
    await registry.register(ID_A, record(ethers.ZeroAddress));
    expect((await registry.get(ID_A)).controller).to.equal(deployer.address);
  });

  it("is first-come-first-served: duplicate id reverts", async function () {
    const { registry, community } = await deploy();
    await registry.register(ID_A, record(community.address));
    await expect(registry.register(ID_A, record(community.address)))
      .to.be.revertedWithCustomError(registry, "IdTaken")
      .withArgs(ID_A);
  });
});

describe("CommunityRegistry — update", function () {
  it("controller updates the record; controller field in payload is ignored", async function () {
    const { registry, community, stranger } = await deploy();
    await registry.register(ID_A, record(community.address));
    // payload tries to smuggle a controller rotation through update()
    const updated = { ...record(stranger.address, 10), manifestURI: "ipfs://new" };
    await expect(registry.connect(community).update(ID_A, updated))
      .to.emit(registry, "CommunityUpdated")
      .withArgs(ID_A);
    const c = await registry.get(ID_A);
    expect(c.citizenNft).to.equal(addr(10));
    expect(c.manifestURI).to.equal("ipfs://new");
    expect(c.controller).to.equal(community.address); // rotation only via setController
  });

  it("a stranger cannot update", async function () {
    const { registry, community, stranger } = await deploy();
    await registry.register(ID_A, record(community.address));
    await expect(registry.connect(stranger).update(ID_A, record(stranger.address)))
      .to.be.revertedWithCustomError(registry, "NotController")
      .withArgs(ID_A, stranger.address);
  });

  it("updating an unknown id reverts", async function () {
    const { registry, community } = await deploy();
    await expect(registry.connect(community).update(ID_B, record(community.address)))
      .to.be.revertedWithCustomError(registry, "UnknownId")
      .withArgs(ID_B);
  });
});

describe("CommunityRegistry — setController", function () {
  it("rotates control; old controller loses access, new one gains it", async function () {
    const { registry, community, next } = await deploy();
    await registry.register(ID_A, record(community.address));
    await expect(registry.connect(community).setController(ID_A, next.address))
      .to.emit(registry, "ControllerChanged")
      .withArgs(ID_A, community.address, next.address);
    await expect(registry.connect(community).update(ID_A, record(community.address)))
      .to.be.revertedWithCustomError(registry, "NotController");
    await registry.connect(next).update(ID_A, record(next.address, 20));
    expect((await registry.get(ID_A)).citizenNft).to.equal(addr(20));
  });

  it("cannot rotate to the zero address (would brick the record)", async function () {
    const { registry, community } = await deploy();
    await registry.register(ID_A, record(community.address));
    await expect(registry.connect(community).setController(ID_A, ethers.ZeroAddress))
      .to.be.revertedWithCustomError(registry, "ZeroController");
  });
});

describe("CommunityRegistry — reads", function () {
  it("get() of an unknown id reverts (distinguishable from a zeroed record)", async function () {
    const { registry } = await deploy();
    await expect(registry.get(ID_B))
      .to.be.revertedWithCustomError(registry, "UnknownId")
      .withArgs(ID_B);
  });

  it("enumerates all registered communities in order", async function () {
    const { registry, community } = await deploy();
    await registry.register(ID_A, record(community.address));
    await registry.register(ID_B, record(community.address, 30));
    expect(await registry.count()).to.equal(2n);
    expect(await registry.idAt(0)).to.equal(ID_A);
    expect(await registry.idAt(1)).to.equal(ID_B);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd contracts/governor-contract && npx hardhat test test/CommunityRegistry.test.js`
Expected: FAIL — `HardhatError: ... Artifact for contract "CommunityRegistry" not found` (or compile error), because the contract does not exist yet.

- [ ] **Step 3: Write the contract**

`contracts/governor-contract/contracts/verification-system/CommunityRegistry.sol`:

```solidity
// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.28;

/**
 * @title CommunityRegistry
 * @notice The onchain address book for Netizen communities — one per chain.
 *         Maps a community id to its full civic contract set and the URI of its
 *         signed NSP-0 manifest, so every client, SDK, indexer and agent resolves
 *         a deployment from one read instead of hardcoding addresses.
 *
 *         Ids are first-come-first-served (by convention keccak256 of the
 *         community slug). Records are self-sovereign: only the community's
 *         controller — its timelock or Safe — may write. The registry itself is
 *         unowned and has no admin: it is a phone book, not a root of trust.
 *         Trust comes from the manifest signature and the membership contracts
 *         a record points at.
 */
contract CommunityRegistry {
    struct Community {
        address citizenNft;
        address attesterNft;
        address governor;
        address timelock;
        address maci;
        address safe;
        address gatekeeper; // optional — address(0) when absent
        address circlesGroup; // optional — address(0) when absent
        string manifestURI;
        address controller;
    }

    // controller == address(0) doubles as "id not registered".
    mapping(bytes32 => Community) private _communities;
    bytes32[] private _ids;

    event CommunityRegistered(bytes32 indexed id, address indexed controller);
    event CommunityUpdated(bytes32 indexed id);
    event ControllerChanged(bytes32 indexed id, address indexed previous, address indexed next);

    error IdTaken(bytes32 id);
    error UnknownId(bytes32 id);
    error NotController(bytes32 id, address caller);
    error ZeroController();

    modifier onlyController(bytes32 id) {
        address controller = _communities[id].controller;
        if (controller == address(0)) revert UnknownId(id);
        if (controller != msg.sender) revert NotController(id, msg.sender);
        _;
    }

    /// @notice Claim an id and write its record. `c.controller == address(0)`
    ///         defaults to the caller; pass the community's timelock/Safe to
    ///         hand over control in the same transaction.
    function register(bytes32 id, Community calldata c) external {
        if (_communities[id].controller != address(0)) revert IdTaken(id);
        Community memory rec = c;
        if (rec.controller == address(0)) rec.controller = msg.sender;
        _communities[id] = rec;
        _ids.push(id);
        emit CommunityRegistered(id, rec.controller);
    }

    /// @notice Replace the record. The controller field of the payload is
    ///         ignored — rotation is only ever the explicit setController event.
    function update(bytes32 id, Community calldata c) external onlyController(id) {
        Community memory rec = c;
        rec.controller = _communities[id].controller;
        _communities[id] = rec;
        emit CommunityUpdated(id);
    }

    function setController(bytes32 id, address next) external onlyController(id) {
        if (next == address(0)) revert ZeroController();
        address previous = _communities[id].controller;
        _communities[id].controller = next;
        emit ControllerChanged(id, previous, next);
    }

    function get(bytes32 id) external view returns (Community memory) {
        Community memory rec = _communities[id];
        if (rec.controller == address(0)) revert UnknownId(id);
        return rec;
    }

    function count() external view returns (uint256) {
        return _ids.length;
    }

    function idAt(uint256 index) external view returns (bytes32) {
        return _ids[index];
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd contracts/governor-contract && npx hardhat test test/CommunityRegistry.test.js`
Expected: PASS — 10 passing, 0 failing. Also run the neighboring suite to prove no compile regression: `npx hardhat test test/CitizenNFTv2.test.js` → same pass count as before the change.

- [ ] **Step 5: Commit**

```bash
cd /Users/maxbrych/Documents/privat/side_projects/DAO_test
git add contracts/governor-contract/contracts/verification-system/CommunityRegistry.sol contracts/governor-contract/test/CommunityRegistry.test.js
git commit -m "feat(contracts): CommunityRegistry — one read resolves a community's whole deployment

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push
```

---

### Task 2: Staged Gnosis deploy script

**Files:**
- Create: `contracts/governor-contract/scripts/deploy-community-registry.cjs`

**Interfaces:**
- Consumes: the `CommunityRegistry` artifact from Task 1.
- Produces: a runnable-by-the-user script printing the deployed address + verify command. NOT executed in this plan — deployment is the user's operational step (needs `DEPLOYER_PRIVATE_KEY` + gas).

- [ ] **Step 1: Write the script**

`contracts/governor-contract/scripts/deploy-community-registry.cjs`:

```js
// Deploys the CommunityRegistry (one per chain — unowned, no constructor args).
// Staged for the operator:
//   npx hardhat run scripts/deploy-community-registry.cjs --network gnosis
// Then record the address in docs and packages/blockchain, and verify.
const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  if (!deployer) throw new Error("No deployer — set DEPLOYER_PRIVATE_KEY in .env");
  console.log(`Deploying CommunityRegistry to ${hre.network.name} as ${deployer.address}`);

  const Registry = await hre.ethers.getContractFactory("CommunityRegistry");
  const registry = await Registry.deploy();
  await registry.waitForDeployment();
  const address = await registry.getAddress();

  console.log(`CommunityRegistry: ${address}`);
  console.log(`Verify: npx hardhat verify --network ${hre.network.name} ${address}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Dry-run against the in-process network to prove the script works end-to-end**

Run: `cd contracts/governor-contract && npx hardhat run scripts/deploy-community-registry.cjs`
Expected: prints `Deploying CommunityRegistry to hardhat as 0x…` then `CommunityRegistry: 0x…`. (In-process chain only — nothing leaves the machine.)

- [ ] **Step 3: Commit**

```bash
cd /Users/maxbrych/Documents/privat/side_projects/DAO_test
git add contracts/governor-contract/scripts/deploy-community-registry.cjs
git commit -m "feat(contracts): staged Gnosis deploy script for the CommunityRegistry

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push
```

---

### Task 3: Manifest presets + DeployPlan schema in @netizen-labs/protocol

**Files:**
- Create: `packages/protocol/src/presets.ts` (in the netizen_labs repo)
- Modify: `packages/protocol/src/index.ts` (add one export block)
- Test: `packages/protocol/test/presets.test.ts`

**Interfaces:**
- Consumes: `parseManifest`, `NetizenManifest` from `./manifest.js`.
- Produces: `PRESETS: readonly NetizenPreset[]`, `getPreset(id: PresetId): NetizenPreset`, `DeployPlanSchema` (zod), types `DeployPlan`, `PresetId`, `NetizenPreset`, constant `NO_CAP = 65535`. The future TenantFactory script consumes `getPreset(id).deploy`; `netizen deploy` consumes `getPreset(id).manifest(opts)`.

- [ ] **Step 1: Write the failing test**

`packages/protocol/test/presets.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseManifest } from "../src/manifest.js";
import { PRESETS, getPreset, DeployPlanSchema, NO_CAP } from "../src/presets.js";

test("all four presets exist with unique ids and labels", () => {
  assert.deepEqual(
    PRESETS.map((p) => p.id).sort(),
    ["company", "genossenschaft", "town", "verein"],
  );
  const labels = PRESETS.flatMap((p) => [p.label.de, p.label.en]);
  assert.equal(new Set(labels).size, labels.length);
});

test("every preset yields a schema-valid pre-deploy manifest", () => {
  for (const p of PRESETS) {
    const m = parseManifest(p.manifest({ id: "waren", name: "Waren (Müritz)" }));
    assert.equal(m.id, "waren");
    assert.equal(m.name, "Waren (Müritz)");
    assert.equal(m.nsp, "0");
  }
});

test("presets never contain chain or contracts — those are factory output", () => {
  for (const p of PRESETS) {
    const m = p.manifest({ id: "x", name: "X" });
    assert.equal(m.chain, undefined, `${p.id} leaked a chain block`);
    assert.equal(m.contracts, undefined, `${p.id} leaked a contracts block`);
  }
});

test("every preset's deploy plan validates against DeployPlanSchema", () => {
  for (const p of PRESETS) {
    const parsed = DeployPlanSchema.safeParse(p.deploy);
    assert.equal(parsed.success, true, `${p.id}: ${JSON.stringify(parsed)}`);
  }
});

test("a malformed band is rejected (bps over 100%)", () => {
  const bad = structuredClone(getPreset("town").deploy);
  bad.membership.attestationAttester = [10001, 2, 7];
  assert.equal(DeployPlanSchema.safeParse(bad).success, false);
});

test("treasury splits, where present, sum to 100", () => {
  for (const p of PRESETS) {
    const splits = p.deploy.treasury.splits;
    if (!splits) continue;
    const sum = Object.values(splits).reduce((a, b) => a + b, 0);
    assert.equal(sum, 100, `${p.id} splits sum to ${sum}`);
  }
});

test("town carries the production Röbel bands", () => {
  const m = getPreset("town").deploy.membership;
  assert.deepEqual(m.attestationAttester, [3000, 2, 7]);
  assert.deepEqual(m.attestationCitizen, [0, 1, 1]);
  assert.deepEqual(m.revocationAttester, [6700, 3, NO_CAP]);
  assert.deepEqual(m.revocationCitizen, [0, 1, 1]);
  assert.deepEqual(m.rejectionAttester, [2500, 2, 5]);
});

test("company runs the simple engine with no coordinator; the rest run MACI", () => {
  assert.equal(getPreset("company").deploy.governance.engine, "simple");
  assert.equal(getPreset("company").deploy.governance.coordinator, "none");
  for (const id of ["town", "verein", "genossenschaft"] as const) {
    assert.equal(getPreset(id).deploy.governance.engine, "maci");
  }
});

test("getPreset throws on an unknown id", () => {
  assert.throws(() => getPreset("kingdom" as never), /unknown preset/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/maxbrych/Documents/privat/side_projects/netizen_labs/packages/protocol && pnpm test`
Expected: FAIL — `Cannot find module '../src/presets.js'`. (`manifest.test.ts` keeps passing.)

- [ ] **Step 3: Write presets.ts**

`packages/protocol/src/presets.ts`:

```ts
import { z } from "zod";
import { parseManifest, type NetizenManifest } from "./manifest.js";

/**
 * Manifest presets — the template half of "template selection + a few clicks →
 * a live governance + identity system" (Conduit study §3.4; design spec
 * 2026-07-31-community-registry-and-manifest-presets-design.md).
 *
 * A preset is INTENT, not deployment output: it yields a schema-valid
 * pre-deploy manifest skeleton (no `chain`, no `contracts` — the factory
 * writes those INTO the manifest after deploying) plus a typed DeployPlan,
 * the contract between template selection and the TenantFactory script.
 */

/** Threshold band [bps, floor, cap] — the ThresholdBands vocabulary from CitizenNFTv2. */
export const NO_CAP = 65535;
const band = z.tuple([
  z.number().int().min(0).max(10000), // basis points of the eligible set
  z.number().int().min(0), // absolute floor
  z.number().int().min(0).max(NO_CAP), // absolute cap; NO_CAP = uncapped
]);
export type ThresholdBand = z.infer<typeof band>;

export const DeployPlanSchema = z
  .object({
    membership: z.object({
      attestationAttester: band,
      attestationCitizen: band,
      revocationAttester: band,
      revocationCitizen: band,
      rejectionAttester: band,
      rejectionCitizen: band,
    }),
    governance: z.object({
      engine: z.enum(["maci", "simple"]),
      coordinator: z.enum(["shamir", "single", "none"]),
      quorumBps: z.number().int().min(0).max(10000),
      timelockMinDelaySeconds: z.number().int().positive(),
    }),
    treasury: z.object({
      safeThreshold: z.number().int().positive(),
      /** Owner slots the guided flow collects before deploying the Safe. */
      safeOwners: z.number().int().positive(),
      splits: z
        .record(z.number())
        .refine(
          (s) => Object.values(s).reduce((a, b) => a + b, 0) === 100,
          "treasury splits must sum to 100",
        )
        .optional(),
    }),
    /** Register the deployment in the chain's CommunityRegistry. */
    registry: z.boolean(),
  })
  .refine(
    (p) => p.treasury.safeThreshold <= p.treasury.safeOwners,
    "safe threshold cannot exceed owner count",
  );
export type DeployPlan = z.infer<typeof DeployPlanSchema>;

export type PresetId = "town" | "verein" | "genossenschaft" | "company";

export interface NetizenPreset {
  id: PresetId;
  label: { de: string; en: string };
  /** Schema-valid pre-deploy manifest skeleton. Throws (via parseManifest) on drift. */
  manifest: (opts: { id: string; name: string }) => NetizenManifest;
  deploy: DeployPlan;
}

/** Shared skeleton: the minimum viable node plus per-preset civic intent. */
function base(
  opts: { id: string; name: string },
  type: NonNullable<NetizenManifest["type"]>,
  governance: { engine: "maci" | "simple"; coordinator: "shamir" | "single" | "none" },
  modules: Record<string, boolean>,
): NetizenManifest {
  return parseManifest({
    nsp: "0",
    manifestVersion: "1.0.0",
    id: opts.id,
    name: opts.name,
    type,
    services: { host: { provider: "hetzner", region: "eu-central" } },
    governance: {
      engine: governance.engine,
      coordinator: { type: governance.coordinator },
    },
    modules,
  });
}

// Production Röbel bands (CitizenNFTv2 on Gnosis, live since 2026-06-25).
const TOWN_MEMBERSHIP: DeployPlan["membership"] = {
  attestationAttester: [3000, 2, 7],
  attestationCitizen: [0, 1, 1],
  revocationAttester: [6700, 3, NO_CAP],
  revocationCitizen: [0, 1, 1],
  rejectionAttester: [2500, 2, 5],
  rejectionCitizen: [2500, 2, 5],
};

// Small-org bands: a board of 1-3 admits; removal still needs a supermajority.
const SMALL_ORG_MEMBERSHIP: DeployPlan["membership"] = {
  attestationAttester: [5000, 1, 3],
  attestationCitizen: [0, 1, 1],
  revocationAttester: [6700, 2, NO_CAP],
  revocationCitizen: [0, 1, 1],
  rejectionAttester: [5000, 1, 3],
  rejectionCitizen: [5000, 1, 3],
};

export const PRESETS: readonly NetizenPreset[] = [
  {
    id: "town",
    label: { de: "Stadt / Gemeinde", en: "Town" },
    manifest: (o) =>
      base(o, "town", { engine: "maci", coordinator: "shamir" }, {
        governance: true,
        treasury: true,
        workspace: true,
        chat: true,
        ai: true,
      }),
    deploy: {
      membership: TOWN_MEMBERSHIP,
      governance: {
        engine: "maci",
        coordinator: "shamir",
        quorumBps: 400, // 4% — the Röbel production quorum shape
        timelockMinDelaySeconds: 3600,
      },
      treasury: { safeThreshold: 3, safeOwners: 5, splits: { dividend: 50, endowment: 30, reinvest: 20 } },
      registry: true,
    },
  },
  {
    id: "verein",
    label: { de: "Verein", en: "Association" },
    manifest: (o) =>
      base(o, "club", { engine: "maci", coordinator: "single" }, {
        governance: true,
        treasury: true,
      }),
    deploy: {
      membership: SMALL_ORG_MEMBERSHIP,
      governance: {
        engine: "maci",
        coordinator: "single",
        quorumBps: 2500, // Vereine quora are high — 25% of members
        timelockMinDelaySeconds: 3600,
      },
      treasury: { safeThreshold: 2, safeOwners: 3 },
      registry: true,
    },
  },
  {
    id: "genossenschaft",
    label: { de: "Genossenschaft", en: "Cooperative" },
    manifest: (o) =>
      base(o, "community", { engine: "maci", coordinator: "shamir" }, {
        governance: true,
        treasury: true,
        workspace: true,
        chat: true,
        ai: true,
      }),
    deploy: {
      membership: {
        ...SMALL_ORG_MEMBERSHIP,
        attestationAttester: [5000, 2, 5],
        revocationAttester: [6700, 3, NO_CAP],
      },
      governance: {
        engine: "maci", // 1-member-1-vote with a secret ballot is the legal point
        coordinator: "shamir",
        quorumBps: 2500,
        timelockMinDelaySeconds: 3600,
      },
      treasury: { safeThreshold: 3, safeOwners: 5, splits: { dividend: 50, endowment: 30, reinvest: 20 } },
      registry: true,
    },
  },
  {
    id: "company",
    label: { de: "Unternehmen", en: "Company" },
    manifest: (o) =>
      base(o, "business", { engine: "simple", coordinator: "none" }, {
        governance: true,
        treasury: true,
        workspace: true,
        ai: true,
      }),
    deploy: {
      membership: SMALL_ORG_MEMBERSHIP,
      governance: {
        engine: "simple", // public voting; MACI opt-in comes later
        coordinator: "none",
        quorumBps: 5000,
        timelockMinDelaySeconds: 3600,
      },
      treasury: { safeThreshold: 2, safeOwners: 3 },
      registry: true,
    },
  },
];

export function getPreset(id: PresetId): NetizenPreset {
  const preset = PRESETS.find((p) => p.id === id);
  if (!preset) throw new Error(`unknown preset: ${id}`);
  return preset;
}
```

- [ ] **Step 4: Export from index.ts**

Modify `packages/protocol/src/index.ts` — append below the existing export block:

```ts
export {
  PRESETS,
  getPreset,
  DeployPlanSchema,
  NO_CAP,
  type DeployPlan,
  type PresetId,
  type NetizenPreset,
  type ThresholdBand,
} from "./presets.js";
```

- [ ] **Step 5: Run tests + typecheck to verify they pass**

Run: `cd /Users/maxbrych/Documents/privat/side_projects/netizen_labs/packages/protocol && pnpm test && pnpm typecheck`
Expected: all tests PASS (manifest.test.ts + 9 new), typecheck clean.

- [ ] **Step 6: Commit (pull first — the signer session is active in this repo)**

```bash
cd /Users/maxbrych/Documents/privat/side_projects/netizen_labs
git pull --ff-only
git add packages/protocol/src/presets.ts packages/protocol/src/index.ts packages/protocol/test/presets.test.ts
git commit -m "feat(protocol): manifest presets — town, Verein, Genossenschaft, company, each with a typed deploy plan

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push
```
