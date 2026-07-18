import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

function repoFile(path: string): string {
  return readFileSync(fileURLToPath(new URL(`../../../${path}`, import.meta.url)), "utf8");
}

test("the Röbel Data deployment remains frameable and provider-configurable", () => {
  const appPackage = JSON.parse(
    repoFile("apps/mini-apps/roebel-data/package.json"),
  ) as { dependencies?: Record<string, string> };
  const vercel = JSON.parse(repoFile("apps/mini-apps/roebel-data/vercel.json")) as {
    headers?: Array<{ headers?: Array<{ key?: string; value?: string }> }>;
  };
  const envExample = repoFile("apps/mini-apps/roebel-data/.env.example");
  const nextConfig = repoFile("apps/mini-apps/roebel-data/next.config.ts");

  assert.equal(
    appPackage.dependencies?.["@roebel/stadtstack-federation-client"],
    "workspace:*",
  );
  assert.match(nextConfig, /@roebel\/stadtstack-federation-client/);
  assert.match(
    envExample,
    /^NEXT_PUBLIC_STADTSTACK_PUBLIC_BASE_URL=$/m,
  );
  assert.doesNotMatch(envExample, /(TOKEN|SECRET|PASSWORD|PRIVATE_KEY)\s*=/i);

  const headers = vercel.headers?.flatMap((entry) => entry.headers ?? []) ?? [];
  const frameAncestors = headers.find(
    (header) => header.key?.toLowerCase() === "content-security-policy",
  )?.value;
  assert.match(frameAncestors ?? "", /(?:^|;)\s*frame-ancestors\s+\*/i);
  assert.equal(
    headers.some(
      (header) =>
        header.key?.toLowerCase() === "x-frame-options" &&
        /^(deny|sameorigin)$/i.test(header.value ?? ""),
    ),
    false,
  );
});

test("the web iframe host preserves the SDK handshake and origin boundary", () => {
  const playground = repoFile("apps/web/src/components/mini-apps/Playground.tsx");
  const host = repoFile("apps/web/src/lib/miniapp-host/index.ts");

  assert.match(playground, /createWebMiniAppHost/);
  assert.match(
    playground,
    /sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"/,
  );
  assert.match(host, /iframe\.contentWindow\?\.postMessage\(message,/);
  assert.match(host, /if \(ev\.source !== iframe\.contentWindow\) return;/);
  assert.match(host, /if \(targetOrigin !== "\*" && ev\.origin !== targetOrigin\) return;/);
  assert.match(host, /openUrl: \(\{ url \}/);
});

test("the Expo WebView host preserves bridge delivery and external case navigation", () => {
  const host = repoFile("apps/expo/components/miniapp/MiniAppHost.tsx");

  assert.match(host, /createHostBridge\(\{/);
  assert.match(host, /onMessage=\{onMessage\}/);
  assert.match(host, /source=\{\{ uri: sourceUrl \}\}/);
  assert.match(host, /openUrl: \(\{ url \}\) => \{/);
  assert.match(host, /\^https\?:\\\/\\\//);
  assert.match(host, /Linking\.openURL\(url\)/);
});

test("the municipal-case edge stays reviewed-only and credentialless", () => {
  const clientPackage = JSON.parse(repoFile("packages/stadtstack-federation-client/package.json")) as {
    dependencies?: Record<string, string>;
  };
  const client = repoFile("packages/stadtstack-federation-client/src/client.ts");
  const section = repoFile(
    "apps/mini-apps/roebel-data/src/views/MunicipalDecisionCasesSection.tsx",
  );
  const app = repoFile("apps/mini-apps/roebel-data/src/App.tsx");

  const bannedDependencies = [
    "@netizen-labs/miniapp-sdk",
    "@supabase/supabase-js",
    "thirdweb",
    "viem",
  ];
  for (const dependency of bannedDependencies) {
    assert.equal(clientPackage.dependencies?.[dependency], undefined);
  }

  assert.match(client, /method: "GET"/);
  assert.match(client, /credentials: "omit"/);
  assert.match(client, /redirect: "error"/);
  assert.doesNotMatch(client, /method:\s*"(?:POST|PUT|PATCH|DELETE)"/);
  assert.match(section, /loadReviewedCivicCases\(\{/);
  assert.match(section, /municipalityId: "roebel-mueritz"/);
  assert.match(section, /NEXT_PUBLIC_STADTSTACK_PUBLIC_BASE_URL/);
  assert.doesNotMatch(section, /\b(?:fetch|supabase|wallet|grantReward|track)\s*\(/i);
  assert.match(app, /sdk\.actions\.openUrl\(url\)/);
});
