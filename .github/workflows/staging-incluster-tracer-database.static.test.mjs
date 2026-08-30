import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  assert.match(harness, /--pull=always/u);
  assert.match(harness, /trap cleanup EXIT/u);
  assert.match(
    harness,
    /PGOPTIONS='-c search_path=pg_catalog,public,staging_participant_private'/u
  );
  assert.equal(
    (harness.match(/run_participant_migration_file "\$(?:PARTICIPANT|TOPIC)_MIGRATION"/gu) ?? [])
      .length,
    2
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

test("the HTTP test traverses both preflights and ordinary write RPCs", () => {
  for (const rpc of [
    "staging_participant_gateway_preflight",
    "staging_participant_gateway_topic_tracer_preflight",
    "staging_participant_gateway_create_main_text_post",
    "staging_participant_gateway_create_main_text_comment",
  ]) {
    assert.match(harness, new RegExp(`/rpc/${rpc}`, "u"));
  }
  assert.match(harness, /Authorization: Bearer/u);
  assert.match(harness, /@Mecky/u);
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
});
