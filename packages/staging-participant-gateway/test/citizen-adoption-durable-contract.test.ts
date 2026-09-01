import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const migrationUrl = new URL(
  "../../../supabase/migrations/20260901_staging_citizen_adoption.sql",
  import.meta.url,
);
const contractUrl = new URL(
  "../../../supabase/staging-citizen-adoption-schema-contract-v1.json",
  import.meta.url,
);
const migrationPath = fileURLToPath(migrationUrl);
const contractPath = fileURLToPath(contractUrl);
const migration = existsSync(migrationPath)
  ? readFileSync(migrationPath, "utf8")
  : "";
const contractBytes = existsSync(contractPath)
  ? readFileSync(contractPath, "utf8")
  : "";
const contract = contractBytes
  ? JSON.parse(contractBytes) as Record<string, unknown>
  : {};

const PUBLIC_RPCS = [
  "staging_participant_gateway_issue_citizen_challenge",
  "staging_participant_gateway_consume_citizen_challenge",
  "staging_participant_gateway_store_citizen_eligibility_receipt",
  "staging_participant_gateway_get_citizen_eligibility_receipt",
  "staging_participant_gateway_get_citizen_suggestion_root",
  "staging_participant_gateway_resolve_citizen_adoption_replay",
  "staging_participant_gateway_accept_citizen_adoption",
  "staging_participant_gateway_read_public_citizen_adoption",
  "staging_participant_gateway_citizen_adoption_preflight",
] as const;

test("the checksum-pinned citizen-adoption SQL and canonical contract both exist", () => {
  assert.equal(existsSync(migrationPath), true, migrationPath);
  assert.equal(existsSync(contractPath), true, contractPath);
  assert.equal(contractBytes, `${JSON.stringify(JSON.parse(contractBytes))}\n`);
  assert.equal(contract.migrationId, "20260901_staging_citizen_adoption");
  assert.equal(
    contract.schemaVersion,
    "roebel_staging_citizen_adoption_schema_contract_v1",
  );
});

test("the migration binds its readiness marker to the exact canonical contract bytes", () => {
  const contractSha256 = createHash("sha256").update(contractBytes).digest("hex");
  assert.match(migration, new RegExp(`sha256:${contractSha256}`, "u"));
  assert.match(migration, /staging_participant_citizen_adoption_schema_contract/u);
  assert.match(migration, /staging_participant_citizen_adoption_catalog_contract/u);
  assert.match(migration, /canonical_contract\s+text\s+not\s+null/iu);
  assert.match(migration, /STAGING_PARTICIPANT_CITIZEN_ADOPTION_(?:SCHEMA|CATALOG|RLS)_DRIFT/u);
});

test("all durable adoption state is private, RLS-closed, and never directly granted", () => {
  const tables = [
    "staging_participant_citizen_eligibility_challenges",
    "staging_participant_citizen_eligibility_receipts",
    "staging_participant_citizen_adoptions",
    "staging_participant_citizen_adoption_schema_contract",
    "staging_participant_citizen_adoption_catalog_contract",
  ];
  for (const table of tables) {
    assert.match(
      migration,
      new RegExp(`create table staging_participant_private\\.${table}`, "iu"),
    );
    assert.match(
      migration,
      new RegExp(
        `alter table staging_participant_private\\.${table}\\s+enable row level security`,
        "iu",
      ),
    );
    assert.match(
      migration,
      new RegExp(
        `revoke all on table staging_participant_private\\.${table} from public, anon, authenticated`,
        "iu",
      ),
    );
  }
  assert.doesNotMatch(migration, /create\s+policy/iu);
});

test("the RPC surface is fixed, secret-bound, and executable only by anon", () => {
  assert.match(migration, /vault\.decrypted_secrets/u);
  assert.match(migration, /x-staging-participant-rpc-secret/u);
  for (const rpc of PUBLIC_RPCS) {
    assert.match(
      migration,
      new RegExp(`create or replace function public\\.${rpc}\\(`, "iu"),
    );
    assert.match(
      migration,
      new RegExp(
        `revoke all on function public\\.${rpc}[\\s\\S]{0,800}?from public, anon, authenticated`,
        "iu",
      ),
    );
    assert.match(
      migration,
      new RegExp(
        `grant execute on function public\\.${rpc}[\\s\\S]{0,800}?to anon`,
        "iu",
      ),
    );
  }
  assert.match(migration, /has_function_privilege\('anon'/u);
  assert.match(migration, /has_function_privilege\('authenticated'/u);
  assert.match(migration, /pg_get_functiondef\(proc\.oid\)/u);
  assert.match(migration, /proc\.proconfig/u);
});

test("adoption writes serialize within the municipality and reject every conflicting replay", () => {
  assert.match(
    migration,
    /pg_advisory_xact_lock\([\s\S]{0,600}?p_municipality_id/u,
  );
  for (const code of [
    "STAGING_PARTICIPANT_CITIZEN_CHALLENGE_MISSING",
    "STAGING_PARTICIPANT_CITIZEN_CHALLENGE_USED",
    "STAGING_PARTICIPANT_CITIZEN_CHALLENGE_EXPIRED",
    "STAGING_PARTICIPANT_CITIZEN_CHALLENGE_MISMATCH",
    "STAGING_PARTICIPANT_CITIZEN_ADOPTION_TUPLE_CONFLICT",
    "STAGING_PARTICIPANT_CITIZEN_ADOPTION_REQUEST_CONFLICT",
    "STAGING_PARTICIPANT_CITIZEN_ADOPTION_IDEMPOTENCY_CONFLICT",
    "STAGING_PARTICIPANT_CITIZEN_ADOPTION_EVENT_CONFLICT",
  ]) {
    assert.match(migration, new RegExp(code, "u"));
  }
});

test("the only public projection is advisory and explicitly has no later civic effects", () => {
  assert.match(migration, /case_steward_review_required/u);
  assert.match(migration, /civic_eligibility_only/u);
  for (const effect of [
    "submittedToCivicWorkflow",
    "administrativeEndorsement",
    "bindingVote",
    "councilDecision",
    "treasuryEffect",
    "paymentEffect",
  ]) {
    assert.match(migration, new RegExp(`'${effect}',\\s*false`, "u"));
  }
  assert.doesNotMatch(
    migration,
    /(?:insert|update|delete)\s+(?:into\s+|from\s+)?public\.(?:civic_cases|votes|treasury|municipal_decisions)\b/iu,
  );
});

test("the contract advertises the same closed ACL, private tables, and no-effect boundary", () => {
  const canonical = JSON.stringify(contract);
  for (const rpc of PUBLIC_RPCS) assert.match(canonical, new RegExp(rpc, "u"));
  for (const value of [
    "staging_participant_citizen_eligibility_challenges",
    "staging_participant_citizen_eligibility_receipts",
    "staging_participant_citizen_adoptions",
    "case_steward_review_required",
    "civic_eligibility_only",
    "submittedToCivicWorkflow",
    "administrativeEndorsement",
    "bindingVote",
    "councilDecision",
    "treasuryEffect",
    "paymentEffect",
  ]) assert.match(canonical, new RegExp(value, "u"));
  assert.match(canonical, /"rowLevelSecurity":true/u);
  assert.match(canonical, /"noDirectAcl":true/u);
  assert.match(canonical, /"publicRpcAllowed":\["anon"\]/u);
  assert.match(canonical, /"publicRpcDenied":\["PUBLIC","authenticated"\]/u);
});
