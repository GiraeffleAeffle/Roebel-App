import { parseSignature, getAddress } from "viem";
import { EIP3009_ABI } from "./eip3009.js";
import type { PaymentPayload, PaymentRequirements, SettleResult } from "./types.js";

export interface SettleDeps {
  /** viem walletClient.writeContract, pre-bound to chain + settler account. */
  writeContract: (args: {
    address: `0x${string}`; abi: typeof EIP3009_ABI;
    functionName: "transferWithAuthorization"; args: readonly unknown[];
  }) => Promise<`0x${string}`>;
  waitForReceipt: (hash: `0x${string}`) => Promise<{ status: "success" | "reverted" }>;
}

/**
 * Submit the payer-signed authorization from the settler EOA. The settler pays
 * only gas (xDAI); the value moves straight from payer to payTo, so a
 * compromised settler key can waste gas but cannot redirect funds.
 */
export async function settleExact(
  payload: PaymentPayload,
  req: PaymentRequirements,
  deps: SettleDeps,
): Promise<SettleResult> {
  const auth = payload.payload.authorization;
  // Normalize addresses early, fail-closed on malformed addresses.
  let asset: `0x${string}`;
  let authFrom: `0x${string}`;
  let authTo: `0x${string}`;
  try {
    asset = getAddress(req.asset);
    authFrom = getAddress(auth.from);
    authTo = getAddress(auth.to);
  } catch {
    return { success: false, errorReason: "network_error", network: req.network };
  }

  // viem 2.x: parseSignature. `v` is absent on compact signatures — derive it
  // from yParity, which is always present.
  const sig = parseSignature(payload.payload.signature);
  const v = sig.v ?? BigInt((sig.yParity ?? 0) + 27);
  const { r, s } = sig;
  try {
    const hash = await deps.writeContract({
      address: asset,
      abi: EIP3009_ABI,
      functionName: "transferWithAuthorization",
      args: [authFrom, authTo, BigInt(auth.value), BigInt(auth.validAfter), BigInt(auth.validBefore), auth.nonce, Number(v), r, s],
    });
    const receipt = await deps.waitForReceipt(hash);
    if (receipt.status !== "success") return { success: false, errorReason: "settle_reverted", transaction: hash, network: req.network };
    return { success: true, transaction: hash, network: req.network };
  } catch (error) {
    // Distinguish an on-chain revert (payment is bad — do not serve) from an
    // RPC failure (payment may be fine — the caller decides, spec §8).
    const message = (error as Error).message ?? "";
    if (/revert|reverted|execution/i.test(message)) {
      return { success: false, errorReason: "settle_reverted", network: req.network };
    }
    return { success: false, errorReason: "network_error", network: req.network };
  }
}
