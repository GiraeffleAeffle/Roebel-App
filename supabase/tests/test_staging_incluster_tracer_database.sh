#!/usr/bin/env bash
# Keep this schema-local: scripts/ci changes intentionally fan out to every
# staging image, while this harness builds no application image.
set -euo pipefail

readonly POSTGRES_IMAGE="docker.io/supabase/postgres:15.8.1.085@sha256:af083ef64d0408c8f098ee6f5c364a59b26f36fbc0f3a334a62c5c1d57362e9b"
readonly POSTGREST_IMAGE="docker.io/postgrest/postgrest:v14.16@sha256:bea1c76a856fa39d1e542d25911cf95d02fe2bf971992d033044ff209f1504b8"
readonly TRACER_BASELINE="supabase/staging_incluster_tracer_baseline_v1.sql"
readonly TRACER_BASELINE_SHA256="f8f9745c1783043334ef24b3cde801d19a609867d12d0c23612bda7c5206ca5a"
readonly PARTICIPANT_MIGRATION="supabase/migrations/20260825_staging_participant_gateway.sql"
readonly PARTICIPANT_MIGRATION_SHA256="ad050047a71bf2cc82361c16169627dc0a0a66a7982db804b1612624f0f97eab"
readonly TOPIC_MIGRATION="supabase/migrations/20260825_staging_participant_topic_tracer.sql"
readonly TOPIC_MIGRATION_SHA256="739cbcb189e3b12913ebf28dae74c931eab3cfae514e476bea4071092aef242e"
readonly CITIZEN_ADOPTION_MIGRATION="supabase/migrations/20260901_staging_citizen_adoption.sql"
readonly CITIZEN_ADOPTION_MIGRATION_SHA256="35e12ecc7e54e76f8e12b17e828970bc2d3bd4393f14f58fe9604dd00d398a2d"
readonly CITIZEN_ADOPTION_SCHEMA_CONTRACT="supabase/staging-citizen-adoption-schema-contract-v1.json"
readonly CITIZEN_ADOPTION_SCHEMA_CONTRACT_SHA256="79fea3feb09029e6138c7675fa0b877c3367390bec012b07e052c55103de7c9c"
readonly SYNTHETIC_ADOPTION_MIGRATION="supabase/migrations/20260902_staging_synthetic_citizen_adoption.sql"
readonly SYNTHETIC_ADOPTION_MIGRATION_SHA256="992e56a65af74b32e35d2211ac57714f32e2e72e4fb82ea59afeb7dbbcefb282"
readonly SYNTHETIC_ADOPTION_SCHEMA_CONTRACT="supabase/staging-synthetic-citizen-adoption-schema-contract-v1.json"
readonly SYNTHETIC_ADOPTION_SCHEMA_CONTRACT_SHA256="bcaa0b098a99b145e5111c17e29e5e7d9e9eb0840ee27643b3c26db34118bd66"
readonly PARTICIPANT_PREFLIGHT_RPC_PATH="/rpc/staging_participant_gateway_preflight"
readonly TOPIC_PREFLIGHT_RPC_PATH="/rpc/staging_participant_gateway_topic_tracer_preflight"
readonly CITIZEN_ADOPTION_PREFLIGHT_RPC_PATH="/rpc/staging_participant_gateway_citizen_adoption_preflight"
readonly SYNTHETIC_ADOPTION_PREFLIGHT_RPC_PATH="/rpc/staging_participant_gateway_synthetic_adoption_preflight"
readonly CREATE_POST_RPC_PATH="/rpc/staging_participant_gateway_create_main_text_post"
readonly CREATE_COMMENT_RPC_PATH="/rpc/staging_participant_gateway_create_main_text_comment"
readonly READ_POST_RPC_PATH="/rpc/staging_participant_gateway_read_owned_main_text_post"

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

sha256_file() {
  local file="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
  else
    shasum -a 256 "$file" | awk '{print $1}'
  fi
}

require_sha256() {
  local file="$1"
  local expected="$2"
  local actual
  actual="$(sha256_file "$file")"
  if [[ "$actual" != "$expected" ]]; then
    printf 'Checksum mismatch for %s: expected %s, got %s\n' \
      "$file" "$expected" "$actual" >&2
    exit 1
  fi
}

