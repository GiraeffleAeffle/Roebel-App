import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(
  new URL("../../../supabase/migrations/20260825_staging_participant_topic_tracer.sql", import.meta.url),
  "utf8",
);
const contract = JSON.parse(readFileSync(
  new URL("../../../supabase/staging-participant-topic-tracer-schema-contract-v1.json", import.meta.url),
  "utf8",
)) as {
  migrationId?: unknown;
  assertions?: {
    authority?: unknown;
    catalog?: {
      capturedDefinitionAndSourceDigests?: unknown;
      capturedOwnerLanguageReturnVolatilitySecuritySearchPath?: unknown;
      exactReviewedSearchPath?: unknown;
    };
    executeAcl?: {
      privateHelperDenied?: unknown;
      publicRpcAllowed?: unknown;
      publicRpcDenied?: unknown;
    };
    idempotency?: { concurrentClaimsUseAdvisoryLocks?: unknown };
    privateTableIsolation?: { noDirectAcl?: unknown; rowLevelSecurity?: unknown };
    publicRpc?: unknown;
  };
};
const workbench = readFileSync(
  new URL("../../e2e-workbench/src/server.ts", import.meta.url),
  "utf8",
);
const publisher = readFileSync(
  new URL("../../../.github/workflows/staging-participant-gateway-publish.yml", import.meta.url),
  "utf8",
);
const gatewayHttp = readFileSync(
  new URL("../src/http.ts", import.meta.url),
  "utf8",
);
const civicProtocol = readFileSync(
  new URL("../../nostr/src/civic.ts", import.meta.url),
  "utf8",
);

test("ADR-0022 adds a separate no-authority durable ledger without modifying the deployed gateway migration", () => {
  assert.equal(contract.migrationId, "20260825_staging_participant_topic_tracer");
  assert.equal(contract.assertions?.authority, "none");
  assert.equal(contract.assertions?.idempotency?.concurrentClaimsUseAdvisoryLocks, true);
  for (const rpc of [
    "staging_participant_gateway_reserve_source_post_promotion",
    "staging_participant_gateway_complete_source_post_promotion",
    "staging_participant_gateway_reserve_topic_suggestion",
    "staging_participant_gateway_complete_topic_suggestion",
    "staging_participant_gateway_bind_published_nostr_post_mirror",
    "staging_participant_gateway_resolve_published_nostr_post_mirror",
    "staging_participant_gateway_resolve_published_source_post_promotion",
    "staging_participant_gateway_topic_tracer_preflight",
  ]) {
    assert.match(migration, new RegExp(`create or replace function public\\.${rpc}`, "u"));
    assert.match(migration, new RegExp(`grant execute on function public\\.${rpc}`, "u"));
    assert.match(migration, new RegExp(`revoke all on function public\\.${rpc}[^\\n]+from public, anon, authenticated`, "u"));
  }
  assert.match(migration, /primary key \(namespace, source_post_id\)/u);
  assert.match(migration, /primary key \(namespace, discussion_root_id, source_author_pubkey\)/u);
  assert.match(migration, /STAGING_PARTICIPANT_PROMOTION_SOURCE_REUSED/u);
  assert.match(migration, /STAGING_PARTICIPANT_SUGGESTION_CLAIM_REUSED/u);
  assert.match(migration, /staging_participant_nostr_post_mirror_bindings/u);
  assert.match(migration, /staging_participant_topic_tracer_schema_contract/u);
  assert.match(migration, /staging_participant_topic_tracer_catalog_contract/u);
  assert.match(migration, /STAGING_PARTICIPANT_TOPIC_TRACER_CATALOG_DRIFT/u);
  // Promotion, suggestion, mirror binding, plus their completion paths are
  // independently serialized; a later migration must not silently remove one.
  assert.equal((migration.match(/pg_advisory_xact_lock/g) ?? []).length, 5);
  assert.doesNotMatch(migration, /\b(civic_cases|votes|treasury|case_steward|municipal_publication)\b/iu);
  assert.doesNotMatch(migration, /alter table public\./iu);
});

