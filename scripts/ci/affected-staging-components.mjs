import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const STAGING_COMPONENTS = [
  "web",
  "public_mecky",
  "e2e_workbench",
  "staging_relay",
];

export const STAGING_SERVICE_BUILD_MATRIX = Object.freeze([
  Object.freeze({
    key: "public_mecky",
    component: "public-mecky",
    package: "@netizen-labs/agent-watcher",
    dockerfile: "packages/agent-watcher/Dockerfile",
  }),
  Object.freeze({
    key: "e2e_workbench",
    component: "roebel-e2e-workbench",
    package: "@roebel/e2e-workbench",
    dockerfile: "packages/e2e-workbench/Dockerfile",
  }),
  Object.freeze({
    key: "staging_relay",
    component: "roebel-staging-relay",
    package: "@roebel/staging-relay",
    dockerfile: "packages/staging-relay/Dockerfile",
  }),
]);

// The protected publisher has a smaller, separate image boundary than the
// service-only workflow. Keep this matrix explicit so a component-only
// publication can never accidentally widen into a second image build.
export const STAGING_PUBLISH_BUILD_MATRIX = Object.freeze([
  Object.freeze({
    key: "web",
    component: "roebel-web-staging",
    package: "@roebel/web",
    dockerfile: "Dockerfile.staging-web-runtime",
    image: "ghcr.io/giraeffleaeffle/roebel-web-staging",
    archive: "roebel-web-staging.oci.tar",
    max_artifact_bytes: "167772160",
  }),
  Object.freeze({
    key: "public_mecky",
    component: "public-mecky",
    package: "@netizen-labs/agent-watcher",
    dockerfile: "packages/agent-watcher/Dockerfile",
    image: "ghcr.io/giraeffleaeffle/public-mecky",
    archive: "public-mecky.oci.tar",
    max_artifact_bytes: "134217728",
    cache_mode: "min",
  }),
]);

/**
 * Closed workspace ownership used by the quality gate. The detector tests
 * this list against every workspace package.json so a newly added package
 * cannot silently escape CI.
 */
export const QUALITY_WORKSPACES = Object.freeze([
  ["apps/expo", "@roebel/expo"],
  ["apps/mini-apps/_template", "@netizen/miniapp-template"],
  ["apps/mini-apps/roebel-data", "@netizen/miniapp-roebel-data"],
  ["apps/roebel-id", "@roebel/roebel-id"],
  ["apps/web", "@roebel/web"],
  ["contracts/governor-contract", "hardhat-javascript-starter"],
  ["packages/agent-watcher", "@netizen-labs/agent-watcher"],
  ["packages/blockchain", "@roebel/blockchain"],
  ["packages/cli", "@netizen-labs/cli"],
  ["packages/config", "@roebel/config"],
  ["packages/design-tokens", "@roebel/design-tokens"],
  ["packages/e2e-workbench", "@roebel/e2e-workbench"],
  ["packages/facilitator", "@netizen-labs/facilitator"],
  ["packages/gateway", "@netizen-labs/gateway"],
  ["packages/indexer", "@netizen-labs/indexer"],
  ["packages/miniapp-sdk", "@netizen-labs/miniapp-sdk"],
  ["packages/nostr", "@netizen-labs/nostr"],
  ["packages/protocol", "@netizen-labs/protocol"],
  ["packages/publisher", "@netizen-labs/publisher"],
  ["packages/record-client", "@netizen-labs/record-client"],
  ["packages/relay-sync", "@netizen-labs/relay-sync"],
  ["packages/stadtstack-federation-client", "@roebel/stadtstack-federation-client"],
  ["packages/staging-relay", "@roebel/staging-relay"],
  ["packages/staging-participant-gateway", "@roebel/staging-participant-gateway"],
  ["packages/workspace", "@netizen-labs/workspace"],
].map(([root, name]) => Object.freeze({ root, name })));

const FULL_QUALITY_PATHS = new Set([
  ".github/workflows/ci.yml",
  ".npmrc",
  ".nvmrc",
  ".prettierrc",
  "app.json",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "turbo.json",
]);

