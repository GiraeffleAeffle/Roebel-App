import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../../", import.meta.url);
const workflow = readFileSync(
  new URL(".github/workflows/staging-incluster-tracer-database.yml", root),
  "utf8"
);
const harness = readFileSync(
  new URL("supabase/tests/test_staging_incluster_tracer_database.sh", root),
  "utf8"
);
const baselineSql = readFileSync(
  new URL("supabase/staging_incluster_tracer_baseline_v1.sql", root),
  "utf8"
);
const integrationSql = readFileSync(
  new URL("supabase/tests/staging_incluster_tracer_integration.sql", root),
  "utf8"
);
const citizenAdoptionIntegrationUrl = new URL(
  "supabase/tests/staging_incluster_tracer_citizen_adoption_integration.sql",
  root
);
const citizenAdoptionIntegrationSql = existsSync(citizenAdoptionIntegrationUrl)
  ? readFileSync(citizenAdoptionIntegrationUrl, "utf8")
  : "";
const syntheticAdoptionIntegrationUrl = new URL(
  "supabase/tests/staging_incluster_tracer_synthetic_citizen_adoption_integration.sql",
  root
);
const syntheticAdoptionIntegrationSql = existsSync(syntheticAdoptionIntegrationUrl)
  ? readFileSync(syntheticAdoptionIntegrationUrl, "utf8")
  : "";
const syntheticAdoptionMigration = readFileSync(
  new URL(
    "supabase/migrations/20260902_staging_synthetic_citizen_adoption.sql",
    root
  ),
  "utf8"
);
const syntheticAdoptionSchemaContract = readFileSync(
  new URL(
    "supabase/staging-synthetic-citizen-adoption-schema-contract-v1.json",
    root
  ),
  "utf8"
);
const secretProvisioningSql = readFileSync(
  new URL(
    "supabase/tests/staging_incluster_tracer_provision_secrets.sql",
    root
  ),
  "utf8"
);

test("the database integration workflow is bounded and runs on relevant changes", () => {
  assert.match(workflow, /^name: In-cluster tracer database integration$/mu);
  assert.match(workflow, /^  push:\n    branches: \[main\]/mu);
  assert.match(workflow, /^  pull_request:\n    branches: \[main\]/mu);
  assert.match(workflow, /^permissions:\n  contents: read$/mu);
  assert.match(workflow, /^    timeout-minutes: 15$/mu);
  assert.match(
    workflow,
    /actions\/checkout@d23441a48e516b6c34aea4fa41551a30e30af803 # v6/u
  );
  assert.match(
    workflow,
    /node --test\s+\.github\/workflows\/staging-incluster-tracer-database\.static\.test\.mjs/u
  );
  assert.match(
    workflow,
    /bash supabase\/tests\/test_staging_incluster_tracer_database\.sh/u
  );
  assert.doesNotMatch(workflow, /- "package\.json"/u);
  for (const path of [
    "supabase/migrations/20260901_staging_citizen_adoption.sql",
    "supabase/staging-citizen-adoption-schema-contract-v1.json",
    "supabase/migrations/20260902_staging_synthetic_citizen_adoption.sql",
    "supabase/staging-synthetic-citizen-adoption-schema-contract-v1.json",
  ]) {
    assert.equal(
      (workflow.match(new RegExp(`- "${path.replaceAll(".", "\\.")}"`, "gu")) ?? [])
        .length,
      2,
    );
  }
});

