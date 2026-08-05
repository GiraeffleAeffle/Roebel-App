#!/usr/bin/env node
import { createPublicClient, createWalletClient, defineChain, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chainIdOf, EIP3009_ABI } from "./eip3009.js";
import { verifyExact } from "./verify.js";
import { settleExact } from "./settle.js";
import { createFacilitatorServer } from "./server.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`missing required env var: ${name}`);
    process.exit(2);
  }
  return value;
}

const network = required("NETWORK");            // e.g. eip155:100
const rpcUrl = required("RPC_URL");
const settlerPriv = required("SETTLER_PRIV");   // gas-only key; cannot redirect funds
const port = Number(process.env.PORT ?? 8402);

const chain = defineChain({
  id: chainIdOf(network),
  name: network,
  nativeCurrency: { name: "native", symbol: "NATIVE", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const settler = privateKeyToAccount(settlerPriv as `0x${string}`);
const walletClient = createWalletClient({ chain, transport: http(rpcUrl), account: settler });

createFacilitatorServer({
  network,
  verify: (p, r) =>
    verifyExact(p, r, {
      readContract: ({ address, functionName, args }) =>
        publicClient.readContract({ address, abi: EIP3009_ABI, functionName, args } as Parameters<typeof publicClient.readContract>[0]),
    }),
  settle: (p, r) =>
    settleExact(p, r, {
      writeContract: (args) => walletClient.writeContract({ ...args, chain, account: settler } as Parameters<typeof walletClient.writeContract>[0]),
      waitForReceipt: async (hash) => {
        const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 45_000 });
        return { status: receipt.status === "success" ? "success" : "reverted" };
      },
    }),
}).listen(port, () => {
  console.log(`facilitator for ${network} listening on :${port}; settler ${settler.address}`);
});
