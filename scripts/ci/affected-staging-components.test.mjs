import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  affectedStagingComponents,
  QUALITY_WORKSPACES,
  STAGING_PUBLISH_BUILD_MATRIX,
  STAGING_SERVICE_BUILD_MATRIX,
} from "./affected-staging-components.mjs";

const CLI = fileURLToPath(new URL("./affected-staging-components.mjs", import.meta.url));
const ROOT = fileURLToPath(new URL("../../", import.meta.url));

function actualWorkspaceRoots(directory = ROOT, prefix = "") {
  const roots = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === ".git" || entry.name === "node_modules" || entry.name === ".next") continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = join(directory, entry.name);
    if (relative !== "apps" && relative !== "packages" && relative !== "contracts" && !prefix) {
      continue;
    }
    if (existsSync(join(absolute, "package.json"))) roots.push(relative);
    roots.push(...actualWorkspaceRoots(absolute, relative));
  }
  return roots;
}

function workspaceClosure(root) {
  const manifests = new Map(
    actualWorkspaceRoots().map((workspaceRoot) => {
      const manifest = JSON.parse(
        readFileSync(join(ROOT, workspaceRoot, "package.json"), "utf8"),
      );
      return [manifest.name, { manifest, root: workspaceRoot }];
    }),
  );
  const start = JSON.parse(
    readFileSync(join(ROOT, root, "package.json"), "utf8"),
  );
  const pending = [start.name];
  const visited = new Set();
  while (pending.length > 0) {
    const name = pending.pop();
    if (visited.has(name)) continue;
    visited.add(name);
    const entry = manifests.get(name);
    if (!entry) continue;
    const dependencies = {
      ...(entry.manifest.dependencies ?? {}),
      ...(entry.manifest.devDependencies ?? {}),
      ...(entry.manifest.optionalDependencies ?? {}),
    };
    for (const [dependency, version] of Object.entries(dependencies)) {
      if (String(version).startsWith("workspace:") && manifests.has(dependency)) {
        pending.push(dependency);
      }
    }
  }
  return [...visited]
    .map((name) => manifests.get(name)?.root)
    .filter(Boolean)
    .sort();
}

const selection = (paths) => {
  const result = affectedStagingComponents(paths);
  return {
    web: result.web,
    public_mecky: result.public_mecky,
    e2e_workbench: result.e2e_workbench,
    staging_relay: result.staging_relay,
    any_service: result.any_service,
    any_publish: result.any_publish,
  };
};