const QUALITY_FREE_PATHS = new Set([
  ".dockerignore",
  ".gitignore",
  ".mcp.json",
  "CLAUDE.md",
  "CODE_OF_CONDUCT.md",
  "CONTEXT.md",
  "CONTRIBUTING.md",
  "Dockerfile.staging-web",
  "Dockerfile.staging-web.dockerignore",
  "LICENSE",
  "README.md",
  "SECURITY.md",
  "scripts/verify-staging-service-oci.mjs",
  "scripts/verify-staging-service-oci.test.mjs",
  "scripts/verify-staging-web-oci.mjs",
  "scripts/verify-staging-web-oci.test.mjs",
]);

const QUALITY_EXACT_PACKAGE_PATHS = new Map([
  [
    "supabase/migrations/20260901_staging_citizen_adoption.sql",
    "@roebel/staging-participant-gateway",
  ],
  [
    "supabase/staging-citizen-adoption-schema-contract-v1.json",
    "@roebel/staging-participant-gateway",
  ],
  [
    "supabase/migrations/20260902_staging_synthetic_citizen_adoption.sql",
    "@roebel/staging-participant-gateway",
  ],
  [
    "supabase/staging-synthetic-citizen-adoption-schema-contract-v1.json",
    "@roebel/staging-participant-gateway",
  ],
]);

function qualitySelection(changedPaths, affected) {
  let full = changedPaths.includes("__all__");
  const packages = new Set();
  for (const path of changedPaths) {
    if (path === "__all__") continue;
    const exactPackage = QUALITY_EXACT_PACKAGE_PATHS.get(path);
    if (exactPackage) {
      packages.add(exactPackage);
      continue;
    }
    const workspace = QUALITY_WORKSPACES.find(({ root }) =>
      path === `${root}/package.json` || path.startsWith(`${root}/`)
    );
    if (workspace) {
      packages.add(workspace.name);
      continue;
    }
    if (
      QUALITY_FREE_PATHS.has(path) ||
      path.startsWith("docs/") ||
      path.startsWith(".changeset/")
    ) {
      continue;
    }
    if (
      FULL_QUALITY_PATHS.has(path) ||
      path.startsWith("patches/") ||
      path.startsWith("scripts/ci/") ||
      path.startsWith(".github/workflows/")
    ) {
      full = true;
      continue;
    }
    // Unknown repository surfaces fail closed to the complete quality suite.
    full = true;
  }
  const packageNames = Object.freeze(full ? [] : [...packages].sort());
  return Object.freeze({
    quality_required: full || packageNames.length > 0,
    quality_full: full,
    quality_web_tests: full || affected.web,
    quality_packages: packageNames,
  });
}

const ALL_COMPONENT_PATHS = new Set([
  ".npmrc",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "turbo.json",
]);

const PREFIXES = {
  web: [
    "apps/web/",
    "packages/blockchain/",
    "packages/miniapp-sdk/",
    "packages/nostr/",
    "packages/protocol/",
    "packages/publisher/",
    "packages/record-client/",
    "packages/workspace/",
  ],
  public_mecky: [
    "packages/agent-watcher/",
    "packages/nostr/",
    "packages/stadtstack-federation-client/",
  ],
  e2e_workbench: [
    "packages/e2e-workbench/",
    "packages/nostr/",
    "packages/relay-sync/",
  ],
  staging_relay: [
    "packages/nostr/",
    "packages/staging-relay/",
  ],
};

const EXACT_PATHS = {
  web: new Set([
    ".github/workflows/ci.yml",
    ".github/workflows/staging-web-oci.yml",
    "Dockerfile.staging-web",
    "Dockerfile.staging-web.dockerignore",
    "Dockerfile.staging-web-runtime",
    "scripts/ci/build-staging-web-runtime.sh",
    "scripts/verify-staging-web-oci.mjs",
    "scripts/verify-staging-web-oci.test.mjs",
  ]),
  public_mecky: new Set([]),
  e2e_workbench: new Set([]),
  staging_relay: new Set([]),
};

