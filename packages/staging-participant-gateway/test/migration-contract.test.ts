import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(
  new URL(
    "../../../supabase/migrations/20260825_staging_participant_gateway.sql",
    import.meta.url,
  ),
  "utf8",
);
const adapter = readFileSync(
  new URL("../src/supabase-adapter.ts", import.meta.url),
  "utf8",
);
const deactivation = readFileSync(
  new URL("../../../supabase/staging_participant_gateway_deactivate.sql", import.meta.url),
  "utf8",
);

test("migration exposes only two writes, one exact source read, and two durable mirror receipt RPCs", () => {
  assert.match(migration, /vault\.decrypted_secrets/u);
  assert.match(migration, /roebel_staging_participant_environment_arm/u);
  assert.match(migration, /x-staging-participant-rpc-secret/u);
  assert.match(
    migration,
    /grant execute on function public\.staging_participant_gateway_create_main_text_post[\s\S]*to anon;/u,
  );
  assert.match(
    migration,
    /grant execute on function public\.staging_participant_gateway_read_owned_main_text_post[\s\S]*to anon;/u,
  );
  assert.match(
    migration,
    /grant execute on function public\.staging_participant_gateway_create_main_text_comment[\s\S]*to anon;/u,
  );
  assert.match(
    migration,
    /grant execute on function public\.staging_participant_gateway_reserve_nostr_post_mirror[\s\S]*to anon;/u,
  );
  assert.match(
    migration,
    /grant execute on function public\.staging_participant_gateway_complete_nostr_post_mirror[\s\S]*to anon;/u,
  );
  assert.doesNotMatch(migration, /create role staging_participant_writer/iu);
  assert.doesNotMatch(migration, /is_staging_test_participant/iu);
  assert.doesNotMatch(adapter, /service_role|writerToken|staging_participant_writer/u);
  assert.match(adapter, /authorization: `Bearer \$\{config\.anonKey\}`/u);
  assert.match(adapter, /"x-staging-participant-rpc-secret": config\.rpcSecret/u);
});

test("mirror receipt is durable, source-bound, and cannot authorize replacement after a crash", () => {
  assert.match(migration, /staging_participant_nostr_post_mirror_receipts/u);
  assert.match(migration, /primary key \(wallet_address, source_post_id\)/u);
  assert.match(migration, /request_id uuid not null unique/u);
  assert.match(migration, /event_created_at bigint not null/u);
  assert.match(migration, /p_event_created_at bigint/u);
  assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\(v_wallet \|\| ':' \|\| p_source_post_id::text/u);
  assert.match(migration, /STAGING_PARTICIPANT_MIRROR_SOURCE_REUSED/u);
  assert.match(migration, /STAGING_PARTICIPANT_MIRROR_REQUEST_REUSED/u);
  assert.match(migration, /extensions\.digest\(p\.content, 'sha256'\) = v_content_sha/u);
  assert.match(migration, /state = 'published', published_at = now\(\)/u);
  assert.match(adapter, /reserveNostrPostMirror/u);
  assert.match(adapter, /completeNostrPostMirror/u);
  assert.match(adapter, /staging_participant_mirror_conflict/u);
  assert.match(adapter, /p_event_created_at/u);
  assert.match(adapter, /value\.event_created_at !== expected\.eventCreatedAt/u);
  assert.match(migration, /STAGING_PARTICIPANT_MIRROR_EVENT_STALE/u);
  assert.match(migration, /'event_created_at', v_receipt\.event_created_at/u);
});

test("the source read can return only an exact participant-created ordinary post", () => {
  assert.match(migration, /staging_participant_gateway_read_owned_main_text_post/u);
  assert.match(migration, /a\.action = 'post'/u);
  assert.match(migration, /lower\(p\.wallet_address\) = v_wallet/u);
  assert.match(migration, /p\.feed_type = 'main'/u);
  assert.doesNotMatch(migration, /staging_participant_gateway_read_owned_main_text_post[\s\S]{0,1800}\b(proposals|civic_cases|votes|treasury)\b/iu);
});

