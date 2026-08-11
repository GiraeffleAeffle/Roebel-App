import assert from "node:assert/strict";
import test from "node:test";

import { buildCivicDiscussionDeepLink } from "./civicDiscussionLink";

const exactBinding = {
  municipalityId: "roebel-mueritz",
  sourceCaseId: "marienfelder-strasse",
  canonicalCaseId:
    "urn:stadtstack:case:municipality:roebel-mueritz:018f0000-0000-7000-8000-000000000001",
  title: "Marienfelder Straße",
};

test("builds the exact host deep link for one reviewed municipal Case", () => {
  const link = buildCivicDiscussionDeepLink(exactBinding);
  const url = new URL(link);

  assert.equal(url.protocol, "roebel:");
  assert.equal(url.host, "civic-discussion");
  assert.deepEqual([...url.searchParams.entries()], [
    ["municipality", exactBinding.municipalityId],
    ["case", exactBinding.sourceCaseId],
    ["stadtstackCase", exactBinding.canonicalCaseId],
    ["title", exactBinding.title],
  ]);
});

test("fails closed before opening an unbound or malformed Case", () => {
  for (const input of [
    { ...exactBinding, municipalityId: "another-town" },
    { ...exactBinding, sourceCaseId: "Marienfelder Straße" },
    {
      ...exactBinding,
      canonicalCaseId:
        "urn:stadtstack:case:municipality:another-town:018f0000-0000-7000-8000-000000000001",
    },
    { ...exactBinding, title: " Marienfelder Straße" },
  ]) {
    assert.throws(() => buildCivicDiscussionDeepLink(input), /civic_discussion_link_invalid/);
  }
});
