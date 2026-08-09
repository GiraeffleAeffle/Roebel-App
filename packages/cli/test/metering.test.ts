import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderBundle, renderCaddyfile, renderComposeYml } from "../src/render.js";
import { parseManifest } from "@netizen-labs/protocol";

const example = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../protocol/examples/roebel.netizen.json", import.meta.url)), "utf8"),
);

// The Röbel manifest deferred its metering block on 2026-08-09 (settler-key
// gate still open — restored when the x402 deploy is wanted), so the fixture
// below IS the example declaration, attached on top before parsing. `base`
// stays the declared case and `without` the removal, as the tests expect.
example.services.metering = {
  payTo: "0x3A08c86Efc5ff38CC35d850F1D4d564e497bFDEa",
  network: "eip155:100",
  asset: "0x2a22f9c3b484C3629090FeED35F17Ff8F88f76F0",
  assetName: "Bridged USDC (Gnosis)",
  assetVersion: "2",
  assetDecimals: 6,
  prices: { bulk: "500000", export: "5000000", firehoseDay: "1000000" },
  split: { authors: 50, treasury: 50 },
};
const base = parseManifest(example);

const without = structuredClone(base) as typeof base;
delete (without.services as Record<string, unknown>).metering;

test("compose gains gateway and facilitator services when metering is declared", () => {
  const compose = renderComposeYml(base);
  assert.match(compose, /^ {2}gateway:/m);
  assert.match(compose, /^ {2}facilitator:/m);
  assert.match(compose, /METERING_SETTLER_PRIV/);
  assert.match(compose, /FACILITATOR_URL: "http:\/\/facilitator:8402"/);
  assert.match(compose, /PAY_TO: "0x3A08c86Efc5ff38CC35d850F1D4d564e497bFDEa"/);
  const off = renderComposeYml(without);
  assert.ok(!/^ {2}gateway:/m.test(off));
  assert.ok(!/^ {2}facilitator:/m.test(off));
});

test("the index host path-routes paid endpoints to the gateway, rest to the indexer", () => {
  const caddy = renderCaddyfile(base);
  assert.match(caddy, /handle \/bulk\/\* \{\s*reverse_proxy gateway:8402/);
  assert.match(caddy, /handle \/pay\* \{\s*reverse_proxy gateway:8402/);
  // the catch-all must exist AND come after the paid handles
  const block = caddy.slice(caddy.indexOf("index.roebel.app"));
  assert.ok(block.indexOf("handle {") > block.indexOf("handle /bulk/*"), "catch-all after paid routes");
  // without metering the old single-line route survives
  assert.match(renderCaddyfile(without), /index\.roebel\.app \{\s*reverse_proxy indexer:8080\s*\}/);
});

test("the bundle ships the monetization opt-out file", () => {
  const bundle = renderBundle(base);
  const file = bundle.files["strfry-policy/metering-excluded.txt"];
  assert.ok(file, "metering-excluded.txt must be in the bundle");
  assert.match(file, /^#/m, "starts with an explanatory comment");
  assert.equal(bundle.files["strfry-policy/metering-excluded.txt"] === undefined, false);
  const off = renderBundle(without);
  assert.equal(off.files["strfry-policy/metering-excluded.txt"], undefined);
});

test("SECRETS.md lists the settler key when metering is declared", () => {
  const bundle = renderBundle(base);
  assert.match(bundle.files["SECRETS.md"], /METERING_SETTLER_PRIV/);
  const off = renderBundle(without);
  assert.ok(!/METERING_SETTLER_PRIV/.test(off.files["SECRETS.md"]));
});
