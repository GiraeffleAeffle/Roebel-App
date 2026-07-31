# ERC-4337 Smart-Account Implementation Bake-off — Netizen Accounts

**Date:** 2026-07-31 · **Status:** research, no code changes · **Author:** Claude (research session)
**Scope:** pick the smart-account implementation for NEW Netizen accounts (node-signer EOA admin, guardian recovery at genesis, identical address on every EVM chain).

## Methodology / what "VERIFIED" means here

- **Onchain:** every address in the matrix below was checked on 2026-07-31 via `eth_getCode`/`eth_call` against `rpc.gnosischain.com` (chain 100) and `mainnet.base.org` (chain 8453). "identical" = byte-identical runtime code on both chains; "equal-mod-immutables" = same length, diffs confined to chain-dependent immutables (cached EIP-712 domain separator + `block.chainid` — decoded byte-for-byte: the 2-byte diff regions are literally `0x0064` vs `0x2105`, i.e. 100 vs 8453).
- **Source:** thirdweb contracts read from **verified source on Gnosis Blockscout** (`/api/v2/smart-contracts/…`); other repos read from raw.githubusercontent.com at exact tags.
- **Web claims:** compiled from three parallel research passes against primary sources (repos, audit PDFs, official docs, release notes). Anything not confirmed against a primary source is in the **Unverified** section at the end.

## Constraints recap

