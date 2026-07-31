# Netizen Accounts — M0 onchain truth + M1 quick wins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute the first tranche of the approved Netizen Accounts spec (v2.1): verify the onchain truth that blocks the account layer, ship phone login on the current stack, and fix the two live signature-verifier bugs.

**Architecture:** Read-only Gnosis RPC verification first (M0), then three surgical code changes that are each independently shippable and reversible. No new services, no address changes, no thirdweb removal in this tranche.

**Tech Stack:** curl JSON-RPC (Gnosis), thirdweb v5 `inAppWallet` config, viem (Deno edge function), ethers v6 (coordinator Node script).

**Spec:** `docs/superpowers/specs/2026-07-31-netizen-accounts-service-design.md` (APPROVED v2.1).
**Out of scope here (next plans):** SDK skeleton + `useAccount()` adoption, account-implementation bake-off, rails (M2), signer plane (M3).

## Global Constraints

- Never change any existing account address; all changes are additive or verifier-side.
- Pathspec-only commits (parallel sessions are active in this repo); push after every commit.
- All user-facing text German-first; currency label "Röbel Münzen", never CRC.
- Repo has ~431 pre-existing tsc errors; do not run full typecheck as a gate for these edits.
- Edge-function deploys and Fly deploys are operational gates for the user (Supabase MCP unauthenticated in this session; user runs Fly/EAS themselves).

---

### Task 1: M0 — onchain truth for a live citizen account (read-only)

**Files:**
- Modify: `docs/future-research/2026-07-27_WALLET_SOVEREIGNTY_RESEARCH.md` (append an `## Addendum 2026-07-31 — onchain answers (M0)` section)

**Interfaces:**
- Produces: verified `factory` address, `entryPoint` address + version, and account-implementation address for the live citizen accounts. The M2 rails plan and the bake-off consume these values verbatim.

- [ ] **Step 1: Resolve a live citizen smart-account address from CitizenNFTv2**

