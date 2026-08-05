import { recoverTypedDataAddress } from "viem";
import { transferAuthTypedData } from "./eip3009.js";
import type { PaymentPayload, PaymentRequirements, VerifyResult } from "./types.js";

export interface VerifyDeps {
  readContract: (args: {
    address: `0x${string}`;
    functionName: "authorizationState" | "balanceOf";
    args: readonly unknown[];
  }) => Promise<unknown>;
  /** Unix seconds. Injectable so tests are deterministic. */
  now?: () => number;
}

const invalid = (invalidReason: string): VerifyResult => ({ isValid: false, invalidReason });

/**
 * Fail-closed verification of an exact-scheme EIP-3009 payment.
 * Cheap checks first; the two RPC reads happen only for a payload that is
 * already internally consistent and correctly signed.
 */
export async function verifyExact(
  payload: PaymentPayload,
  req: PaymentRequirements,
  deps: VerifyDeps,
): Promise<VerifyResult> {
  const auth = payload.payload?.authorization;
  if (!auth || payload.scheme !== "exact" || payload.network !== req.network) {
    return invalid("scheme_or_network_mismatch");
  }
  if (auth.to.toLowerCase() !== req.payTo.toLowerCase()) return invalid("payTo_mismatch");
  if (BigInt(auth.value) < BigInt(req.maxAmountRequired)) return invalid("insufficient_value");

  const now = deps.now?.() ?? Math.floor(Date.now() / 1000);
  if (Number(auth.validAfter) > now) return invalid("not_yet_valid");
  // A few seconds of margin: the settle tx must still land inside the window.
  if (Number(auth.validBefore) < now + 6) return invalid("expired");

  let recovered: string;
  try {
    recovered = await recoverTypedDataAddress({
      ...transferAuthTypedData(req, auth),
      signature: payload.payload.signature,
    });
  } catch {
    return invalid("bad_signature");
  }
  if (recovered.toLowerCase() !== auth.from.toLowerCase()) return invalid("bad_signature");

  const used = await deps.readContract({
    address: req.asset, functionName: "authorizationState", args: [auth.from, auth.nonce],
  });
  if (used) return invalid("nonce_used");

  const balance = (await deps.readContract({
    address: req.asset, functionName: "balanceOf", args: [auth.from],
  })) as bigint;
  if (balance < BigInt(auth.value)) return invalid("insufficient_funds");

  return { isValid: true, payer: auth.from };
}
