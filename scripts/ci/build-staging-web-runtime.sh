#!/usr/bin/env bash

# Build the Röbel Web standalone output once in a pinned, offline container,
# then assemble the only context the runtime image is allowed to receive.

set -euo pipefail
umask 077

node_image='docker.io/library/node@sha256:7c269ea419bfbaef1f5eed57e58016395bbe3036176411025a5093e39a948dcf'

fail() {
  printf 'Röbel staging Web runtime build: %s\n' "$1" >&2
  exit 1
}

source_context="${SOURCE_CONTEXT:-}"
pnpm_store="${PNPM_STORE:-}"
corepack_cache="${COREPACK_CACHE:-}"
runtime_context="${RUNTIME_CONTEXT:-}"
source_revision="${SOURCE_REVISION:-}"
max_dependency_install_bytes="${MAX_DEPENDENCY_INSTALL_BYTES:-4294967296}"
max_runtime_context_bytes="${MAX_RUNTIME_CONTEXT_BYTES:-805306368}"

for path in "$source_context" "$pnpm_store" "$corepack_cache"; do
  [[ "$path" == /* && -d "$path" && ! -L "$path" ]] || fail "required absolute input directory differs: $path"
done
[[ "$runtime_context" == /* && ! -e "$runtime_context" && ! -L "$runtime_context" ]] || fail 'runtime context must be an absent absolute path'
[[ "$source_revision" =~ ^[0-9a-f]{40}$ ]] || fail 'source revision differs'
[[ "$max_dependency_install_bytes" =~ ^[1-9][0-9]*$ ]] || fail 'dependency-install budget differs'
[[ "$max_runtime_context_bytes" =~ ^[1-9][0-9]*$ ]] || fail 'runtime context budget differs'
[[ -f "$source_context/pnpm-lock.yaml" && ! -L "$source_context/pnpm-lock.yaml" ]] || fail 'pruned lockfile differs'
[[ -f "$source_context/apps/web/package.json" && ! -L "$source_context/apps/web/package.json" ]] || fail 'Web package manifest differs'
[[ ! -e "$source_context/node_modules" ]] || fail 'source context must begin without node_modules'

docker run --rm \
  --platform linux/amd64 \
  --user "$(id -u):$(id -g)" \
  --network none \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --mount "type=bind,src=$source_context,dst=/workspace" \
  --mount "type=bind,src=$pnpm_store,dst=/pnpm/store,readonly" \
  --mount "type=bind,src=$corepack_cache,dst=/corepack,readonly" \
  --workdir /workspace \
  --env HOME=/tmp \
  --env COREPACK_HOME=/corepack \
  --env NEXT_TELEMETRY_DISABLED=1 \
  --env ROEBEL_STANDALONE_IMAGE=1 \
  --env ROEBEL_WEBPACK_PARALLELISM=2 \
  --env NEXT_PUBLIC_STADTSTACK_STAGING_LAB=1 \
  --env ROEBEL_PUBLIC_DEPLOYMENT_PROFILE=talos_staging_synthetic_workflow \
  --env ROEBEL_PUBLIC_BASE_URL=https://roebel-web.staging.agentcart.eu \
  --env ROEBEL_PUBLIC_SITE_URL=https://roebel-web.staging.agentcart.eu \
  --env ROEBEL_PUBLIC_SUPABASE_URL=https://runtime-config-required.invalid \
  --env ROEBEL_PUBLIC_SUPABASE_ANON_KEY=__ROEBEL_RUNTIME_SUPABASE_ANON_KEY__ \
  --env ROEBEL_PUBLIC_THIRDWEB_CLIENT_ID=__ROEBEL_RUNTIME_THIRDWEB_CLIENT_ID__ \
  --env ROEBEL_PUBLIC_GNOSIS_BUNDLER_URL=/__roebel_runtime_gnosis_bundler_url__ \
  --env ROEBEL_PUBLIC_STADTSTACK_BASE_URL=https://stadtstack-runtime-config-required.invalid \
  --env NEXT_PUBLIC_SUPABASE_URL=https://runtime-config-required.invalid \
  --env NEXT_PUBLIC_SUPABASE_ANON_KEY=__ROEBEL_RUNTIME_SUPABASE_ANON_KEY__ \
  --env NEXT_PUBLIC_TEMPLATE_CLIENT_ID=__ROEBEL_RUNTIME_THIRDWEB_CLIENT_ID__ \
  --env NEXT_PUBLIC_GNOSIS_BUNDLER_URL=/__roebel_runtime_gnosis_bundler_url__ \
  --env NEXT_PUBLIC_BASE_URL=https://roebel-web.staging.agentcart.eu \
  --env NEXT_PUBLIC_SITE_URL=https://roebel-web.staging.agentcart.eu \
  --env SUPABASE_SERVICE_ROLE_KEY=placeholder-service-role-for-build-only \
  --env STRIPE_SECRET_KEY=sk_test_placeholder_for_build_1234567890 \
  --env STRIPE_SECRET_KEY_CARD=sk_test_placeholder_card_build_1234567890 \
  --env RESEND_API_KEY=re_placeholder_for_build \
  --env SESSION_SECRET=placeholder-session-secret-for-build-32chars \
  --env THIRDWEB_CLIENT_ID=placeholder-for-build \
  "$node_image" \
  sh -ceu '
    corepack pnpm --store-dir /pnpm/store --filter @roebel/web... install --offline --frozen-lockfile --ignore-scripts
    corepack pnpm --filter @roebel/web build
  '

dependency_install="$source_context/node_modules"
[[ -d "$dependency_install/.pnpm" && ! -L "$dependency_install" ]] || fail 'dependency materialization differs'
dependency_install_bytes="$(du -sb "$dependency_install" | cut -f1)"
[[ "$dependency_install_bytes" =~ ^[0-9]+$ ]] || fail 'dependency-install measurement differs'
(( dependency_install_bytes <= max_dependency_install_bytes )) || fail 'dependency materialization exceeds its retained budget'

standalone="$source_context/apps/web/.next/standalone"
static="$source_context/apps/web/.next/static"
public="$source_context/apps/web/public"
entrypoint="$source_context/apps/web/scripts/inject-public-runtime-config.mjs"

for path in "$standalone" "$static" "$public"; do
  [[ -d "$path" && ! -L "$path" ]] || fail "required standalone build directory differs: $path"
done
[[ -f "$standalone/apps/web/server.js" && ! -L "$standalone/apps/web/server.js" ]] || fail 'standalone server differs'
[[ -f "$entrypoint" && ! -L "$entrypoint" ]] || fail 'runtime entrypoint differs'

mkdir -p "$runtime_context/apps/web/.next" "$runtime_context/apps/web"
cp -a "$standalone/." "$runtime_context/"
cp -a "$static" "$runtime_context/apps/web/.next/static"
cp -a "$public" "$runtime_context/apps/web/public"
cp "$entrypoint" "$runtime_context/apps/web/runtime-entrypoint.mjs"

[[ ! -e "$runtime_context/apps/web/.next/cache" ]] || fail 'runtime context contains a build cache'
[[ -f "$runtime_context/apps/web/server.js" && ! -L "$runtime_context/apps/web/server.js" ]] || fail 'runtime server was not assembled'
[[ -f "$runtime_context/apps/web/runtime-entrypoint.mjs" && ! -L "$runtime_context/apps/web/runtime-entrypoint.mjs" ]] || fail 'runtime entrypoint was not assembled'

runtime_context_bytes="$(du -sb "$runtime_context" | cut -f1)"
[[ "$runtime_context_bytes" =~ ^[0-9]+$ ]] || fail 'runtime context measurement differs'
(( runtime_context_bytes <= max_runtime_context_bytes )) || fail 'runtime context exceeds its packaging budget'

printf '%s\n' \
  'staging_web_runtime_build=PASS' \
  'bundler=webpack' \
  "source_revision=$source_revision" \
  "dependency_install_bytes=$dependency_install_bytes" \
  "runtime_context_bytes=$runtime_context_bytes"
