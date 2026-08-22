// Every published mini app is served on its own subdomain of this apex domain
// (https://<slug>.roebel.site — the chatgpt.site / lovable.site pattern). The
// domain + wildcard *.roebel.site are attached to this Vercel project. Keep the
// default in sync with src/lib/miniapp/siteDomain.ts (this file can't import TS).
const MINI_APPS_SITE_DOMAIN = process.env.MINI_APPS_SITE_DOMAIN || "roebel.site";
const MINI_APPS_SITE_APEX_RE = MINI_APPS_SITE_DOMAIN.replace(/\./g, "\\.");
const MINI_APPS_SITE_HOST_RE = `(?<slug>[a-z0-9-]+)\\.${MINI_APPS_SITE_APEX_RE}`;

export function resolveWebpackParallelism(value) {
  if (value === undefined || value === "") return 1;
  if (value !== "1" && value !== "2")
    throw new Error("roebel_webpack_parallelism_invalid");
  return Number(value);
}

const WEBPACK_PARALLELISM = resolveWebpackParallelism(
  process.env.ROEBEL_WEBPACK_PARALLELISM,
);

export function resolveStagingBuildWorkers(value) {
  return value === "1";
}

// The Talos staging image builds on GitHub's 4-core / 16 GiB public runner.
// Unlike the smaller Vercel build, it has enough memory to run Next's server
// compilation and output tracing concurrently. No-publish run 32569355209
// proved compatibility with our custom fallbacks and externals and reduced the
// exact Next build from 363.5s to 279.8s. Keep the smaller Vercel build on its
// existing memory-constrained path.
const STAGING_BUILD_WORKERS = resolveStagingBuildWorkers(
  process.env.ROEBEL_STANDALONE_IMAGE,
);

/** @type {import('next').NextConfig} */
const nextConfig = {
  // The public/Vercel build keeps its existing output mode. Talos' immutable
  // staging image opts into Next's self-contained server explicitly.
  output: process.env.ROEBEL_STANDALONE_IMAGE === "1" ? "standalone" : undefined,
  // The Vercel build container is 4 cores / 8GB. Type-checking + ESLint over the
  // heavy crypto deps (thirdweb, snarkjs, ffjavascript, semaphore) ran the container
  // out of memory (exit 137 / SIGKILL) right after webpack compile. Move both passes
  // out of the production build — run `turbo run typecheck` / `lint` in CI instead.
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  // Vercel build hit exit 137 (OOM at the 8GB ceiling) again on 2026-07-08
  // (commit ac1c425, right at the webpack compile). This trades a bit of build
  // time for materially lower webpack memory — the documented next step after
  // the 4096MB heap cap (see package.json build script).
  experimental: {
    webpackMemoryOptimizations: true,
    webpackBuildWorker: STAGING_BUILD_WORKERS,
    parallelServerCompiles: STAGING_BUILD_WORKERS,
    parallelServerBuildTraces: STAGING_BUILD_WORKERS,
  },
  // The Netizen packages ship untranspiled TS source (main: src/index.ts), so
  // they must be transpiled by the app that consumes them.
  // @netizen-labs/workspace happens to be transpiled today even without being
  // listed — but only as a side effect of this array being non-empty for an
  // unrelated package. Naming it removes that dependency on a coincidence.
  transpilePackages: ["@netizen-labs/miniapp-sdk", "@netizen-labs/workspace", "@netizen-labs/record-client"],
  // Keep heavy server-only packages OUT of the webpack bundle (loaded from
  // node_modules at runtime instead). @safe-global/protocol-kit pulls in
  // @safe-global/safe-deployments — multi-MB of all-chain Safe contract JSON —
  // which, when bundled, blew the 8GB build container's memory (exit 137 / OOM).
  // These are imported server-side only (safe-server.ts / api-kit.ts).
  // `typescript` is required at runtime by the AI-builder preview route (it
  // transpiles generated TSX in a node:vm); keep it external so it loads from
  // node_modules instead of being bundled.
  serverExternalPackages: [
    "pino-pretty",
    "got",
    "typescript",
    "@safe-global/protocol-kit",
    "@safe-global/api-kit",
    "@safe-global/safe-deployments",
    "@safe-global/safe-modules-deployments",
    // MCP server stack (/api/[transport]) — bundling it tipped the build back
    // into exit 137 (OOM) from ac1c425 on; server-only, load from node_modules.
    "mcp-handler",
    "@modelcontextprotocol/sdk",
    "@vercel/functions",
  ],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
      {
        protocol: 'http',
        hostname: '**',
      },
    ],
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        got: false,
        // react-pdf/pdfjs reference node "canvas" which is not needed in the browser
        canvas: false,
      };
    }
    // The Vercel build container is 4 cores / 8GB and this app already sits at
    // the memory ceiling (thirdweb + viem + snarkjs/ffjavascript + maci crypto,
    // most bundled because they run in client pages and can't be externalized).
    // Any marginal dependency growth tips the webpack compile into exit 137
    // (container OOM / SIGKILL) — e.g. the viem 2.47→2.53 dedupe in #18.
    // Serializing module processing (parallelism = 1) trades a slower build for
    // a much lower peak RSS, reclaiming the headroom the heap cap + memory
    // optimizations alone no longer cover. If OOM recurs, enable Vercel Enhanced
    // Builds (larger machine) — code levers are exhausted at this point.
    config.parallelism = WEBPACK_PARALLELISM;
    return config;
  },
  async rewrites() {
    return {
      // beforeFiles: on <slug>.roebel.site EVERY path serves the app's HTML
      // (single-file apps may pushState to deep paths; a reload must not fall
      // through to the main site's pages). Must run before the filesystem, or
      // "/" would be served by the roebel.app homepage.
      beforeFiles: [
        {
          source: "/:path*",
          has: [{ type: "host", value: MINI_APPS_SITE_HOST_RE }],
          destination: "/mini/:slug",
        },
      ],
    };
  },
  async redirects() {
    return [
      // Bare roebel.site → the store. Subdomains never match (host is exact).
      {
        source: "/:path*",
        has: [{ type: "host", value: MINI_APPS_SITE_APEX_RE }],
        destination: "https://www.roebel.app/mini-apps",
        permanent: false,
      },
    ];
  },
  // Headers for Universal Links (iOS) and App Links (Android)
  async headers() {
    return [
      {
        source: '/.well-known/apple-app-site-association',
        headers: [
          {
            key: 'Content-Type',
            value: 'application/json',
          },
        ],
      },
      {
        source: '/.well-known/assetlinks.json',
        headers: [
          {
            key: 'Content-Type',
            value: 'application/json',
          },
        ],
      },
      {
        source: '/wasm/:path*',
        headers: [
          {
            key: 'Content-Type',
            value: 'application/wasm',
          },
        ],
      },
      {
        // Mini apps served from /mini/[slug] run with an opaque origin (CSP
        // sandbox) — @font-face fetches are CORS-gated there, so the shared
        // fonts must be readable cross-origin.
        source: '/fonts/:path*',
        headers: [
          {
            key: 'Access-Control-Allow-Origin',
            value: '*',
          },
        ],
      },
      {
        // Self-hosted @netizen-labs/miniapp-sdk bundle (synced from
        // packages/miniapp-sdk via `pnpm sync-web`). Imported as an ES module
        // by sandboxed /mini/[slug] apps (opaque origin) and by externally
        // hosted mini apps — must be CORS-readable everywhere.
        source: '/sdk/:path*',
        headers: [
          {
            key: 'Access-Control-Allow-Origin',
            value: '*',
          },
          {
            key: 'Cache-Control',
            value: 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
