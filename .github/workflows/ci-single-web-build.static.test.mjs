import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const ci = readFileSync(new URL("./ci.yml", import.meta.url), "utf8");
const web = readFileSync(new URL("./staging-web-oci.yml", import.meta.url), "utf8");
const runtimeBuilder = readFileSync(
  new URL("../../scripts/ci/build-staging-web-runtime.sh", import.meta.url),
  "utf8",
);

function workflowStep(name) {
  const marker = `      - name: ${name}\n`;
  const start = web.indexOf(marker);
  assert.notEqual(start, -1, `missing workflow step: ${name}`);
  const next = web.indexOf("\n      - name:", start + marker.length);
  return web.slice(start, next === -1 ? web.length : next);
}

test("the required ci result joins quality with one verified Web build", () => {
  assert.match(ci, /\n  changes:\n    name: Detect affected staging components/u);
  assert.match(ci, /node scripts\/ci\/affected-staging-components\.mjs --github-output/u);
  assert.match(ci, /\n  quality:\n    name: Affected quality and non-Web builds/u);
  assert.match(ci, /node scripts\/ci\/run-affected-quality\.mjs/u);
  assert.match(ci, /\.github\/workflows\/ci-single-web-build\.static\.test\.mjs/u);
  assert.match(ci, /scripts\/ci\/write-staging-web-build-evidence\.test\.mjs/u);
  assert.doesNotMatch(ci, /run: pnpm build/u);
  assert.match(
    ci,
    /\n  web-oci:[\s\S]*?needs: changes[\s\S]*?if: \$\{\{ needs\.changes\.outputs\.web == 'true' \}\}[\s\S]*?uses: \.\/\.github\/workflows\/staging-web-oci\.yml[\s\S]*?source_revision: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/u,
  );
  assert.match(ci, /\n  ci:\n    name: ci\n    if: \$\{\{ always\(\) \}\}/u);
  assert.match(ci, /needs:\n      - changes\n      - quality\n      - web-oci/u);
  assert.match(ci, /test "\$CHANGES_RESULT" = success/u);
  assert.match(ci, /test "\$QUALITY_RESULT" = success/u);
  assert.match(ci, /if test "\$WEB_REQUIRED" = true; then[\s\S]*?test "\$WEB_OCI_RESULT" = success[\s\S]*?test "\$WEB_OCI_RESULT" = skipped/u);
});

test("the Web workflow is reusable and no longer starts a duplicate PR build", () => {
  assert.match(web, /on:\n  workflow_call:\n    inputs:\n      source_revision:/u);
  assert.match(web, /  workflow_dispatch:/u);
  assert.doesNotMatch(web, /\n  pull_request:/u);
  assert.match(web, /SOURCE_REVISION: \$\{\{ inputs\.source_revision \|\| github\.sha \}\}/u);
  assert.match(web, /\[\[ "\$SOURCE_REVISION" =~ \^\[0-9a-f\]\{40\}\$ \]\]/u);
  assert.match(web, /test "\$\(git rev-parse HEAD\)" = "\$SOURCE_REVISION"/u);
  assert.equal((web.match(/Build one linux\/amd64 OCI archive/gu) ?? []).length, 1);
});

test("the required summary has no publication or deployment authority", () => {
  assert.match(ci, /^permissions: \{\}$/mu);
  assert.match(ci, /web-oci:[\s\S]*?permissions:\n      contents: read/u);
  assert.doesNotMatch(ci, /(?:packages|attestations|id-token): write/u);
  assert.doesNotMatch(ci, /^\s*(?:kubectl|helm|flux|talosctl|tailscale|ssh)\b/imu);
});

test("PR Web builds once and packages runtime output only", () => {
  assert.doesNotMatch(web, /staging-web-cache-family|MAX_NEXT_CACHE_BYTES|\.next\/cache/u);
  assert.doesNotMatch(web, /staging-web-dependency-family|actions\/cache|DEPENDENCY_CACHE_HIT/u);
  assert.match(web, /test ! -e "\$RUNNER_TEMP\/context\/node_modules"/u);
  assert.match(web, /MAX_DEPENDENCY_INSTALL_BYTES: "4294967296"/u);
  assert.match(web, /MAX_RUNTIME_CONTEXT_BYTES: "805306368"/u);
  assert.match(web, /run: scripts\/ci\/build-staging-web-runtime\.sh/u);
  assert.match(web, /Build the standalone Web runtime once/u);
  assert.match(web, /--file Dockerfile\.staging-web-runtime/u);
  assert.match(web, /"\$RUNNER_TEMP\/web-runtime-context"/u);
  assert.doesNotMatch(web, /type=gha|mode=max/u);
});

