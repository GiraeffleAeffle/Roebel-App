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
    "packages/miniapp-sdk/",
    "packages/nostr/",
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
    path.startsWith("scripts/ci/")
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
  return Object.freeze({
    ...affected,
    any_service: affected.public_mecky || affected.e2e_workbench || affected.staging_relay,
    service_build_matrix: serviceBuildMatrix,
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
      "",
    ].join("\n"), "utf8");
    return;
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}