test("post bypass needs a secret-derived, one-time exact-shape reservation", () => {
  assert.match(migration, /staging_participant_write_reservations/u);
  assert.match(migration, /hmac\(/u);
  assert.match(migration, /consumed_at is not null/u);
  assert.match(migration, /private\.consume_staging_post_reservation\(new\)/u);
  assert.match(migration, /p_post\.feed_type is distinct from 'main'/u);
  assert.match(migration, /p_post\.account_id is not null/u);
  assert.match(migration, /coalesce\(cardinality\(p_post\.media_urls\), 0\) <> 0/u);
});

test("RPCs retain staging, revocation, idempotency and authority exclusions", () => {
  assert.match(migration, /roebel_env/u);
  assert.match(migration, /staging_participant_private\.staging_participant_environment/u);
  assert.match(migration, /revoked_at is not null/u);
  assert.match(migration, /request_id uuid primary key/u);
  assert.match(migration, /STAGING_PARTICIPANT_REQUEST_REUSED/u);
  assert.doesNotMatch(migration, /\b(proposals|civic_cases|votes|treasury)\b/iu);
});

test("staging closes direct feed writes and relies on the exact preflighted comment trigger", () => {
  assert.match(
    migration,
    /revoke insert, update, delete on table public\.posts[\s\S]*from public, anon, authenticated;/u,
  );
  assert.match(migration, /staging_participant_prior_privileges[\s\S]*table_column/u);
  assert.match(migration, /revoke insert \(%I\), update \(%I\) on table/u);
  assert.match(migration, /has_column_privilege\('anon'/u);
  assert.match(migration, /STAGING_PARTICIPANT_DIRECT_COLUMN_WRITE_PRIVILEGE_REMAINS/u);
  assert.match(
    migration,
    /revoke insert, update, delete on table public\.post_comments[\s\S]*from public, anon, authenticated;/u,
  );
  assert.match(
    migration,
    /trg_post_comment_counts[\s\S]*t\.tgenabled in \('O', 'A'\)[\s\S]*t\.tgtype = 13[\s\S]*post_comment_counts_sync/u,
  );
  assert.doesNotMatch(
    migration,
    /update public\.posts[\s\S]*set comments_count = comments_count \+ 1/u,
  );
  assert.match(
    migration,
    /revoke insert, delete on table public\.post_likes[\s\S]*from public, anon, authenticated;/u,
  );
  assert.match(
    migration,
    /revoke all on function public\.pin_own_post\(uuid, text, boolean\)[\s\S]*from public, anon, authenticated;/u,
  );
});

test("first signed write provisions only a non-citizen guest prerequisite", () => {
  assert.match(
    migration,
    /insert into public\.users[\s\S]*p_wallet_address, 'guest', false, 'pending'/u,
  );
  assert.doesNotMatch(migration, /insert into public\.accounts|insert into public\.account_owners/iu);
});

test("activation captures and deactivation restores compatibility state without deleting evidence", () => {
  assert.match(migration, /staging_participant_prior_function_definitions/u);
  assert.match(migration, /staging_participant_prior_privileges/u);
  assert.match(deactivation, /execute v_definition/u);
  assert.match(deactivation, /grant %s on table %s/u);
  assert.match(deactivation, /grant %s \(%I\) on table %s/u);
  assert.match(deactivation, /grant %s on function %s/u);
  assert.match(deactivation, /revoke all on function public\.pin_own_post/u);
  assert.match(deactivation, /revoke all on function public\.staging_participant_gateway_read_owned_main_text_post/u);
  assert.match(deactivation, /revoke all on function public\.staging_participant_gateway_reserve_nostr_post_mirror/u);
  assert.doesNotMatch(deactivation, /drop schema|delete from public\.(posts|post_comments)/iu);
});

test("every private capability and audit table has RLS enabled with no public policy", () => {
  for (const table of [
    "staging_participant_environment",
    "staging_participant_admissions",
    "staging_participant_write_reservations",
    "staging_participant_write_audit",
    "staging_participant_nostr_post_mirror_receipts",
    "staging_participant_prior_function_definitions",
    "staging_participant_prior_privileges",
  ]) {
    assert.match(
      migration,
      new RegExp(
        `alter table staging_participant_private\\.${table}\\s+enable row level security`,
        "u",
      ),
    );
  }
  assert.doesNotMatch(migration, /create\s+policy/iu);
});
