import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const nextConfig = readFileSync(
  new URL("../next.config.mjs", import.meta.url),
  "utf8"
);
const runtimeDockerfile = readFileSync(
  new URL("../../../Dockerfile.staging-web-runtime", import.meta.url),
  "utf8"
);
const buildScript = readFileSync(
  new URL("../../../scripts/ci/build-staging-web-runtime.sh", import.meta.url),
  "utf8"
);
const workflow = readFileSync(
  new URL("../../../.github/workflows/staging-web-oci.yml", import.meta.url),
  "utf8"
);

test("emits the standalone server only for the explicit Talos staging image", () => {
  assert.match(
    nextConfig,
    /process\.env\.ROEBEL_STANDALONE_IMAGE === "1" \? "standalone" : undefined/
  );
  assert.match(buildScript, /--env ROEBEL_STANDALONE_IMAGE=1/);
  assert.match(buildScript, /--env ROEBEL_WEBPACK_PARALLELISM=2/);
  assert.match(buildScript, /\.next\/standalone/);
  assert.match(buildScript, /inject-public-runtime-config\.mjs/);
  assert.match(runtimeDockerfile, /CMD \["apps\/web\/runtime-entrypoint\.mjs"\]/);
  assert.doesNotMatch(
    runtimeDockerfile,
    /NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder-for-build/
  );
  assert.doesNotMatch(
    runtimeDockerfile,
    /NEXT_PUBLIC_TEMPLATE_CLIENT_ID=placeholder-for-build/
  );
  assert.doesNotMatch(runtimeDockerfile, /NEXT_PUBLIC_STADTSTACK_PUBLIC_BASE_URL/);
});

test("installs only the Röbel web dependency graph from the frozen offline store", () => {
  assert.doesNotMatch(buildScript, /pnpm fetch/);
  assert.match(
    buildScript,
    /corepack pnpm --store-dir \/pnpm\/store --filter @roebel\/web\.\.\. install --offline --frozen-lockfile --ignore-scripts/
  );
  assert.match(
    buildScript,
    /corepack pnpm --filter @roebel\/web build/
  );
  assert.match(buildScript, /--network none/);
  assert.match(buildScript, /--user "\$\(id -u\):\$\(id -g\)"/);
});

test("packages only the bounded standalone runtime and excludes build cache", () => {
  assert.match(buildScript, /runtime_context\/apps\/web\/\.next/);
  assert.match(buildScript, /! -e "\$runtime_context\/apps\/web\/\.next\/cache"/);
  assert.match(buildScript, /runtime_context_bytes <= max_runtime_context_bytes/);
  assert.match(runtimeDockerfile, /COPY --chown=65532:65532 \. \./);
  assert.doesNotMatch(runtimeDockerfile, /pnpm|next build|node_modules/);
});

test("builds one bounded private OCI artifact remotely without publishing it", () => {
  assert.match(workflow, /workflow_call:/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /pull_request:/);
  assert.match(workflow, /permissions:\s*\n\s*contents: read/);
  assert.doesNotMatch(
    workflow,
    /packages: write|push:\s*true|docker\/login-action|ghcr\.io/
  );
  assert.match(workflow, /turbo@2\.4\.0 prune @roebel\/web --docker/);
  assert.match(workflow, /pnpm fetch --store-dir/);
  assert.equal(
    (workflow.match(/uses: actions\/cache\/(?:restore|save)@0400d5f644dc74513175e3cd8d07132dd4860809/g) ?? []).length,
    2
  );
  assert.match(workflow, /roebel-web-pr-webpack-server-v1-/);
  assert.match(workflow, /github\.event\.pull_request\.head\.sha/);
  assert.match(workflow, /cache\/webpack\/server-production/);
  assert.match(workflow, /cache\/webpack\/edge-server-production/);
  const cacheActionBlocks = workflow.match(/- name: (?:Restore|Save) the exact-head PR server compiler cache[\s\S]*?(?=\n      - name:)/g) ?? [];
  assert.equal(cacheActionBlocks.length, 2);
  assert.doesNotMatch(cacheActionBlocks.join("\n"), /client-production|restore-keys|node_modules|pnpm-store|runtime-context|\.oci/i);
  assert.match(
    workflow,
    /runner\.temp \}\}\/context\/apps\/web\/\.next\/cache/
  );
  assert.match(
    workflow,
    /github\.event_name == 'pull_request'/
  );
  assert.match(
    workflow,
    /next_cache_directory_v1 path=%q apparent_bytes=%s allocated_bytes=%s files=%s/
  );
  assert.match(
    workflow,
    /next_cache_compression_v1 compressed_bytes=%s elapsed_seconds=%s/
  );
  assert.match(workflow, /archive_deleted=true upload=false save=false/);
  assert.match(workflow, /next_cache_selected_v1/);
  assert.match(workflow, /next_cache_restore_v1/);
  assert.match(workflow, /next_cache_save_v1/);
  assert.match(workflow, /selected_apparent_bytes < MAX_SELECTED_CACHE_BYTES/);
  assert.match(workflow, /find "\$NEXT_CACHE_PATH" -type l -print -quit/);
  assert.doesNotMatch(
    workflow,
    /path:.*(?:node_modules|pnpm-store|oci|runtime-context)/i
  );
  assert.match(workflow, /test ! -e "\$RUNNER_TEMP\/context\/node_modules"/);
  assert.match(workflow, /Dockerfile\.staging-web-runtime/);
  assert.doesNotMatch(workflow, /pnpm fetch --(?:dev|prod)/);
  assert.match(
    workflow,
    /name=\$import_name,annotation\.io\.containerd\.image\.name=\$import_name/
  );
  assert.match(workflow, /MAX_ARTIFACT_BYTES:\s*"?167772160"?/);
  assert.match(workflow, /verify-staging-web-oci\.mjs/);
  assert.match(workflow, /retention-days: 1/);
  assert.match(workflow, /compression-level: 0/);
});
