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

// A node that declares the FULL suite. Röbel's own manifest deliberately declares
// only what the installer can stand up today, so suite-coverage tests use this.
const fullNode = {
  ...roebel,
  services: {
    ...roebel.services,
    workspace: {
      ...roebel.services.workspace,
      mail: "https://mail.roebel.app",
      wiki: "https://wiki.roebel.app",
      video: "https://meet.roebel.app",
      project: "https://project.roebel.app",
      portal: "https://agents.roebel.app",
    },
    chat: {
      ...roebel.services.chat,
      matrix: {
        homeserver: "https://matrix.roebel.app",
        mas: "https://auth.roebel.app",
        element: "https://chat.roebel.app",
      },
    },
  },
};

// Röbel hosts its keystone on Fly (hosted: "external"). Tests that assert on
// keystone artifacts use this self-hosting variant.
const selfHosted = {
  ...roebel,
  identity: { ...roebel.identity, idp: { ...roebel.identity.idp, hosted: "node" } },
};

test("roebel-id.env is generated from the manifest's relying parties", () => {
  const env = renderRoebelIdEnv(fullNode);
  assert.match(env, /NEXTCLOUD_CLIENT_ID=nextcloud/);
  assert.match(env, /NEXTCLOUD_REDIRECT_URIS=https:\/\/cloud\.roebel\.app\/apps\/user_oidc\/code/);
  assert.match(env, /MATRIX_CLIENT_ID=matrix/);
  assert.match(env, /MATRIX_REDIRECT_URIS=https:\/\/auth\.roebel\.app\/upstream\/callback\//);
  assert.match(env, /ISSUER_URL=https:\/\/id\.roebel\.app/);
});

test("web.env carries exactly the two dashboard-tile base URLs", () => {
  const env = renderWebEnv(fullNode);
  assert.match(env, /NEXT_PUBLIC_WORKSPACE_BASE_URL=https:\/\/cloud\.roebel\.app/);
  assert.match(env, /NEXT_PUBLIC_CHAT_BASE_URL=https:\/\/chat\.roebel\.app/);
});

test("secrets appear only as references, never resolved values", () => {
  const bundle = renderBundle(fullNode);
  // every secret the manifest names is surfaced as a ref in SECRETS.md
  assert.deepEqual(
    collectSecretRefs(roebel).sort(),
    ["$COORDINATOR_PUBKEY", "$GNOSIS_BUNDLER_RPC", "$GNOSIS_RPC", "$MATRIX_CLIENT_SECRET", "$NEXTCLOUD_CLIENT_SECRET", "$ROEBEL_ID_JWKS", "$SUPABASE_URL"],
  );
  // the keystone env references the secret, it does not inline a value
  assert.match(renderBundle(selfHosted).files["roebel-id.env"], /NEXTCLOUD_CLIENT_SECRET=\$NEXTCLOUD_CLIENT_SECRET/);
  assert.match(bundle.files["SECRETS.md"], /\$ROEBEL_ID_JWKS/);
});

test("the plan is ordered and covers every declared surface", () => {
  const ids = plan(fullNode).map((s) => s.id);
  assert.deepEqual(ids, [
    "dns", "secrets", "compose", "identity",
    "nextcloud-oidc", "mail-oidc", "wiki-oidc", "video-auth", "project-oidc",
    "mas-oidc", "nostr-relay", "web-env", "verify",
  ]);
  // the DNS step names every host the node actually needs
  // the external keystone is NOT a host that points at this box
  assert.match(plan(fullNode)[0].title, /cloud, matrix, auth, chat, relay, mail, wiki, meet, project/);
  assert.deepEqual(plan({ ...fullNode, identity: selfHosted.identity }).map((s) => s.id)[3], "roebel-id");
});

test("bundle emits the full deployable set (compose, caddy, matrix, nostr, nextcloud)", () => {
  const files = Object.keys(renderBundle(fullNode).files);
  for (const f of [
    "README.md", "bootstrap.sh", "docker-compose.yml", "Caddyfile", "web.env", "PLAN.md", "SECRETS.md",
    "mas/config.yaml", "element/config.json", "strfry.conf", "nextcloud/setup.sh",
  ]) {
    assert.ok(files.includes(f), `expected ${f} in bundle`);
  }
});

test("the installer provisions the whole declared stack (identity, comms, workspace, AI)", () => {
  const compose = renderComposeYml(fullNode);
  assert.ok(renderComposeYml(selfHosted).includes("roebel-id:"), "self-hosted keystone is provisioned");
  // comms
  for (const s of ["synapse:", "mas:", "element:", "strfry:", "caddy:"]) {
    assert.ok(compose.includes(s), `expected service ${s}`);
  }
  // workspace suite declared by the Röbel manifest
  for (const s of ["nextcloud:", "collabora:", "xwiki:", "jitsi:", "openproject:"]) {
    assert.ok(compose.includes(s), `expected service ${s}`);
  }
  // postgres is included because Matrix/Nextcloud/XWiki/OpenProject need it
  assert.ok(compose.includes("postgres:"));
});

test("services are config-gated — a node that declares nothing gets no workspace services", () => {
  const bare = {
    ...roebel,
    services: { host: roebel.services.host },
    ai: undefined,
  };
  const compose = renderComposeYml(bare);
  for (const s of ["nextcloud:", "xwiki:", "jitsi:", "openproject:", "synapse:", "strfry:", "litellm:"]) {
    assert.ok(!compose.includes(s), `did not expect ${s} in a bare node`);
  }
  assert.ok(compose.includes("caddy:"));
});

test("the Nostr members-only write policy ships WITH the node (not hand-wired)", () => {
  const b = renderBundle(roebel);
  for (const f of ["strfry-policy/policy.awk", "strfry-policy/write-policy.sh", "strfry-policy/members.txt", "strfry-policy/add-member.sh"]) {
    assert.ok(Object.keys(b.files).includes(f), `expected ${f}`);
  }
  // strfry.conf points at the rendered plugin
  assert.match(b.files["strfry.conf"], /writePolicy \{ plugin = "\/etc\/strfry\/write-policy\.sh" \}/);
  // and the relay mounts the policy DIRECTORY (inode gotcha: single-file mounts
  // break live revokes because sed -i replaces the inode)
  assert.match(b.files["docker-compose.yml"], /\.\/strfry-policy:\/etc\/strfry:ro/);
});

test("web.env carries one var per declared workspace surface", () => {
  const env = renderWebEnv(fullNode);
  for (const v of [
    "NEXT_PUBLIC_WORKSPACE_BASE_URL", "NEXT_PUBLIC_CHAT_BASE_URL", "NEXT_PUBLIC_WIKI_BASE_URL",
    "NEXT_PUBLIC_VIDEO_BASE_URL", "NEXT_PUBLIC_PROJECT_BASE_URL", "NEXT_PUBLIC_AGENTS_BASE_URL",
  ]) {
    assert.ok(env.includes(v), `expected ${v}`);
  }
  // undeclared surfaces are omitted (Röbel runs no Open-Xchange yet)
  assert.ok(!renderWebEnv(roebel).includes("NEXT_PUBLIC_WIKI_BASE_URL"), "undeclared surfaces are omitted");
});

test("an externally hosted keystone is never re-provisioned by the installer", () => {
  // Röbel runs its keystone on Fly (hosted: "external").
  const b = renderBundle(fullNode);
  assert.ok(!b.files["docker-compose.yml"].includes("roebel-id:"), "must not start a second keystone");
  assert.ok(!b.files["Caddyfile"].includes("id.roebel.app"), "must not route the external issuer locally");
  assert.ok(!Object.keys(b.files).includes("roebel-id.env"), "must not emit keystone env it does not own");
  assert.match(b.files["PLAN.md"], /hosted externally/);
  // ...but the services still point at it
  assert.match(b.files["mas/config.yaml"], /issuer: https:\/\/id\.roebel\.app/);
});

test("a node that hosts its own keystone still provisions it", () => {
  const selfHosted = { ...roebel, identity: { ...roebel.identity, idp: { ...roebel.identity.idp, hosted: "node" } } };
  const b = renderBundle({ ...fullNode, identity: selfHosted.identity });
  assert.ok(b.files["docker-compose.yml"].includes("roebel-id:"));
  assert.ok(b.files["Caddyfile"].includes("id.roebel.app"));
  assert.ok(Object.keys(b.files).includes("roebel-id.env"));
});

test("bootstrap.sh is an idempotent apply script (docker + .env gate + compose up)", () => {
  const b = renderBootstrap(fullNode);
  assert.match(b, /command -v docker/);
  assert.match(b, /if \[ ! -f \.env \]/); // refuses to apply without secrets
  assert.match(b, /docker compose up -d/);
  // roebel declares nextcloud → the bootstrap runs its OIDC/group-folder setup
  // inside the container (idempotent, tolerates a not-yet-installed instance)
  assert.match(b, /nextcloud sh < nextcloud\/setup\.sh/);
});

test("declared openDesk tools (mail/project) get Caddy routes", () => {
  const m = {
    ...fullNode,
    services: {
      ...fullNode.services,
      workspace: { ...fullNode.services.workspace, mail: "https://mail.roebel.app", project: "https://project.roebel.app" },
    },
  };
  const caddy = renderCaddyfile(m);
  assert.match(caddy, /mail\.roebel\.app \{\n\s*reverse_proxy ox:8080/);
  assert.match(caddy, /project\.roebel\.app \{\n\s*reverse_proxy openproject:80/);
});

test("the Nostr relay is rendered and wired through Caddy + compose", () => {
  const strfry = renderStrfryConf(fullNode);
  assert.match(strfry, /name = "Röbel \/ Müritz Relay"/);
  assert.match(strfry, /port = 7777/);
  const caddy = renderCaddyfile(fullNode);
  assert.match(caddy, /relay\.roebel\.app \{\n\s*reverse_proxy strfry:7777/);
  assert.match(renderCaddyfile(selfHosted), /id\.roebel\.app \{\n\s*reverse_proxy roebel-id:3010/);
  const compose = renderComposeYml(fullNode);
  assert.match(compose, /strfry:/);
  assert.match(compose, /synapse:/);
  assert.match(renderComposeYml(selfHosted), /roebel-id:/);
});
