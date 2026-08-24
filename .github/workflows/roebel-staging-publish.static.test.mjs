import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(new URL("./roebel-staging-publish.yml", import.meta.url), "utf8");
const docs = readFileSync(new URL("./ROEBEL_STAGING_PUBLISHER_CANDIDATE.md", import.meta.url), "utf8");
const webRuntimeDockerfile = readFileSync(
  new URL("../../Dockerfile.staging-web-runtime", import.meta.url),
  "utf8",
);
const webBuildScript = readFileSync(
  new URL("../../scripts/ci/build-staging-web-runtime.sh", import.meta.url),
  "utf8",
);
const meckyDockerfile = readFileSync(
  new URL("../../packages/agent-watcher/Dockerfile", import.meta.url),
  "utf8",
);
const webCandidateWorkflow = readFileSync(new URL("./staging-web-oci.yml", import.meta.url), "utf8");
const servicesCandidateWorkflow = readFileSync(
  new URL("./staging-services-oci.yml", import.meta.url),
  "utf8",
);

const actionPins = new Map([
  ["actions/checkout", "d23441a48e516b6c34aea4fa41551a30e30af803"],
  ["actions/setup-node", "49933ea5288caeca8642d1e84afbd3f7d6820020"],
  ["pnpm/action-setup", "b906affcce14559ad1aafd4ab0e942779e9f58b1"],
  ["docker/setup-buildx-action", "37fe631027851001ddb9b187196cc803df7f5f0e"],
  ["oras-project/setup-oras", "22ce207df3b08e061f537244349aac6ae1d214f6"],
  ["anchore/sbom-action/download-syft", "e22c389904149dbc22b58101806040fa8d37a610"],
  ["actions/attest", "1e69f48acb82d1966a394da916b4c1698aa569d6"],
  ["actions/download-artifact", "018cc2cf5baa6db3ef3c5f8a56943fffe632ef53"],
  ["actions/upload-artifact", "ea165f8d65b6e75b540449e92b4886f43607fa02"],
]);

const assemblyJobStart = workflow.indexOf("\n  assemble-release-set:");
const assemblyJob = assemblyJobStart >= 0 ? workflow.slice(assemblyJobStart) : "";

function workflowStep(source, name) {
  const marker = `      - name: ${name}\n`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing workflow step: ${name}`);
  const end = source.indexOf("\n      - name: ", start + marker.length);
  return source.slice(start, end === -1 ? source.length : end);
}

test("publisher follows protected relevant main pushes and retains exact-SHA recovery dispatch", () => {
  assert.match(workflow, /on:\n  push:\n    branches: \[main\]/u);
  assert.match(workflow, /  workflow_dispatch:/u);
  assert.doesNotMatch(workflow, /\n  (?:pull_request|schedule):/u);
  for (const relevantPath of [
    "apps/web/**",
    "packages/agent-watcher/**",
    "packages/miniapp-sdk/**",
    "packages/nostr/**",
    "packages/protocol/**",
    "packages/publisher/**",
    "packages/record-client/**",
    "packages/stadtstack-federation-client/**",
    "packages/workspace/**",
    "Dockerfile.staging-web",
    "Dockerfile.staging-web-runtime",
    ".npmrc",
    "package.json",
    "patches/**",
    "scripts/ci/build-staging-web-runtime.sh",
    "scripts/ci/affected-staging-components.mjs",
    "scripts/assemble-roebel-staging-release-set.mjs",
    "pnpm-lock.yaml",
  ]) {
    assert.match(workflow, new RegExp(`- "${relevantPath.replaceAll("*", "\\*")}"`, "u"));
  }
  assert.doesNotMatch(
    workflow,
    /^\s+- "\.dockerignore"$/mu,
    "the publisher uses isolated contexts, so this path must not trigger a no-op run",
  );
  assert.match(workflow, /github\.event_name == 'workflow_dispatch' && inputs\.source_revision \|\| github\.sha/u);
  assert.match(workflow, /if: \$\{\{ github\.ref == 'refs\/heads\/main' \}\}/u);
  assert.match(workflow, /environment: roebel-staging-publisher/u);
  assert.match(workflow, /test "\$GITHUB_REF" = "refs\/heads\/main"/u);
  assert.match(workflow, /\^\[0-9a-f\]\{40\}\$/u);
  assert.match(workflow, /repos\/\$GITHUB_REPOSITORY\/commits\/\$SOURCE_REVISION/u);
  assert.match(workflow, /repos\/\$GITHUB_REPOSITORY\/compare\/\$SOURCE_REVISION\.\.\.main/u);
  assert.match(workflow, /test "\$ancestry" = identical \|\| test "\$ancestry" = ahead/u);
});

test("runner-local paths are bound only after the runner exists", () => {
  const beforeJobs = workflow.slice(0, workflow.indexOf("\njobs:"));
  assert.doesNotMatch(beforeJobs, /\$\{\{\s*runner\./u);
  assert.match(workflow, /- name: Bind runner-local evidence paths/u);
  assert.match(workflow, /printf 'ARCHIVE=%s\/%s\\n' "\$RUNNER_TEMP" "\$ARCHIVE_NAME"/u);
  for (const variable of ["LAYOUT", "SOURCE_RECEIPT", "SBOM", "PUBLICATION_RECEIPT"]) {
    assert.match(workflow, new RegExp(`printf '${variable}=`, "u"));
  }
  assert.match(workflow, /\} >> "\$GITHUB_ENV"/u);
  assert.doesNotMatch(workflow, /MAX_NEXT_CACHE_BYTES|actions\/cache|\.next\/cache/u);
});

