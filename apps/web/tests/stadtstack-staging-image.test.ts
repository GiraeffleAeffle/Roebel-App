import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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

for (const tracedAssetDirectories of [false, true]) {
  test(`assembles assets at their served paths with traced asset directories ${tracedAssetDirectories}`, () => {
    const root = mkdtempSync(join(tmpdir(), "roebel-runtime-assets-"));
    const source = join(root, "source");
    const runtime = join(root, "runtime");
    const write = (relative: string, contents: string) => {
      const path = join(source, "apps/web", relative);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, contents);
    };
    try {
      write(".next/standalone/apps/web/server.js", "// standalone server\n");
      write(".next/static/chunks/client.js", "// browser bundle\n");
      write("public/Logo-new.png", "fixture logo bytes");
      write("public/site.webmanifest", '{"name":"Röbel"}\n');
      write("public/.well-known/assetlinks.json", "[]\n");
      write("scripts/inject-public-runtime-config.mjs", "// entrypoint\n");
      if (tracedAssetDirectories) {
        write(".next/standalone/apps/web/public/traced.txt", "traced asset\n");
        write(".next/standalone/apps/web/.next/static/traced.js", "// traced bundle\n");
      }

      // Exercise the production assembly commands against a Next output fixture.
      // Compilation and OCI packaging are outside this filesystem regression.
      const start = buildScript.indexOf('standalone="$source_context/');
      const end = buildScript.indexOf('runtime_context_bytes=', start);
      assert.ok(start >= 0 && end > start);
      execFileSync("bash", ["-ceu", `fail() { printf '%s\\n' "$1" >&2; exit 1; }\n${buildScript.slice(start, end)}`], {
        env: { ...process.env, source_context: source, runtime_context: runtime },
      });
      for (const relative of ["public/Logo-new.png", "public/site.webmanifest", "public/.well-known/assetlinks.json", ".next/static/chunks/client.js"]) {
        assert.deepEqual(
          readFileSync(join(runtime, "apps/web", relative)),
          readFileSync(join(source, "apps/web", relative)),
        );
      }
      assert.equal(existsSync(join(runtime, "apps/web/public/public")), false);
      assert.equal(existsSync(join(runtime, "apps/web/.next/static/static")), false);
      if (tracedAssetDirectories) {
        assert.equal(readFileSync(join(runtime, "apps/web/public/traced.txt"), "utf8"), "traced asset\n");
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test("emits the standalone server only for the explicit Talos staging image", () => {
  assert.match(
    nextConfig,
    /process\.env\.ROEBEL_STANDALONE_IMAGE === "1" \? "standalone" : undefined/
  );
  assert.match(buildScript, /--env ROEBEL_STANDALONE_IMAGE=1/);
  assert.match(buildScript, /--env ROEBEL_WEBPACK_PARALLELISM=2/);
  assert.match(buildScript, /\.next\/standalone/);
  assert.match(buildScript, /inject-public-runtime-config\.mjs/);
  assert.match(buildScript, /NEXT_PUBLIC_IDENTITY_CONTRACT_SET=__ROEBEL_RUNTIME_IDENTITY_CONTRACT_SET__/);
  assert.match(buildScript, /NEXT_PUBLIC_ATTESTER_NFT_ADDRESS=0x0000000000000000000000000000000000000a71/);
  assert.match(buildScript, /NEXT_PUBLIC_CITIZEN_NFT_ADDRESS=0x0000000000000000000000000000000000000c17/);
  assert.match(runtimeDockerfile, /ROEBEL_PUBLIC_IDENTITY_CONTRACT_SET=__ROEBEL_RUNTIME_IDENTITY_CONTRACT_SET__/);
  assert.match(runtimeDockerfile, /ROEBEL_PUBLIC_ATTESTER_NFT_ADDRESS=0x0000000000000000000000000000000000000a71/);
  assert.match(runtimeDockerfile, /ROEBEL_PUBLIC_CITIZEN_NFT_ADDRESS=0x0000000000000000000000000000000000000c17/);
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
  assert.doesNotMatch(workflow, /staging-web-cache-family|\.next\/cache/);
  assert.doesNotMatch(workflow, /staging-web-dependency-family|actions\/cache|DEPENDENCY_CACHE_HIT/);
  assert.match(workflow, /test ! -e "\$RUNNER_TEMP\/context\/node_modules"/);
  assert.match(workflow, /Dockerfile\.staging-web-runtime/);
  assert.doesNotMatch(workflow, /pnpm fetch --(?:dev|prod)/);
  assert.match(
    workflow,
    /name=\$import_name,annotation\.io\.containerd\.image\.name=\$import_name/
  );
  assert.match(workflow, /MAX_ARTIFACT_BYTES:\s*"?167772160"?/);
  assert.match(workflow, /write-staging-web-build-evidence\.mjs/);
  assert.match(workflow, /--pipeline-finished-at-ms after-verification/);
  assert.doesNotMatch(workflow, /node scripts\/verify-staging-web-oci\.mjs/);
  assert.match(workflow, /retention-days: 1/);
  assert.match(workflow, /compression-level: 0/);
});