require_sha256 "$TRACER_BASELINE" "$TRACER_BASELINE_SHA256"
require_sha256 "$PARTICIPANT_MIGRATION" "$PARTICIPANT_MIGRATION_SHA256"
require_sha256 "$TOPIC_MIGRATION" "$TOPIC_MIGRATION_SHA256"
require_sha256 "$CITIZEN_ADOPTION_MIGRATION" "$CITIZEN_ADOPTION_MIGRATION_SHA256"
require_sha256 "$CITIZEN_ADOPTION_SCHEMA_CONTRACT" "$CITIZEN_ADOPTION_SCHEMA_CONTRACT_SHA256"
require_sha256 "$SYNTHETIC_ADOPTION_MIGRATION" "$SYNTHETIC_ADOPTION_MIGRATION_SHA256"
require_sha256 "$SYNTHETIC_ADOPTION_SCHEMA_CONTRACT" "$SYNTHETIC_ADOPTION_SCHEMA_CONTRACT_SHA256"

run_identity="${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-0}-$$"
safe_run_identity="${run_identity//[^a-zA-Z0-9_.-]/-}"
database_container_name="roebel-tracer-db-$safe_run_identity"
postgrest_container_name="roebel-tracer-rest-$safe_run_identity"
network_name="roebel-tracer-net-$safe_run_identity"
database_password="$(openssl rand -hex 32)"
authenticator_password="$(openssl rand -hex 32)"
participant_rpc_secret="$(openssl rand -hex 48)"
jwt_signing_secret="$(openssl rand -hex 48)"
anon_jwt="$(
  TRACER_JWT_SIGNING_SECRET="$jwt_signing_secret" node -e '
    const { createHmac } = require("node:crypto");
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const header = encode({ alg: "HS256", typ: "JWT" });
    const payload = encode({ role: "anon", exp: Math.floor(Date.now() / 1000) + 900 });
    const unsigned = `${header}.${payload}`;
    const signature = createHmac("sha256", process.env.TRACER_JWT_SIGNING_SECRET)
      .update(unsigned)
      .digest("base64url");
    process.stdout.write(`${unsigned}.${signature}`);
  '
)"