for (const component of ["public_mecky", "e2e_workbench", "staging_relay"]) {
  for (const path of [
    ".github/workflows/staging-services-oci.yml",
    "scripts/verify-staging-service-oci.mjs",
    "scripts/verify-staging-service-oci.test.mjs",
  ]) {
    EXACT_PATHS[component].add(path);
  }
}

function cleanPaths(paths) {
  if (!Array.isArray(paths)) throw new Error("Changed paths must be an array.");
  return [...new Set(paths.map((value) => {
    if (
      typeof value !== "string" ||
      !value ||
      value !== value.trim() ||
      value.startsWith("/") ||
      value.includes("\\") ||
      value.includes("\0") ||
      value.split("/").includes("..")
    ) {
      throw new Error("Invalid changed path.");
    }
    return value;
  }))].sort();
}

/**
 * Map repository changes onto immutable staging image boundaries. Unknown
 * paths do not build an image; `__all__` is the explicit fail-closed sentinel
 * used when Git cannot establish an exact comparison range.
 */
export function affectedStagingComponents(paths) {
  const changedPaths = cleanPaths(paths);
  const all = changedPaths.includes("__all__") || changedPaths.some((path) =>
    ALL_COMPONENT_PATHS.has(path) ||
    path.startsWith("patches/") ||
    (path.startsWith("scripts/ci/") && path !== "scripts/ci/build-staging-web-runtime.sh") ||
    path === "scripts/assemble-roebel-staging-release-set.mjs" ||
    path === ".github/workflows/roebel-staging-publish.yml"
  );
  const affected = Object.fromEntries(STAGING_COMPONENTS.map((component) => [
    component,
    all || changedPaths.some((path) =>
      EXACT_PATHS[component].has(path) ||
      PREFIXES[component].some((prefix) => path.startsWith(prefix))
    ),
  ]));
  const serviceBuildMatrix = Object.freeze({
    include: Object.freeze(STAGING_SERVICE_BUILD_MATRIX
      .filter(({ key }) => affected[key])
      .map(({ key: _key, ...entry }) => Object.freeze(entry))),
  });
  const publishBuildMatrix = Object.freeze({
    include: Object.freeze(STAGING_PUBLISH_BUILD_MATRIX
      .filter(({ key }) => affected[key])
      .map(({ key: _key, ...entry }) => Object.freeze(entry))),
  });
  const quality = qualitySelection(changedPaths, affected);
  return Object.freeze({
    ...affected,
    any_service: affected.public_mecky || affected.e2e_workbench || affected.staging_relay,
    any_publish: affected.web || affected.public_mecky,
    service_build_matrix: serviceBuildMatrix,
    publish_build_matrix: publishBuildMatrix,
    ...quality,
    changed_paths: Object.freeze(changedPaths),
  });
}

function runCli() {
  const args = new Set(process.argv.slice(2));
  if ([...args].some((arg) => arg !== "--github-output")) {
    throw new Error("Unknown affected-components option.");
  }
  const input = readFileSync(0, "utf8");
  if (input.includes("\r")) throw new Error("Changed path input is ambiguous.");
  const result = affectedStagingComponents(input.split("\n").filter(Boolean));
  if (args.has("--github-output")) {
    const output = process.env.GITHUB_OUTPUT;
    if (!output) throw new Error("GITHUB_OUTPUT is required.");
    appendFileSync(output, [
      `web=${result.web}`,
      `public_mecky=${result.public_mecky}`,
      `e2e_workbench=${result.e2e_workbench}`,
      `staging_relay=${result.staging_relay}`,
      `any_service=${result.any_service}`,
      `service_build_matrix=${JSON.stringify(result.service_build_matrix)}`,
      `any_publish=${result.any_publish}`,
      `publish_build_matrix=${JSON.stringify(result.publish_build_matrix)}`,
      `quality_required=${result.quality_required}`,
      `quality_full=${result.quality_full}`,
      `quality_web_tests=${result.quality_web_tests}`,
      `quality_packages=${JSON.stringify(result.quality_packages)}`,
      "",
    ].join("\n"), "utf8");
    return;
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}
