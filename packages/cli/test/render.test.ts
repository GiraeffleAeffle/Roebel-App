import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  renderBundle,
  renderRoebelIdEnv,
  renderWebEnv,
  renderStrfryConf,
  renderCaddyfile,
  renderComposeYml,
  renderBootstrap,
  collectSecretRefs,
  plan,
} from "../src/render.js";

const roebel = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../protocol/examples/roebel.netizen.json", import.meta.url)),
    "utf8",
  ),
);

test("roebel-id.env is generated from the manifest's relying parties", () => {
  const env = renderRoebelIdEnv(roebel);
  assert.match(env, /NEXTCLOUD_CLIENT_ID=nextcloud/);
  assert.match(env, /NEXTCLOUD_REDIRECT_URIS=https:\/\/cloud\.roebel\.app\/apps\/user_oidc\/code/);
  assert.match(env, /MATRIX_CLIENT_ID=matrix/);
  assert.match(env, /MATRIX_REDIRECT_URIS=https:\/\/auth\.roebel\.app\/upstream\/callback\//);
  assert.match(env, /ISSUER_URL=https:\/\/id\.roebel\.app/);
});

test("web.env carries exactly the two dashboard-tile base URLs", () => {
  const env = renderWebEnv(roebel);
  assert.match(env, /NEXT_PUBLIC_WORKSPACE_BASE_URL=https:\/\/cloud\.roebel\.app/);
  assert.match(env, /NEXT_PUBLIC_CHAT_BASE_URL=https:\/\/chat\.roebel\.app/);
});

test("secrets appear only as references, never resolved values", () => {
  const bundle = renderBundle(roebel);
  // every secret the manifest names is surfaced as a ref in SECRETS.md
  assert.deepEqual(
    collectSecretRefs(roebel).sort(),
    ["$COORDINATOR_PUBKEY", "$GNOSIS_BUNDLER_RPC", "$GNOSIS_RPC", "$MATRIX_CLIENT_SECRET", "$NEXTCLOUD_CLIENT_SECRET", "$ROEBEL_ID_JWKS", "$SUPABASE_URL"],
  );
  // the keystone env references the secret, it does not inline a value
  assert.match(bundle.files["roebel-id.env"], /NEXTCLOUD_CLIENT_SECRET=\$NEXTCLOUD_CLIENT_SECRET/);
  assert.match(bundle.files["SECRETS.md"], /\$ROEBEL_ID_JWKS/);
});

test("the plan is ordered and includes the workspace + chat + nostr steps", () => {
  const ids = plan(roebel).map((s) => s.id);
  assert.deepEqual(ids, ["dns", "compose", "roebel-id", "nextcloud-oidc", "mas-oidc", "nostr-relay", "web-env", "verify"]);
});

test("bundle emits the full deployable set (compose, caddy, matrix, nostr, nextcloud)", () => {
  const files = Object.keys(renderBundle(roebel).files);
  for (const f of [
    "README.md", "bootstrap.sh", "docker-compose.yml", "Caddyfile", "roebel-id.env", "web.env", "PLAN.md", "SECRETS.md",
    "mas/config.yaml", "element/config.json", "strfry.conf", "nextcloud/setup.sh",
  ]) {
    assert.ok(files.includes(f), `expected ${f} in bundle`);
  }
});

test("bootstrap.sh is an idempotent apply script (docker + .env gate + compose up)", () => {
  const b = renderBootstrap(roebel);
  assert.match(b, /command -v docker/);
  assert.match(b, /if \[ ! -f \.env \]/); // refuses to apply without secrets
  assert.match(b, /docker compose up -d/);
  assert.match(b, /bash nextcloud\/setup\.sh/); // roebel declares nextcloud
});

test("declared openDesk tools (mail/project) get Caddy routes", () => {
  const m = {
    ...roebel,
    services: {
      ...roebel.services,
      workspace: { ...roebel.services.workspace, mail: "https://mail.roebel.app", project: "https://project.roebel.app" },
    },
  };
  const caddy = renderCaddyfile(m);
  assert.match(caddy, /mail\.roebel\.app \{\n\s*reverse_proxy ox:8080/);
  assert.match(caddy, /project\.roebel\.app \{\n\s*reverse_proxy openproject:80/);
});

test("the Nostr relay is rendered and wired through Caddy + compose", () => {
  const strfry = renderStrfryConf(roebel);
  assert.match(strfry, /name = "Röbel \/ Müritz Relay"/);
  assert.match(strfry, /port = 7777/);
  const caddy = renderCaddyfile(roebel);
  assert.match(caddy, /relay\.roebel\.app \{\n\s*reverse_proxy strfry:7777/);
  assert.match(caddy, /id\.roebel\.app \{\n\s*reverse_proxy roebel-id:3010/);
  const compose = renderComposeYml(roebel);
  assert.match(compose, /strfry:/);
  assert.match(compose, /synapse:/);
  assert.match(compose, /roebel-id:/);
});
