import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const route = readFileSync(
  new URL(
    "../src/app/api/stadtstack/case-bindings/by-discussion/[rootId]/route.ts",
    import.meta.url
  ),
  "utf8"
);
const client = readFileSync(
  new URL(
    "../src/lib/stadtstack/public-case-binding-receipt-client.ts",
    import.meta.url
  ),
  "utf8"
);
const bff = readFileSync(
  new URL(
    "../src/lib/stadtstack/public-case-binding-bff.ts",
    import.meta.url
  ),
  "utf8"
);
const discussion = readFileSync(
  new URL("../src/components/app/StadtstackDiscussion.tsx", import.meta.url),
  "utf8"
);
const topic = readFileSync(
  new URL("../src/components/app/StadtstackCivicTopic.tsx", import.meta.url),
  "utf8"
);

test("keeps the case-binding BFF credential-free and read-only", () => {
  assert.match(route, /fetchVerifiedPublicCaseBindingReceipt/);
  assert.match(route, /export async function GET/);
  assert.match(route, /export async function HEAD/);
  assert.doesNotMatch(route, /export async function (?:POST|PUT|PATCH|DELETE)/);
  assert.match(route, /respondPublicCaseBindingRequest/);
  assert.match(bff, /isPublicCaseBindingRootEventId/);
  assert.match(bff, /status: 404/);
  assert.match(bff, /status: 503/);
  assert.match(bff, /cache-control.*no-store/);
  assert.doesNotMatch(route, /authorization|cookie|stagingPost|admit|openDesk/i);
  assert.match(client, /\/api\/stadtstack\/case-bindings\/by-discussion\//);
  assert.match(client, /x-stadtstack-receipt-sha256/);
});

test("advances civic stages only from an exact proposal-bound receipt", () => {
  assert.match(discussion, /loadVerifiedPublicCaseBindingReceipt\(rootId\)/);
  assert.match(discussion, /bindPublicCaseReceiptToProposal/);
  assert.match(discussion, /suggestion: thread\.suggestion/);
  assert.match(discussion, /bindingReceiptMismatch/);
  assert.match(
    discussion,
    /const canonicalCaseId = topicBindingReceipt\?\.caseId/
  );
  assert.match(discussion, /thread\.caseBinding && !topicBindingReceipt/);
  assert.doesNotMatch(discussion, /thread\.caseBinding\?\.canonicalCaseId/);
  assert.match(topic, /loadVerifiedPublicCaseBindingReceipt\(rootId\)/);
  assert.match(topic, /bindingReceipt\.caseId/);
  assert.match(topic, /Synthetische\s+Legacy-Case-Markierung/);
});
