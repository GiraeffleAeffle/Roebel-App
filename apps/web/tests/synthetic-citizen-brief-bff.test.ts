import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { respondSyntheticBrief } from "../src/lib/stadtstack/synthetic-citizen-brief-bff";
import { syntheticBriefPath } from "../../../packages/stadtstack-federation-client/src/syntheticCitizenBrief";

const { returned, receipt } = JSON.parse(readFileSync(new URL("../../../packages/stadtstack-federation-client/src/fixtures/synthetic-citizen-brief-return-v1.json", import.meta.url), "utf8"));
const origin = "http://roebel-case-steward-control.stadtstack-roebel-staging-lab.svc.cluster.local:18090";
const config = { environment: "staging", caseId: returned.caseId, upstreamOrigin: origin };
const request = (method = "GET") => new Request("https://app.example" + syntheticBriefPath(returned.discussionId),
  { method, headers: { cookie: "private-session-canary", authorization: "Bearer browser-canary" } });

test("public return binds the admission receipt and sends no browser/session credential", async () => {
  const calls: RequestInit[] = [];
  const response = await respondSyntheticBrief(request(), returned.discussionId, config, {
    readReceipt: async () => receipt,
    fetch: async (url, init) => {
      assert.equal(url, origin + "/v1/staging/administration/citizen-brief"); calls.push(init!); return Response.json(returned);
    },
  });
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), returned);
  assert.deepEqual(calls[0].headers, { host: "127.0.0.1", accept: "application/json" });
  assert.equal(calls[0].credentials, "omit"); assert.equal(calls[0].method, "GET");
});

test("wrong receipt, Case, method, configuration or private response fail closed", async () => {
  let reads = 0;
  const dependencies = { readReceipt: async () => receipt, fetch: async () => { reads++; return Response.json(returned); } };
  assert.equal((await respondSyntheticBrief(request("POST"), returned.discussionId, config, dependencies)).status, 405);
  assert.equal((await respondSyntheticBrief(request(), returned.discussionId, { ...config, environment: "production" }, dependencies)).status, 503);
  assert.equal((await respondSyntheticBrief(request(), returned.discussionId, { ...config, caseId: "foreign-case" }, dependencies)).status, 404);
  assert.equal(reads, 0);
  for (const value of [{ ...returned, privateDraft: "canary" }, { ...returned, returnChecksum: "sha256:" + "0".repeat(64) }]) {
    assert.equal((await respondSyntheticBrief(request(), returned.discussionId, config,
      { ...dependencies, fetch: async () => Response.json(value) })).status, 503);
  }
});
