import { http, createPublicClient, type PublicClient } from "viem";
import { gnosis } from "viem/chains";
import type { ChainVerifier } from "./types.js";

const BALANCE_OF_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export interface GnosisVerifierOptions {
  rpcUrl: string;
  /** CitizenNFTv2 on Gnosis. */
  citizenNftAddress: string;
  client?: PublicClient;
}

/**
 * The on-chain half of verification, against Gnosis.
 *
 * Signature verification goes through viem's `verifyMessage`, which resolves
 * ERC-1271 for contract accounts (and ERC-6492 for counterfactual ones) — the
 * right primitive here, because a Citizen's wallet is an ERC-4337 smart account
 * with no key of its own to ecrecover against.
 */
export function createGnosisVerifier(options: GnosisVerifierOptions): ChainVerifier {
  const client =
    options.client ??
    (createPublicClient({ chain: gnosis, transport: http(options.rpcUrl) }) as PublicClient);
  const citizenNft = options.citizenNftAddress as `0x${string}`;

  /**
   * A `false` from `verifyMessage` is ambiguous: it can mean "bad signature" or
   * "the call failed". Since a wrong `false` silently revokes a real Citizen, we
   * probe the node before believing it — if the chain is unreachable, throw so
   * the pass aborts and the allow-list is left alone.
   */
  const confirmNodeHealthy = async () => {
    await client.getBlockNumber();
  };

  return {
    async verifyWalletSignature({ address, message, signature }) {
      const valid = await client.verifyMessage({
        address: address as `0x${string}`,
        message,
        signature: signature as `0x${string}`,
      });
      if (!valid) await confirmNodeHealthy();
      return valid;
    },

    async holdsCitizenNft(address) {
      const balance = await client.readContract({
        address: citizenNft,
        abi: BALANCE_OF_ABI,
        functionName: "balanceOf",
        args: [address as `0x${string}`],
      });
      return balance > 0n;
    },
  };
}