cleanup() {
  docker rm --force "$postgrest_container_name" >/dev/null 2>&1 || true
  docker rm --force "$database_container_name" >/dev/null 2>&1 || true
  docker network rm "$network_name" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker network create --driver bridge --internal "$network_name" >/dev/null

docker run \
  --detach \
  --pull=always \
  --name "$database_container_name" \
  --network "$network_name" \
  --network-alias database \
  --tmpfs /var/lib/postgresql/data:rw,nosuid,nodev,size=2g \
  --env POSTGRES_DB=postgres \
  --env POSTGRES_PASSWORD="$database_password" \
  "$POSTGRES_IMAGE" >/dev/null

database_ready=false
for _ in $(seq 1 90); do
  if docker exec "$database_container_name" \
    pg_isready --quiet --username supabase_admin --dbname postgres; then
    database_ready=true
    break
  fi
  sleep 2
done

if [[ "$database_ready" != true ]]; then
  printf 'Pinned tracer PostgreSQL did not become ready.\n' >&2
  docker logs --tail 200 "$database_container_name" >&2
  exit 1
fi

run_psql_file() {
  local sql_file="$1"
  docker exec --interactive --env PGPASSWORD="$database_password" \
    "$database_container_name" \
    psql --no-psqlrc --quiet --set ON_ERROR_STOP=1 \
      --host 127.0.0.1 --username supabase_admin --dbname postgres < "$sql_file"
}

run_participant_migration_file() {
  local sql_file="$1"
  docker exec --interactive \
    --env PGPASSWORD="$database_password" \
    --env PGOPTIONS='-c search_path=pg_catalog,public,staging_participant_private' \
    "$database_container_name" \
    psql --no-psqlrc --quiet --set ON_ERROR_STOP=1 \
      --host 127.0.0.1 --username supabase_admin --dbname postgres < "$sql_file"
}

run_psql_file "$TRACER_BASELINE"

docker exec --interactive \
  --env PGPASSWORD="$database_password" \
  --env AUTHENTICATOR_PASSWORD="$authenticator_password" \
  --env PARTICIPANT_ENVIRONMENT_ARM=staging-only \
  --env PARTICIPANT_RPC_SECRET="$participant_rpc_secret" \
  "$database_container_name" \
  psql --no-psqlrc --quiet --set ON_ERROR_STOP=1 \
    --host 127.0.0.1 --username supabase_admin --dbname postgres \
  < supabase/tests/staging_incluster_tracer_provision_secrets.sql

run_participant_migration_file "$PARTICIPANT_MIGRATION"
run_participant_migration_file "$TOPIC_MIGRATION"
run_participant_migration_file "$CITIZEN_ADOPTION_MIGRATION"
run_participant_migration_file "$SYNTHETIC_ADOPTION_MIGRATION"

docker exec --interactive \
  --env PGPASSWORD="$database_password" \
  --env PARTICIPANT_RPC_SECRET="$participant_rpc_secret" \
  "$database_container_name" \
  psql --no-psqlrc --quiet --set ON_ERROR_STOP=1 \
    --set citizen_adoption_schema_sha256="sha256:$CITIZEN_ADOPTION_SCHEMA_CONTRACT_SHA256" \
    --host 127.0.0.1 --username supabase_admin --dbname postgres \
  < supabase/tests/staging_incluster_tracer_integration.sql

docker exec --interactive \
  --env PGPASSWORD="$database_password" \
  --env PARTICIPANT_RPC_SECRET="$participant_rpc_secret" \
  "$database_container_name" \
  psql --no-psqlrc --quiet --set ON_ERROR_STOP=1 \
    --host 127.0.0.1 --username supabase_admin --dbname postgres \
  < supabase/tests/staging_incluster_tracer_citizen_adoption_integration.sql

docker exec --interactive \
  --env PGPASSWORD="$database_password" \
  --env PARTICIPANT_RPC_SECRET="$participant_rpc_secret" \
  "$database_container_name" \
  psql --no-psqlrc --quiet --set ON_ERROR_STOP=1 \
    --host 127.0.0.1 --username supabase_admin --dbname postgres \
  < supabase/tests/staging_incluster_tracer_synthetic_citizen_adoption_integration.sql

database_uri="postgres://authenticator:${authenticator_password}@database:5432/postgres"
docker run \
  --detach \
  --pull=always \
  --name "$postgrest_container_name" \
  --network "$network_name" \
  --network-alias postgrest \
  --env PGRST_DB_URI="$database_uri" \
  --env PGRST_DB_SCHEMAS=public \
  --env PGRST_DB_ANON_ROLE=anon \
  --env PGRST_JWT_SECRET="$jwt_signing_secret" \
  --env PGRST_LOG_LEVEL=warn \
  --env PGRST_SERVER_PORT=3000 \
  "$POSTGREST_IMAGE" >/dev/null

postgrest_ip="$(
  docker inspect --format \
    "{{with index .NetworkSettings.Networks \"$network_name\"}}{{.IPAddress}}{{end}}" \
    "$postgrest_container_name"
)"
if [[ ! "$postgrest_ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  printf 'PostgREST did not receive an isolated-network address.\n' >&2
  exit 1
fi
postgrest_port_bindings="$(
  docker inspect --format '{{json .HostConfig.PortBindings}}' \
    "$postgrest_container_name"
)"
if [[ "$postgrest_port_bindings" != "{}" && "$postgrest_port_bindings" != "null" ]]; then
  printf 'PostgREST unexpectedly received a host-published port.\n' >&2
  exit 1
fi
postgrest_origin="http://postgrest:3000"

rpc_request() {
  local rpc_path="$1"
  local request_body="$2"
  docker exec "$database_container_name" \
    curl --silent --show-error --fail --noproxy '*' \
    --request POST \
    --header "Authorization: Bearer $anon_jwt" \
    --header 'Content-Type: application/json' \
    --header "x-staging-participant-rpc-secret: $participant_rpc_secret" \
    --data "$request_body" \
    "$postgrest_origin$rpc_path"
}

rpc_status() {
  local rpc_path="$1"
  local request_body="$2"
  local status
  status="$(
    docker exec "$database_container_name" \
      curl --silent --show-error --noproxy '*' \
        --output /dev/null \
        --write-out '%{http_code}' \
        --request POST \
        --header "Authorization: Bearer $anon_jwt" \
        --header 'Content-Type: application/json' \
        --header "x-staging-participant-rpc-secret: $participant_rpc_secret" \
        --data "$request_body" \
        "$postgrest_origin$rpc_path" \
      2>/dev/null
  )" || true
  if [[ ! "$status" =~ ^[0-9]{3}$ ]]; then
    status=000
  fi
  printf '%s' "$status"
}

