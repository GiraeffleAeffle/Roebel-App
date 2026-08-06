import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createGatewayServer, type GatewayDeps } from "../src/server.js";
import { configFromEnv } from "../src/config.js";
import type { PaymentPayload } from "@netizen-labs/facilitator";

const cfg = configFromEnv({
  NODE_ID: "roebel", PUBLIC_BASE: "https://index.roebel.app", DATABASE_URL: "x",
  FACILITATOR_URL: "http://fac", PAY_TO: "0x3A08c86Efc5ff38CC35d850F1D4d564e497bFDEa",
  NETWORK: "eip155:100", ASSET: "0x2a22f9c3b484C3629090FeED35F17Ff8F88f76F0",
  ASSET_NAME: "Bridged USDC (Gnosis)", ASSET_VERSION: "2", ASSET_DECIMALS: "6",
  PRICE_BULK: "500000", PRICE_EXPORT: "5000000", PRICE_FIREHOSE_DAY: "1000000",
  SPLIT_AUTHORS: "50",
} as NodeJS.ProcessEnv);

const PAYMENT: PaymentPayload = {
  x402Version: 1, scheme: "exact", network: "eip155:100",
  payload: {
    signature: "0x00" as `0x${string}`,
    authorization: {
      from: "0x0000000000000000000000000000000000000001",
      to: cfg.payTo, value: "500000", validAfter: "0", validBefore: "9999999999",
      nonce: ("0x" + "00".repeat(32)) as `0x${string}`,
    },
  },
};
const HEADER = Buffer.from(JSON.stringify(PAYMENT)).toString("base64");

function deps(overrides: Partial<GatewayDeps> = {}): GatewayDeps & { sql: string[] } {
  const sql: string[] = [];
  return {
    sql,
    cfg,
    query: async (text: string) => {
      sql.push(text);
      if (/INSERT INTO access_ledger/.test(text)) return [{ id: 1 }];
      if (/FROM nostr_events/.test(text)) {
        return [{ id: "e1", pubkey: "p1", kind: 1, created_at: 9, content: "c", tags: [], sig: "s", node_id: "n", source: "r" }];
      }
      if (/COUNT\(\*\)::int AS requests, COALESCE/.test(text)) return [{ requests: 0, revenue_atomic: "0" }];
      return [];
    },
    facilitator: {
      verify: async () => ({ isValid: true, payer: "0x0000000000000000000000000000000000000001" }),
      settle: async () => ({ success: true, transaction: "0xdead" as `0x${string}`, network: "eip155:100" }),
    },
    excluded: () => new Set<string>(),
    mintToken: () => "PASSTOKEN",
    ...overrides,
  };
}

async function withServer(d: GatewayDeps, run: (base: string) => Promise<void>) {
  const server = createGatewayServer(d);
  await new Promise<void>((r) => server.listen(0, r));
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    server.close();
  }
}

test("an unpaid bulk request gets a self-describing 402", async () => {
  await withServer(deps(), async (base) => {
    const res = await fetch(`${base}/bulk/events?kinds=1`);
    assert.equal(res.status, 402);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const body = await res.json();
    assert.equal(body.x402Version, 1);
    assert.equal(body.accepts[0].maxAmountRequired, "500000");
    assert.equal(body.payLink, "https://index.roebel.app/pay");
  });
});

test("a paid bulk request serves events, records ledger + serving, sets X-PAYMENT-RESPONSE", async () => {
  const d = deps();
  await withServer(d, async (base) => {
    const res = await fetch(`${base}/bulk/events?kinds=1`, { headers: { "X-PAYMENT": HEADER } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.events.length, 1);
    assert.ok(res.headers.get("x-payment-response"));
    assert.ok(d.sql.some((s) => /INSERT INTO access_ledger/.test(s)));
    assert.ok(d.sql.some((s) => /INSERT INTO serving_log/.test(s)));
  });
});

test("a failed verification is a 402 with the reason", async () => {
  const d = deps({
    facilitator: {
      verify: async () => ({ isValid: false, invalidReason: "nonce_used" }),
      settle: async () => { throw new Error("must not settle"); },
    },
  });
  await withServer(d, async (base) => {
    const res = await fetch(`${base}/bulk/events`, { headers: { "X-PAYMENT": HEADER } });
    assert.equal(res.status, 402);
    assert.match((await res.json()).error, /nonce_used/);
  });
});

test("a settle revert is a 402; a network error serves with reconcile", async () => {
  const reverted = deps({
    facilitator: {
      verify: async () => ({ isValid: true, payer: "0x01" as `0x${string}` }),
      settle: async () => ({ success: false, errorReason: "settle_reverted", network: "eip155:100" }),
    },
  });
  await withServer(reverted, async (base) => {
    const res = await fetch(`${base}/bulk/events`, { headers: { "X-PAYMENT": HEADER } });
    assert.equal(res.status, 402);
  });
  const flaky = deps({
    facilitator: {
      verify: async () => ({ isValid: true, payer: "0x01" as `0x${string}` }),
      settle: async () => ({ success: false, errorReason: "network_error", network: "eip155:100" }),
    },
  });
  await withServer(flaky, async (base) => {
    const res = await fetch(`${base}/bulk/events`, { headers: { "X-PAYMENT": HEADER } });
    assert.equal(res.status, 200, "spec §8: bounded risk — serve and reconcile");
    assert.ok(flaky.sql.some((s) => /INSERT INTO access_ledger/.test(s)));
  });
});

test("a paid firehose request mints a pass", async () => {
  const d = deps();
  await withServer(d, async (base) => {
    const res = await fetch(`${base}/firehose`, { headers: { "X-PAYMENT": HEADER } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.pass, "PASSTOKEN");
    assert.match(body.connect, /\/firehose\?pass=PASSTOKEN/);
    assert.ok(d.sql.some((s) => /INSERT INTO firehose_passes/.test(s)));
  });
});

test("/pay is human-readable and shows formatted prices", async () => {
  await withServer(deps(), async (base) => {
    const res = await fetch(`${base}/pay`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /0\.50/);
    assert.match(html, /USDC\.e|Bridged USDC/);
    assert.match(html, /X-PAYMENT/);
  });
});

test("/metering/stats returns totals and split", async () => {
  await withServer(deps(), async (base) => {
    const res = await fetch(`${base}/metering/stats`);
    const body = await res.json();
    assert.equal(body.split.authors, 50);
    assert.equal(body.totals.requests, 0);
  });
});
