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

test("migration exposes exactly two Vault-checked anon RPCs without a service/custom writer role", () => {
  assert.match(migration, /vault\.decrypted_secrets/u);
  assert.match(migration, /roebel_staging_participant_environment_arm/u);
  assert.match(migration, /x-staging-participant-rpc-secret/u);
  assert.match(
    migration,
    /grant execute on function public\.staging_participant_gateway_create_main_text_post[\s\S]*to anon;/u,
  );
  assert.match(
    migration,
    /grant execute on function public\.staging_participant_gateway_create_main_text_comment[\s\S]*to anon;/u,
  );
  assert.doesNotMatch(migration, /create role staging_participant_writer/iu);
  assert.doesNotMatch(migration, /is_staging_test_participant/iu);
  assert.doesNotMatch(adapter, /service_role|writerToken|staging_participant_writer/u);
  assert.match(adapter, /authorization: `Bearer \$\{config\.anonKey\}`/u);
  assert.match(adapter, /"x-staging-participant-rpc-secret": config\.rpcSecret/u);
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
  assert.match(deactivation, /grant %s on function %s/u);
  assert.match(deactivation, /revoke all on function public\.pin_own_post/u);
  assert.doesNotMatch(deactivation, /drop schema|delete from public\.(posts|post_comments)/iu);
});