test("the harness pins the database image and reviewed migration bytes", () => {
  assert.match(
    harness,
    /docker\.io\/supabase\/postgres:15\.8\.1\.085@sha256:af083ef64d0408c8f098ee6f5c364a59b26f36fbc0f3a334a62c5c1d57362e9b/u
  );
  assert.match(
    harness,
    /f8f9745c1783043334ef24b3cde801d19a609867d12d0c23612bda7c5206ca5a/u
  );
  assert.match(
    harness,
    /ad050047a71bf2cc82361c16169627dc0a0a66a7982db804b1612624f0f97eab/u
  );
  assert.match(
    harness,
    /739cbcb189e3b12913ebf28dae74c931eab3cfae514e476bea4071092aef242e/u
  );
  assert.match(
    harness,
    /readonly CITIZEN_ADOPTION_MIGRATION_SHA256="[0-9a-f]{64}"/u
  );
  assert.match(
    harness,
    /require_sha256 "\$CITIZEN_ADOPTION_MIGRATION" "\$CITIZEN_ADOPTION_MIGRATION_SHA256"/u
  );
  assert.match(
    harness,
    /readonly SYNTHETIC_ADOPTION_MIGRATION_SHA256="992e56a65af74b32e35d2211ac57714f32e2e72e4fb82ea59afeb7dbbcefb282"/u
  );
  assert.match(
    harness,
    /readonly SYNTHETIC_ADOPTION_SCHEMA_CONTRACT_SHA256="bcaa0b098a99b145e5111c17e29e5e7d9e9eb0840ee27643b3c26db34118bd66"/u
  );
  assert.match(
    harness,
    /require_sha256 "\$SYNTHETIC_ADOPTION_MIGRATION" "\$SYNTHETIC_ADOPTION_MIGRATION_SHA256"/u
  );
  assert.match(
    harness,
    /require_sha256 "\$SYNTHETIC_ADOPTION_SCHEMA_CONTRACT" "\$SYNTHETIC_ADOPTION_SCHEMA_CONTRACT_SHA256"/u
  );
  assert.match(harness, /--pull=always/u);
  assert.match(harness, /trap cleanup EXIT/u);
  assert.match(
    harness,
    /PGOPTIONS='-c search_path=pg_catalog,public,staging_participant_private'/u
  );
  assert.equal(
    (harness.match(/run_participant_migration_file "\$(?:PARTICIPANT|TOPIC|CITIZEN_ADOPTION|SYNTHETIC_ADOPTION)_MIGRATION"/gu) ?? [])
      .length,
    4
  );
  assert.doesNotMatch(harness, /docker (?:build|compose build)/u);
});

test("PostgREST is digest-pinned on an unpublished isolated network", () => {
  assert.match(
    harness,
    /docker\.io\/postgrest\/postgrest:v14\.16@sha256:bea1c76a856fa39d1e542d25911cf95d02fe2bf971992d033044ff209f1504b8/u
  );
  assert.match(harness, /docker network create --driver bridge --internal/u);
  assert.match(harness, /--network-alias postgrest/u);
  assert.match(harness, /\.HostConfig\.PortBindings/u);
  assert.match(harness, /postgrest_origin="http:\/\/postgrest:3000"/u);
  assert.equal(
    (
      harness.match(
        /docker exec "\$database_container_name" \\\n\s+curl /gu
      ) ?? []
    ).length,
    3
  );
  assert.equal((harness.match(/--noproxy '\*'/gu) ?? []).length, 3);
  assert.doesNotMatch(harness, /--fail-with-body/u);
  assert.match(harness, /getent hosts postgrest/u);
  assert.match(harness, /--write-out '%\{http_code\}'/u);
  assert.match(harness, /PostgREST diagnostics withheld/u);
  assert.match(harness, /PGRST_DB_ANON_ROLE=anon/u);
  assert.match(harness, /PGRST_JWT_SECRET=/u);
  assert.doesNotMatch(harness, /--publish(?:=|\s)/u);
});

test("the HTTP test traverses all four preflights and ordinary write RPCs", () => {
  for (const rpc of [
    "staging_participant_gateway_preflight",
    "staging_participant_gateway_topic_tracer_preflight",
    "staging_participant_gateway_citizen_adoption_preflight",
    "staging_participant_gateway_synthetic_adoption_preflight",
    "staging_participant_gateway_create_main_text_post",
    "staging_participant_gateway_create_main_text_comment",
  ]) {
    assert.match(harness, new RegExp(`/rpc/${rpc}`, "u"));
  }
  assert.match(harness, /Authorization: Bearer/u);
  assert.match(harness, /@Mecky/u);
});

