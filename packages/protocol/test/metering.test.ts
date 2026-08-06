import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NetizenManifestSchema } from "../src/index.js";

const base = JSON.parse(
  readFileSync(fileURLToPath(new URL("../examples/roebel.netizen.json", import.meta.url)), "utf8"),
);

const METERING = {
  payTo: "0x3A08c86Efc5ff38CC35d850F1D4d564e497bFDEa",
  network: "eip155:100",
  asset: "0x2a22f9c3b484C3629090FeED35F17Ff8F88f76F0",
  assetName: "Bridged USDC (Gnosis)",
  assetVersion: "2",
  assetDecimals: 6,
  prices: { bulk: "500000", export: "5000000", firehoseDay: "1000000" },
  split: { authors: 50, treasury: 50 },
};

test("the example manifest declares metering and parses", () => {
  const parsed = NetizenManifestSchema.parse(base);
  assert.equal(parsed.services.metering?.payTo, METERING.payTo);
  assert.equal(parsed.services.metering?.prices.bulk, "500000");
});

test("metering.split must sum to 100", () => {
  const bad = structuredClone(base);
  bad.services.metering = { ...METERING, split: { authors: 60, treasury: 60 } };
  assert.throws(() => NetizenManifestSchema.parse(bad));
});

test("metering requires the indexer — the gateway reads its database", () => {
  const bad = structuredClone(base);
  delete bad.services.indexer;
  assert.throws(() => NetizenManifestSchema.parse(bad));
});

test("metering.network must match the declared chain", () => {
  const bad = structuredClone(base);
  bad.services.metering = { ...METERING, network: "eip155:8453" };
  assert.throws(() => NetizenManifestSchema.parse(bad));
});

test("prices are atomic-unit integer strings", () => {
  const bad = structuredClone(base);
  bad.services.metering = { ...METERING, prices: { ...METERING.prices, bulk: "0.5" } };
  assert.throws(() => NetizenManifestSchema.parse(bad));
});

test("metering requires services.chat.nostr — the gateway/facilitator render inside the relay stack", () => {
  const bad = structuredClone(base);
  delete bad.services.chat.nostr;
  assert.throws(() => NetizenManifestSchema.parse(bad));
});

test("metering requires chain — the facilitator needs the chain RPC", () => {
  const bad = structuredClone(base);
  delete bad.chain;
  assert.throws(() => NetizenManifestSchema.parse(bad));
});

test("metering requires services.backend — the gateway needs the backend Postgres", () => {
  const bad = structuredClone(base);
  delete bad.services.backend;
  assert.throws(() => NetizenManifestSchema.parse(bad));
});
