import { test } from "node:test";
import assert from "node:assert/strict";
import { configFromEnv, formatAtomic } from "../src/config.js";
import { FacilitatorClient, body402, encodePaymentResponse, parsePayment, requirementsFor } from "../src/x402.js";
import type { PaymentPayload } from "@netizen-labs/facilitator";

const ENV = {
  NODE_ID: "roebel",
  PUBLIC_BASE: "https://index.roebel.app",
  DATABASE_URL: "postgres://x",
  FACILITATOR_URL: "http://facilitator:8402",
  PAY_TO: "0x3A08c86Efc5ff38CC35d850F1D4d564e497bFDEa",
  NETWORK: "eip155:100",
  ASSET: "0x2a22f9c3b484C3629090FeED35F17Ff8F88f76F0",
  ASSET_NAME: "Bridged USDC (Gnosis)",
  ASSET_VERSION: "2",
  ASSET_DECIMALS: "6",
  PRICE_BULK: "500000",
  PRICE_EXPORT: "5000000",
  PRICE_FIREHOSE_DAY: "1000000",
  SPLIT_AUTHORS: "50",
} as NodeJS.ProcessEnv;

test("config parses the rendered environment", () => {
  const cfg = configFromEnv(ENV);
  assert.equal(cfg.prices.bulk, "500000");
  assert.equal(cfg.splitAuthors, 50);
  assert.equal(cfg.port, 8402);
});

test("config refuses a missing variable", () => {
  const { PAY_TO: _omit, ...rest } = ENV;
  assert.throws(() => configFromEnv(rest as NodeJS.ProcessEnv), /PAY_TO/);
});

test("formatAtomic renders human prices", () => {
  assert.equal(formatAtomic("500000", 6), "0.50");
  assert.equal(formatAtomic("5000000", 6), "5.00");
  assert.equal(formatAtomic("1000001", 6), "1.000001");
});

test("requirementsFor builds a full x402 exact requirement", () => {
  const req = requirementsFor(configFromEnv(ENV), "/bulk/events", "500000", "bulk query");
  assert.equal(req.scheme, "exact");
  assert.equal(req.resource, "https://index.roebel.app/bulk/events");
  assert.equal(req.maxAmountRequired, "500000");
  assert.deepEqual(req.extra, { name: "Bridged USDC (Gnosis)", version: "2" });
});

test("body402 carries accepts plus a human link", () => {
  const body = body402(configFromEnv(ENV), "/export", "5000000", "full export") as {
    x402Version: number; accepts: unknown[]; payLink: string; error: string;
  };
  assert.equal(body.x402Version, 1);
  assert.equal(body.accepts.length, 1);
  assert.equal(body.payLink, "https://index.roebel.app/pay");
});

test("parsePayment round-trips and rejects garbage", () => {
  const payload: PaymentPayload = {
    x402Version: 1, scheme: "exact", network: "eip155:100",
    payload: {
      signature: "0xsig" as `0x${string}`,
      authorization: {
        from: "0x0000000000000000000000000000000000000001",
        to: "0x0000000000000000000000000000000000000002",
        value: "1", validAfter: "0", validBefore: "9", nonce: ("0x" + "00".repeat(32)) as `0x${string}`,
      },
    },
  };
  const header = Buffer.from(JSON.stringify(payload)).toString("base64");
  assert.deepEqual(parsePayment(header), payload);
  assert.equal(parsePayment("not-base64-json!!"), null);
  assert.equal(parsePayment(Buffer.from("{}").toString("base64")), null);
});

test("encodePaymentResponse is base64 JSON", () => {
  const encoded = encodePaymentResponse({ success: true, transaction: "0xabc" as `0x${string}`, network: "eip155:100" });
  assert.deepEqual(JSON.parse(Buffer.from(encoded, "base64").toString("utf8")).transaction, "0xabc");
});

test("FacilitatorClient posts to /verify and /settle", async () => {
  const calls: string[] = [];
  const client = new FacilitatorClient("http://fac:1", (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push(String(url));
    assert.equal(init?.method, "POST");
    return new Response(JSON.stringify({ isValid: true }), { status: 200 });
  }) as typeof fetch);
  await client.verify({} as PaymentPayload, {} as never);
  assert.deepEqual(calls, ["http://fac:1/verify"]);
});
