import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  renderBundle,
  renderRoebelIdEnv,
  renderWebEnv,
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
    ["$COORDINATOR_PUBKEY", "$GNOSIS_RPC", "$MATRIX_CLIENT_SECRET", "$NEXTCLOUD_CLIENT_SECRET", "$ROEBEL_ID_JWKS"],
  );
  // the keystone env references the secret, it does not inline a value
  assert.match(bundle.files["roebel-id.env"], /NEXTCLOUD_CLIENT_SECRET=\$NEXTCLOUD_CLIENT_SECRET/);
  assert.match(bundle.files["SECRETS.md"], /\$ROEBEL_ID_JWKS/);
});

test("the plan is ordered and includes the workspace + chat steps for this manifest", () => {
  const ids = plan(roebel).map((s) => s.id);
  assert.deepEqual(ids, ["dns", "compose", "roebel-id", "nextcloud-oidc", "mas-oidc", "web-env", "verify"]);
});

test("bundle emits MAS + Element + Nextcloud files when those services are present", () => {
  const files = Object.keys(renderBundle(roebel).files);
  for (const f of ["roebel-id.env", "web.env", "PLAN.md", "SECRETS.md", "mas/config.yaml", "element/config.json", "nextcloud/setup.sh"]) {
    assert.ok(files.includes(f), `expected ${f} in bundle`);
  }
});
