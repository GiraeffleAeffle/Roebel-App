import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  new URL("./staging-participant-gateway-publish.yml", import.meta.url),
  "utf8",
);

test("the gateway publisher carries real and synthetic citizen-adoption storage into v4 release evidence", () => {
  for (const path of [
    "supabase/migrations/20260901_staging_citizen_adoption.sql",
    "supabase/staging-citizen-adoption-schema-contract-v1.json",
    "supabase/migrations/20260902_staging_synthetic_citizen_adoption.sql",
    "supabase/staging-synthetic-citizen-adoption-schema-contract-v1.json",
    "supabase/migrations/20260905_staging_synthetic_citizen_pass_v2.sql",
    "supabase/staging-synthetic-citizen-adoption-schema-contract-v2.json",
  ]) {
    assert.equal(
      (workflow.match(new RegExp(`- "${path.replaceAll(".", "\\.")}"`, "gu")) ?? [])
        .length,
      2,
      `${path} must trigger both pull-request verification and protected-main publication`,
    );
  }
  assert.match(
    workflow,
    /cp supabase\/migrations\/20260901_staging_citizen_adoption\.sql \\\n\s+"\$RUNNER_TEMP\/test-context\/supabase\/migrations\/"/u,
  );
  assert.match(
    workflow,
    /cp supabase\/staging-citizen-adoption-schema-contract-v1\.json \\\n\s+"\$RUNNER_TEMP\/test-context\/supabase\/"/u,
  );
  assert.match(
    workflow,
    /cp supabase\/migrations\/20260902_staging_synthetic_citizen_adoption\.sql \\\n\s+"\$RUNNER_TEMP\/test-context\/supabase\/migrations\/"/u,
  );
  assert.match(
    workflow,
    /cp supabase\/staging-synthetic-citizen-adoption-schema-contract-v1\.json \\\n\s+"\$RUNNER_TEMP\/test-context\/supabase\/"/u,
  );
  for (const field of [
    "citizenAdoptionMigrationSha256",
    "citizenAdoptionDatabaseSchemaSha256",
    "syntheticCitizenAdoptionMigrationSha256",
    "syntheticCitizenAdoptionDatabaseSchemaSha256",
  ]) {
    assert.match(workflow, new RegExp(field, "u"));
  }
  assert.match(workflow, /roebel_staging_participant_gateway_release_pins_v4/u);
  assert.match(workflow, /roebel_staging_publication_receipt_v4/u);
  assert.match(
    workflow,
    /test "\$\(jq -r \.citizenAdoptionMigrationSha256 "\$RELEASE_PINS"\)" = "sha256:\$\(sha256sum source\/supabase\/migrations\/20260901_staging_citizen_adoption\.sql/u,
  );
  assert.match(
    workflow,
    /test "\$\(jq -r \.citizenAdoptionDatabaseSchemaSha256 "\$RELEASE_PINS"\)" = "sha256:\$\(sha256sum source\/supabase\/staging-citizen-adoption-schema-contract-v1\.json/u,
  );
  assert.match(
    workflow,
    /test "\$\(jq -r \.syntheticCitizenAdoptionMigrationSha256 "\$RELEASE_PINS"\)" = "sha256:\$\(sha256sum source\/supabase\/migrations\/20260905_staging_synthetic_citizen_pass_v2\.sql/u,
  );
  assert.match(
    workflow,
    /test "\$\(jq -r \.syntheticCitizenAdoptionDatabaseSchemaSha256 "\$RELEASE_PINS"\)" = "sha256:\$\(sha256sum source\/supabase\/staging-synthetic-citizen-adoption-schema-contract-v2\.json/u,
  );
});

test("the publisher runs its static pin contract before building the gateway", () => {
  assert.equal(
    (workflow.match(/- "\.github\/workflows\/staging-participant-gateway-publish\.static\.test\.mjs"/gu) ?? [])
      .length,
    2,
  );
  assert.match(
    workflow,
    /node --test[\s\S]*?staging-participant-gateway-publish\.static\.test\.mjs[\s\S]*?verify-staging-service-oci\.test\.mjs/u,
  );
});
