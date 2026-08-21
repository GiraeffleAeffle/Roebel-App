import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  isMarienfelderPublicDemo,
  normalizeMiniAppBasePath,
} from "./src/lib/publicDemoMode";

const publicDemoOnly = isMarienfelderPublicDemo(
  process.env.NEXT_PUBLIC_STADTSTACK_PUBLIC_DEMO_MODE,
);
const basePath = normalizeMiniAppBasePath(
  process.env.NEXT_PUBLIC_MINIAPP_BASE_PATH,
);
const configDirectory = path.dirname(fileURLToPath(import.meta.url));

// Both aliases are deliberately selected while the bundle is assembled, not
// from a runtime condition. That makes the public build's import graph a real
// boundary: webpack never sees the normal application shell or full manifest.
const appEntrypoint = path.resolve(
  configDirectory,
  publicDemoOnly
    ? "src/entrypoints/public-demo.tsx"
    : "src/entrypoints/normal-miniapp.tsx",
);
const manifestEntrypoint = path.resolve(
  configDirectory,
  publicDemoOnly
    ? "src/entrypoints/public-demo-manifest.ts"
    : "src/entrypoints/normal-manifest.ts",
);

const nextConfig: NextConfig = {
  // The SDK ships as TypeScript source (like @roebel/blockchain), so Next must
  // transpile it. MANDATORY for every mini app — without this the build fails.
  transpilePackages: [
    "@netizen-labs/miniapp-sdk",
    "@roebel/stadtstack-federation-client",
  ],

  // The normal Mini App retains its self-contained server build. The explicit
  // public demo has no server capability at all: it exports a static bundle
  // which the Talos preview serves from an unprivileged static web server.
  output: publicDemoOnly ? "export" : "standalone",

  // Keep the sealed graph in its own Next cache. Without this, a developer
  // switching from a normal standalone build to the public build can reuse a
  // cached full-App module graph even though the environment changed.
  distDir: publicDemoOnly ? ".next-public-demo" : ".next",

  // A Talos-hosted preview can live below a shared staging host without
  // changing its public URLs or the normal Röbel host behaviour.
  ...(basePath ? { basePath } : {}),

  reactStrictMode: true,

  webpack(config) {
    config.resolve ??= {};
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      "@roebel-data/entrypoint$": appEntrypoint,
      "@roebel-data/manifest$": manifestEntrypoint,
    };
    return config;
  },
};

export default nextConfig;
