import { parseAbi, getAddress } from "viem";
import type { PaymentRequirements, Eip3009Authorization } from "./types.js";

/** "eip155:100" -> 100. Throws on anything that is not a CAIP-2 eip155 id. */
export function chainIdOf(network: string): number {
  const match = /^eip155:(\d+)$/.exec(network);
  if (!match) throw new Error(`not an eip155 network id: ${network}`);
  return Number(match[1]);
}

/** The v/r/s overload is the one every FiatTokenV2-family deployment carries. */
export const EIP3009_ABI = parseAbi([
  "function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)",
  "function authorizationState(address authorizer, bytes32 nonce) view returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
]);

/**
 * The EIP-712 payload a payer signs. Domain values come from the payment
 * requirements (which come from the manifest) — never hardcoded, so any
 * EIP-3009 token on any chain works from the same code.
 */
export function transferAuthTypedData(req: PaymentRequirements, auth: Eip3009Authorization) {
  return {
    domain: {
      name: req.extra.name,
      version: req.extra.version,
      chainId: chainIdOf(req.network),
      verifyingContract: getAddress(req.asset),
    },
    types: {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "TransferWithAuthorization" as const,
    message: {
      from: getAddress(auth.from),
      to: getAddress(auth.to),
      value: BigInt(auth.value),
      validAfter: BigInt(auth.validAfter),
      validBefore: BigInt(auth.validBefore),
      nonce: auth.nonce,
    },
  };
}
