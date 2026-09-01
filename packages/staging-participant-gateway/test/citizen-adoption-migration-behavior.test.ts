import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migrationUrl = new URL(
  "../../../supabase/migrations/20260901_staging_citizen_adoption.sql",
  import.meta.url,
);

test("the durable challenge is session-bound, atomic, one-use, and private", () => {
  const migration = readFileSync(migrationUrl, "utf8");
  assert.match(migration, /^begin;/mu);
  assert.match(migration, /staging_participant_citizen_eligibility_challenges/u);
  assert.match(migration, /primary key \(challenge_id\)/u);
  assert.match(migration, /session_binding_sha256 bytea not null/u);
  assert.match(migration, /alter table[\s\S]+enable row level security/u);
  assert.match(migration, /pg_advisory_xact_lock/u);
  assert.match(migration, /select \* into v_challenge[\s\S]+for update/u);
  assert.match(migration, /consumed_at = p_consumed_at/u);
  for (const failure of ["MISSING", "USED", "EXPIRED", "MISMATCH"]) {
    assert.match(
      migration,
      new RegExp(`STAGING_PARTICIPANT_CITIZEN_CHALLENGE_${failure}`, "u"),
    );
  }
  assert.doesNotMatch(migration, /create\s+policy/iu);
});

test("eligibility receipts retain finalized evidence privately and resolve only the public envelope", () => {
  const migration = readFileSync(migrationUrl, "utf8");
  assert.match(migration, /staging_participant_citizen_eligibility_receipts/u);
  assert.match(migration, /public_receipt jsonb not null/u);
  assert.match(migration, /private_eligibility_evidence jsonb not null/u);
  assert.match(migration, /challenge_id text not null unique/u);
  assert.match(migration, /challenge\.consumed_at is null/u);
  assert.match(
    migration,
    /p_private_eligibility_evidence->'active' is distinct from 'true'::jsonb/u,
  );
  assert.match(
    migration,
    /p_private_eligibility_evidence->'chainId' is distinct from '100'::jsonb/u,
  );
  assert.match(
    migration,
    /0x59aa26f499d7c2b3ec2c8524ed06f54fc4e85de5/u,
  );
  assert.match(migration, /finalizedBlockNumber/u);
  assert.match(migration, /finalizedBlockHash/u);
  assert.match(migration, /return v_receipt\.public_receipt/u);
  assert.doesNotMatch(
    migration,
    /jsonb_build_object\([^;]*private_eligibility_evidence/iu,
  );
});

test("the adoption ledger uses the exact tuple and preserves original advisory projection", () => {
  const migration = readFileSync(migrationUrl, "utf8");
  assert.match(migration, /staging_participant_gateway_get_citizen_suggestion_root/u);
  assert.match(migration, /suggestion\.state = 'published'/u);
  assert.match(migration, /staging_participant_citizen_adoptions/u);
  assert.match(
    migration,
    /primary key \(municipality_id, participant_suggestion_id, adopter_pubkey\)/u,
  );
  assert.match(migration, /request_id uuid not null unique/u);
  assert.match(migration, /idempotency_key_sha256 bytea not null unique/u);
  assert.match(migration, /adoption_event_id text not null unique/u);
  assert.match(
    migration,
    /pg_advisory_xact_lock\([\s\S]{0,600}?p_municipality_id/u,
  );
  for (const conflict of ["TUPLE", "REQUEST", "IDEMPOTENCY", "EVENT"]) {
    assert.match(
      migration,
      new RegExp(`STAGING_PARTICIPANT_CITIZEN_ADOPTION_${conflict}_CONFLICT`, "u"),
    );
  }
  for (const effect of [
    "submittedToCivicWorkflow",
    "administrativeEndorsement",
    "bindingVote",
    "councilDecision",
    "treasuryEffect",
    "paymentEffect",
  ]) assert.match(migration, new RegExp(`'${effect}',\\s*false`, "u"));
  assert.match(migration, /return v_adoption\.public_projection/u);
});

test("closed JSON envelopes use PostgreSQL 15-safe exact key-set guards", () => {
  const migration = readFileSync(migrationUrl, "utf8");
  assert.doesNotMatch(migration, /jsonb_object_length/u);
  assert.equal(
    migration.match(/pg_catalog\.jsonb_object_keys\(/gu)?.length,
    10,
  );
  assert.equal(migration.match(/\?&\s+array\[/gu)?.length, 10);
});

test("closed inputs fail closed on SQL NULL and JSON null", () => {
  const migration = readFileSync(migrationUrl, "utf8");
  assert.equal(migration.match(/pg_catalog\.jsonb_each\(/gu)?.length, 10);
  assert.match(
    migration,
    /p_challenge->'schemaVersion'\s+is distinct from/u,
  );
  assert.match(
    migration,
    /v_challenge_id is null\s+or v_challenge_id !~/u,
  );
  assert.match(migration, /v_issued_at is null\s+or v_expires_at is null/u);
  assert.match(migration, /v_wallet is null\s+or v_wallet !~/u);
  assert.match(
    migration,
    /v_session_binding is null\s+or v_session_binding !~/u,
  );
  assert.match(
    migration,
    /p_private_eligibility_evidence->'active'\s+is distinct from\s+'true'::jsonb/u,
  );
  assert.match(
    migration,
    /p_adoption->'submittedToCivicWorkflow'\s+is distinct from\s+'false'::jsonb/u,
  );
  assert.match(
    migration,
    /p_acceptance_receipt->>'eventCreatedAt' is null/u,
  );
});