test("the Web build emits bounded, schema-checked route and timing evidence", () => {
  assert.match(web, /MAX_ROUTE_MANIFEST_BYTES: "1048576"/u);
  assert.match(web, /MAX_BUILD_EVIDENCE_BYTES: "1048576"/u);
  assert.match(web, /Start post-checkout Web pipeline timing/u);
  for (const stage of ["prune", "offline_fetch", "oci_packaging"]) {
    assert.match(web, new RegExp(`printf '${stage}\\\\t%s\\\\t%s\\\\n'`, "u"));
  }
  assert.match(web, /WEB_BUILD_TIMING_PATH: \$\{\{ runner\.temp \}\}\/web-build-evidence\/runtime\/runtime-timing\.json/u);
  assert.match(web, /write-staging-web-build-evidence\.mjs/u);
  assert.match(web, /app-paths-manifest\.json/u);
  assert.match(web, /--canonical-route-manifest-output "\$RUNNER_TEMP\/web-build-evidence\/private\/canonical-route-manifest\.json"/u);
  assert.match(web, /--oci-archive-input "\$RUNNER_TEMP\/roebel-web-staging\.buildx\.oci\.tar"/u);
  assert.match(web, /--oci-archive-output \/tmp\/roebel-web-staging\.oci\.tar/u);
  assert.match(web, /--oci-archive-checksum-output \/tmp\/roebel-web-staging\.oci\.tar\.sha256/u);
  assert.match(web, /--oci-receipt-output \/tmp\/roebel-web-staging\.receipt\.json/u);
  assert.match(web, /--pipeline-finished-at-ms after-verification/u);
  assert.match(web, /roebel-web-staging\.build-evidence\.json/u);
  assert.doesNotMatch(web, /^\s+\$RUNNER_TEMP\/web-build-evidence\/private/mu);
  assert.match(
    runtimeBuilder,
    /timing_args\+=\(--env "WEB_BUILD_HOST_ANCHOR_MS=\$docker_host_anchor_ms"\)/u,
  );
  assert.match(runtimeBuilder, /node -e "process\.stdout\.write\(String\(Date\.now\(\)\)\)"/u);
  const inContainerBuild = runtimeBuilder.match(/  sh -ceu '\n[\s\S]*?\n  '\n/u)?.[0] ?? "";
  assert.notEqual(inContainerBuild, "", "missing in-container Web build command");
  assert.doesNotMatch(inContainerBuild, /date \+%s%3N/u);

  const runtimeUpload = workflowStep("Upload the private short-lived runtime delivery artifact");
  assert.match(runtimeUpload, /name: roebel-web-staging-\$\{\{ env\.SOURCE_REVISION \}\}/u);
  assert.match(runtimeUpload, /\/tmp\/roebel-web-staging\.oci\.tar\n/u);
  assert.match(runtimeUpload, /\/tmp\/roebel-web-staging\.oci\.tar\.sha256\n/u);
  assert.match(runtimeUpload, /\/tmp\/roebel-web-staging\.receipt\.json\n/u);
  assert.match(runtimeUpload, /compression-level: 0[\s\S]*retention-days: 1/u);
  assert.doesNotMatch(runtimeUpload, /build-evidence|canonical-route-manifest|web-build-evidence\/private/u);

  const measurementUpload = workflowStep("Upload aggregate-only short-lived measurement evidence");
  assert.match(
    measurementUpload,
    /name: roebel-web-staging-measurement-\$\{\{ env\.SOURCE_REVISION \}\}/u,
  );
  assert.match(measurementUpload, /path: \/tmp\/roebel-web-staging\.build-evidence\.json/u);
  assert.match(measurementUpload, /compression-level: 9[\s\S]*retention-days: 1/u);
  assert.doesNotMatch(
    measurementUpload,
    /\.oci\.tar|\.receipt\.json|canonical-route-manifest|web-build-evidence\/private/u,
  );
  const timingWriter = runtimeBuilder.match(
    /    if \[ -n "[$][{]WEB_BUILD_DOCKER_TIMING_PATH:-[}]" \]; then\n[\s\S]*?\n    fi/u,
  );
  assert.ok(timingWriter, "missing in-container timing writer");

  const fixture = mkdtempSync(join(tmpdir(), "roebel-web-timing-writer-"));
  const output = join(fixture, "docker-timing.json");
  try {
    const executed = spawnSync("/bin/sh", ["-ceu", timingWriter[0]], {
      encoding: "utf8",
      env: {
        ...process.env,
        WEB_BUILD_DOCKER_TIMING_PATH: output,
        WEB_BUILD_HOST_ANCHOR_MS: "1000",
        container_clock_origin_ms: "5000",
        materialization_started_clock_ms: "5010",
        materialization_finished_clock_ms: "5020",
        next_compile_started_clock_ms: "5020",
        next_compile_finished_clock_ms: "5030",
      },
    });
    assert.equal(executed.status, 0, executed.stderr);
    assert.deepEqual(JSON.parse(readFileSync(output, "utf8")), {
      schemaVersion: "roebel_staging_web_docker_timing_v1",
      offlineMaterializationStartedAtMs: 1010,
      offlineMaterializationFinishedAtMs: 1020,
      nextCompileStartedAtMs: 1020,
      nextCompileFinishedAtMs: 1030,
    });
  } finally {
    rmSync(fixture, { force: true, recursive: true });
  }
});

test("the raw Buildx archive reaches one validation boundary before any extraction", () => {
  const buildStep = workflowStep("Build one linux/amd64 OCI archive");
  const prepareStep = workflowStep("Validate, bind and atomically expose the exact OCI snapshot");
  assert.match(buildStep, /dest=\$RUNNER_TEMP\/roebel-web-staging\.buildx\.oci\.tar/u);
  assert.match(prepareStep, /write-staging-web-build-evidence\.mjs/u);
  assert.ok(web.indexOf(prepareStep) > web.indexOf(buildStep));
  assert.equal(
    web.slice(web.indexOf(buildStep) + buildStep.length, web.indexOf(prepareStep)).trim(),
    "",
    "the validation boundary must immediately follow the Buildx archive step",
  );
  assert.doesNotMatch(web, /(?:^|\s)tar\s+(?:-[^\s]*x|--extract)\b/imu);
  assert.doesNotMatch(web, /sha256sum\s+\$RUNNER_TEMP\/roebel-web-staging\.buildx\.oci\.tar/u);
  assert.doesNotMatch(prepareStep, /pipeline_finished_at_ms=.*date/u);
});
