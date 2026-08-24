import {
  prepareContractCall,
  sendTransaction,
  type PreparedTransaction,
} from "thirdweb";
import { smartWallet, type Wallet } from "thirdweb/wallets";
import { client } from "@/app/client";
import { gnosis } from "@/lib/gnosis";

/** Gnosis bundler minimum (Pimlico rejects maxFeePerGas below 1.5 gwei). */
const GAS_PRICE_FLOOR = 1_500_000_000n;

/**
 * Ask the bundler for its recommended userOp gas price. thirdweb's own gas
 * estimation for a *custom* bundler falls back to a chain RPC that returns a
 * near-zero maxFeePerGas on Gnosis (15 wei), which the bundler rejects — so we
 * fetch the real price and pin it on the userOp. Floors at 1.5 gwei and falls
 * back to the floor if the bundler doesn't speak pimlico_getUserOperationGasPrice.
 */
async function fetchBundlerGasPrice(
  bundlerUrl: string
): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }> {
  try {
    const res = await fetch(bundlerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "pimlico_getUserOperationGasPrice",
        params: [],
      }),
    });
    const json = await res.json();
    const tier = json?.result?.fast ?? json?.result?.standard;
    if (tier?.maxFeePerGas && tier?.maxPriorityFeePerGas) {
      const mfpg = BigInt(tier.maxFeePerGas);
      const mpfpg = BigInt(tier.maxPriorityFeePerGas);
      return {
        maxFeePerGas: mfpg > GAS_PRICE_FLOOR ? mfpg : GAS_PRICE_FLOOR,
        maxPriorityFeePerGas: mpfpg > GAS_PRICE_FLOOR ? mpfpg : GAS_PRICE_FLOOR,
      };
    }
  } catch (err) {
    console.warn("[highgas] gas-price fetch failed, using floor:", err);
  }
  return {
    maxFeePerGas: GAS_PRICE_FLOOR,
    maxPriorityFeePerGas: GAS_PRICE_FLOOR,
  };
}

/**
 * Higher-cap ERC-4337 bundler for the ONE transaction that needs it:
 * creating a governance proposal. `Governor.propose()` deploys a fresh MACI
 * Poll (Poll + MessageProcessor + Tally) inline — ~15.7M gas — which exceeds
 * thirdweb's hosted bundler cap of 12M gas per bundle, so the default
 * sponsored path fails with:
 *   "User operation gas limits exceed the max gas per bundle: 15745022 > 12000000"
 *
 * The only accepted value is the same-origin server proxy. The bundler API key
 * stays server-side and the route rejects arbitrary provider selection (see
 * app/api/bundler/route.ts):
 *   NEXT_PUBLIC_GNOSIS_BUNDLER_URL=/api/bundler
 *   GNOSIS_BUNDLER_RPC_URL=https://api.pimlico.io/v2/100/rpc?apikey=YOUR_KEY  (server-only)
 *
 * When unset, callers fall back to the default thirdweb path (which fails for
 * proposal creation on Gnosis). Only proposal creation uses this; every other
 * tx in the app keeps the default gasless/sponsored bundler.
 */
const CONFIGURED_BUNDLER = process.env.NEXT_PUBLIC_GNOSIS_BUNDLER_URL ?? "";
const APPROVED_BUNDLER_PATH = "/api/bundler";

export function hasHighGasBundler(): boolean {
  return CONFIGURED_BUNDLER === APPROVED_BUNDLER_PATH;
}

/** Resolve the configured value to an absolute URL at call time (client-side). */
function resolveBundlerUrl(): string {
  if (!hasHighGasBundler()) {
    throw new Error("high_gas_bundler_not_approved");
  }
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}${APPROVED_BUNDLER_PATH}`;
}

/**
 * Send `transaction` from the user's EXISTING smart account, but through the
 * higher-cap bundler and self-paying gas (no thirdweb sponsorship).
 *
 * It reconnects the same smart account via the override bundler using the
 * active wallet's admin signer. Same factory + same admin ⇒ same smart-account
 * address, so `msg.sender` stays the attester wallet and the
 * `OnlyAttestersCanPropose` check still passes.
 *
 * Self-pay: the smart account spends its own xDAI for gas (~0.03–0.05 xDAI for a
 * poll-deploy proposal at typical Gnosis gas prices). Fund the attester wallet
 * with a little xDAI first.
 */
export async function sendViaHighGasBundler(
  activeWallet: Wallet,
  transaction: PreparedTransaction
): Promise<{ transactionHash: `0x${string}` }> {
  if (!hasHighGasBundler()) {
    throw new Error(
      "NEXT_PUBLIC_GNOSIS_BUNDLER_URL ist nicht gesetzt — kein Bundler mit erhöhtem Gas-Limit konfiguriert."
    );
  }

  const adminAccount = activeWallet.getAdminAccount?.();
  if (!adminAccount) {
    throw new Error(
      "Admin-Signer des Smart Accounts konnte nicht ermittelt werden."
    );
  }

  const bundlerUrl = resolveBundlerUrl();
  const { maxFeePerGas, maxPriorityFeePerGas } =
    await fetchBundlerGasPrice(bundlerUrl);

  const highGasWallet = smartWallet({
    chain: gnosis,
    sponsorGas: false, // self-pay; avoids thirdweb's sponsored 12M cap
    overrides: {
      bundlerUrl,
      // thirdweb derives the userOp fee from the inner `execute` call. Its
      // default builds that call without a fee (→ chain-RPC fallback = 15 wei on
      // Gnosis → bundler rejects). Replicate the default execute but pin a real
      // fee so the userOp meets the bundler's minimum.
      execute: (accountContract, transaction) =>
        prepareContractCall({
          contract: accountContract,
          gas: transaction.gas ? transaction.gas + 21000n : undefined,
          method: "function execute(address, uint256, bytes)",
          params: [
            transaction.to || "",
            transaction.value || 0n,
            transaction.data || "0x",
          ],
          maxFeePerGas,
          maxPriorityFeePerGas,
        }),
    },
  });

  const account = await highGasWallet.connect({
    client,
    personalAccount: adminAccount,
  });

  const result = await sendTransaction({ account, transaction });
  return { transactionHash: result.transactionHash };
}
