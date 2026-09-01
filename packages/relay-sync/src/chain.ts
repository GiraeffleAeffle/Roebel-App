import {
  http,
  createPublicClient,
  hashMessage,
  keccak256,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
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

const IS_ACTIVE_ABI = [
  {
    name: "isActive",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export type PinnedCitizenNftEligibilityEvidence = Readonly<{
  active: boolean;
  chainId: 100;
  contractAddress: string;
  finalizedBlockNumber: bigint;
  finalizedBlockHash: string;
}>;

export type PinnedCitizenNftEligibilityVerifier = Readonly<{
  verifyActiveCitizen(input: Readonly<{
    address: string;
  }>): Promise<PinnedCitizenNftEligibilityEvidence>;
}>;

export type PinnedCitizenNftEligibilityVerifierOptions = Readonly<{
  rpcUrl: string;
  citizenNftAddress: string;
  citizenNftRuntimeCodeHash: string;
  client?: PublicClient;
}>;

export interface GnosisVerifierOptions {
  rpcUrl: string;
  /** CitizenNFTv2 on Gnosis. */
  citizenNftAddress: string;
  client?: PublicClient;
}

export type GnosisWalletVerifierOptions = Omit<
  GnosisVerifierOptions,
  "citizenNftAddress"
>;

/**
 * The on-chain half of verification, against Gnosis.
 *
 * Signature verification goes through viem's `verifyMessage`, which resolves
 * ERC-1271 for contract accounts (and ERC-6492 for counterfactual ones) — the
 * right primitive here, because a Citizen's wallet is an ERC-4337 smart account
 * with no key of its own to ecrecover against.
 */
export function createGnosisWalletVerifier(
  options: GnosisWalletVerifierOptions
): Pick<ChainVerifier, "verifyWalletSignature"> {
  const client =
    options.client ??
    (createPublicClient({
      chain: gnosis,
      transport: http(options.rpcUrl),
    }) as PublicClient);

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
  };
}

export function createGnosisVerifier(
  options: GnosisVerifierOptions
): ChainVerifier {
  const client =
    options.client ??
    (createPublicClient({
      chain: gnosis,
      transport: http(options.rpcUrl),
    }) as PublicClient);
  const citizenNft = options.citizenNftAddress as `0x${string}`;
  const walletVerifier = createGnosisWalletVerifier({
    rpcUrl: options.rpcUrl,
    client,
  });

  return {
    ...walletVerifier,

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

/**
 * Verify only CitizenNFTv2.isActive at one pinned finalized Gnosis block.
 *
 * This is intentionally separate from the legacy relay `balanceOf` helper:
 * municipal eligibility must fail closed on the chain, deployment bytecode,
 * finality, block identity, or contract response drifting from configuration.
 */
export function createPinnedCitizenNftEligibilityVerifier(
  options: PinnedCitizenNftEligibilityVerifierOptions,
): PinnedCitizenNftEligibilityVerifier {
  if (
    !/^https:\/\//u.test(options.rpcUrl) ||
    !/^0x[0-9a-fA-F]{40}$/u.test(options.citizenNftAddress) ||
    !/^0x[0-9a-fA-F]{64}$/u.test(options.citizenNftRuntimeCodeHash)
  ) {
    throw new Error("citizen_nft_eligibility_config_invalid");
  }
  const client =
    options.client ??
    (createPublicClient({
      chain: gnosis,
      transport: http(options.rpcUrl),
    }) as PublicClient);
  const citizenNft = options.citizenNftAddress as Address;
  const expectedCodeHash = options.citizenNftRuntimeCodeHash.toLowerCase();

  return Object.freeze({
    async verifyActiveCitizen({ address }) {
      if (!/^0x[0-9a-fA-F]{40}$/u.test(address)) {
        throw new Error("citizen_nft_eligibility_address_invalid");
      }
      const chainId = await client.getChainId();
      if (chainId !== 100) {
        throw new Error("citizen_nft_eligibility_chain_mismatch");
      }
      const finalized = await client.getBlock({ blockTag: "finalized" });
      if (finalized.number === null || finalized.hash === null) {
        throw new Error("citizen_nft_eligibility_finality_unavailable");
      }
      const code = await client.getCode({
        address: citizenNft,
        blockNumber: finalized.number,
      });
      if (!code || code === "0x" || keccak256(code as Hex).toLowerCase() !== expectedCodeHash) {
        throw new Error("citizen_nft_eligibility_deployment_mismatch");
      }
      const active = await client.readContract({
        address: citizenNft,
        abi: IS_ACTIVE_ABI,
        functionName: "isActive",
        args: [address as Address],
        blockNumber: finalized.number,
      });
      if (typeof active !== "boolean") {
        throw new Error("citizen_nft_eligibility_response_invalid");
      }
      const confirmed = await client.getBlock({ blockNumber: finalized.number });
      if (
        confirmed.number !== finalized.number ||
        confirmed.hash === null ||
        confirmed.hash !== finalized.hash
      ) {
        throw new Error("citizen_nft_eligibility_block_reorged");
      }
      return Object.freeze({
        active,
        chainId: 100 as const,
        contractAddress: citizenNft.toLowerCase(),
        finalizedBlockNumber: finalized.number,
        finalizedBlockHash: finalized.hash,
      });
    },
  });
}
