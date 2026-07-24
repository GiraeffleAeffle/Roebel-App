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

  // Emit a self-contained server so this mini app deploys standalone (Vercel /
  // Docker / Fly) without the rest of the monorepo. The host loads it by its
  // own `homeUrl`; it never runs "inside" the Röbel app process.
  output: "standalone",

  // A Talos-hosted preview can live below a shared staging host without
  // changing its public URLs or the normal Röbel host behaviour.
  ...(basePath ? { basePath } : {}),

  // The standalone public preview is intentionally a non-indexed demo. This
  // header is absent from normal Mini App builds.
  ...(publicDemoOnly
    ? {
        async headers() {
          return [
            {
              source: "/:path*",
              headers: [
                {
                  key: "X-Robots-Tag",
                  value: "noindex, nofollow, noarchive",
                },
              ],
            },
          ];
        },
      }
    : {}),

  reactStrictMode: true,
};

export default nextConfig;