test("the synthetic schema bytes stay pinned to the isolated no-authority contract", () => {
  assert.equal(
    syntheticAdoptionSchemaContract,
    `${JSON.stringify(JSON.parse(syntheticAdoptionSchemaContract))}\n`
  );
  assert.match(
    syntheticAdoptionMigration,
    /sha256:bcaa0b098a99b145e5111c17e29e5e7d9e9eb0840ee27643b3c26db34118bd66/u
  );
  assert.match(
    syntheticAdoptionMigration,
    /\$contract\$\{"authorityBinding":"none"[\s\S]+?\n\$contract\$/u
  );
  for (const value of [
    "staging_test_citizen_pass_v1",
    "public_synthetic_citizen_adoption_projection_v1",
    "synthetic_journey_preview_only",
    "authorityBinding",
    "testOnly",
  ]) assert.match(syntheticAdoptionMigration, new RegExp(value, "u"));
  assert.doesNotMatch(
    syntheticAdoptionMigration,
    /(?:insert|update|delete)\s+(?:into\s+|from\s+)?(?:public\.)?(?:civic_cases|votes|treasury|municipal_decisions)\b/iu
  );
});

test("the behavior check uses the secret-bound anon RPC surface", () => {
  assert.match(integrationSql, /set local role anon/iu);
  assert.match(integrationSql, /request\.headers/u);
  assert.match(
    integrationSql,
    /public\.staging_participant_gateway_preflight\(\)/u
  );
  assert.match(
    integrationSql,
    /public\.staging_participant_gateway_topic_tracer_preflight\(\)/u
  );
  assert.match(
    integrationSql,
    /public\.staging_participant_gateway_citizen_adoption_preflight\(\)/u
  );
  assert.match(
    integrationSql,
    /public\.staging_participant_gateway_create_main_text_post\(/u
  );
  assert.match(
    integrationSql,
    /public\.staging_participant_gateway_create_main_text_comment\(/u
  );
  assert.match(integrationSql, /tier = 'guest'/u);
  assert.match(integrationSql, /is_verified_citizen is false/u);
  assert.doesNotMatch(
    integrationSql,
    /x-staging-participant-rpc-secret['"]?\s*[,=:]\s*['"][^:'"]{32,}['"]/iu
  );
});

test("citizen adoption is exercised behaviorally through the durable anon RPCs", () => {
  assert.notEqual(citizenAdoptionIntegrationSql, "");
  assert.match(
    harness,
    /staging_incluster_tracer_citizen_adoption_integration\.sql/u
  );
  assert.match(citizenAdoptionIntegrationSql, /set local role anon/iu);
  assert.match(citizenAdoptionIntegrationSql, /request\.headers/u);
  for (const rpc of [
    "issue_citizen_challenge",
    "consume_citizen_challenge",
    "store_citizen_eligibility_receipt",
    "get_citizen_eligibility_receipt",
    "accept_citizen_adoption",
    "resolve_citizen_adoption_replay",
    "read_public_citizen_adoption",
  ]) {
    assert.match(
      citizenAdoptionIntegrationSql,
      new RegExp(`public\\.staging_participant_gateway_${rpc}\\(`, "u")
    );
  }
  assert.match(
    citizenAdoptionIntegrationSql,
    /do \$citizen_challenge_used\$[\s\S]+?staging_participant_gateway_consume_citizen_challenge\([\s\S]+?STAGING_PARTICIPANT_CITIZEN_CHALLENGE_USED[\s\S]+?\$citizen_challenge_used\$;/iu,
  );
  for (const [kind, failure] of [
    ["tuple", "STAGING_PARTICIPANT_CITIZEN_ADOPTION_TUPLE_CONFLICT"],
    ["request", "STAGING_PARTICIPANT_CITIZEN_ADOPTION_REQUEST_CONFLICT"],
    ["idempotency", "STAGING_PARTICIPANT_CITIZEN_ADOPTION_IDEMPOTENCY_CONFLICT"],
    ["event", "STAGING_PARTICIPANT_CITIZEN_ADOPTION_EVENT_CONFLICT"],
  ]) {
    assert.match(
      citizenAdoptionIntegrationSql,
      new RegExp(
        `do \\$citizen_adoption_${kind}_conflict\\$[\\s\\S]+?${failure}[\\s\\S]+?\\$citizen_adoption_${kind}_conflict\\$;`,
        "iu",
      ),
    );
  }
  assert.match(
    citizenAdoptionIntegrationSql,
    /public\.staging_participant_gateway_accept_citizen_adoption\([\s\S]+?public\.staging_participant_gateway_resolve_citizen_adoption_replay\([\s\S]+?as adoption_exact_retry/iu,
  );
  assert.equal(
    (
      citizenAdoptionIntegrationSql.match(
        /public\.staging_participant_gateway_accept_citizen_adoption\(/gu,
      ) ?? []
    ).length,
    6,
  );
  assert.match(
    citizenAdoptionIntegrationSql,
    /select count\(\*\) = 1 as adoption_retry_kept_one_ledger_row[\s\S]+?staging_participant_private\.staging_participant_citizen_adoptions/iu,
  );
  for (const effect of [
    "submittedToCivicWorkflow",
    "administrativeEndorsement",
    "bindingVote",
    "councilDecision",
    "treasuryEffect",
    "paymentEffect",
  ]) {
    assert.match(
      citizenAdoptionIntegrationSql,
      new RegExp(`'${effect}'[\\s\\S]{0,80}?false`, "u")
    );
  }
});

test("synthetic adoption is exercised through a separate durable anon RPC surface", () => {
  assert.notEqual(syntheticAdoptionIntegrationSql, "");
  assert.match(
    harness,
    /staging_incluster_tracer_synthetic_citizen_adoption_integration\.sql/u
  );
  assert.match(syntheticAdoptionIntegrationSql, /set local role anon/iu);
  assert.match(syntheticAdoptionIntegrationSql, /request\.headers/u);
  for (const rpc of [
    "synthetic_adoption_preflight",
    "issue_synthetic_challenge",
    "consume_synthetic_challenge",
    "accept_synthetic_adoption",
    "resolve_synthetic_adoption_replay",
    "read_public_synthetic_adoption",
  ]) {
    assert.match(
      syntheticAdoptionIntegrationSql,
      new RegExp(`public\\.staging_participant_gateway_${rpc}\\(`, "u")
    );
  }
  assert.match(
    syntheticAdoptionIntegrationSql,
    /do \$synthetic_challenge_used\$[\s\S]+?STAGING_PARTICIPANT_SYNTHETIC_CHALLENGE_USED[\s\S]+?\$synthetic_challenge_used\$;/iu
  );
  for (const [kind, failure] of [
    ["request", "STAGING_PARTICIPANT_SYNTHETIC_ADOPTION_REQUEST_CONFLICT"],
    ["idempotency", "STAGING_PARTICIPANT_SYNTHETIC_ADOPTION_IDEMPOTENCY_CONFLICT"],
    ["event", "STAGING_PARTICIPANT_SYNTHETIC_ADOPTION_EVENT_CONFLICT"],
    ["tuple", "STAGING_PARTICIPANT_SYNTHETIC_ADOPTION_TUPLE_CONFLICT"],
  ]) {
    const block = syntheticAdoptionIntegrationSql.match(
      new RegExp(
        `do \\$synthetic_adoption_${kind}_conflict\\$[\\s\\S]+?${failure}[\\s\\S]+?\\$synthetic_adoption_${kind}_conflict\\$;`,
        "iu"
      )
    )?.[0];
    assert.ok(block);
    assert.doesNotMatch(
      block,
      /:'[a-z_]+'/u,
      "psql variables are not interpolated inside dollar-quoted DO blocks"
    );
    assert.match(block, /current_setting\('roebel\.test\.synthetic_adoption_/u);
  }
  assert.match(
    syntheticAdoptionIntegrationSql,
    /accept_synthetic_adoption\([\s\S]+?resolve_synthetic_adoption_replay\([\s\S]+?as synthetic_adoption_exact_retry/iu
  );
  assert.equal(
    (
      syntheticAdoptionIntegrationSql.match(
        /public\.staging_participant_gateway_accept_synthetic_adoption\(/gu
      ) ?? []
    ).length,
    6
  );
  for (const evidence of [
    "walletAddress",
    "sessionBindingSha256",
    "privateEligibilityEvidence",
    "finalizedBlockNumber",
    "finalizedBlockHash",
  ]) assert.match(syntheticAdoptionIntegrationSql, new RegExp(evidence, "u"));
  for (const effect of [
    "submittedToCivicWorkflow",
    "civicCaseCreated",
    "administrativeEndorsement",
    "bindingVote",
    "councilDecision",
    "treasuryEffect",
    "paymentEffect",
  ]) {
    assert.match(
      syntheticAdoptionIntegrationSql,
      new RegExp(`'${effect}'[\\s\\S]{0,100}?'false'`, "u")
    );
  }
});

test("database credentials are injected into the authenticator role", () => {
  assert.match(harness, /--username supabase_admin/u);
  assert.doesNotMatch(harness, /psql[^\n]*--username postgres/u);
  assert.match(
    secretProvisioningSql,
    /\\getenv authenticator_password AUTHENTICATOR_PASSWORD/u
  );
  assert.match(
    secretProvisioningSql,
    /alter role authenticator with login password :'authenticator_password'/iu
  );
  assert.doesNotMatch(
    secretProvisioningSql,
    /password\s+['"][^:'"]{20,}['"]/iu
  );
});

test("the fresh baseline removes inherited RPC grants before pinned migrations", () => {
  assert.match(
    baselineSql,
    /alter default privileges for role supabase_admin in schema public\s+revoke all on functions from postgres, anon, authenticated, service_role;/iu
  );
  assert.match(
    integrationSql,
    /defaclrole = \(\s*select oid from pg_catalog\.pg_roles where rolname = 'supabase_admin'\s*\)/iu
  );
  assert.match(integrationSql, /defaclobjtype = 'f'/iu);
  assert.match(integrationSql, /default public-function ACL normalization failed/iu);
  assert.match(integrationSql, /count\(\*\) = 8/iu);
  assert.match(integrationSql, /execute_acl_count = 2/iu);
  assert.match(
    integrationSql,
    /Topic RPC ACLs are not exactly owner and anon EXECUTE\./u
  );
  assert.match(integrationSql, /count\(\*\) = 9/iu);
  assert.match(
    integrationSql,
    /Citizen-adoption RPC ACLs are not exactly owner and anon EXECUTE\./u
  );
  for (const signature of [
    "issue_citizen_challenge\\(jsonb\\)",
    "consume_citizen_challenge\\(text,text,text,bigint\\)",
    "store_citizen_eligibility_receipt\\(text,jsonb,jsonb\\)",
    "get_citizen_eligibility_receipt\\(text\\)",
    "get_citizen_suggestion_root\\(text,text\\)",
    "resolve_citizen_adoption_replay\\(text,uuid,text,text,text\\)",
    "accept_citizen_adoption\\(text,uuid,text,text,bigint,integer,jsonb,jsonb,jsonb\\)",
    "read_public_citizen_adoption\\(text,text,text\\)",
    "citizen_adoption_preflight\\(\\)",
  ]) assert.match(integrationSql, new RegExp(signature, "u"));
});
