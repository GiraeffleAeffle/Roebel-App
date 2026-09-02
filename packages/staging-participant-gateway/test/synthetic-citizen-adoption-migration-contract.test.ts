import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(
  new URL(
    "../../../supabase/migrations/20260902_staging_synthetic_citizen_adoption.sql",
    import.meta.url,
  ),
  "utf8",
);
const publishedContract = readFileSync(
  new URL(
    "../../../supabase/staging-synthetic-citizen-adoption-schema-contract-v1.json",
    import.meta.url,
  ),
  "utf8",
);

test("synthetic adoption migration is a separate staging-only, no-authority store", () => {
  assert.match(migration, /20260902_staging_synthetic_citizen_adoption/u);
  assert.match(migration, /staging_participant_synthetic_citizen_challenges/u);
  assert.match(migration, /staging_participant_synthetic_citizen_adoptions/u);
  assert.match(migration, /public_synthetic_citizen_adoption_projection_v1/u);
  assert.match(migration, /synthetic_citizen_adoption_tracer_v1/u);
  assert.ok(migration.includes("authorityBinding' is distinct from '\"none\"'"));
  assert.match(migration, /p_public_projection \?\| array\['eligibilityReceipt','adoptionEvent','caseBindingReceipt'\]/u);
  assert.doesNotMatch(
    migration,
    /insert into\s+(?:public\.)?(?:civic_cases|votes|treasury|payments)/iu,
  );
});

test("migration rejects JSON nulls, early consume, wrong contract and cross-field drift", () => {
  assert.match(migration, /field\.value = 'null'::jsonb/u);
  assert.match(migration, /p_consumed_at < v_row\.issued_at/u);
  assert.match(migration, /v_expires - v_issued <> 300/u);
  const exactContract = "0x0be374808a567c9088ac8208b90a4239432b3220";
  assert.equal(migration.match(new RegExp(exactContract, "gu"))?.length, 2);
  assert.match(
    migration,
    /lower\(p_public_projection->>'participantSuggestionId'\) is distinct from v_suggestion/u,
  );
  assert.match(
    migration,
    /v_acceptance->>'topicId' is distinct from v_tracer->>'topicId'/u,
  );
  assert.match(
    migration,
    /v_challenge\.policy_version is distinct from v_acceptance->>'policyVersion'/u,
  );
});

test("preflight schema checksum is the checksum of the embedded canonical contract", () => {
  const [prefix, canonical, suffix] = migration.split("$contract$");
  assert.ok(prefix);
  assert.ok(canonical);
  assert.ok(suffix);
  assert.equal(canonical, publishedContract);
  const checksum = createHash("sha256").update(canonical, "utf8").digest("hex");
  assert.match(prefix, new RegExp(`sha256:${checksum}`, "u"));
  assert.equal(
    checksum,
    "bcaa0b098a99b145e5111c17e29e5e7d9e9eb0840ee27643b3c26db34118bd66",
  );
});
