import assert from "node:assert/strict";
import { test } from "node:test";
import { subTypeFeatures, type OrgSubType } from "../src/types/account";

const ORG_SUB_TYPES: OrgSubType[] = [
  "restaurant",
  "unternehmen",
  "verein",
  "stadt",
  "fraktion",
  "journalist",
];

test("every org sub_type gets the workspace section", () => {
  for (const sub of ORG_SUB_TYPES) {
    assert.equal(
      subTypeFeatures(sub).workspace,
      true,
      `${sub} should expose the workspace`
    );
  }
});

test("null sub_type (no org) does not get the workspace section", () => {
  assert.equal(subTypeFeatures(null).workspace, false);
});
