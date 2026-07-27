import { http, createPublicClient, hashMessage, type PublicClient } from "viem";
import { gnosis } from "viem/chains";
import { recoverCandidateSigners } from "./signature.js";
import type { ChainVerifier } from "./types.js";

const IS_ADMIN_ABI = [
  {
    name: "isAdmin",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const GET_MESSAGE_HASH_ABI = [
  {
    name: "getMessageHash",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "hash", type: "bytes32" }],
    outputs: [{ name: "", type: "bytes32" }],
  },
] as const;

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
      // Fast path: works for EOAs and for smart accounts whose ERC-1271 agrees
      // with viem's assumptions.
      try {
        if (
          await client.verifyMessage({
            address: address as `0x${string}`,
            message,
            signature: signature as `0x${string}`,
          })
        ) {
          return true;
        }
      } catch {
        // Fall through: the recovery path below makes its own RPC calls, and a
        // genuine network fault will surface there as a throw (fail-closed).
      }

      // Slow path: recover the signer under each plausible signing convention and
      // ask the ACCOUNT whether that signer is an admin. Needed because a
      // thirdweb smart account signs an EIP-712 `AccountMessage` stamped with the
      // chain its wallet is configured for — Base for this app — while the
      // account itself is verified on Gnosis. Authorisation is unchanged: it is
      // still `isAdmin` on the real account that decides.
      let accountDigest: string | undefined;
      try {
        accountDigest = (await client.readContract({
          address: address as `0x${string}`,
          abi: GET_MESSAGE_HASH_ABI,
          functionName: "getMessageHash",
          args: [hashMessage(message)],
        })) as string;
      } catch {
        // Not a thirdweb-style account, or not readable — the other candidates stand.
      }

      const candidates = await recoverCandidateSigners({
        account: address,
        message,
        signature,
        accountDigest,
      });

      for (const candidate of candidates) {
        const isAdmin = await client.readContract({
          address: address as `0x${string}`,
          abi: IS_ADMIN_ABI,
          functionName: "isAdmin",
          args: [candidate.address as `0x${string}`],
        });
        if (isAdmin) return true;
      }

      // Genuinely not an admin — but only say so if the node is actually healthy,
      // so a flaky RPC can never masquerade as a bad signature.
      await confirmNodeHealthy();
      return false;
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
