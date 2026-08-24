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
  assert.match(workflow, /MAX_NEXT_CACHE_BYTES: "536870912"/);
  assert.match(workflow, /actions\/cache\/restore@v4/);
  assert.match(workflow, /actions\/cache\/save@v4/);
  assert.match(
    workflow,
    /path: \$\{\{ runner\.temp \}\}\/context\/apps\/web\/.next\/cache/,
  );
  assert.match(workflow, /\$\{\{ env\.SOURCE_REVISION \}\}/);
  assert.match(
    workflow,
    /node22-nodeimage-sha256-7c269ea419bfbaef1f5eed57e58016395bbe3036176411025a5093e39a948dcf-pnpm9\.15\.0/,
  );
  assert.match(
    workflow,
    /hashFiles\('\.npmrc', 'package\.json', 'pnpm-lock\.yaml', 'pnpm-workspace\.yaml'/,
  );
  assert.match(workflow, /id: next-cache-scope/);
  assert.match(workflow, /CACHE_SCOPE_REPOSITORY: \$\{\{ github\.event\.pull_request\.head\.repo\.full_name \|\| github\.repository \}\}/);
  assert.match(workflow, /CACHE_SCOPE_REF: \$\{\{ github\.head_ref \|\| github\.ref_name \}\}/);
  assert.match(workflow, /sha256sum/);
  assert.match(workflow, /steps\.next-cache-scope\.outputs\.scope/);
  assert.match(workflow, /find "\$NEXT_CACHE" -type l/);
  assert.equal((workflow.match(/cache_bytes <= MAX_NEXT_CACHE_BYTES/g) ?? []).length, 2);
  assert.equal(
    (workflow.match(/runner\.temp \}\}\/context\/apps\/web\/.next\/cache/g) ?? []).length,
    4,
  );
  assert.doesNotMatch(workflow, /web-runtime-context\/[^\n]*\.next\/cache/);
  const restore = workflow.indexOf("Restore the branch-scoped Next compiler cache");
  const before = workflow.indexOf("Validate the restored Next compiler cache");
  const build = workflow.indexOf("Build the standalone Web runtime once");
  const after = workflow.indexOf("Validate the generated Next compiler cache");
  const save = workflow.indexOf("Save the bounded branch-scoped Next compiler cache");
  assert.ok(restore >= 0 && restore < before && before < build && build < after && after < save);
  assert.doesNotMatch(
    workflow,
    /staging-web-dependency-family|DEPENDENCY_CACHE_HIT|pnpm-cache|node_modules-cache/,
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