if ! docker exec "$database_container_name" curl --version >/dev/null; then
  printf 'Pinned PostgreSQL client container does not provide curl.\n' >&2
  exit 1
fi
if ! docker exec "$database_container_name" getent hosts postgrest >/dev/null; then
  printf 'Pinned PostgreSQL client container cannot resolve PostgREST.\n' >&2
  exit 1
fi

postgrest_ready=false
postgrest_probe_status=000
for _ in $(seq 1 60); do
  postgrest_probe_status="$(
    rpc_status "$PARTICIPANT_PREFLIGHT_RPC_PATH" '{}'
  )"
  if [[ "$postgrest_probe_status" == 200 ]]; then
    postgrest_ready=true
    break
  fi
  if [[ "$postgrest_probe_status" != 000 \
    && "$postgrest_probe_status" != 503 ]]; then
    break
  fi
  sleep 1
done
if [[ "$postgrest_ready" != true ]]; then
  postgrest_state="$(
    docker inspect --format '{{.State.Status}} (exit {{.State.ExitCode}})' \
      "$postgrest_container_name"
  )"
  printf 'Pinned PostgREST did not become ready: %s; HTTP %s.\n' \
    "$postgrest_state" "$postgrest_probe_status" >&2
  postgrest_logs="$(
    docker logs --tail 100 "$postgrest_container_name" 2>&1 || true
  )"
  if [[ "$postgrest_logs" == *"$database_password"* \
    || "$postgrest_logs" == *"$authenticator_password"* \
    || "$postgrest_logs" == *"$participant_rpc_secret"* \
    || "$postgrest_logs" == *"$jwt_signing_secret"* \
    || "$postgrest_logs" == *"$anon_jwt"* ]]; then
    printf 'PostgREST diagnostics withheld because they contained an ephemeral credential.\n' >&2
  else
    printf '%s\n' "$postgrest_logs" >&2
  fi
  exit 1
fi

participant_preflight_response="$(
  rpc_request "$PARTICIPANT_PREFLIGHT_RPC_PATH" '{}'
)"
if ! printf '%s' "$participant_preflight_response" | jq --exit-status \
  '.migration_id == "20260825_staging_participant_gateway"
   and .database_schema_sha256 ==
     "sha256:a540591c718d4b2c74f56fe7310baf5b522ac6541384223a5263079e207f3d5d"' \
  >/dev/null; then
  printf 'Participant preflight failed over HTTP.\n' >&2
  exit 1
fi

topic_preflight_response="$(
  rpc_request "$TOPIC_PREFLIGHT_RPC_PATH" '{}'
)"
if ! printf '%s' "$topic_preflight_response" | jq --exit-status \
  '.migration_id == "20260825_staging_participant_topic_tracer"
   and .database_schema_sha256 ==
     "sha256:298ef4a02f5f299afd157210a1074f179b08478c683bad3ed36430eb013854eb"' \
  >/dev/null; then
  printf 'Topic tracer preflight failed over HTTP.\n' >&2
  exit 1
fi

citizen_adoption_preflight_response="$(
  rpc_request "$CITIZEN_ADOPTION_PREFLIGHT_RPC_PATH" '{}'
)"
if ! printf '%s' "$citizen_adoption_preflight_response" | jq --exit-status \
  --arg schema_sha256 "sha256:$CITIZEN_ADOPTION_SCHEMA_CONTRACT_SHA256" \
  '.migration_id == "20260901_staging_citizen_adoption"
   and .database_schema_sha256 == $schema_sha256' \
  >/dev/null; then
  printf 'Citizen-adoption preflight failed over HTTP.\n' >&2
  exit 1
fi

synthetic_adoption_preflight_response="$(
  rpc_request "$SYNTHETIC_ADOPTION_PREFLIGHT_RPC_PATH" '{}'
)"
if ! printf '%s' "$synthetic_adoption_preflight_response" | jq --exit-status \
  --arg schema_sha256 "sha256:$SYNTHETIC_ADOPTION_SCHEMA_CONTRACT_SHA256" \
  '.migration_id == "20260902_staging_synthetic_citizen_adoption"
   and .database_schema_sha256 == $schema_sha256' \
  >/dev/null; then
  printf 'Synthetic citizen-adoption preflight failed over HTTP.\n' >&2
  exit 1