test("publisher selects affected components and publishes only verified digests", () => {
  assert.match(workflow, /name: Select affected publisher components/u);
  assert.match(workflow, /needs: guard/u);
  assert.match(workflow, /fetch-depth: 0/u);
  assert.match(
    workflow,
    /name: Check out the exact comparison range[\s\S]*?path: source[\s\S]*?fetch-depth: 0/u,
  );
  assert.match(workflow, /git diff --name-only "\$BASE_REVISION" "\$SOURCE_REVISION"/u);
  assert.match(workflow, /printf '__all__\\n' > "\$changed_paths"/u);
  assert.match(workflow, /affected-staging-components\.mjs --github-output/u);
  assert.match(workflow, /outputs:\n      web: \$\{\{ steps\.detect\.outputs\.web \}\}/u);
  assert.match(workflow, /outputs:\n      web:[\s\S]*publish_build_matrix: \$\{\{ steps\.detect\.outputs\.publish_build_matrix \}\}/u);
  assert.match(workflow, /needs: \[guard, changes\]/u);
  assert.match(workflow, /if: \$\{\{ needs\.changes\.outputs\.any_publish == 'true' \}\}/u);
  assert.match(workflow, /matrix: \$\{\{ fromJSON\(needs\.changes\.outputs\.publish_build_matrix\) \}\}/u);
  assert.match(workflow, /--output "type=oci,dest=\$ARCHIVE/u);
  assert.match(workflow, /verify-staging-web-oci\.mjs/u);
  assert.match(workflow, /verify-staging-service-oci\.mjs/u);
  assert.match(workflow, /oras cp --from-oci-layout/u);
  assert.match(workflow, /refusing to overwrite/u);
  assert.match(workflow, /source-\$SOURCE_REVISION/u);
  assert.doesNotMatch(workflow, /(?:tags?:\s*(?:latest|main)|:latest\b)/u);
});

test("Web builds once, packages runtime-only, and keeps diagnostics outside publication", () => {
  const diagnostic = workflowStep(webCandidateWorkflow, "Measure PR-only Web compiler cache candidates");
  const restore = workflowStep(webCandidateWorkflow, "Restore the exact-head PR server compiler cache");
  const save = workflowStep(webCandidateWorkflow, "Save the exact-head PR server compiler cache");

  assert.doesNotMatch(workflow, /MAX_NEXT_CACHE_BYTES|actions\/cache|\.next\/cache/u);
  assert.equal((webCandidateWorkflow.match(/uses: actions\/cache\/(?:restore|save)@[0-9a-f]{40}/gu) ?? []).length, 2);
  assert.match(restore, /github\.event_name == 'pull_request'/u);
  assert.match(save, /github\.event_name == 'pull_request'/u);
  assert.doesNotMatch(`${restore}\n${save}`, /restore-keys|client-production|node_modules|pnpm-store|runtime-context|\.oci/iu);
  assert.match(diagnostic, /if: \$\{\{ github\.event_name == 'pull_request' \}\}/u);
  assert.match(diagnostic, /NEXT_CACHE_ARCHIVE: \$\{\{ runner\.temp \}\}\/next-cache-diagnostic\.tar\.zst/u);
  assert.match(diagnostic, /next_cache_directory_v1/u);
  assert.match(diagnostic, /next_cache_compression_v1/u);
  assert.match(diagnostic, /archive_deleted=true upload=false save=false/u);
  assert.match(diagnostic, /find "\$NEXT_CACHE_PATH" -type l -print -quit/u);
  assert.match(workflow, /test ! -e "\$RUNNER_TEMP\/context\/node_modules"/u);
  assert.match(workflow, /run: scripts\/ci\/build-staging-web-runtime\.sh/u);
  assert.match(workflow, /RUNTIME_CONTEXT: \$\{\{ runner\.temp \}\}\/web-runtime-context/u);
  assert.match(workflow, /--file "\$GITHUB_WORKSPACE\/source\/\$DOCKERFILE"[\s\S]*?"\$RUNNER_TEMP\/web-runtime-context"/u);
  assert.doesNotMatch(workflow, /mode=max/u);

  assert.match(webBuildScript, /--network none/u);
  assert.match(webBuildScript, /--user "\$\(id -u\):\$\(id -g\)"/u);
  assert.match(webBuildScript, /--cap-drop ALL/u);
  assert.match(webBuildScript, /--security-opt no-new-privileges/u);
  assert.match(webBuildScript, /corepack pnpm --store-dir \/pnpm\/store --filter @roebel\/web\.\.\. install --offline/u);
  assert.match(webBuildScript, /corepack pnpm --filter @roebel\/web build/u);
  assert.match(webBuildScript, /bundler=webpack/u);
  assert.match(webBuildScript, /dependency_install_bytes <= max_dependency_install_bytes/u);
  assert.match(webBuildScript, /runtime_context_bytes <= max_runtime_context_bytes/u);
  assert.match(webBuildScript, /! -e "\$runtime_context\/apps\/web\/\.next\/cache"/u);

  assert.match(webRuntimeDockerfile, /COPY --chown=65532:65532 \. \./u);
  assert.match(webRuntimeDockerfile, /org\.opencontainers\.image\.revision="\$\{SOURCE_REVISION\}"/u);
  assert.match(webRuntimeDockerfile, /stadtstack\.io\/civic-authority="none"/u);
  assert.doesNotMatch(webRuntimeDockerfile, /pnpm|next build|dependency-manifests/u);
});

test("offline dependency inputs remain isolated and Public Mecky keeps a minimal BuildKit cache", () => {
  const login = workflow.indexOf("- name: Authenticate BuildKit to the exact GHCR namespace");
  const build = workflow.indexOf("- name: Build exactly one Public Mecky linux/amd64 OCI archive");
  assert.ok(login >= 0 && build > login, "registry auth must precede the cache-backed Mecky build");
  assert.match(workflow, /cache_ref="\$IMAGE:buildcache-main"/u);
  assert.match(workflow, /--cache-from "type=registry,ref=\$cache_ref"/u);
  assert.match(workflow, /--cache-to "type=registry,ref=\$cache_ref,mode=min,oci-mediatypes=true,image-manifest=true"/u);
  assert.match(workflow, /--build-context "dependency-manifests=\$RUNNER_TEMP\/dependency-manifests"/u);
  assert.match(workflow, /cp -a "\$RUNNER_TEMP\/pruned\/json\/\." "\$RUNNER_TEMP\/dependency-manifests\/"/u);
  assert.match(workflow, /cp -a "\$RUNNER_TEMP\/dependency-manifests\/\." "\$RUNNER_TEMP\/fetch-input\/"/u);
  assert.match(workflow, /pnpm fetch --store-dir "\$RUNNER_TEMP\/pnpm-store" --dir "\$RUNNER_TEMP\/fetch-input"/u);
  assert.doesNotMatch(workflow, /pnpm fetch --store-dir "\$RUNNER_TEMP\/pnpm-store" --dir "\$RUNNER_TEMP\/context"/u);
  assert.match(workflow, /test ! -e "\$RUNNER_TEMP\/context\/node_modules"/u);
  assert.match(
    meckyDockerfile,
    /COPY --from=dependency-manifests \. \.[\s\S]*?pnpm --filter @netizen-labs\/agent-watcher\.\.\. install[\s\S]*?COPY \. \./u,
  );
  for (const candidateWorkflow of [webCandidateWorkflow, servicesCandidateWorkflow]) {
    assert.match(candidateWorkflow, /cp -a "\$RUNNER_TEMP\/pruned\/json\/\." "\$RUNNER_TEMP\/dependency-manifests\/"/u);
    assert.match(candidateWorkflow, /pnpm fetch --store-dir "\$RUNNER_TEMP\/pnpm-store" --dir "\$RUNNER_TEMP\/fetch-input"/u);
    assert.doesNotMatch(candidateWorkflow, /pnpm fetch --store-dir "\$RUNNER_TEMP\/pnpm-store" --dir "\$RUNNER_TEMP\/context"/u);
    assert.match(candidateWorkflow, /test ! -e "\$RUNNER_TEMP\/context\/node_modules"/u);
  }
  assert.doesNotMatch(webCandidateWorkflow, /type=gha|mode=max/u);
  assert.match(servicesCandidateWorkflow, /--build-context "dependency-manifests=\$RUNNER_TEMP\/dependency-manifests"/u);
  assert.match(servicesCandidateWorkflow, /pnpm --dir "\$RUNNER_TEMP\/test-context" --store-dir "\$RUNNER_TEMP\/pnpm-store" --offline install/u);
  assert.doesNotMatch(servicesCandidateWorkflow, /pnpm --dir "\$RUNNER_TEMP\/context" --store-dir "\$RUNNER_TEMP\/pnpm-store" --offline install/u);
  assert.match(docs, /runtime-only packaging path/iu);
  assert.match(docs, /dependency-cache trial/iu);
  assert.match(docs, /measured warm-cache run/iu);
  assert.match(docs, /test the exact-head server compiler cache/iu);
  assert.match(docs, /1,688,883,560 apparent bytes/iu);
  assert.match(docs, /never uploaded, saved/iu);
  assert.match(docs, /never a publication or[\s\S]*deployment input/iu);
  assert.match(docs, /Turbopack trial/iu);
  assert.match(docs, /never a deployment input/iu);
});

test("all third-party actions are immutable and expected", () => {
  const uses = [...workflow.matchAll(/^\s+uses:\s+([^\s#]+)(?:\s+#.*)?$/gmu)].map((match) => match[1]);
  assert.ok(uses.length > 0);
  for (const use of uses) {
    const [name, sha] = use.split("@");
    assert.equal(sha?.length, 40, `${use} must use a full commit SHA`);
    assert.match(sha, /^[0-9a-f]{40}$/u);
    assert.equal(sha, actionPins.get(name), `${name} pin drift`);
  }
  assert.deepEqual(new Set(uses.map((use) => use.split("@")[0])), new Set(actionPins.keys()));
  assert.match(workflow, /uses: oras-project\/setup-oras@[0-9a-f]{40}[\s\S]*?version: 1\.3\.0/u);
  assert.doesNotMatch(workflow, /version: 1\.3\.3/u);
});

test("publication produces SPDX and GitHub OIDC attestations for exact digests", () => {
  assert.match(workflow, /syft-version: v1\.51\.0/u);
  assert.match(workflow, /oci-archive:\$ARCHIVE/u);
  assert.match(workflow, /SPDX-2\.3/u);
  assert.match(workflow, /stat -c %s "\$SBOM"\)" -le 16777216/u);
  assert.equal((workflow.match(/uses: actions\/attest@/gu) ?? []).length, 2);
  assert.equal((workflow.match(/push-to-registry: true/gu) ?? []).length, 2);
  assert.match(workflow, /subject-digest: \$\{\{ steps\.publish\.outputs\.manifest_digest \}\}/u);
  assert.match(workflow, /roebel_staging_publication_receipt_v1/u);
  assert.match(workflow, /civicAuthority:"none"/u);
  assert.match(workflow, /deploymentEffect:false/u);
});

test("same-run evidence is verified into an effect-free CAS-bound Release Set candidate", () => {
  assert.notEqual(assemblyJobStart, -1);
  assert.match(assemblyJob, /needs: \[publish, changes\]/u);
  assert.match(assemblyJob, /AFFECTED_WEB: \$\{\{ needs\.changes\.outputs\.web \}\}/u);
  assert.match(assemblyJob, /AFFECTED_MECKY: \$\{\{ needs\.changes\.outputs\.public_mecky \}\}/u);
  assert.match(assemblyJob, /permissions:\n      actions: read\n      contents: read\n      packages: write\n      attestations: read/u);
  assert.doesNotMatch(assemblyJob, /(?:attestations|contents): write/u);
  assert.doesNotMatch(assemblyJob, /id-token: write/u);
  assert.match(assemblyJob, /actions\/download-artifact@[0-9a-f]{40}/u);
  assert.match(assemblyJob, /pattern: "\*-publication-/u);
  assert.match(assemblyJob, /merge-multiple: true/u);
  assert.match(
    assemblyJob,
    /OPERATIONS_HEAD_URL: https:\/\/raw\.githubusercontent\.com\/GiraeffleAeffle\/roebel-staging-operations\/main\/reviewed-render\/roebel-staging\/head\.json/u,
  );
  assert.equal((assemblyJob.match(/gh attestation download /gu) ?? []).length, 2);
  assert.equal((assemblyJob.match(/gh attestation verify /gu) ?? []).length, 4);
  assert.equal(
    (
      assemblyJob.match(
        /mv -- "\$\{manifest_digest\}\.jsonl" "sha256-\$\{manifest_digest#sha256:\}\.jsonl"/gu,
      ) ?? []
    ).length,
    2,
  );
  assert.match(
    assemblyJob,
    /bundle_name="sha256-\$\{manifest_digest#sha256:\}\.jsonl"/u,
  );
  assert.doesNotMatch(assemblyJob, /bundle_name="\$\{manifest_digest\}\.jsonl"/u);
  for (const predicate of ["https://slsa.dev/provenance/v1", "https://spdx.dev/Document/v2.3"]) {
    assert.match(assemblyJob, new RegExp(predicate.replaceAll("/", "\\/"), "u"));
  }
  assert.match(assemblyJob, /--cert-identity "\$SIGNER_IDENTITY"/u);
  assert.match(assemblyJob, /--source-digest "\$SOURCE_REVISION"/u);
  assert.match(assemblyJob, /--source-ref refs\/heads\/main/u);
  assert.match(assemblyJob, /--deny-self-hosted-runners/u);
  assert.match(assemblyJob, /verify_component roebel-web-staging "\$WEB_IMAGE"/u);
  assert.match(assemblyJob, /verify_component public-mecky "\$MECKY_IMAGE"/u);
  assert.match(assemblyJob, /reuse_component roebel-web-staging "\$WEB_IMAGE"/u);
  assert.match(assemblyJob, /reuse_component public-mecky "\$MECKY_IMAGE"/u);
  assert.match(assemblyJob, /release-set-\$previous_revision/u);
  assert.match(assemblyJob, /candidatePayloadDigest/u);
  assert.match(assemblyJob, /oras cp "\$image@\$manifest_digest" --to-oci-layout/u);
  assert.match(assemblyJob, /--source-digest "\$source_revision"/u);
  assert.match(assemblyJob, /approved_release_set_digest_mismatch/u);
  assert.match(assemblyJob, /scripts\/assemble-roebel-staging-release-set\.mjs/u);
  assert.match(assemblyJob, /release-set\/release-set\.candidate\.json/u);
  assert.match(assemblyJob, /roebel-staging-release-set-/u);
  assert.match(assemblyJob, /test "\$\(jq -er \.deploymentEffect "\$publication_receipt"\)" = false/u);
  assert.doesNotMatch(assemblyJob, /^\s*(?:kubectl|helm|flux|talosctl|tailscale|ssh)\b/imu);
});

test("verified Release Set is handed off immutably inside the existing Web package", () => {
  assert.match(assemblyJob, /target="\$WEB_IMAGE:\$tag"/u);
  assert.match(assemblyJob, /tag="release-set-\$SOURCE_REVISION"/u);
  assert.match(assemblyJob, /application\/vnd\.stadtstack\.roebel\.release-set\.v1/u);
  assert.match(assemblyJob, /oras push "\$target"/u);
  assert.match(assemblyJob, /org\.opencontainers\.image\.revision=\$SOURCE_REVISION/u);
  assert.match(assemblyJob, /stadtstack\.io\/candidate-payload-digest=\$candidate_digest/u);
  assert.match(
    assemblyJob,
    /mecky_manifest_hex="\$\(jq -er '\.components\[\] \| select\(\.component == "public-mecky"\)/u,
  );
  assert.match(
    assemblyJob,
    /web_manifest_hex="\$\(jq -er '\.components\[\] \| select\(\.component == "roebel-web-staging"\)/u,
  );
  assert.doesNotMatch(assemblyJob, /\\"(?:public-mecky|roebel-web-staging)\\"/u);
  assert.match(assemblyJob, /\[\[ "\$mecky_manifest_hex" =~ \^\[0-9a-f\]\{64\}\$ \]\]/u);
  assert.match(assemblyJob, /\[\[ "\$web_manifest_hex" =~ \^\[0-9a-f\]\{64\}\$ \]\]/u);
  assert.match(assemblyJob, /refusing to overwrite|diff -r "\$existing\/release-set" release-set/u);
  assert.match(assemblyJob, /oras manifest fetch "\$WEB_IMAGE@\$artifact_digest"/u);
  assert.match(assemblyJob, /roebel_staging_release_set_publication_v1/u);
  assert.match(assemblyJob, /release-set\/release-set\.publication\.json/u);
  assert.doesNotMatch(assemblyJob, /ghcr\.io\/giraeffleaeffle\/roebel-staging-release-set/u);
  assert.doesNotMatch(assemblyJob, /^\s*(?:kubectl|helm|flux|talosctl|tailscale|ssh)\b/imu);
});

test("publication has no deployment, runtime-secret or broad authority surface", () => {
  assert.match(workflow, /^permissions: \{\}$/mu);
  assert.match(workflow, /packages: write/u);
  assert.match(workflow, /attestations: write/u);
  assert.match(workflow, /id-token: write/u);
  const secretRefs = [...workflow.matchAll(/secrets\.([A-Z0-9_]+)/gu)].map((match) => match[1]);
  assert.deepEqual(new Set(secretRefs), new Set(["GITHUB_TOKEN"]));
  assert.doesNotMatch(workflow, /^\s*(?:kubectl|helm|flux|talosctl|tailscale|ssh)\b/imu);
  assert.doesNotMatch(workflow, /^\s*(?:HETZNER|KUBECONFIG|TALOSCONFIG|MECKY_INFERENCE_API_KEY):/imu);
  assert.match(docs, /publication is not promotion/iu);
  assert.match(docs, /effect-free Release Set candidate/iu);
  assert.match(docs, /public visibility cannot\s+be reversed/iu);
  assert.match(docs, /does not merge or deploy a pull request/iu);
});
