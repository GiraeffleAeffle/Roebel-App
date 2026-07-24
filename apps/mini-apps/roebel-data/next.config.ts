import type { NextConfig } from "next";
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

  // A Talos-hosted preview can live below a shared staging host without
  // changing its public URLs or the normal Röbel host behaviour.
  ...(basePath ? { basePath } : {}),

  reactStrictMode: true,
};

export default nextConfig;
