import { test } from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import { parseSignature, getAddress } from "viem";
import { settleExact } from "../src/settle.js";
import { transferAuthTypedData } from "../src/eip3009.js";
import type { PaymentPayload, PaymentRequirements, Eip3009Authorization } from "../src/types.js";

const payer = privateKeyToAccount(("0x" + "11".repeat(32)) as `0x${string}`);

const REQ: PaymentRequirements = {
  scheme: "exact",
  network: "eip155:100",
  maxAmountRequired: "500000",
  resource: "https://index.roebel.app/bulk/events",
  description: "bulk query",
  mimeType: "application/json",
  payTo: "0x3A08c86Efc5ff38CC35d850F1D4d564e497bFDEa",
  maxTimeoutSeconds: 60,
  asset: "0x2a22f9c3b484C3629090FeED35F17Ff8F88f76F0",
  extra: { name: "Bridged USDC (Gnosis)", version: "2" },
};

async function signedPayload(overrides: Partial<Eip3009Authorization> = {}): Promise<PaymentPayload> {
  const authorization: Eip3009Authorization = {
    from: payer.address,
    to: REQ.payTo,
    value: "500000",
    validAfter: "0",
    validBefore: String(1_800_000_600),
    nonce: ("0x" + "ab".repeat(32)) as `0x${string}`,
    ...overrides,
  };
  const typed = transferAuthTypedData(REQ, authorization);
  const signature = await payer.signTypedData(typed as Parameters<typeof payer.signTypedData>[0]);
  return { x402Version: 1, scheme: "exact", network: "eip155:100", payload: { signature, authorization } };
}

test("happy path: settleExact calls writeContract with checksummed addresses and BigInt values, receipt success", async () => {
  const payload = await signedPayload();
  const auth = payload.payload.authorization;

  let capturedArgs: {
    address: `0x${string}`;
    functionName: string;
    args: readonly unknown[];
  } | undefined;

  const deps = {
    writeContract: async (args: any) => {
      capturedArgs = args;
      return "0xabc123" as `0x${string}`;
    },
    waitForReceipt: async () => ({ status: "success" as const }),
  };

  const result = await settleExact(payload, REQ, deps);

  assert.equal(result.success, true);
  assert.equal(result.transaction, "0xabc123");
  assert.equal(result.network, "eip155:100");
  assert(!result.errorReason);

  // Verify writeContract was called with correct structure
  assert(capturedArgs);
  assert.equal(capturedArgs.functionName, "transferWithAuthorization");
  assert.equal(capturedArgs.address, getAddress(REQ.asset));

  // Verify args are [from, to, value, validAfter, validBefore, nonce, v, r, s]
  const [from, to, value, validAfter, validBefore, nonce, v, r, s] = capturedArgs.args;
  assert.equal((from as string).toLowerCase(), auth.from.toLowerCase());
  assert.equal((to as string).toLowerCase(), auth.to.toLowerCase());
  assert.equal(value, BigInt(auth.value));
  assert.equal(validAfter, BigInt(auth.validAfter));
  assert.equal(validBefore, BigInt(auth.validBefore));
  assert.equal(nonce, auth.nonce);
  // v should be a number (27 or 28)
  assert.equal(typeof v, "number");
  assert(v === 27 || v === 28, `v should be 27 or 28, got ${v}`);
});

test("v is correctly derived from yParity when signature is compact", async () => {
  const payload = await signedPayload();
  const auth = payload.payload.authorization;

  let capturedV: number | undefined;

  const deps = {
    writeContract: async (args: any) => {
      capturedV = args.args[6]; // v is at index 6
      return "0xhash" as `0x${string}`;
    },
    waitForReceipt: async () => ({ status: "success" as const }),
  };

  await settleExact(payload, REQ, deps);

  // Confirm v was derived and is 27 or 28 (not undefined, not BigInt)
  assert.equal(typeof capturedV, "number");
  assert(capturedV === 27 || capturedV === 28);
});