```bash
# CitizenNFTv2 on Gnosis: 0x59aA26f499D7C2B3EC2c8524Ed06F54fc4E85dE5; ownerOf(1)
curl -s https://rpc.gnosischain.com -H 'content-type: application/json' -d '{
  "jsonrpc":"2.0","id":1,"method":"eth_call","params":[{
    "to":"0x59aA26f499D7C2B3EC2c8524Ed06F54fc4E85dE5",
    "data":"0x6352211e0000000000000000000000000000000000000000000000000000000000000001"
  },"latest"]}'
```
Expected: a 32-byte-padded address (the citizen's smart account). If it reverts (token 1 burned), try token ids 2..20.

- [ ] **Step 2: Confirm the account has code and read its EntryPoint**

```bash
ACCOUNT=0x...   # from step 1
curl -s https://rpc.gnosischain.com -H 'content-type: application/json' -d '{
  "jsonrpc":"2.0","id":1,"method":"eth_getCode","params":["'"$ACCOUNT"'","latest"]}'
# entryPoint() selector 0xb0d691fe
curl -s https://rpc.gnosischain.com -H 'content-type: application/json' -d '{
  "jsonrpc":"2.0","id":2,"method":"eth_call","params":[{"to":"'"$ACCOUNT"'","data":"0xb0d691fe"},"latest"]}'
```
Expected: non-empty bytecode (a minimal proxy is fine), and EntryPoint = `0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789` (v0.6) or `0x0000000071727De22E5E9d8BAf0edAc6f37da032` (v0.7). Record which.

- [ ] **Step 3: Read the factory**

```bash
# factory() selector 0xc45a0155
curl -s https://rpc.gnosischain.com -H 'content-type: application/json' -d '{
  "jsonrpc":"2.0","id":3,"method":"eth_call","params":[{"to":"'"$ACCOUNT"'","data":"0xc45a0155"},"latest"]}'
```
Expected: the thirdweb default AccountFactory address on Gnosis. If the call reverts, extract the implementation address from the proxy bytecode in step 2 (bytes 10–29 of an EIP-1167 minimal proxy) and retry `factory()` against the implementation; if it still reverts, find the account's deployment tx via Gnosisscan and read the factory from `sender` — record whichever evidence path succeeded.

- [ ] **Step 4: Append the addendum to the research doc**

Append to `docs/future-research/2026-07-27_WALLET_SOVEREIGNTY_RESEARCH.md`:

```markdown
## Addendum 2026-07-31 — onchain answers (M0 of the Accounts plan)

Verified against citizen account `<ACCOUNT>` (CitizenNFTv2 token <ID>) on Gnosis:

- **Account bytecode:** <deployed | counterfactual> (eth_getCode length <N>)
- **EntryPoint:** `<ADDRESS>` → **v0.6 | v0.7**
- **Factory:** `<ADDRESS>` (via <factory() | implementation | deploy-tx> evidence)
- **Consequence for the rails (M2):** Alto must serve EntryPoint <version> for
  legacy accounts alongside v0.7+ for new accounts. §7 items 1–2 of this doc are
  now answered; item 3 (paymaster audit status) remains open.
```

- [ ] **Step 5: Commit**

```bash
git add docs/future-research/2026-07-27_WALLET_SOVEREIGNTY_RESEARCH.md
git commit -m "docs(research): M0 onchain truth — live citizen account factory + EntryPoint verified"
git push
```

---

### Task 2: Phone login on the current stack (5 config sites)

**Files:**
- Modify: `apps/web/src/lib/wallet-config.ts:9`
- Modify: `apps/web/src/components/auth/WalletConnectionStep.tsx:12`
- Modify: `apps/web/src/app/wallet/reveal/page.tsx:11`
- Modify: `apps/expo/constants/wallets.ts:11,27`
- Modify: `apps/roebel-id/src/interaction/login-page.ts:54` (option only; custom UI deferred)

**Interfaces:**
- Produces: `"phone"` as an enabled `inAppWallet` auth strategy everywhere. thirdweb's ConnectButton/ConnectEmbed render the phone input automatically; the keystone's custom HTML gets the option now and its input UI in the keystone milestone (M4).

- [ ] **Step 1: Add `"phone"` to each auth options array**

In each of the five sites, the auth options array gains `"phone"` after `"email"`. Web (three files, identical shape — example from `wallet-config.ts`):

```ts
    auth: {
      options: ["email", "phone", "google", "apple", "facebook"],
    },
```

Expo (`constants/wallets.ts`, both the primary wallet and `gnosisWallet` — single quotes per file style):

```ts
    auth: {
      options: ['email', 'phone', 'google', 'facebook', 'apple'],
      redirectUrl,
    },
```

roebel-id (`login-page.ts`, inside the template string):

```ts
    auth: { options: ['google', 'email', 'phone', 'apple', 'facebook'] },
```

- [ ] **Step 2: Verify every site changed**

Run: `grep -rn "'phone'\|\"phone\"" apps/web/src/lib/wallet-config.ts apps/web/src/components/auth/WalletConnectionStep.tsx apps/web/src/app/wallet/reveal/page.tsx apps/expo/constants/wallets.ts apps/roebel-id/src/interaction/login-page.ts`
Expected: 6 matches (expo file has two).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/wallet-config.ts apps/web/src/components/auth/WalletConnectionStep.tsx apps/web/src/app/wallet/reveal/page.tsx apps/expo/constants/wallets.ts apps/roebel-id/src/interaction/login-page.ts
git commit -m "feat: phone number login — the fifth door into the same wallet"
git push
```

**Operational gate (user):** verify SMS auth is enabled for the client ID in the thirdweb dashboard, then test on a real device (expo needs the next EAS build only if the RN adapter requires it — config-level change should ride `eas update`; the user runs updates themselves).

---

### Task 3: Fix delete-user-account — smart-account signatures always fail

**Files:**
- Modify: `apps/expo/supabase/functions/delete-user-account/index.ts:18-20,96-111`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: deletion endpoint that accepts EOA **and** ERC-1271/ERC-6492 smart-account signatures. Client (`apps/expo/lib/supabase-account-deletion.ts`) is unchanged.

**Bug:** the client signs with the smart account (`account.signMessage()`), but the function verifies with `recoverMessageAddress`, which yields the enclave admin EOA — never equal to the smart-account address → every legitimate deletion returns `BAD_SIGNATURE`. App Store Guideline 5.1.1(v) makes this a compliance bug, not a nicety.

- [ ] **Step 1: Extend the viem import and add a Gnosis public client**

Replace line 20:

```ts
import { recoverMessageAddress, isAddress, createPublicClient, http } from 'https://esm.sh/viem@2.21.45';
import { gnosis } from 'https://esm.sh/viem@2.21.45/chains';
```

After the `corsHeaders` block, add:

```ts
// ERC-1271/6492 verification needs the chain the smart account lives on.
const gnosisClient = createPublicClient({
  chain: gnosis,
  transport: http(Deno.env.get('GNOSIS_RPC_URL') ?? 'https://rpc.gnosischain.com'),
});
```

- [ ] **Step 2: Replace the recovery block (lines 96–111) with recovery + universal fallback**

```ts
  // Fast path: plain EOA recovery. Smart accounts (ERC-1271/6492) fall through
  // to viem's universal verifier, which runs the check against the account
  // contract on Gnosis — the client signs with the smart account, so recovery
  // alone would yield the enclave admin EOA and always mismatch.
  let verified = false;
  try {
    const recovered = (
      await recoverMessageAddress({
        message: body.message,
        signature: body.signature as `0x${string}`,
      })
    ).toLowerCase();
    verified = recovered === claimedWallet;
  } catch {
    // not an EOA signature — try the universal path
  }
  if (!verified) {
    try {
      verified = await gnosisClient.verifyMessage({
        address: body.wallet as `0x${string}`,
        message: body.message,
        signature: body.signature as `0x${string}`,
      });
    } catch (err) {
      console.error('signature verification failed', err);
      return fail('BAD_SIGNATURE', 400, 'could not verify signer');
    }
  }
  if (!verified) {
    return fail('BAD_SIGNATURE', 400, 'signer does not match wallet');
  }
```

- [ ] **Step 3: Sanity-check the module parses**

Run: `deno check apps/expo/supabase/functions/delete-user-account/index.ts` if deno is installed; otherwise `node -e "const s=require('fs').readFileSync('apps/expo/supabase/functions/delete-user-account/index.ts','utf8'); if(!s.includes('verifyMessage')||!s.includes('gnosisClient')) process.exit(1)"`.
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add apps/expo/supabase/functions/delete-user-account/index.ts
git commit -m "fix(edge): account deletion verifies smart-account signatures — ERC-1271/6492 via viem universal verifier"
git push
```

**Operational gate (user):** deploy with `supabase functions deploy delete-user-account` (Supabase MCP once authenticated), then delete a test account from a real device.

---

### Task 4: Fix coordinator share-submission verifier — stale Base RPC

**Files:**
- Modify: `apps/coordinator/scripts/lib/session-manifest.js:121-155`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `verifySubmissionSignature()` (same signature/behavior) that checks ERC-1271 on **Gnosis first** (where accounts live since 2026-07-27), with Base kept as a legacy fallback.

- [ ] **Step 1: Replace the single-RPC fallback with an ordered multi-chain loop**

Replace from `// ERC-1271 fallback for smart accounts.` (line 121) through the end of the `catch` closing the function (line 155) with:

```js
  // ERC-1271 fallback for smart accounts. Wallets live on Gnosis since the
  // 2026-07-27 primary-chain migration; Base stays as a legacy fallback for
  // accounts that only have code there.
  const rpcUrls = [
    process.env.GNOSIS_RPC_URL || "https://rpc.gnosischain.com",
    process.env.BASE_RPC_URL,
  ].filter(Boolean);
  for (const rpcUrl of rpcUrls) {
    try {
      const provider = new ethers.JsonRpcProvider(rpcUrl, undefined, {
        batchMaxCount: 1,
      });
      const code = await provider.getCode(wallet);
      if (!code || code === "0x") {
        // No contract on this chain — try the next one.
        continue;
      }
      const contract = new ethers.Contract(
        wallet,
        [
          "function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)",
        ],
        provider,
      );
      const hash = ethers.hashMessage(payload);
      const result = await contract.isValidSignature(hash, signature);
      if (
        typeof result === "string" &&
        result.toLowerCase() === ERC1271_MAGIC_VALUE
      ) {
        return true;
      }
    } catch (err) {
      console.warn(
        `[session-manifest] ERC-1271 verify failed for ${wallet} via ${rpcUrl}: ${err?.message ?? err}`,
      );
    }
  }
  return false;
```

Also update the doc comment above the function (lines 88–94): replace the sentence mentioning the fallback with "We fall back to calling isValidSignature(hash, sig) on the smart-account contract, on Gnosis first, then Base (legacy)."

- [ ] **Step 2: Syntax-check**

Run: `node --check apps/coordinator/scripts/lib/session-manifest.js`
Expected: no output, exit 0.

- [ ] **Step 3: Commit**

```bash
git add apps/coordinator/scripts/lib/session-manifest.js
git commit -m "fix(coordinator): share-submission ERC-1271 check moves to Gnosis — Base stays as legacy fallback"
git push
```

**Operational gate (user):** set `GNOSIS_RPC_URL` on the Fly app `roebel-maci-coordinator` (or accept the public default) and redeploy before the next tally session.
