import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createFacilitatorServer } from "../src/server.js";

async function withServer(
  deps: Partial<Parameters<typeof createFacilitatorServer>[0]>,
  run: (base: string) => Promise<void>,
) {
  const server = createFacilitatorServer({
    network: "eip155:100",
    verify: async () => ({ isValid: true, payer: "0x0000000000000000000000000000000000000001" }),
    settle: async () => ({ success: true, transaction: "0xabc" as `0x${string}`, network: "eip155:100" }),
    ...deps,
  });
  await new Promise<void>((r) => server.listen(0, r));
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    server.close();
  }
}

test("GET /supported names the scheme and network", async () => {
  await withServer({}, async (base) => {
    const res = await fetch(`${base}/supported`);
    assert.deepEqual(await res.json(), { kinds: [{ scheme: "exact", network: "eip155:100" }] });
  });
});

test("POST /verify routes body to the verifier", async () => {
  await withServer(
    { verify: async (p) => ({ isValid: false, invalidReason: `saw:${(p as { network: string }).network}` }) },
    async (base) => {
      const res = await fetch(`${base}/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ paymentPayload: { network: "eip155:100" }, paymentRequirements: {} }),
      });
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { isValid: false, invalidReason: "saw:eip155:100" });
    },
  );
});

test("POST /settle returns the settle result", async () => {
  await withServer({}, async (base) => {
    const res = await fetch(`${base}/settle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paymentPayload: {}, paymentRequirements: {} }),
    });
    assert.deepEqual(await res.json(), { success: true, transaction: "0xabc", network: "eip155:100" });
  });
});

test("malformed JSON is a 400, not a crash", async () => {
  await withServer({}, async (base) => {
    const res = await fetch(`${base}/verify`, { method: "POST", body: "{nope" });
    assert.equal(res.status, 400);
  });
});