test("receipt status reverted returns settle_reverted with transaction", async () => {
  const payload = await signedPayload();

  const deps = {
    writeContract: async () => "0xfailed" as `0x${string}`,
    waitForReceipt: async () => ({ status: "reverted" as const }),
  };

  const result = await settleExact(payload, REQ, deps);

  assert.equal(result.success, false);
  assert.equal(result.errorReason, "settle_reverted");
  assert.equal(result.transaction, "0xfailed");
  assert.equal(result.network, "eip155:100");
});

test("writeContract throws execution reverted error → settle_reverted, no transaction", async () => {
  const payload = await signedPayload();

  const deps = {
    writeContract: async () => {
      throw new Error("execution reverted: bad authorization");
    },
    waitForReceipt: async () => { throw new Error("should not be called"); },
  };

  const result = await settleExact(payload, REQ, deps);

  assert.equal(result.success, false);
  assert.equal(result.errorReason, "settle_reverted");
  assert(!result.transaction);
  assert.equal(result.network, "eip155:100");
});

test("writeContract throws generic RPC error → network_error", async () => {
  const payload = await signedPayload();

  const deps = {
    writeContract: async () => {
      throw new Error("fetch failed: network unreachable");
    },
    waitForReceipt: async () => { throw new Error("should not be called"); },
  };

  const result = await settleExact(payload, REQ, deps);

  assert.equal(result.success, false);
  assert.equal(result.errorReason, "network_error");
  assert(!result.transaction);
  assert.equal(result.network, "eip155:100");
});

test("malformed asset address returns settle_reverted, no transaction", async () => {
  const payload = await signedPayload();
  const badReq: PaymentRequirements = {
    ...REQ,
    asset: "0x_invalid_" as `0x${string}`,
  };

  const deps = {
    writeContract: async () => { throw new Error("should not be called"); },
    waitForReceipt: async () => { throw new Error("should not be called"); },
  };

  const result = await settleExact(payload, badReq, deps);

  assert.equal(result.success, false);
  assert.equal(result.errorReason, "settle_reverted");
  assert(!result.transaction);
  assert.equal(result.network, "eip155:100");
});

test("malformed from address returns settle_reverted, no transaction", async () => {
  const payload = await signedPayload();
  payload.payload.authorization.from = "0x_bad_" as `0x${string}`;

  const deps = {
    writeContract: async () => { throw new Error("should not be called"); },
    waitForReceipt: async () => { throw new Error("should not be called"); },
  };

  const result = await settleExact(payload, REQ, deps);

  assert.equal(result.success, false);
  assert.equal(result.errorReason, "settle_reverted");
  assert(!result.transaction);
  assert.equal(result.network, "eip155:100");
});

test("malformed to address returns settle_reverted, no transaction", async () => {
  const payload = await signedPayload();
  payload.payload.authorization.to = "0x_bad_" as `0x${string}`;

  const deps = {
    writeContract: async () => { throw new Error("should not be called"); },
    waitForReceipt: async () => { throw new Error("should not be called"); },
  };

  const result = await settleExact(payload, REQ, deps);

  assert.equal(result.success, false);
  assert.equal(result.errorReason, "settle_reverted");
  assert(!result.transaction);
  assert.equal(result.network, "eip155:100");
});

test("lowercase asset address is checksummed before writeContract", async () => {
  const payload = await signedPayload();
  const lowercaseReq: PaymentRequirements = {
    ...REQ,
    asset: REQ.asset.toLowerCase() as `0x${string}`,
  };

  let capturedAddress: `0x${string}` | undefined;

  const deps = {
    writeContract: async (args: any) => {
      capturedAddress = args.address;
      return "0xhash" as `0x${string}`;
    },
    waitForReceipt: async () => ({ status: "success" as const }),
  };

  const result = await settleExact(payload, lowercaseReq, deps);

  assert.equal(result.success, true);
  // Verify the address passed to writeContract is checksummed (not lowercase).
  assert.equal(capturedAddress?.toLowerCase(), lowercaseReq.asset.toLowerCase());
  assert.notEqual(capturedAddress, lowercaseReq.asset);
});
