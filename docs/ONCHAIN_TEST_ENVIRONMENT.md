# Onchain Test Environment

A parallel, throwaway copy of the Röbel identity contracts on **Gnosis mainnet
(chain 100)**, so you can click through citizenship minting, attestation and
revocation in the real app without touching the real DAO.

Until now this was a documented gap. The staging environment spec
(`docs/superpowers/specs/2026-07-24-shared-staging-environment-design.md`) said:

> Blockchain stays LIVE Gnosis (chain 100), shared **read-only**. Governance writes
> (propose/attest/vote) need Attester/Citizen NFTs → NOT testable by normal
> contributors.

This closes that gap for the **identity layer**. Governance (MACI) and Circles /
Röbel Münzen are still not covered — see [Out of scope](#out-of-scope).

---

## The contracts

|                            | Address                                                              |
| -------------------------- | -------------------------------------------------------------------- |
| **AttesterNFTv2 (test)**   | `0x5983F6300bCE3D9C1336a858Bd73F259bB8330F3`                         |
| **CitizenNFTv2 (test)**    | `0x0Be374808A567c9088aC8208B90a4239432B3220`                         |
| Owner (burner EOA)         | `0xd5028284017A32C672CbD73Fe35aCD897bA874cf`                         |
| Attester runtime code hash | `0x3c12a034ea9c2749c786497b5d50dcfaa4eff84860819d788517145a2276ee51` |
| Citizen runtime code hash  | `0x481949efe62483d881190ec16e7ac6ffd796b0e601ea952507fa6eee1986bafb` |

Manifest: [`contracts/governor-contract/deployments/gnosis-test.json`](../contracts/governor-contract/deployments/gnosis-test.json)

Three deliberate differences from production:

1. **Owner is a burner EOA, not the Attester Safe.** Retuning thresholds is one
   transaction instead of a multi-sig ceremony.
2. **`finalizeMigration()` is never called.** `migrationMint` stays owner-callable
   forever, which is the seed / reset button. In production this is closed and can
   never reopen.
3. **Five co-signer EOAs are derived from the burner key** and hold both Attester
   and Citizen NFTs, so one person can supply an entire approval quorum.

### Why Gnosis mainnet and not a testnet

Chain 100 is load-bearing far beyond which RPC gets called. A thirdweb smart account
stamps its EIP-712 domain with the chain it lives on, and `org-membership`,
`nostr-identity-register` and `delete-user-account` all hardcode viem's `gnosis` for
their ERC-1271 checks. `apps/expo/lib/citizen-commitment.ts` freezes `chainId: 100` as
a _derivation constant_. Moving to Chiado would change the domain separator, break
identity verification across several edge functions, and leave you testing a
configuration production never runs. Gnosis gas is cheap enough that the whole deploy
cost **0.05 xDAI** — the fake chain isn't worth it.

---

## Quick start

### 1. Point your build at the test contracts

**Expo** (`apps/expo/.env`):

```bash
EXPO_PUBLIC_IDENTITY_CONTRACT_SET=gnosis-staging-test-v1
EXPO_PUBLIC_ATTESTER_NFT_ADDRESS=0x5983F6300bCE3D9C1336a858Bd73F259bB8330F3
EXPO_PUBLIC_CITIZEN_NFT_ADDRESS=0x0Be374808A567c9088aC8208B90a4239432B3220
```

**Web** (`apps/web/.env.local`):

```bash
NEXT_PUBLIC_IDENTITY_CONTRACT_SET=gnosis-staging-test-v1
NEXT_PUBLIC_ATTESTER_NFT_ADDRESS=0x5983F6300bCE3D9C1336a858Bd73F259bB8330F3
NEXT_PUBLIC_CITIZEN_NFT_ADDRESS=0x0Be374808A567c9088aC8208B90a4239432B3220
```

Both apps select the pair through one fail-closed Module and show a persistent
**🧪 Test-Bürger-Pass · keine reale Berechtigung** banner.
If you don't see the banner, your env vars aren't reaching the bundle and you are
talking to **production** — stop and fix that first.

The same Module disables production proposal and voting mutations while this test
set is selected. Test credentials can unlock the staging identity/posting rehearsal,
but they never authorize the production MACI, treasury, coordinator or municipal
decision path.

The immutable Talos Web image embeds placeholders for the three `NEXT_PUBLIC_*`
values. GitOps supplies the matching `ROEBEL_PUBLIC_IDENTITY_CONTRACT_SET`,
`ROEBEL_PUBLIC_ATTESTER_NFT_ADDRESS`, and
`ROEBEL_PUBLIC_CITIZEN_NFT_ADDRESS` values at runtime. The injector rejects any
partial, unknown or mixed pair before the Web server starts.

> The Expo variables **must** use the `EXPO_PUBLIC_` prefix. Before this change
> verification and Thirdweb used different configuration reads, so the banner and
> write handles could disagree. They now consume the same selected contract set.

### 2. Get the burner key

Everything that writes to these contracts needs the burner private key in
`contracts/governor-contract/.env`:

```bash
DEPLOYER_PRIVATE_KEY=0x...
```

Only an authorized test-environment operator should provision this burner key from
the existing secret store. It owns only the test contracts and has **no power over
production** (both production contracts are owned by the Attester Safe
`0x3A08…FDEa`). Never commit or print it.

Without the burner key you can still _use_ the environment as a normal applicant; you
just can't drive approvals. An authorized test-environment operator can seed your
app account as an attester instead without sharing the key.

### 3. Check it's alive

```bash
cd contracts/governor-contract
node scripts/test-env/status.cjs
```

Shows contracts, citizen/attester counts, co-signer gas balances and every pending
request with the exact command to complete it.

---

## The two ways to become a citizen

### A. The real flow (what you actually want to test)

1. Log into the app with a fresh email. Thirdweb creates a smart account.
2. Request citizenship in the UI.
3. Find the request id: `node scripts/test-env/status.cjs`
4. Complete the quorum from the CLI:

```bash
ROEBEL_TEST_ENV=1 node scripts/test-env/cosign.cjs <requestId>
```

`cosign.cjs` reads how many signatures are still missing in each role, skips
co-signers that already voted or are the request's target, and sends exactly that
many transactions. The NFT mints on the last one and the app flips you to citizen.

### B. The shortcut (setting up a scenario)

Mint straight into an address, skipping the request entirely:

```bash
ROEBEL_TEST_ENV=1 node scripts/test-env/seed-identity.cjs 0xYOURSMARTACCOUNT --citizen
ROEBEL_TEST_ENV=1 node scripts/test-env/seed-identity.cjs 0xYOURSMARTACCOUNT --attester
```

Use `--attester` to test the **approver's** side of the UI: seed yourself as an
attester, manufacture a pending request with `simulate-applicant.cjs`, then approve it
from the app.

> Pass your **smart account** address, not an EOA — that is the address the app holds
> the NFT with. Get it from the staging Supabase `users.wallet_address` row after
> logging in, or check any address with
> `node scripts/test-env/status.cjs --whoami 0x…`.

---

## Script reference

All mutating scripts require `ROEBEL_TEST_ENV=1`, refuse to run on any chain but
Gnosis, and hard-refuse if an address they are about to write to belongs to the
production stack. Run them from `contracts/governor-contract/`.

| Script                         | What it does                                                                                                                                   |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `status.cjs`                   | State dump: counts, thresholds, co-signer gas, pending requests. Read-only, no opt-in needed.                                                  |
| `cosign.cjs <id>`              | Completes a pending request as the co-signers. `--attester` for the AttesterNFT contract, `--reject` to reject, `--dry-run` to see the plan.   |
| `seed-identity.cjs <addr>`     | `migrationMint` a citizen and/or attester NFT directly.                                                                                        |
| `simulate-applicant.cjs`       | Creates a citizenship request from a throwaway derived EOA, without opening the app. `--index N` for a fresh applicant.                        |
| `set-bands.cjs --fast\|--prod` | Retunes thresholds. `--fast` makes every gate 1-of-1 for quick UI loops.                                                                       |
| `deploy.cjs`                   | Deploys a fresh, unreviewed candidate. Requires `--candidate-manifest <new-path>` (or `--dry-run`) and never overwrites the reviewed manifest. |
| `rehearse.cjs`                 | Runs the whole thing on a local Hardhat chain (`npx hardhat run scripts/test-env/rehearse.cjs`). Run before any real deploy.                   |

---

## Why five co-signers

`CitizenNFTv2.approveRequest` enforces **one approval per wallet**, so a wallet
holding both NFTs counts toward exactly one role. That makes the quorum a count of
_distinct wallets_:

| attesters | join needs        | revoke needs                              |
| --------- | ----------------- | ----------------------------------------- |
| 3         | 2 att + 1 cit = 3 | 3 att + 1 cit = **4 — impossible with 3** |
| **5**     | 2 att + 1 cit = 3 | 4 att + 1 cit = **5 — exactly fits**      |
| 7         | 3 att + 1 cit = 4 | 5 att + 1 cit = 6                         |

The constructors take exactly three founders, so the deploy mints two more via
`migrationMint`. Five is the smallest set that can drive _every_ gate.

---

## Gotchas

- **Don't mint more than ~7 test attesters.** `attesterCount` drives the percentage
  bands, and revocation is `ceil(0.67 × attesterCount)` with no cap. Past 7 the five
  co-signers can no longer reach quorum. `seed-identity.cjs` warns you. Escape hatch:
  `set-bands.cjs --fast`.
- **The test CitizenNFT is named "Roebel Citizen", exactly like production.**
  `CitizenNFTv2` hardcodes its ERC721 name, so only the address differs. That is the
  entire reason the in-app banner exists. (`AttesterNFTv2` takes name/symbol
  arguments, so the test one is "Roebel TEST Attester".)
- **`0x5983F6300bCE3D9C1336a858Bd73F259bB8330F3` is also an archived MACI governor on
  Base.** Same deployer, same nonce, different chain — so a repo-wide grep for that
  address hits `deployments/base.json` too. Harmless, but don't be confused by it.
- **Anyone with the burner key can mint citizenship at will.** That is the point, and
  it is also why nothing here may ever be referenced from production config.
- **Co-signers run out of gas.** They start with 0.01 xDAI each; `status.cjs` flags
  low balances. Top up from the burner.
- **Changing bands affects only requests created afterwards.** Every request
  snapshots its approval and rejection thresholds when it is created; pending
  requests keep their original quorum.

---

## Resetting and rotation

There is intentionally no reset button: the contracts are immutable and soulbound.
Use fresh test accounts for ordinary scenarios; `migrationMint` remains open and
`simulate-applicant.cjs --index N` provides fresh applicants.

A redeploy is a **contract-set rotation**, not a runtime configuration edit. The
deploy helper can create a candidate pair, but it requires an explicit new candidate
manifest path and refuses to overwrite the reviewed manifest. The new addresses,
owner, pair binding and runtime code hashes must be reviewed under a new contract-set
id in the shared Module and GitOps before any app or mutating helper accepts it.
Never repoint `gnosis-staging-test-v1` to different addresses.

## Out of scope

- **MACI governance** (proposals, private voting, tallying). Needs a MACI core,
  VkRegistry with the ~1GB zkeys, a gatekeeper, a timelock and a running coordinator.
  A separate build.
- **Circles / Röbel Münzen.** A test group would cost real CRC to register and can't
  be unregistered.
- **Contract unit tests.** Already covered by `contracts/governor-contract/test/`
  (`CitizenNFTv2.test.js`, `AttesterNFTv2.test.js`) — run `npx hardhat test`.