| # | Constraint |
|---|---|
| C1 | One user address identical on every EVM chain (deterministic factory, same address cross-chain; salt = user's admin EOA) |
| C2 | Admin signer = EOA held by our node signer service (no passkeys required) |
| C3 | Guardian/recovery module installable in the account's **initial** configuration (factory initdata) → guardian owner-rotation works on chains where the account never transacted |
| C4 | Admin owner rotation post-deployment |
| C5 | EntryPoint v0.7+ (v0.8 welcome) |
| C6 | Audited; permissive/open license (no FSL/BUSL/non-commercial) |
| C7 | Live/deployable on Gnosis (100) AND Base (8453) |
| — | ERC-7579 modularity preferred |

## Comparison table

| | **Kernel v3.3 (ZeroDev)** | **Nexus v1.2.0 (Biconomy)** | **Safe 1.4.1 + 4337Module 0.3.0 + Candide SRM** | **thirdweb Account (current)** | **Alchemy MAv2** | **Coinbase Smart Wallet** | **SimpleAccount** |
|---|---|---|---|---|---|---|---|
| License (SPDX) | MIT (LICENSE.txt at v3.x tags; ⚠ v4-era `dev` branch has no LICENSE file) | MIT | LGPL-3.0 (core) / LGPL-3.0-only (4337 module) / GPL-3.0 (Candide SRM) | Apache-2.0 (account) / GPL-3.0 (factory) | GPL-3.0-or-later | MIT | GPL-3.0 (core EP; interfaces MIT since v0.8) |
| EntryPoint | v0.7 (verified onchain); 7702-aware; **no EP v0.8 release** (v4.0 targets v0.9) | v0.7 (verified onchain) + EIP-7702; EP v0.8 PRs stalled as drafts | v0.7 (module `SUPPORTED_ENTRYPOINT` verified onchain); EP v0.8 module not shipped (unverified) | **v0.6** (immutable, verified) | v0.7 | **v0.6 only** | v0.6/v0.7/v0.8 per release |
| ERC-7579 | Yes (native) | Yes (native) | Via Safe7579 adapter only | No | No (ERC-6900) | No | No |
| Same addr Gnosis+Base | **VERIFIED** (factory byte-identical; impl equal-mod-immutables) | **VERIFIED** (all three published sets) | **VERIFIED** (proxy factory, SafeL2, 4337 module, module setup, Candide SRM ×3 all byte-identical) | **VERIFIED** incl. `getAddress()` parity | ✗ **NOT on Gnosis** (empty at all 4 addrs) | deployed both chains (byte-identical) but EP v0.6 | VERIFIED (v0.7 factory) |
| Guardian module at init (C3) | **Yes** — `initialize(...bytes[] initConfig)` self-calls install any 7579 module at genesis | **Yes** — `NexusBootstrap.initNexus(validators[], executors[], hook, fallbacks[], …)` | **Yes** — `setup()` delegatecall enables 4337 module + SocialRecoveryModule in the initializer (baked into CREATE2 address) | **No** — initialize binds exactly one admin, nothing else | Yes (but fails C7) | No module system | No |
| Admin rotation (C4) | recovery executor rewrites ECDSA-validator owner; `changeRootValidator` | `K1Validator.transferOwnership()` | `swapOwner()` (guardian-driven via SRM `finalizeRecovery`) | `setPermissionsForSigner` (EIP-712-signed by an existing admin) | yes | owner add/remove by index | owner is immutable-ish (single storage slot) |
| Audits | v3.0 ChainLight 2024 (2 High, patched); v3.1 incremental; **v3.2/v3.3 deltas: no published audit** | CodeHawks 07/2024, Spearbit/Cantina 10-11/2024, Zenith 03/2025, **Pashov 03/2025 (contemporaneous with v1.2.0)** | Safe core: many + Certora FV; 4337 module v0.3.0: **Ackee**; v0.2.0: Ackee + OpenZeppelin; Candide SRM: audited (see §3c) | thirdweb prebuilt audits (0xMacro; not re-verified) | Quantstamp + Cantina bounty | Cantina ×2, Certora, Code4rena (2023-24) | EP audits (OZ 2023/2024, Spearbit 03/2025 for v0.8, Cantina for v0.9) |
| Prod scale (BundleBear, all-time accounts) | **5.65 M** | 2.28 M (label conflates Biconomy v2+Nexus) | n/a in 4337 factory stats; largest TVL implementation overall | share not isolated in factory table (unverified) | 13.7 M (Alchemy label) | 3.6 M | n/a |
| Maintenance 2026 | **Active** (v4.0 2026-07-07; pushed 2026-07-21) | Slow (main pushed 2026-02-27; EP-0.8 PR draft since 02/2025; energy moved to MEE suite) | Very active | Maintained; EP v0.6 architecture frozen | Active (pushed 2026-07-31) | Active-ish (pushed 2026-07-17) | Active (v0.9 shipped) |
| Verdict vs constraints | **PASS all** (audit caveat on v3.3 delta) | **PASS all** | PASS all except 7579-native (adapter) | Fails C3, C5 | Fails C7 | Fails C3, C5 | Fails C3 |

## Onchain verification matrix (2026-07-31)

All checked via public RPCs; ✓ = code present.

| Contract | Address | Gnosis | Base | Bytecode |
|---|---|---|---|---|
| EntryPoint v0.6 | `0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789` | ✓ | ✓ | identical |
| EntryPoint v0.7 | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` | ✓ | ✓ | identical |
| EntryPoint v0.8 | `0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108` | ✓ | ✓ | equal-mod-immutables (EIP-712 domain sep + chainid) |
| Kernel v3.1 factory | `0xaac5D4240AF87249B3f71BC8E4A2cae074A3E419` | ✓ | ✓ | identical |
| Kernel v3.2 factory | `0x7a1dBAB750f12a90EB1B60D2Ae3aD17D4D81EfFe` | ✓ | ✓ | identical |
| Kernel v3.3 factory | `0x2577507b78c2008Ff367261CB6285d44ba5eF2E9` | ✓ | ✓ | identical; `implementation()` = v3.3 impl on both |
| Kernel v3.1 impl | `0xBAC849bB641841b44E965fB01A4Bf5F074f84b4D` | ✓ | ✓ | equal-mod-immutables; `entrypoint()` = **EP v0.7** (read onchain) |
| Kernel v3.3 impl | `0xd6CEDDe84be40893d153Be9d467CD6aD37875b28` | ✓ | ✓ | same size; `entrypoint()` = **EP v0.7** (read onchain) |
| Kernel FactoryStaker (meta-factory) | `0xd703aaE79538628d27099B8c4f621bE4CCd142d5` | ✓ | ✓ | identical; `owner()` = `0x9775…AE8A` on both; `approved()` = true for v3.1 & v3.3 factories on both |
| Kernel ECDSAValidator (v3.1+) | `0x845ADb2C711129d4f3966735eD98a9F09fC4cE57` | ✓ | ✓ | same size |
| ZeroDev recovery-action executor | `0xe884C2868CC82c16177eC73a93f7D9E6F3A5DC6E` | ✓ | ✓ | identical |
| Nexus legacy NexusAccountFactory | `0x000000226cada0d8b36034F5D5c06855F59F6F3A` | ✓ | ✓ | identical; `ACCOUNT_IMPLEMENTATION()` = `0x0000…EaaF` on both |
| Nexus legacy impl (accountId `biconomy.nexus.1.0.0`) | `0x000000008761E87F023f65c49DC9cb1C7EdFEaaf` | ✓ | ✓ | same size; `entryPoint()` = EP v0.7 (read onchain) |
| Nexus legacy K1ValidatorFactory | `0x00000024115AA990F0bAE0B6b0D5B8F68b684cd6` | ✓ | ✓ | identical |
| Nexus v1.2.0 impl (MEE v2.1 default) | `0x00000000383e8cBe298514674Ea60Ee1d1de50ac` | ✓ | ✓ | equal length |
| Nexus factory (MEE v2.1) | `0x0000006648ED9B2B842552BE63Af870bC74af837` | ✓ | ✓ | identical |
| NexusBootstrap v1.2.1 | `0x0000003eDf18913c01cBc482C978bBD3D6E8ffA3` | ✓ | ✓ | identical |
| Nexus v1.3.2 impl / factory / bootstrap | `0x0000b1C0…f62B` / `0x0000B1c0…dB05` / `0x0000B1c0…00C6` | ✓ | ✓ | equal length / identical / identical |
| Safe ProxyFactory 1.4.1 | `0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67` | ✓ | ✓ | identical |
| SafeL2 1.4.1 singleton | `0x29fcB43b46531BcA003ddC8FCB67FFE91900C762` | ✓ | ✓ | identical |
| Safe4337Module 0.3.0 | `0x75cf11467937ce3F2f357CE24ffc3DBF8fD5c226` | ✓ | ✓ | identical; `SUPPORTED_ENTRYPOINT()` = **EP v0.7** (read onchain) |
| SafeModuleSetup | `0x2dd68b007B46fBe91B9A7c3EDa5A7a1063cB5b47` | ✓ | ✓ | identical |
| Candide SocialRecoveryModule 3d / 7d / 14d | `0x38275826…541c` / `0x088f6cfD…33f2` / `0x9BacD92F…f25b` | ✓ | ✓ | identical per address (md5-equal both chains) |
| Coinbase SW factory | `0x0BA5ED0c6AA8c49038F819E587E2633c4A9F428a` | ✓ | ✓ | identical (someone replayed the CREATE2 deploy on Gnosis) — but EP v0.6 |
| SimpleAccountFactory (EP v0.7) | `0x91E60e0613810449d098b0b5Ec8b51A0FE8c8985` | ✓ | ✓ | identical |
| Alchemy MAv2 factory | `0x00000000000017c61b5bEe81050EC8eFc9c6fecd` | **✗ EMPTY** | ✓ | — |
| Alchemy MAv2 impls (ModularAccount, SMABytecode, SMA7702) | `0x0000…DD4f` / `0x0000…7383` / `0x6900…E139` | **✗ EMPTY** | ✓ | — |
| thirdweb AccountFactory | `0x85e23b94e7F5E9cC1fF78BCe78cfb15B81f0DF00` | ✓ | ✓ | identical; `accountImplementation()` = `0xf221…a346` on **both**; `getAddress(0x…01, 0x)` returns the **same address on both chains** |
| thirdweb Account impl | `0xf22175c80c6e074c171811c59c6c0087e2a6a346` | ✓ | ✓ | equal-mod-immutables |
| Rhinestone SocialRecovery validator | `0xA04D053b3C8021e8D5bF641816c42dAA75D8b597` | ✓ | ✓ | same size both chains — **address provenance unverified** (not confirmed from official Rhinestone docs) |

---

## 1) ZeroDev Kernel v3.x — RECOMMENDED

**Repo:** `zerodevapp/kernel` · **License:** MIT — `LICENSE.txt` present at v3.0–v3.3 tags ("Copyright 2023 ZeroDev, Inc."), SPDX `MIT` in `Kernel.sol`, `KernelFactory.sol`, `FactoryStaker.sol`. ⚠ The post-v4.0 `dev` branch currently ships **no LICENSE file** (GitHub API reports no license; source headers still MIT) — likely restructure oversight, worth pinning tags.

- **EntryPoint:** constructor-injected immutable. v3.0–v3.3 all bind **EP v0.7** — confirmed by reading `entrypoint()` off the deployed v3.1 and v3.3 impls on Gnosis. v3.3 (released 2025-04-03) adds EIP-7702 delegate support (`EIP7702_PREFIX` check in `initialize`; the same impl address doubles as the 7702 delegation target in ZeroDev's SDK). **No EP v0.8 release exists**; Kernel v4.0 (2026-07-07) jumped straight to EP v0.9 (new code, no published audit found).
- **Determinism (C1):** `KernelFactory.createAccount(bytes data, bytes32 salt)` → `LibClone.createDeterministicERC1967(implementation, keccak(data‖salt))`. Address depends only on (factory, impl, initData, salt) — all byte-identical on Gnosis and Base (verified). Salt is free-form → salt = admin EOA works; note the initData (root validator + owner + initConfig) is also part of the address, which is *good*: the guardian config is pinned into the counterfactual address.
- **Guardian at init (C3):** `initialize(ValidationId _rootValidator, IHook hook, bytes validatorData, bytes hookData, bytes[] initConfig)` — verified at the v3.3 tag. Each `initConfig[i]` executes as a self-call during initialization (reverts on failure), and module-install functions are `onlyEntryPointOrSelfOrRoot` → **any ERC-7579 recovery/guardian validator or executor installs atomically at account genesis**. ZeroDev's account-recovery docs show exactly this guardian-at-creation pattern. On a chain the user never touched: anyone can permissionlessly deploy the account (same initcode → same address, same guardians), then guardians execute recovery there. C3 fully satisfied.
- **Rotation (C4):** ECDSAValidator itself has no `setOwner` — rotation runs through the recovery executor `0xe884C286…DC6E` (verified deployed both chains): a guardian validator authorized for `doRecovery(validator, newOwnerData)` rewrites the ECDSA validator's stored owner. Admin-driven rotation alternative: `changeRootValidator` / `installValidations` (self/root/EntryPoint-gated).
- **Audits (C6):** ChainLight (Theori) audit of v3.0, report 2024-04-05 — 12 findings, 2 High (both patched), status table 9 patched/1 ack/2 WIP-informational. v3.1 incremental audit (Felix Kim, 2024-06) — 3 minor findings. KALOS audited v1/v2 + plugins. **Gap: no published audit covering the v3.2/v3.3 deltas** (ERC-1271 replayable-sig change; 7702). Conservative option: deploy **v3.1** (fully audited) — same initConfig mechanism; v3.3 only if the 7702-delegate future matters more than audit completeness.
- **Vendor-dependency check:** the `FactoryStaker` meta-factory (used as the userop `initCode` target because factories must stake with the EntryPoint) is `Ownable` by ZeroDev (`0x9775…AE8A` on both chains) — but it does **not** influence account addresses (it just forwards to `KernelFactory.createAccount`) and only its `approved` mapping gates it. Direct `KernelFactory.createAccount` is permissionless, and we can deploy + stake **our own** staker wrapper and keep identical account addresses. No ZeroDev choke point on addresses.
- **Scale/maintenance:** BundleBear all-time: **5,648,790 accounts** from the Kernel factory (2026-07-31). Repo active (pushed 2026-07-21). ZeroDev's ">50% of all 4337 accounts" marketing claim is inconsistent with BundleBear (~16% of named-factory deploys) — ignore it.

## 2) Biconomy Nexus — close second

**Repo:** `bcnmy/nexus` · **License:** MIT (LICENSE at main and v1.2.0; SPDX MIT in `Nexus.sol`).

- **EntryPoint:** constructor-injected. v1.0.x and v1.2.0 = **EP v0.7** (docs list EP v0.7 for the production sets; confirmed by reading `entryPoint()` off the deployed legacy impl on Gnosis). v1.2.0 (2025-04-07) = "Built for EIP-7702 + ERC-4337 v0.7". **EP v0.8 support never shipped** — "Nexus 2.0.0: EIP-7702 + EP v0.8" PRs (#240/#243) have been open drafts since Feb 2025.
- **Determinism (C1):** `NexusAccountFactory.createAccount(bytes initData, bytes32 salt)` — CREATE2 via `ProxyLib.deployProxy`; salt free-form (use admin EOA). All three published deployment sets (legacy v1.0.x, MEE-default v1.2.0, audited v1.3.2) verified byte-identical factories on Gnosis + Base.
- **Guardian at init (C3):** `NexusBootstrap.initNexus(BootstrapConfig[] validators, BootstrapConfig[] executors, BootstrapConfig hook, BootstrapConfig[] fallbacks, preValidationHooks, registryConfig)` — multiple validators (K1 owner validator + guardian/recovery validator), executors and hooks all installable in the genesis initData. Bootstrap v1.2.1 verified deployed on both chains.
- **Rotation (C4):** `K1Validator.transferOwnership(newOwner)` (called by the account) — the cleanest owner-rotation semantics in the field. Plus standard 7579 install/uninstall.
- **Audits (C6):** the best coverage of a *shipped current version*: CodeHawks-Cyfrin competition (Jul 2024), Spearbit/Cantina core + ERC-7739 addon (Oct-Nov 2024), Zenith (Mar 2025), **Pashov (Mar 2025, contemporaneous with v1.2.0)**. Caveat: Biconomy's own docs mark the newest MEE suite v2.3.0-rc (Nexus impl "v1.3.1") **Unaudited**; suite v2.2.2 (impl v1.3.2) audited Pashov May 2026. v1.3.x has no repo tags/release notes — weaker provenance; stick to v1.2.0 if choosing Nexus.
- **Scale/maintenance:** BundleBear "Biconomy" label = 2.28 M accounts (conflates v2+Nexus). Open-repo momentum is visibly slower than Kernel's (main pushed 2026-02-27; EP-0.8 stalled; energy moved to the MEE suite). That maintenance trajectory is why it ranks #2 despite the stronger latest-version audit story.

## 3) Safe 1.4.1 + Safe4337Module 0.3.0 + Candide SocialRecoveryModule — battle-tested fallback

**Licenses:** safe-smart-account **LGPL-3.0**; safe-modules **LGPL-3.0** (repo) / `LGPL-3.0-only` (Safe4337Module.sol SPDX); Candide `CandideWalletContracts` **GPL-3.0**. All open, weak-copyleft — acceptable (contracts deployed as-is; no FSL/BUSL/NC anywhere).

- **(a) EntryPoint:** Safe4337Module 0.3.0 `SUPPORTED_ENTRYPOINT()` = EP v0.7 (read onchain, Gnosis). v0.2.0 was EP v0.6. An EP v0.8-compatible module release was **not confirmed** (see Unverified).
- **(b) Determinism + guardian at init (C1+C3):** `SafeProxyFactory.createProxyWithNonce(singleton, initializer, saltNonce)` → proxy address = f(factory, singleton, keccak(initializer), saltNonce). The initializer runs `Safe.setup(owners, threshold, to, data, fallbackHandler, …)` where `to`+`data` delegatecalls `SafeModuleSetup.enableModules([Safe4337Module, SocialRecoveryModule])` (via MultiSend for the general case) — i.e. **the 4337 module AND the recovery module are enabled inside the initcode and therefore baked into the counterfactual address**. Deploy on a never-touched chain → same owners, same guardians → guardians can rotate there. All pieces verified byte-identical on Gnosis + Base, including all three Candide SRM grace-period variants (3d/7d/14d, addresses from docs.candide.dev deployments page).
- **(c) Recovery semantics:** Candide SocialRecoveryModule — audited by **Ackee Blockchain** (`audit/ackee-blockchain-candide-social-recovery-report.pdf` in `candidelabs/CandideWalletContracts`; findings status not extracted): guardians `confirmRecovery` → threshold met → `executeRecovery` (starts grace period: 3/7/14 days per variant) → `finalizeRecovery` calls `swapOwner` on the Safe. Grace period gives the current owner a veto window — a feature our design may actually want.
- **Registry cross-check:** `safe-global/safe-deployments` `v1.4.1/safe_proxy_factory.json` lists the canonical address `0x4e1DCf…ec67` with chains **100 and 8453 both mapped to "canonical"** — registry-level confirmation on top of the bytecode check.
- **(d) Audits:** the deepest stack in the industry — Safe core audited repeatedly + Certora formal verification; 4337 module v0.3.0 audited by **Ackee Blockchain** (`modules/4337/docs/v0.3.0/audit.md` + PDF in-repo); v0.2.0 by Ackee + OpenZeppelin.
- **(e) Trade-offs:** not ERC-7579-native (Safe7579 adapter by Rhinestone exists but adds a layer and its own audit surface); heavier gas; module model is Safe-specific (`enableModule`) rather than 7579 install; multichain address consistency is famously footgun-prone if any byte of the initializer differs per chain (must freeze the exact initializer template).

## 4) thirdweb Account (the incumbent) — verified deep-dive and the initialize() answer

**Verified source pulled from Gnosis Blockscout** for both `Account` impl `0xf22175c80c6e074c171811c59c6c0087e2a6a346` and `AccountFactory` `0x85e23b94e7F5E9cC1fF78BCe78cfb15B81f0DF00` (compiler v0.8.23; files = thirdweb `contracts/prebuilts/account/*`). Licenses: Account/AccountCore/AccountPermissions SPDX **Apache-2.0**; AccountFactory/BaseAccountFactory SPDX **GPL-3.0**.

**What initialize() binds — the complete answer:**

```solidity
function initialize(address _defaultAdmin, bytes calldata _data) public virtual initializer {
    AccountCoreStorage.data().creationSalt = _generateSalt(_defaultAdmin, _data); // keccak256(abi.encode(admin, data))
    _setAdmin(_defaultAdmin, true);
}
```

1. Stores `creationSalt` (used later only to prove "I am a clone of this factory" in callbacks).
2. Sets the admin flag in `AccountPermissions` storage. `_setAdmin` additionally calls `factory.onSignerAdded(admin, salt)` — a **registry that lives inside the factory contract itself** (`allAccounts` / `accountsOfSigner` EnumerableSets), used by SDK convenience functions (`getAccountsOfSigner` etc.). The callback verifies the caller is a genuine clone via address prediction. **That is the ONLY external binding.** There is **no thirdweb-owned registry, no roles for thirdweb, no hooks, no oracle** — nothing outside the factory + the canonical EntryPoint v0.6.
3. EntryPoint: immutable = v0.6 (`0x5FF1…2789`), with an admin-only escape hatch `setEntrypointOverride()` stored in `AccountCoreStorage` (of limited use: the account implements the v0.6 `UserOperation` struct, so it cannot genuinely validate v0.7 PackedUserOperations).
4. Factory governance: `AccountFactory` is `BaseAccountFactory + ContractMetadata + PermissionsEnumerable`. The constructor's `_defaultAdmin` = `0xdd99b75f095d0c4d5112aCe938e4e6ed962fb024` (thirdweb deployer EOA) holds `DEFAULT_ADMIN_ROLE`, whose **only** powers are `setContractURI` and role management. It has **zero power over accounts**: accounts are non-upgradeable EIP-1167 clones of an immutable implementation the factory itself deployed in its constructor (`new Account(entrypoint, address(this))` — which is why the impl address matches cross-chain). No pause, no upgrade, no fee switch.
5. Admin rotation: `AccountPermissions.setPermissionsForSigner(SignerPermissionRequest, sig)` — anyone may submit, authorization = EIP-712 signature by a current admin; `isAdmin=1` adds, `isAdmin>1` removes. Session keys via the same request struct. ERC-1271 uses the wrapped `AccountMessage(bytes message)` typed digest (the known thirdweb 1271 wrapping quirk — the reason our XMTP/1271 flows need special handling).

**Could our own bundler drive the same factory? YES — verified.** `createAccount(admin, data)` is fully permissionless (callable by anyone, incl. via EntryPoint initCode); salt = `keccak256(abi.encode(admin, data))`; address = `Clones.predictDeterministicAddress(impl, salt)`. Onchain check: `getAddress(0x…01, 0x)` returns the **identical** address `0xc914…8517` on Gnosis AND Base; `accountImplementation()` is identical on both. Accounts talk only to the canonical (permissionless) EntryPoint v0.6 and the factory. **The only thirdweb lock-in is off-chain**: their key management (inAppWallet shards) and their bundler/paymaster service. Any EP v0.6-capable bundler (e.g. self-hosted Alto/Skandha/Voltaire) reproduces identically-behaving accounts at identical addresses.

**Why not for NEW accounts:** EP v0.6 (fails C5), no module system, and — decisive for C3 — `initialize` binds exactly ONE admin; `_data` only feeds the salt. A guardian can only be added post-deploy by an admin-signed op **per chain**; if the admin key is lost, every never-touched chain is unrecoverable. Keep for the existing citizen accounts; do not build Netizen Accounts on it.

## 5) Alchemy Modular Account v2 — eliminated (C7)

GPL-3.0-or-later (LICENSE-GPL + file headers, © Alchemy Insights). EP v0.7, ERC-6900 (not 7579). Docs claim "same address across all EVM chains" for factory `0x0000…6fecd` and impls — but **onchain: all four addresses are EMPTY on Gnosis** (present on Base). Alchemy's infra does not support Gnosis. Repo very active (pushed 2026-07-31); 13.7 M accounts on BundleBear under the Alchemy label. Could be self-deployed in theory, but a vendor stack whose vendor doesn't operate on 50% of our target chains is a bad bet. **Out on C7.**

## 6) Coinbase Smart Wallet — eliminated (C5)

MIT (LICENSE.md; SPDX MIT in `CoinbaseSmartWallet.sol`). Well audited (Cantina Dec 2023 + Apr 2024, Certora Feb 2024, Code4rena Mar 2024 — PDFs in-repo). Factory `0x0BA5…428a` is, surprisingly, deployed byte-identical on Gnosis too (deterministic deploy replayed). But: **EntryPoint v0.6 only**, no module system (multi-owner list incl. passkeys as its only "recovery"), no 7579. **Out on C5 (and effectively C3).**

## 7) eth-infinitism SimpleAccount / Simple7702Account — eliminated (C3)

GPL-3.0 repo; since v0.8 the interfaces/utility contracts are relicensed MIT, core EntryPoint stays GPL (release notes v0.8.0). EP-version-matched factories (v0.7 factory `0x91E6…8985` verified identical Gnosis+Base). Audited as part of the EP audits (OpenZeppelin 2023/2024, Spearbit Mar 2025, Cantina v0.9). But single-owner, **no modules, no recovery** — reference implementation only. **Out on C3.**

## 8) EIP-7702 + EntryPoint v0.8 — the simplification track (status mid-2026)

- **Live everywhere we need:** Ethereum Pectra 2025-05-07; **Gnosis ran Pectra BEFORE Ethereum — 2025-04-30** (gnosischain/specs; the docs page saying "7 May" copies Ethereum's date); **Base via OP-stack Isthmus 2025-05-09**. Both chains have had 7702 for ~14 months.
- **EP v0.8** (`0x4337…F108`) verified onchain on both chains (equal-mod-immutables — it caches an EIP-712 domain separator, hence per-chain bytes). v0.8 = native 7702 auth in userops (`eip7702Auth`), EIP-712 userop hashing, `Simple7702Account`, initCode-frontrun fix. Spearbit review Mar 2025 in-repo; **v0.9 already exists** (Cantina-audited) — v0.8 remains the widely-bundled version.
- **Bundlers:** Pimlico/Alto, Alchemy Rundler, Etherspot Skandha, Candide Voltaire all do EP v0.8 + 7702 — but **Gnosis-specific 7702 bundling is only positively confirmed for thirdweb's infra** (its May-2025 "Expanding EIP-7702 Chain Support" changelog explicitly lists Gnosis AND Base). Pimlico's 7702 chain list names OP-stack chains (Base) but not Gnosis; Alchemy doesn't serve Gnosis at all. **For a self-hosted stack this matters less: we'd run our own bundler anyway (Alto/Skandha support EP v0.8).**
- **Production embedded wallets on 7702:** thirdweb (MinimalAccount delegate, production incl. Gnosis+Base), MetaMask (EIP7702StatelessDeleGator), ZeroDev (Kernel v3.3 as 7702 delegate), Ambire, Privy/Turnkey as authorization-signing layers. Adoption caveat: Wintermute found >97% of early delegations were malicious sweeper contracts — raw delegation counts are noise.
- **Cross-chain:** `chainId = 0` authorizations are spec-sanctioned and used in practice (Pimlico documents the ephemeral-key + universal-auth pattern). Works cleanly while the EOA nonce stays aligned (a fresh EOA that only transacts via 4337 userops keeps nonce 0).
- **Why it does NOT satisfy our constraints as primary:** with 7702 **the EOA key can never be removed as root authority** — it can always sign a new authorization and replace the delegate, overriding any guardian logic inside it (confirmed framing; SlowMist/Halborn/ercsolved analyses; EIP-7851 "deactivate EOA keys" is only a proposal). Our C3 exists precisely to hedge the node-signer key; 7702 would concentrate unrecoverable root authority in exactly that key. **Verdict: keep as a future *additive* track (e.g. Kernel v3.3 doubles as a 7702 delegate, so users with existing EOAs could join the same module ecosystem), not as the account model for Netizen Accounts.**

---

## Ranked recommendation

**1. ZeroDev Kernel v3.x — primary choice.**
MIT, ERC-7579-native, EP v0.7, guardian-at-genesis via `initConfig` (C3 exactly as designed), verified same-address factory+impl on Gnosis and Base, permissionless factory with no vendor choke point on addresses (self-deployable staker), largest 7579 production footprint (5.65 M accounts), active maintenance, and the same v3.3 artifact doubles as the EIP-7702 delegate for a future EOA-onboarding track. **Version call:** v3.1 if audit completeness is the binding constraint; v3.3 if 7702-forward-compatibility wins — the v3.2/v3.3 deltas have no published audit (the one real blemish). Watch item: Kernel v4/EP v0.9 (July 2026) — don't adopt yet (unaudited, brand-new), but it shows the maintenance trajectory.

**2. Biconomy Nexus v1.2.0 — strong runner-up.**
MIT, 7579-native, EP v0.7 + 7702, the best audit coverage of a shipped current version (4 firms through Mar 2025), bootstrap-at-init satisfies C3, all sets verified on both chains, cleanest owner-rotation API. Ranked behind Kernel only on maintenance trajectory (open-source repo slowed since 2025; EP-0.8 stalled in draft; deployment energy moved to the MEE suite whose newest rc is self-declared unaudited) and smaller module/tooling ecosystem.

**3. Safe 1.4.1 + Safe4337Module 0.3.0 + Candide SocialRecoveryModule — the battle-tested conservative option.**
Choose this if "most battle-tested + formal verification + grace-period recovery" outweighs 7579-native ergonomics. Every required piece is verified byte-identical on Gnosis and Base, guardian config bakes into the counterfactual address via the setup initializer, and the LGPL/GPL licenses are open (weak-copyleft, no commercial restriction). Costs: no native 7579 (adapter), heavier accounts, initializer-freezing discipline required for cross-chain address parity. Bonus: we already operate Safes (Attester Safe, GK Safe) — operational familiarity.

**Not viable for new accounts:** thirdweb Account (EP v0.6, no guardian-at-init — but fully self-hostable for the EXISTING citizen accounts, verified), Alchemy MAv2 (not on Gnosis), Coinbase Smart Wallet (EP v0.6), SimpleAccount (no recovery), raw 7702 (root key unrotatable — contradicts the guardian requirement).

**Architecture note for C1+C3 (applies to all three finalists):** because the guardian set is part of the initcode, the counterfactual address on never-touched chains always reproduces the *genesis* configuration. After a recovery on chain A, chain B still initializes with the old owner — guardians must replay the recovery per chain (deploy + rotate). That is exactly the property C3 asks for, but the ops runbook must treat recovery as a per-chain fan-out, and the guardian module/threshold choice is **frozen at genesis** for address-stability — changing the guardian design later changes addresses for new users only.

## Unverified / open items

1. **Kernel v3.2/v3.3 audit coverage** — no published report found covering the deltas over v3.1 (repo audits folder + docs checked). Ask ZeroDev directly before committing to v3.3.
2. **Kernel v4.0 / EP v0.9** — no published audit found; EP v0.9 deployment addresses not verified.
3. **ZeroDev docs deployment-address page** — appears removed/restructured; addresses were instead taken from the official SDK constants (`zerodevapp/sdk` `packages/core/constants.ts`) and then **verified onchain here** (so the addresses themselves are solid; only the docs-page provenance is missing).
4. **Nexus v1.3.x provenance** — deployed + listed in Biconomy docs (v1.3.2 audited Pashov May 2026 per docs) but no repo tags/release notes; EP version of v1.3.x unconfirmed. CodeHawks findings counts not extracted.
5. **BundleBear "Biconomy" account count** — cannot split Smart Account v2 vs Nexus. Similarly, thirdweb factory's share was not isolated in the factory table.
6. **Safe4337Module for EP v0.8** — not found as a shipped release by mid-2026; treat Safe as EP v0.7 (module 0.3.0). (Safe{Core} may have newer artifacts — check safe-modules releases before deciding.)
7. **Candide SocialRecoveryModule audit details** — firm confirmed (Ackee Blockchain, report PDF in-repo), but the report's date/findings/commit scope were not read in this pass. Read before production use if the Safe route is chosen.
8. **Rhinestone SocialRecovery validator address `0xA04D…b597`** — bytecode present and size-identical on both chains, but the address was not confirmed against official Rhinestone deployment docs in this pass.
9. **Gnosis 7702 bundling by third-party bundlers** (Pimlico/Etherspot/Candide on chain 100 specifically) — unconfirmed either way; thirdweb-on-Gnosis is confirmed. Moot if we run our own bundler.
10. **Exact scope of the Spearbit Mar-2025 EP v0.8 audit** (commit range) — PDF not read line-by-line.
11. **Coinbase Smart Wallet 7702 plans**, **cumulative mid-2026 7702 adoption numbers** — live dashboards only, no static citation.
12. **thirdweb prebuilt-account audit report** (0xMacro is the commonly cited firm for thirdweb prebuilts) — not re-verified against a primary source in this pass; the *code* was verified directly instead.

## Primary sources (selection)

- Onchain: `rpc.gnosischain.com`, `mainnet.base.org` (eth_getCode/eth_call, 2026-07-31); `gnosis.blockscout.com/api/v2/smart-contracts/…` for thirdweb verified source.
- Kernel: github.com/zerodevapp/kernel (tags v3.1/v3.3: `LICENSE.txt`, `src/Kernel.sol`, `src/factory/*`, `audits/chainlight_v3_0.pdf`, `audits/v_3_1_incremental_audit.pdf`; releases v3.3, v4.0); github.com/zerodevapp/sdk `packages/core/constants.ts`; docs.zerodev.app (recovery flow, chains).
- Nexus: github.com/bcnmy/nexus (LICENSE, `contracts/Nexus.sol`, `contracts/factory/*`, `contracts/utils/NexusBootstrap.sol`, `contracts/modules/validators/K1Validator.sol`, audits folder, release v1.2.0, PRs #240/#243); docs.biconomy.io/contracts-and-audits (+ supported-chains).
- Safe: github.com/safe-global/safe-smart-account (LICENSE), safe-global/safe-modules (`modules/4337/docs/v0.3.0/audit.md`, Safe4337Module.sol SPDX); docs.candide.dev/wallet/technical-reference/deployments (SRM + module addresses).
- Alchemy: alchemy.com/docs/wallets/smart-contracts/deployed-addresses; github.com/alchemyplatform/modular-account (LICENSE-GPL, ModularAccount.sol header).
- Coinbase: github.com/coinbase/smart-wallet (LICENSE.md, audits folder).
- eth-infinitism: github.com/eth-infinitism/account-abstraction (LICENSE, audits folder, releases v0.8.0/v0.9.0).
- 7702: eips.ethereum.org/EIPS/eip-7702; gnosischain/specs `network-upgrades/pectra.md`; docs.optimism.io Upgrade 15; docs.pimlico.io 7702 FAQ; blog.thirdweb.com 7702 chain-support changelog; MetaMask delegation-framework; Wintermute research (Dune + X threads).
- Usage: bundlebear.com/erc4337-factories/all (fetched 2026-07-31).
