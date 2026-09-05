import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
const oldMigration = read("supabase/migrations/20260902_staging_synthetic_citizen_adoption.sql");
const rotation = read("supabase/migrations/20260905_staging_synthetic_citizen_pass_v2.sql");
const canonical = read("supabase/staging-synthetic-citizen-adoption-schema-contract-v2.json");
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

test("identity rotation preserves migration 76 and every validation except its retired pin", () => {
  assert.equal(sha256(oldMigration), "992e56a65af74b32e35d2211ac57714f32e2e72e4fb82ea59afeb7dbbcefb282");
  for (const name of ["issue_synthetic_challenge", "accept_synthetic_adoption", "synthetic_adoption_preflight"]) {
    const pattern = new RegExp(`create or replace function public\\.staging_participant_gateway_${name}\\([\\s\\S]*?\\n\\$\\$;`, "u");
    const oldFunction = oldMigration.match(pattern)?.[0];
    const newFunction = rotation.match(pattern)?.[0];
    assert.ok(oldFunction);
    assert.ok(newFunction);
    assert.equal(newFunction, oldFunction
      .replaceAll("0x0be374808a567c9088ac8208b90a4239432b3220", "0x4765cb681e8eb080b3191dd550e81eaa41907323")
      .replaceAll("20260902_staging_synthetic_citizen_adoption", "20260905_staging_synthetic_citizen_pass_v2"));
    for (const definition of [oldFunction, newFunction]) {
      const body = definition.split("as $$")[1]!.split("$$;")[0]!;
      assert.ok(rotation.includes(sha256(body)), `${name} body must be checked before replacing it`);
    }
  }
  assert.doesNotMatch(rotation, /\b(?:drop|truncate|delete from|alter table)\b/iu);
  assert.match(rotation, /STAGING_TEST_IDENTITY_ROTATION_FUNCTION_DRIFT/u);
  assert.match(rotation, /REQUIRES_ARMED_STAGING/u);
});

test("v2 schema evidence binds the new contract and retains the no-authority boundary", () => {
  assert.equal(rotation.split("$contract$")[1], canonical);
  assert.ok(rotation.includes(`sha256:${sha256(canonical)}`));
  const contract = JSON.parse(canonical);
  assert.equal(contract.identityContractSet, "gnosis-staging-test-v2");
  assert.equal(contract.testCitizenNftContract, "0x4765cb681e8eb080b3191dd550e81eaa41907323");
  assert.equal(contract.authorityBinding, "none");
  assert.equal(contract.testOnly, true);
  assert.deepEqual(contract.realSchemasForbidden, JSON.parse(read("supabase/staging-synthetic-citizen-adoption-schema-contract-v1.json")).realSchemasForbidden);
});
