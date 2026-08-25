import assert from "node:assert/strict";
import { test } from "node:test";

import { createPrivateWorkbenchMeckyMirrorAdapter } from "../src/workbench-adapter.ts";

const EVENT = {
  id: "1".repeat(64), pubkey: "2".repeat(64), created_at: 1_756_124_701,
  kind: 1, tags: [["p", "a".repeat(64)], ["source-app-post", "10000000-0000-4000-8000-000000000001"]],
  content: "@Mecky, was ist der nächste sinnvolle Schritt?", sig: "3".repeat(128),
};

test("private mirror has only the workbench admission then exact ordinary-post publication", async () => {
  const calls: Array<{ url: string; headers: Headers; body: unknown }> = [];
  const adapter = createPrivateWorkbenchMeckyMirrorAdapter({
    url: "http://e2e-workbench.stadtstack-roebel-staging-lab.svc.cluster.local:18083/",
    admissionHeader: { name: "x-stadtstack-e2e", value: "1" },
    fetch: async (url, init) => {
      calls.push({ url: String(url), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify(
        String(url).endsWith("/api/session/admit")
          ? { status: "admitted" }
          : { status: "published", event: { id: EVENT.id } },
      ), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  const result = await adapter.mirrorPost({ admissionProof: { schemaVersion: "roebel_citizen_admission_proof_v1" }, event: EVENT });
  assert.deepEqual(result, { status: "published", eventId: EVENT.id });
  assert.deepEqual(calls.map(({ url }) => url), [
    "http://e2e-workbench.stadtstack-roebel-staging-lab.svc.cluster.local:18083/api/session/admit",
    "http://e2e-workbench.stadtstack-roebel-staging-lab.svc.cluster.local:18083/api/signed-event",
  ]);
  assert.equal(calls[0]?.headers.get("x-stadtstack-e2e"), "1");
  assert.deepEqual(calls[1]?.body, { intent: "post", event: EVENT });
});

test("private mirror rejects public URLs and arbitrary workbench capability headers", () => {
  assert.throws(() => createPrivateWorkbenchMeckyMirrorAdapter({
    url: "https://roebel-web.staging.agentcart.eu",
    admissionHeader: { name: "x-stadtstack-e2e", value: "1" },
  }));
  assert.throws(() => createPrivateWorkbenchMeckyMirrorAdapter({
    url: "http://e2e-workbench.stadtstack-roebel-staging-lab.svc.cluster.local:18082/",
    admissionHeader: { name: "authorization", value: "Bearer arbitrary" },
  }));
  assert.throws(() => createPrivateWorkbenchMeckyMirrorAdapter({
    url: "http://e2e-workbench.stadtstack-roebel-web-preview.svc.cluster.local:18083/",
    admissionHeader: { name: "x-stadtstack-e2e", value: "1" },
  }));
});