fi

participant_wallet='0x1111111111111111111111111111111111111111'
post_request_id='11111111-1111-4111-8111-111111111111'
comment_request_id='22222222-2222-4222-8222-222222222222'
post_content='@Mecky, welche belegten Hinweise gibt es zum Radweg?'
comment_content='@Mecky, bitte antworte mit sichtbaren Quellen.'

post_request_body="$(
  jq --null-input --compact-output \
    --arg wallet "$participant_wallet" \
    --arg content "$post_content" \
    --arg request_id "$post_request_id" \
    '{
      p_wallet_address: $wallet,
      p_content: $content,
      p_request_id: $request_id
    }'
)"
post_response="$(rpc_request "$CREATE_POST_RPC_PATH" "$post_request_body")"
if ! printf '%s' "$post_response" | jq --exit-status \
  --arg wallet "$participant_wallet" \
  --arg content "$post_content" \
  '.wallet_address == $wallet
   and .content == $content
   and .feed_type == "main"
   and .post_type == "user"
   and .category == "generell"
   and .status == "published"' >/dev/null; then
  printf 'Ordinary post RPC failed over HTTP.\n' >&2
  exit 1
fi
post_id="$(printf '%s' "$post_response" | jq --exit-status --raw-output '.id')"

replayed_post_response="$(
  rpc_request "$CREATE_POST_RPC_PATH" "$post_request_body"
)"
if ! printf '%s' "$replayed_post_response" | jq --exit-status \
  --arg post_id "$post_id" '.id == $post_id' >/dev/null; then
  printf 'Ordinary post RPC was not idempotent over HTTP.\n' >&2
  exit 1
fi

comment_request_body="$(
  jq --null-input --compact-output \
    --arg wallet "$participant_wallet" \
    --arg post_id "$post_id" \
    --arg content "$comment_content" \
    --arg request_id "$comment_request_id" \
    '{
      p_wallet_address: $wallet,
      p_post_id: $post_id,
      p_content: $content,
      p_request_id: $request_id
    }'
)"
comment_response="$(
  rpc_request "$CREATE_COMMENT_RPC_PATH" "$comment_request_body"
)"
if ! printf '%s' "$comment_response" | jq --exit-status \
  --arg wallet "$participant_wallet" \
  --arg post_id "$post_id" \
  --arg content "$comment_content" \
  '.wallet_address == $wallet
   and .post_id == $post_id
   and .content == $content
   and .status == "published"' >/dev/null; then
  printf 'Ordinary comment RPC failed over HTTP.\n' >&2
  exit 1
fi

read_post_request_body="$(
  jq --null-input --compact-output \
    --arg wallet "$participant_wallet" \
    --arg post_id "$post_id" \
    '{p_wallet_address: $wallet, p_post_id: $post_id}'
)"
read_post_response="$(
  rpc_request "$READ_POST_RPC_PATH" "$read_post_request_body"
)"
if ! printf '%s' "$read_post_response" | jq --exit-status \
  --arg post_id "$post_id" \
  '.id == $post_id and .comments_count == 1' >/dev/null; then
  printf 'Owned-post RPC did not expose the published reply over HTTP.\n' >&2
  exit 1
fi

feed_response="$(
  docker exec "$database_container_name" \
    curl --silent --show-error --fail --noproxy '*' \
    --header "Authorization: Bearer $anon_jwt" \
    "$postgrest_origin/posts?select=id,wallet_address,content,feed_type,post_type,status&feed_type=eq.main&status=eq.published"
)"
if ! printf '%s' "$feed_response" | jq --exit-status \
  --arg post_id "$post_id" \
  --arg content "$post_content" \
  'length == 7
   and (map(.wallet_address) | unique | length) == 5
   and any(
     .id == $post_id
     and .content == $content
     and .feed_type == "main"
     and .post_type == "user"
     and .status == "published"
   )' >/dev/null; then
  printf 'HTTP read did not return the expected mixed ordinary feed.\n' >&2
  exit 1
fi

printf 'Pinned tracer database integration passed.\n'
