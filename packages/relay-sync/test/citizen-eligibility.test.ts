import assert from "node:assert/strict";
import { test } from "node:test";
import { keccak256, type PublicClient } from "viem";

import { createPinnedCitizenNftEligibilityVerifier } from "../src/chain.js";

const WALLET = "0x1111111111111111111111111111111111111111";
const CITIZEN_NFT = "0x59aA26f499D7C2B3EC2c8524Ed06F54fc4E85dE5";
const FINALIZED_BLOCK_HASH = `0x${"a".repeat(64)}`;
const RUNTIME_CODE = "0x6001600055";

test("pins one finalized Gnosis block and CitizenNFTv2.isActive for eligibility", async () => {
  const calls: Array<{ method: string; blockNumber?: bigint }> = [];
  const client = {
    async getChainId() {
      calls.push({ method: "getChainId" });
      return 100;
    },
    async getBlock(input: { blockTag?: string; blockNumber?: bigint }) {
      calls.push({ method: "getBlock", blockNumber: input.blockNumber });
      return { number: 12_345n, hash: FINALIZED_BLOCK_HASH };
    },
    async getCode(input: { address: string; blockNumber: bigint }) {
      assert.equal(input.address, CITIZEN_NFT);
      calls.push({ method: "getCode", blockNumber: input.blockNumber });
      return RUNTIME_CODE;
    },
    async readContract(input: {
      address: string;
      functionName: string;
      args: readonly string[];
      blockNumber: bigint;
    }) {
      assert.equal(input.address, CITIZEN_NFT);
      assert.equal(input.functionName, "isActive");
      assert.deepEqual(input.args, [WALLET]);
      calls.push({ method: "readContract", blockNumber: input.blockNumber });
      return true;
    },
  } as unknown as PublicClient;

  const verifier = createPinnedCitizenNftEligibilityVerifier({
    rpcUrl: "https://rpc.example",
    citizenNftAddress: CITIZEN_NFT,
    citizenNftRuntimeCodeHash: keccak256(RUNTIME_CODE),
    client,
  });

  const evidence = await verifier.verifyActiveCitizen({ address: WALLET });

  assert.deepEqual(evidence, {
    active: true,
    chainId: 100,
    contractAddress: CITIZEN_NFT.toLowerCase(),
    finalizedBlockNumber: 12_345n,
    finalizedBlockHash: FINALIZED_BLOCK_HASH,
  });
  assert.deepEqual(calls, [
    { method: "getChainId" },
    { method: "getBlock", blockNumber: undefined },
    { method: "getCode", blockNumber: 12_345n },
    { method: "readContract", blockNumber: 12_345n },
    { method: "getBlock", blockNumber: 12_345n },
  ]);
});

test("fails closed when the finalized block number drifts during verification", async () => {
  let reads = 0;
  const client = {
    async getChainId() { return 100; },
    async getBlock() {
      reads += 1;
      return reads === 1
        ? { number: 12_345n, hash: FINALIZED_BLOCK_HASH }
        : { number: 12_346n, hash: FINALIZED_BLOCK_HASH };
    },
    async getCode() { return RUNTIME_CODE; },
    async readContract() { return true; },
  } as unknown as PublicClient;
  const verifier = createPinnedCitizenNftEligibilityVerifier({
    rpcUrl: "https://rpc.example",
    citizenNftAddress: CITIZEN_NFT,
    citizenNftRuntimeCodeHash: keccak256(RUNTIME_CODE),
    client,
  });

  await assert.rejects(
    verifier.verifyActiveCitizen({ address: WALLET }),
    /citizen_nft_eligibility_block_reorged/u,
  );
});

test("fails closed across every pinned CitizenNFTv2 finality dependency", async (t) => {
  const cases = [
    ["wrong chain", "chain", "citizen_nft_eligibility_chain_mismatch"],
    ["missing finalized number", "number", "citizen_nft_eligibility_finality_unavailable"],
    ["missing finalized hash", "hash", "citizen_nft_eligibility_finality_unavailable"],
    ["missing runtime bytecode", "missing-code", "citizen_nft_eligibility_deployment_mismatch"],
    ["drifted runtime bytecode", "code-drift", "citizen_nft_eligibility_deployment_mismatch"],
    ["malformed isActive response", "active", "citizen_nft_eligibility_response_invalid"],
    ["finalized hash drift", "reorg", "citizen_nft_eligibility_block_reorged"],
  ] as const;

  for (const [name, scenario, expected] of cases) {
    await t.test(name, async () => {
      let blockReads = 0;
      const client = {
        async getChainId() { return scenario === "chain" ? 1 : 100; },
        async getBlock() {
          blockReads += 1;
          if (scenario === "number") {
            return { number: null, hash: FINALIZED_BLOCK_HASH };
          }
          if (scenario === "hash") return { number: 12_345n, hash: null };
          return {
            number: 12_345n,
            hash:
              scenario === "reorg" && blockReads === 2
                ? `0x${"f".repeat(64)}`
                : FINALIZED_BLOCK_HASH,
          };
        },
        async getCode() {
          if (scenario === "missing-code") return undefined;
          return scenario === "code-drift" ? "0x6002" : RUNTIME_CODE;
        },
        async readContract() {
          return scenario === "active" ? "true" : true;
        },
      } as unknown as PublicClient;
      const verifier = createPinnedCitizenNftEligibilityVerifier({
        rpcUrl: "https://rpc.example",
        citizenNftAddress: CITIZEN_NFT,
        citizenNftRuntimeCodeHash: keccak256(RUNTIME_CODE),
        client,
      });

      await assert.rejects(
        verifier.verifyActiveCitizen({ address: WALLET }),
        new RegExp(expected, "u"),
      );
    });
  }
});
