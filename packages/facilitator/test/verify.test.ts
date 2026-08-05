import { test } from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import { verifyExact } from "../src/verify.js";
import { transferAuthTypedData, chainIdOf } from "../src/eip3009.js";
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

const NOW = 1_800_000_000;

async function signedPayload(overrides: Partial<Eip3009Authorization> = {}): Promise<PaymentPayload> {
  const authorization: Eip3009Authorization = {
    from: payer.address,
    to: REQ.payTo,
    value: "500000",
    validAfter: "0",
    validBefore: String(NOW + 600),
    nonce: ("0x" + "ab".repeat(32)) as `0x${string}`,
    ...overrides,
  };
  const typed = transferAuthTypedData(REQ, authorization);
  const signature = await payer.signTypedData(typed as Parameters<typeof payer.signTypedData>[0]);
  return { x402Version: 1, scheme: "exact", network: "eip155:100", payload: { signature, authorization } };
}

/** Happy-path chain state: nonce unused, balance ample. */
const chain = (state: { used?: boolean; balance?: bigint } = {}) => ({
  readContract: async ({ functionName }: { functionName: string }) =>
    functionName === "authorizationState" ? (state.used ?? false) : (state.balance ?? 10_000_000n),
  now: () => NOW,
});

test("chainIdOf parses CAIP-2", () => {
  assert.equal(chainIdOf("eip155:100"), 100);
});

test("a well-signed, funded, unused authorization verifies", async () => {
  const result = await verifyExact(await signedPayload(), REQ, chain());
  assert.equal(result.isValid, true);
  assert.equal(result.payer?.toLowerCase(), payer.address.toLowerCase());
});

test("value below the price is rejected", async () => {
  const result = await verifyExact(await signedPayload({ value: "499999" }), REQ, chain());
  assert.deepEqual([result.isValid, result.invalidReason], [false, "insufficient_value"]);
});

test("authorization to the wrong recipient is rejected", async () => {
  const result = await verifyExact(
    await signedPayload({ to: "0x0000000000000000000000000000000000000001" }),
    REQ,
    chain(),
  );
  assert.deepEqual([result.isValid, result.invalidReason], [false, "payTo_mismatch"]);
});

test("an expired authorization is rejected", async () => {
  const result = await verifyExact(await signedPayload({ validBefore: String(NOW - 1) }), REQ, chain());
  assert.deepEqual([result.isValid, result.invalidReason], [false, "expired"]);
});

test("a tampered value breaks the signature", async () => {
  const payload = await signedPayload();
  payload.payload.authorization.value = "99999";
  const result = await verifyExact(payload, REQ, chain());
  assert.deepEqual([result.isValid, result.invalidReason], [false, "insufficient_value"]);
  // and when the tampered value still covers the price:
  const payload2 = await signedPayload({ value: "600000" });
  payload2.payload.authorization.value = "700000";
  const result2 = await verifyExact(payload2, REQ, chain());
  assert.deepEqual([result2.isValid, result2.invalidReason], [false, "bad_signature"]);
});

test("a used nonce is rejected", async () => {
  const result = await verifyExact(await signedPayload(), REQ, chain({ used: true }));
  assert.deepEqual([result.isValid, result.invalidReason], [false, "nonce_used"]);
});

test("insufficient balance is rejected", async () => {
  const result = await verifyExact(await signedPayload(), REQ, chain({ balance: 1n }));
  assert.deepEqual([result.isValid, result.invalidReason], [false, "insufficient_funds"]);
});

test("network mismatch is rejected before any chain call", async () => {
  const payload = await signedPayload();
  payload.network = "eip155:8453";
  const result = await verifyExact(payload, REQ, {
    readContract: async () => { throw new Error("must not be called"); },
    now: () => NOW,
  });
  assert.deepEqual([result.isValid, result.invalidReason], [false, "scheme_or_network_mismatch"]);
});

test("lowercase asset address is normalized before readContract", async () => {
  const lowercaseReq: PaymentRequirements = {
    ...REQ,
    asset: REQ.asset.toLowerCase() as `0x${string}`,
  };
  let capturedAddress: `0x${string}` | undefined;
  const mockChain = {
    readContract: async ({ address, functionName }: { address: `0x${string}`; functionName: string }) => {
      capturedAddress = address;
      return functionName === "authorizationState" ? false : 10_000_000n;
    },
    now: () => NOW,
  };
  const result = await verifyExact(await signedPayload(), lowercaseReq, mockChain);
  assert.equal(result.isValid, true);
  // Verify the address passed to readContract is checksummed (not lowercase).
  assert.equal(capturedAddress?.toLowerCase(), lowercaseReq.asset.toLowerCase());
  assert.notEqual(capturedAddress, lowercaseReq.asset);
});

test("malformed asset address returns bad_asset_address", async () => {
  const badReq: PaymentRequirements = {
    ...REQ,
    asset: "0x_invalid_" as `0x${string}`,
  };
  const result = await verifyExact(await signedPayload(), badReq, chain());
  assert.deepEqual([result.isValid, result.invalidReason], [false, "bad_asset_address"]);
});