test("the workbench exposes only the four dedicated tracer provider paths, not a generic signed-event escape hatch", () => {
  for (const path of [
    "/api/staging-participant/topic-tracer/promotion-source",
    "/api/staging-participant/topic-tracer/promotions",
    "/api/staging-participant/topic-tracer/suggestion-source",
    "/api/staging-participant/topic-tracer/suggestions",
  ]) assert.match(workbench, new RegExp(`path === "${path.replaceAll("/", "\\/")}"`, "u"));
  assert.match(workbench, /verifyParticipantTopicSuggestion\(/u);
  assert.match(workbench, /verifyAppConversationExchange\(/u);
  assert.doesNotMatch(workbench, /topic-tracer[^\n]{0,240}api\/signed-event/u);
});

test("workbench selected-conversation projection uses the civic kernel field names", () => {
  assert.match(workbench, /type SelectedConversationSource = \{[\s\S]*?mentionEventId: string;[\s\S]*?replyEventId: string;/u);
  assert.match(workbench, /mentionId: selected\.mentionEventId,[\s\S]*?replyId: selected\.replyEventId,/u);
  assert.match(workbench, /selected\.mentionEventId !== sourceNote\.id/u);
  assert.match(workbench, /selected\.replyEventId !== exchange\.reply\.id/u);
});

test("the complete signed suggestion has one explicit route-specific byte budget", () => {
  assert.match(
    gatewayHttp,
    /TOPIC_SUGGESTION_MAX_REQUEST_BYTES\s*=\s*64\s*\*\s*1024/u,
  );
  assert.match(
    gatewayHttp,
    /maxRequestBytesForPath\(url\.pathname\)/u,
  );
  assert.match(
    gatewayHttp,
    /readJson\(request,\s*maxRequestBytesForPath\(url\.pathname\)\)/u,
  );
  assert.match(
    gatewayHttp,
    /readIncomingBody\(incoming,\s*maxRequestBytesForPath\(incomingPath\)\)/u,
  );
  assert.match(civicProtocol, /MAX_EVIDENCE_URL_CHARACTERS\s*=\s*2_048/u);
  assert.match(civicProtocol, /MAX_AGENT_TAG_CHARACTERS\s*=\s*120/u);
  assert.match(civicProtocol, /value\.length\s*>\s*MAX_EVIDENCE_URL_CHARACTERS/u);
  assert.match(civicProtocol, /agent\[1\]\.length\s*>\s*MAX_AGENT_TAG_CHARACTERS/u);
  assert.match(workbench, /\(tag\[2\]\s*\?\?\s*""\)\.length\s*>\s*2_048/u);
});

test("the versioned readiness marker pins the exact additive contract digest", () => {
  const digest = createHash("sha256").update(readFileSync(
    new URL("../../../supabase/staging-participant-topic-tracer-schema-contract-v1.json", import.meta.url),
  )).digest("hex");
  assert.match(migration, new RegExp(`'sha256:${digest}'`, "u"));
  assert.match(migration, /staging_participant_gateway_topic_tracer_preflight\(\)/u);
  assert.match(migration, /STAGING_PARTICIPANT_TOPIC_TRACER_(?:SCHEMA|RLS|CATALOG)_DRIFT/u);
});

test("tracer catalog preflight snapshots every reviewed search path without invalid extension joins", () => {
  assert.doesNotMatch(migration, /cross join extensions/u);
  assert.match(migration, /definition_sha256 text not null[\s\S]*?source_sha256 text not null[\s\S]*?configuration text not null/u);
  assert.match(migration, /coalesce\(array_to_string\(proc\.proconfig, E'\\n'\), ''\)/u);
  assert.match(migration, /coalesce\(array_to_string\(proc\.proconfig, E'\\n'\), ''\) <> contract\.configuration/u);
  assert.doesNotMatch(migration, /p\.proconfig @> array\['search_path=pg_catalog, public, staging_participant_private'\]/u);
  assert.match(migration, /set search_path = pg_catalog, public, staging_participant_private, extensions/u);
  assert.equal((contract.assertions as { catalog?: { exactReviewedSearchPath?: unknown } } | undefined)?.catalog?.exactReviewedSearchPath, true);
});

test("topic-tracer readiness fails closed over executable ACLs and every private table", () => {
  assert.deepEqual(contract.assertions?.executeAcl, {
    privateHelperDenied: ["PUBLIC", "anon", "authenticated"],
    publicRpcAllowed: ["anon"],
    publicRpcDenied: ["PUBLIC", "authenticated"],
  });
  assert.deepEqual(contract.assertions?.privateTableIsolation, {
    noDirectAcl: true,
    rowLevelSecurity: true,
  });
  assert.equal(contract.assertions?.catalog?.capturedDefinitionAndSourceDigests, true);
  assert.equal(
    contract.assertions?.catalog?.capturedOwnerLanguageReturnVolatilitySecuritySearchPath,
    true,
  );
  for (const column of [
    "owner_name text not null",
    "language_name text not null",
    "return_type text not null",
    "volatility \"char\" not null",
    "security_definer boolean not null",
    "definition_sha256 text not null",
    "source_sha256 text not null",
    "configuration text not null",
  ]) assert.match(migration, new RegExp(column.replaceAll(" ", "\\s+"), "u"));
  assert.match(migration, /pg_get_function_result\(proc\.oid\)[\s\S]*?proc\.provolatile[\s\S]*?proc\.prosecdef/u);
  assert.match(migration, /extensions\.digest\(proc\.prosrc, 'sha256'\)/u);
  assert.match(migration, /not has_function_privilege\('anon', to_regprocedure\(v_function\), 'EXECUTE'\)/u);
  assert.match(migration, /has_function_privilege\('authenticated', to_regprocedure\(v_function\), 'EXECUTE'\)/u);
  assert.match(migration, /STAGING_PARTICIPANT_TOPIC_TRACER_RPC_ACL_DRIFT/u);
  assert.match(migration, /staging_participant_private\.staging_participant_topic_receipt_checksum\(text\[\]\)/u);
  assert.match(migration, /STAGING_PARTICIPANT_TOPIC_TRACER_HELPER_ACL_DRIFT/u);
  for (const table of [
    "staging_participant_source_post_promotions",
    "staging_participant_topic_suggestions",
    "staging_participant_nostr_post_mirror_bindings",
    "staging_participant_topic_tracer_schema_contract",
    "staging_participant_topic_tracer_catalog_contract",
  ]) assert.match(migration, new RegExp(`'staging_participant_private\\.${table}'`, "u"));
  assert.match(migration, /acl\.grantee <> relation\.relowner/u);
  assert.match(migration, /STAGING_PARTICIPANT_TOPIC_TRACER_PRIVATE_TABLE_DRIFT/u);
});

test("gateway publisher carries the additive migration and both readiness pins through release evidence", () => {
  for (const required of [
    "supabase/migrations/20260825_staging_participant_topic_tracer.sql",
    "supabase/staging-participant-topic-tracer-schema-contract-v1.json",
    "topicTracerMigrationSha256",
    "topicTracerDatabaseSchemaSha256",
    "roebel_staging_participant_gateway_release_pins_v4",
    "roebel_staging_publication_receipt_v4",
  ]) assert.match(publisher, new RegExp(required.replaceAll(".", "\\."), "u"));
  assert.match(publisher, /test "\$\(jq -r \.topicTracerMigrationSha256 "\$RELEASE_PINS"\)" = "sha256:\$\(sha256sum source\/supabase\/migrations\/20260825_staging_participant_topic_tracer\.sql/u);
  assert.match(publisher, /test "\$\(jq -r \.topicTracerDatabaseSchemaSha256 "\$RELEASE_PINS"\)" = "sha256:\$\(sha256sum source\/supabase\/staging-participant-topic-tracer-schema-contract-v1\.json/u);
  assert.match(publisher, /verify-staging-service-oci\.mjs "\$LAYOUT" "\$SOURCE_REVISION" "\$COMPONENT" "\$SOURCE_RECEIPT" "\$RUNNER_TEMP\/staging-participant-gateway\.release-pins\.json"/u);
  assert.match(publisher, /verify-staging-service-oci\.mjs "\$LAYOUT" "\$SOURCE_REVISION" "\$COMPONENT" "\$SOURCE_RECEIPT\.reverified" "\$RELEASE_PINS"/u);
});
