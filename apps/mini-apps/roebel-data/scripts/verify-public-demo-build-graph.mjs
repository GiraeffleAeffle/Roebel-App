import { readFile } from "node:fs/promises";
import path from "node:path";

const REQUIRED_CONFIG_BOUNDARIES = [
  '"src/entrypoints/public-demo.tsx"',
  '"src/entrypoints/public-demo-manifest.ts"',
  'distDir: publicDemoOnly ? ".next-public-demo" : ".next"',
  '"@roebel-data/entrypoint$"',
  '"@roebel-data/manifest$"',
];

const IMPORT_SOURCE = /^\s*import(?:\s+type)?\s+.+?\s+from\s+["']([^"']+)["']/gm;

export async function verifyPublicDemoBuildGraph({ appDirectory }) {
  const [pageSource, publicEntrypoint, publicManifest, nextConfig] = await Promise.all([
    readFile(path.join(appDirectory, "app", "page.tsx"), "utf8"),
    readFile(
      path.join(appDirectory, "src", "entrypoints", "public-demo.tsx"),
      "utf8",
    ),
    readFile(
      path.join(appDirectory, "src", "entrypoints", "public-demo-manifest.ts"),
      "utf8",
    ),
    readFile(path.join(appDirectory, "next.config.ts"), "utf8"),
  ]);

  if (!pageSource.includes('from "@roebel-data/entrypoint"')) {
    throw new Error("public demo page no longer uses the sealed build entrypoint alias");
  }
  const publicImports = [...publicEntrypoint.matchAll(IMPORT_SOURCE)].map(
    (match) => match[1],
  );
  if (publicImports.some((source) => source !== "react")) {
    throw new Error("public demo entrypoint imports a non-static application module");
  }
  if (/^\s*import(?:\s|\{|\*)/m.test(publicManifest)) {
    throw new Error("public demo manifest imports the normal host capability manifest");
  }

  for (const boundary of REQUIRED_CONFIG_BOUNDARIES) {
    if (!nextConfig.includes(boundary)) {
      throw new Error("public demo build configuration no longer selects the sealed static graph");
    }
  }

  return { checkedBoundaries: REQUIRED_CONFIG_BOUNDARIES.length };
}

const invokedAsScript = process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename;
if (invokedAsScript) {
  const appDirectory = process.cwd();
  const result = await verifyPublicDemoBuildGraph({ appDirectory });
  process.stdout.write(`public demo build graph: PASS (${result.checkedBoundaries} sealed boundaries verified)\n`);
}
