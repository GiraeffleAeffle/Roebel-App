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

// --- Review-round fixes: fail-open recording, watermark normalisation, no crash. ---

test("bulk: a ledger write failure after settlement is fail-open — still 200 with the events", async () => {
  const d = deps({
    query: async (text: string) => {
      if (/INSERT INTO access_ledger/.test(text)) throw new Error("db unavailable");
      if (/FROM nostr_events/.test(text)) {
        return [{ id: "e1", pubkey: "p1", kind: 1, created_at: 9, content: "c", tags: [], sig: "s", node_id: "n", source: "r" }];
      }
      return [];
    },
  });
  await withServer(d, async (base) => {
    const res = await fetch(`${base}/bulk/events?kinds=1`, { headers: { "X-PAYMENT": HEADER } });
    assert.equal(res.status, 200, "payment already settled — the data must still be served");
    const body = await res.json();
    assert.equal(body.events.length, 1);
  });
});

test("firehose SSE: emits data and re-derives an ISO watermark from a Date on the next poll", async () => {
  const batchValues: unknown[][] = [];
  let batchCalls = 0;
  const firstEventIndexedAt = new Date();
  const d = deps({
    pollMs: 10,
    query: async (text: string, values: unknown[]) => {
      if (/FROM firehose_passes/.test(text) && /^SELECT/.test(text)) {
        return [{ ledger_id: 1, expires_at: new Date(Date.now() + 3_600_000) }];
      }
      if (/FROM nostr_events WHERE indexed_at/.test(text)) {
        batchCalls += 1;
        batchValues.push(values);
        if (batchCalls === 1) {
          return [{
            id: "e1", pubkey: "p1", kind: 1, created_at: 9, content: "c", tags: [], sig: "s",
            node_id: "n", source: "r", indexed_at: firstEventIndexedAt,
          }];
        }
        return [];
      }
      return [];
    },
  });
  await withServer(d, async (base) => {
    const controller = new AbortController();
    const res = await fetch(`${base}/firehose?pass=VALID`, { signal: controller.signal });
    assert.equal(res.status, 200);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let received = "";
    const deadline = Date.now() + 5000;
    while (!received.includes("data:") && Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      received += decoder.decode(value, { stream: true });
    }
    assert.match(received, /data: \{.*"id":"e1"/, "the first SSE data event should carry the row");
    // Give the second (pollMs-later) poll a chance to fire and capture its watermark.
    const secondPollDeadline = Date.now() + 2000;
    while (batchCalls < 2 && Date.now() < secondPollDeadline) {
      await new Promise((r) => setTimeout(r, 15));
    }
    await reader.cancel();
    controller.abort();
    // Let the server-side loop observe req 'close' and exit before the server shuts down.
    await new Promise((r) => setTimeout(r, 30));
  });
  assert.ok(batchCalls >= 2, "expected at least two firehose batch polls");
  const secondPollWatermark = String(batchValues[1][0]);
  assert.match(secondPollWatermark, /^\d{4}-\d{2}-\d{2}T.*Z$/, "watermark handed to the next poll must be ISO-8601, not a locale Date string");
});

// --- Whole-branch review fixes: replay guard, uncharged 400 for dropped filters, settled value. ---

test("I2: a replayed X-PAYMENT is rejected with 402 before the facilitator is asked to verify it again", async () => {
  let nonceQueries = 0;
  let verifyCalls = 0;
  const d = deps({
    query: async (text: string) => {
      if (/WHERE nonce = \$1/.test(text)) {
        nonceQueries += 1;
        // First call: nonce unseen. Second call (the replay): nonce now on the ledger.
        return nonceQueries === 1 ? [] : [{ "?column?": 1 }];
      }
      if (/INSERT INTO access_ledger/.test(text)) return [{ id: 1 }];
      if (/FROM nostr_events/.test(text)) {
        return [{ id: "e1", pubkey: "p1", kind: 1, created_at: 9, content: "c", tags: [], sig: "s", node_id: "n", source: "r" }];
      }
      return [];
    },
    facilitator: {
      verify: async () => {
        verifyCalls += 1;
        return { isValid: true, payer: "0x0000000000000000000000000000000000000001" as `0x${string}` };
      },
      settle: async () => ({ success: true, transaction: "0xdead" as `0x${string}`, network: "eip155:100" }),
    },
  });
  await withServer(d, async (base) => {
    const first = await fetch(`${base}/bulk/events?kinds=1`, { headers: { "X-PAYMENT": HEADER } });
    assert.equal(first.status, 200, "the first use of the authorization must be served");

    const second = await fetch(`${base}/bulk/events?kinds=1`, { headers: { "X-PAYMENT": HEADER } });
    assert.equal(second.status, 402, "a replay of the same signed authorization must be rejected");
    const body = await second.json();
    assert.match(body.error, /authorization already used/);
  });
  assert.equal(verifyCalls, 1, "the facilitator must never be asked to verify a nonce already on the ledger");
});

test("I3: /bulk/events with an unsupported tag filter is a 400 and never reaches the paywall", async () => {
  let verifyCalls = 0;
  const d = deps({
    facilitator: {
      verify: async () => { verifyCalls += 1; return { isValid: true, payer: "0x01" as `0x${string}` }; },
      settle: async () => ({ success: true, transaction: "0xdead" as `0x${string}`, network: "eip155:100" }),
    },
  });
  await withServer(d, async (base) => {
    const res = await fetch(`${base}/bulk/events?ids=abc`, { headers: { "X-PAYMENT": HEADER } });
    assert.equal(res.status, 400, "an unsupported filter must be rejected before any payment is taken");
    const body = await res.json();
    assert.match(body.error, /ids/);
    assert.match(body.error, /\/events/);
  });
  assert.equal(verifyCalls, 0, "the client must not be charged for a query that silently drops its filter");
});

test("M2: the ledger records the authorization's actual settled value, not the configured price", async () => {
  const customValue = "999999"; // deliberately different from cfg.prices.bulk ("500000")
  const payment: PaymentPayload = {
    ...PAYMENT,
    payload: {
      ...PAYMENT.payload,
      authorization: { ...PAYMENT.payload.authorization, value: customValue, nonce: ("0x" + "11".repeat(32)) as `0x${string}` },
    },
  };
  const header = Buffer.from(JSON.stringify(payment)).toString("base64");
  let insertedValues: unknown[] | undefined;
  const d = deps({
    query: async (text: string, values: unknown[]) => {
      if (/INSERT INTO access_ledger/.test(text)) {
        insertedValues = values;
        return [{ id: 1 }];
      }
      if (/FROM nostr_events/.test(text)) {
        return [{ id: "e1", pubkey: "p1", kind: 1, created_at: 9, content: "c", tags: [], sig: "s", node_id: "n", source: "r" }];
      }
      return [];
    },
  });
  await withServer(d, async (base) => {
    const res = await fetch(`${base}/bulk/events?kinds=1`, { headers: { "X-PAYMENT": header } });
    assert.equal(res.status, 200);
  });
  assert.ok(insertedValues, "the ledger insert must have run");
  assert.equal(insertedValues?.[2], customValue, "amount column must equal authorization.value, not the configured price");
});

test("firehose SSE: a pass that expires mid-stream ends the connection on the next poll", async () => {
  const d = deps({
    pollMs: 10,
    query: async (text: string) => {
      if (/FROM firehose_passes/.test(text) && /^SELECT/.test(text)) {
        // Already expired by the time the poll loop checks it.
        return [{ ledger_id: 1, expires_at: new Date(Date.now() - 1000) }];
      }
      return [];
    },
  });
  await withServer(d, async (base) => {
    const res = await fetch(`${base}/firehose?pass=EXPIRING`);
    assert.equal(res.status, 200);
    const reader = res.body!.getReader();
    const deadline = Date.now() + 2000;
    let done = false;
    while (!done && Date.now() < deadline) {
      ({ done } = await reader.read());
    }
    assert.ok(done, "the stream must end once the pass has expired, not stay open indefinitely");
  });
});

test("export: a mid-stream query failure destroys the connection without crashing the process", async () => {
  // streamExport only re-queries once a batch comes back FULL (EXPORT_BATCH=5000
  // in src/exportStream.ts) — so the first call must return exactly that many rows
  // to force a second call, which is where we inject the failure.
  const fullBatch = Array.from({ length: 5000 }, (_, i) => ({
    id: `e${i}`, pubkey: "p1", kind: 1, created_at: 9, content: "c", tags: [], sig: "s", node_id: "n", source: "r",
  }));
  let batchCall = 0;
  const d = deps({
    query: async (text: string) => {
      if (/FROM nostr_events/.test(text)) {
        batchCall += 1;
        if (batchCall === 1) return fullBatch;
        throw new Error("db exploded mid-export");
      }
      if (/INSERT INTO access_ledger/.test(text)) return [{ id: 1 }];
      return [];
    },
  });
  await withServer(d, async (base) => {
    // The destroy happens fast enough locally that either the initial fetch()
    // (headers never fully delivered) or the later res.text() (body cut off)
    // can be the one that observes the reset — assert on the outcome, not the
    // exact point of failure: the client must never see a clean 200 body.
    await assert.rejects(async () => {
      const res = await fetch(`${base}/export`, { headers: { "X-PAYMENT": HEADER } });
      await res.text();
    }, "a truncated export must never resolve as a clean response");
    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200, "the server process must still be alive and answering after the failure");
  });
});