describe("staging component change detection", () => {
  it("binds every declared quality workspace to its actual package name", () => {
    assert.equal(new Set(QUALITY_WORKSPACES.map(({ root }) => root)).size, QUALITY_WORKSPACES.length);
    assert.equal(new Set(QUALITY_WORKSPACES.map(({ name }) => name)).size, QUALITY_WORKSPACES.length);
    for (const { root, name } of QUALITY_WORKSPACES) {
      const manifest = join(ROOT, root, "package.json");
      assert.equal(existsSync(manifest), true, `${root} is missing`);
      assert.equal(JSON.parse(readFileSync(manifest, "utf8")).name, name);
    }
    assert.deepEqual(
      QUALITY_WORKSPACES.map(({ root }) => root).sort(),
      actualWorkspaceRoots().sort(),
    );
  });

  it("does not rebuild images for documentation-only changes", () => {
    const result = affectedStagingComponents(["docs/adr/0016-example.md"]);
    assert.deepEqual(selection(["docs/adr/0016-example.md"]), {
      web: false,
      public_mecky: false,
      e2e_workbench: false,
      staging_relay: false,
      any_service: false,
      any_publish: false,
    });
    assert.equal(result.quality_required, false);
    assert.equal(result.quality_full, false);
    assert.deepEqual(result.quality_packages, []);
  });

  it("keeps an agent-watcher change away from the Web and unrelated services", () => {
    const result = affectedStagingComponents(["packages/agent-watcher/src/cli.ts"]);
    assert.deepEqual(selection(["packages/agent-watcher/src/cli.ts"]), {
      web: false,
      public_mecky: true,
      e2e_workbench: false,
      staging_relay: false,
      any_service: true,
      any_publish: true,
    });
    assert.deepEqual(result.service_build_matrix, {
      include: [{
        component: "public-mecky",
        package: "@netizen-labs/agent-watcher",
        dockerfile: "packages/agent-watcher/Dockerfile",
      }],
    });
    assert.deepEqual(result.publish_build_matrix, {
      include: [{
        component: "public-mecky",
        package: "@netizen-labs/agent-watcher",
        dockerfile: "packages/agent-watcher/Dockerfile",
        image: "ghcr.io/giraeffleaeffle/public-mecky",
        archive: "public-mecky.oci.tar",
        max_artifact_bytes: "134217728",
        cache_mode: "min",
      }],
    });
    assert.equal(result.quality_required, true);
    assert.equal(result.quality_full, false);
    assert.equal(result.quality_web_tests, false);
    assert.deepEqual(result.quality_packages, ["@netizen-labs/agent-watcher"]);
  });

  it("selects the participant gateway as a scoped quality package without widening images", () => {
    const result = affectedStagingComponents([
      "packages/staging-participant-gateway/src/http.ts",
    ]);
    assert.deepEqual(selection(["packages/staging-participant-gateway/src/http.ts"]), {
      web: false,
      public_mecky: false,
      e2e_workbench: false,
      staging_relay: false,
      any_service: false,
      any_publish: false,
    });
    assert.equal(result.quality_required, true);
    assert.equal(result.quality_full, false);
    assert.equal(result.quality_web_tests, false);
    assert.deepEqual(result.quality_packages, [
      "@roebel/staging-participant-gateway",
    ]);
  });

  it("keeps citizen-adoption database contracts on the scoped gateway quality lane", () => {
    const paths = [
      "supabase/migrations/20260901_staging_citizen_adoption.sql",
      "supabase/staging-citizen-adoption-schema-contract-v1.json",
    ];
    const result = affectedStagingComponents(paths);
    assert.deepEqual(selection(paths), {
      web: false,
      public_mecky: false,
      e2e_workbench: false,
      staging_relay: false,
      any_service: false,
      any_publish: false,
    });
    assert.equal(result.quality_required, true);
    assert.equal(result.quality_full, false);
    assert.equal(result.quality_web_tests, false);
    assert.deepEqual(result.quality_packages, [
      "@roebel/staging-participant-gateway",
    ]);
  });

  it("selects changed workspaces without widening to the whole monorepo", () => {
    const result = affectedStagingComponents([
      "packages/protocol/src/manifest.ts",
      "packages/cli/src/render.ts",
    ]);
    assert.equal(result.quality_required, true);
    assert.equal(result.quality_full, false);
    assert.equal(result.quality_web_tests, true);
    assert.deepEqual(result.quality_packages, [
      "@netizen-labs/cli",
      "@netizen-labs/protocol",
    ]);
  });

  it("keeps shared Web tests while leaving the Web build to its OCI job", () => {
    const result = affectedStagingComponents(["packages/nostr/src/events.ts"]);
    assert.equal(result.quality_full, false);
    assert.equal(result.quality_web_tests, true);
    assert.deepEqual(result.quality_packages, ["@netizen-labs/nostr"]);
  });

  it("maps shared Nostr changes to every actual consumer", () => {
    assert.deepEqual(selection(["packages/nostr/src/events.ts"]), {
      web: true,
      public_mecky: true,
      e2e_workbench: true,
      staging_relay: true,
      any_service: true,
      any_publish: true,
    });
  });

  it("maps exact Web build inputs without widening to services", () => {
    for (const path of [
      "Dockerfile.staging-web",
      "Dockerfile.staging-web-runtime",
      "scripts/ci/build-staging-web-runtime.sh",
    ]) {
      assert.deepEqual(selection([path]), {
        web: true,
        public_mecky: false,
        e2e_workbench: false,
        staging_relay: false,
        any_service: false,
        any_publish: true,
      });
    }
  });

  it("maps every shared Web workspace dependency to the Web image", () => {
    for (const root of workspaceClosure("apps/web")) {
      assert.equal(
        affectedStagingComponents([`${root}/src/publisher-input.ts`]).web,
        true,
        root,
      );
    }
  });

  it("maps shared service workflow and verifier changes to all services but not Web", () => {
    for (const path of [
      ".github/workflows/staging-services-oci.yml",
      "scripts/verify-staging-service-oci.mjs",
      "scripts/verify-staging-service-oci.test.mjs",
    ]) {
      const result = affectedStagingComponents([path]);
      assert.deepEqual(selection([path]), {
        web: false,
        public_mecky: true,
        e2e_workbench: true,
        staging_relay: true,
        any_service: true,
        any_publish: true,
      });
      assert.deepEqual(
        result.service_build_matrix.include,
        STAGING_SERVICE_BUILD_MATRIX.map(({ key: _key, ...entry }) => entry),
      );
    }
  });

  it("fails closed for dependency and detector changes", () => {
    for (const path of [
      "pnpm-lock.yaml",
      "scripts/ci/affected-staging-components.mjs",
      "scripts/assemble-roebel-staging-release-set.mjs",
      ".github/workflows/roebel-staging-publish.yml",
      "__all__",
    ]) {
      const result = affectedStagingComponents([path]);
      assert.deepEqual(selection([path]), {
        web: true,
        public_mecky: true,
        e2e_workbench: true,
        staging_relay: true,
        any_service: true,
        any_publish: true,
      });
      assert.equal(result.quality_required, true);
      assert.equal(result.quality_full, true);
      assert.deepEqual(result.quality_packages, []);
      assert.deepEqual(
        result.publish_build_matrix.include,
        STAGING_PUBLISH_BUILD_MATRIX.map(({ key: _key, ...entry }) => entry),
      );
    }
    const mixed = affectedStagingComponents([
      "pnpm-lock.yaml",
      "packages/agent-watcher/src/cli.ts",
    ]);
    assert.equal(mixed.quality_full, true);
    assert.deepEqual(mixed.quality_packages, []);
  });

  it("selects only the changed protected publisher component", () => {
    const web = affectedStagingComponents(["apps/web/src/app/page.tsx"]);
    assert.equal(web.any_publish, true);
    assert.deepEqual(web.publish_build_matrix.include, [{
      component: "roebel-web-staging",
      package: "@roebel/web",
      dockerfile: "Dockerfile.staging-web-runtime",
      image: "ghcr.io/giraeffleaeffle/roebel-web-staging",
      archive: "roebel-web-staging.oci.tar",
      max_artifact_bytes: "167772160",
    }]);

    const docs = affectedStagingComponents(["docs/adr/publisher.md"]);
    assert.equal(docs.any_publish, false);
    assert.deepEqual(docs.publish_build_matrix, { include: [] });
  });

  it("treats a publisher workflow change as an explicit full rebuild", () => {
    const result = affectedStagingComponents([".github/workflows/roebel-staging-publish.yml"]);
    assert.equal(result.any_publish, true);
    assert.deepEqual(
      result.publish_build_matrix.include,
      STAGING_PUBLISH_BUILD_MATRIX.map(({ key: _key, ...entry }) => entry),
    );
  });

  it("fails closed to full quality for an unknown repository surface", () => {
    const result = affectedStagingComponents(["future/new-surface.ts"]);
    assert.equal(result.quality_required, true);
    assert.equal(result.quality_full, true);
  });

  it("rejects ambiguous or escaping paths", () => {
    for (const path of [" /apps/web/page.tsx", "/apps/web/page.tsx", "apps/../secrets", "apps\\web\\page.tsx"]) {
      assert.throws(() => affectedStagingComponents([path]), /Invalid changed path/u);
    }
  });

  it("emits closed booleans and a repository-owned service matrix to GitHub output", () => {
    const directory = mkdtempSync(join(tmpdir(), "roebel-affected-components-"));
    const output = join(directory, "github-output");
    try {
      const result = spawnSync(process.execPath, [CLI, "--github-output"], {
        input: "packages/agent-watcher/src/cli.ts\n",
        encoding: "utf8",
        env: { ...process.env, GITHUB_OUTPUT: output },
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(readFileSync(output, "utf8"), [
        "web=false",
        "public_mecky=true",
        "e2e_workbench=false",
        "staging_relay=false",
        "any_service=true",
        'service_build_matrix={"include":[{"component":"public-mecky","package":"@netizen-labs/agent-watcher","dockerfile":"packages/agent-watcher/Dockerfile"}]}',
        "any_publish=true",
        'publish_build_matrix={"include":[{"component":"public-mecky","package":"@netizen-labs/agent-watcher","dockerfile":"packages/agent-watcher/Dockerfile","image":"ghcr.io/giraeffleaeffle/public-mecky","archive":"public-mecky.oci.tar","max_artifact_bytes":"134217728","cache_mode":"min"}]}',
        "quality_required=true",
        "quality_full=false",
        "quality_web_tests=false",
        'quality_packages=["@netizen-labs/agent-watcher"]',
        "",
      ].join("\n"));
      assert.notEqual(
        spawnSync(process.execPath, [CLI, "--unknown"], { encoding: "utf8" }).status,
        0,
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
