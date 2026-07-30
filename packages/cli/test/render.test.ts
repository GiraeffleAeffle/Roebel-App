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
  renderSynapseConfig,
  renderMasConfig,
  renderMatrixSecretsScript,
  collectSecretRefs,
  backupTargets,
  renderBackupScript,
  renderRestoreScript,
  renderHardeningScript,
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
    ["$COORDINATOR_PUBKEY", "$GNOSIS_BUNDLER_RPC", "$GNOSIS_RPC", "$MATRIX_CLIENT_SECRET", "$NEXTCLOUD_CLIENT_SECRET", "$ROEBEL_ID_JWKS", "$SUPABASE_URL", "$WEB_CLIENT_SECRET"],
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
    // Federation follows the relay: peers are mirrored into a store that only
    // exists once the node's own Nostr surface is up.
    // The indexer follows the relay: it indexes stores that must exist first.
    "mas-oidc", "nostr-relay", "indexer", "federation", "web-env",
    // Operations come after the services exist but before "verify" — a node is
    // not verified until it is also survivable.
    "backup", "backup-offsite", "backup-restore-test", "harden", "firewall",
    "verify",
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

test("Synapse delegates ALL auth to MAS and trusts the proxy", () => {
  const c = renderSynapseConfig(fullNode);
  assert.match(c, /server_name: "roebel\.app"/);          // not matrix.roebel.app
  // Synapse REMOVED experimental_features.msc3861; newer builds reject it outright
  assert.match(c, /matrix_authentication_service:\n\s+enabled: true/);
  // the removed key must not be EMITTED (it may still be named in a comment)
  assert.ok(!/^\s*msc3861:/m.test(c), "the removed experimental key must not be emitted");
  assert.ok(!/experimental_features:/.test(c), "no experimental auth block at all");
  assert.match(c, /x_forwarded: true/);                    // real client IPs behind Caddy
  assert.match(c, /enable_registration: false/);
  assert.match(c, /password_config:\n\s+enabled: false/);  // no shadow password accounts
});

test("MAS uses the node's own keystone as the only identity source", () => {
  const c = renderMasConfig(fullNode);
  assert.ok(c.includes(`issuer: ${fullNode.identity.idp.issuer}`), "upstream = our keystone");
  assert.match(c, /passwords:\n\s+enabled: false/);
  assert.match(c, /password_registration_enabled: false/);
  // signing keys referenced by PATH — never inlined into a rendered bundle
  assert.match(c, /key_file: \/keys\/rsa\.pem/);
  assert.ok(!/BEGIN (RSA )?PRIVATE KEY/.test(c), "no key material in the bundle");
});

test("Matrix secrets are generated on the box, idempotently, never rendered", () => {
  const b = renderBundle(fullNode);
  const gen = b.files["matrix/generate-secrets.sh"];
  assert.ok(gen, "generator must ship");
  assert.match(gen, /openssl rand -hex 32/);
  assert.match(gen, /grep -q "\^\$1="/);   // only adds what is missing
  assert.match(gen, /openssl genpkey/);    // MAS signing keys
  // the rendered configs carry placeholders, not values
  assert.match(b.files["mas/config.yaml"], /\$\{MAS_ENCRYPTION_SECRET\}/);
  assert.match(b.files["synapse/homeserver.yaml"], /\$\{POSTGRES_PASSWORD\}/);
  // and the bootstrap substitutes them on the box
  assert.match(b.files["bootstrap.sh"], /envsubst < mas\/config\.yaml/);
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

// ---------------------------------------------------------------------------
// Operations (NSP-9). These assert the FAILURE modes, not the happy path — each
// one below corresponds to a way a backup can look successful while being useless.
// ---------------------------------------------------------------------------

test("backup targets narrow to what the node actually runs", () => {
  // An include list can filter, but must never invent a target the node lacks —
  // that would render a dump step for a container that does not exist and the
  // nightly run would report an error every night until someone muted it.
  const noRelay = { ...roebel, services: { ...roebel.services, chat: {} } };
  assert.deepEqual(backupTargets(roebel), ["postgres", "nextcloud", "strfry"]);
  assert.deepEqual(backupTargets(noRelay), ["postgres", "nextcloud"]);
  const narrowed = { ...roebel, operations: { ...roebel.operations, backup: { ...roebel.operations.backup, include: ["postgres"] } } };
  assert.deepEqual(backupTargets(narrowed), ["postgres"]);
});

test("postgres is dumped with pg_dump, never copied as files", () => {
  const s = renderBackupScript(roebel);
  // A snapshot of a running Postgres is crash-consistent, not transaction-
  // consistent — it can restore into a corrupt database.
  assert.match(s, /pg_dump -U postgres -Fc/);
  // Databases are enumerated live; a hardcoded list silently misses a new one.
  assert.match(s, /select datname from pg_database where not datistemplate/);
});

test("nextcloud files+db are captured in one maintenance window, and the trap always closes it", () => {
  const s = renderBackupScript(roebel);
  assert.match(s, /maintenance:mode --on/);
  // Without the trap, a backup that dies mid-run leaves the town's cloud offline
  // until a human notices. This is the single most important line in the script.
  assert.match(s, /trap 'maintenance_off' EXIT INT TERM/);
  assert.match(s, /maintenance_off\(\)/);
});

test("strfry is exported, never file-copied (live LMDB can be torn)", () => {
  const s = renderBackupScript(roebel);
  assert.match(s, /strfry export/);
  assert.doesNotMatch(s, /cp .*strfry-db/);
  // The write allow-list is state too: losing it silently locks out every citizen.
  assert.match(s, /members\.txt/);
});

test("a zero-byte artifact is an error, not a success", () => {
  const s = renderBackupScript(roebel);
  assert.match(s, /-gt 0 \] \|\| fail "\$1 is empty"/);
  // status.json is written atomically so an agent never parses a half-written file.
  assert.match(s, /mv "\$STATUS\.tmp" "\$STATUS"/);
  assert.match(s, /"ok": \$\(\[ "\$ERRORS" -eq 0 \]/);
});

test("offsite is loud when unconfigured — silence would read as safety", () => {
  const s = renderBackupScript(roebel);
  assert.match(s, /BACKUP_RESTIC_REPOSITORY/);
  assert.match(s, /OFFSITE_STATE="unconfigured"/);
  assert.match(s, /warn "BACKUP_RESTIC_REPOSITORY/);
  // A node that declares no offsite says so in the status, rather than omitting it.
  const none = { ...roebel, operations: { ...roebel.operations, backup: { ...roebel.operations.backup, offsite: "none" } } };
  assert.match(renderBackupScript(none), /OFFSITE_STATE="disabled-by-manifest"/);
});

test("restore refuses to overwrite live data without --yes", () => {
  const s = renderRestoreScript(roebel);
  assert.match(s, /Refusing to overwrite live data without --yes/);
  assert.match(s, /pg_restore -U postgres --clean --if-exists/);
  // Restoring files and db must re-enter the same maintenance window.
  assert.match(s, /maintenance:mode --on/);
});

test("hardening refuses to lock the operator out", () => {
  const s = renderHardeningScript(roebel);
  // Reading the EFFECTIVE config (sshd -T), because a later Include can override
  // whatever was just written into sshd_config.
  assert.match(s, /sshd -T/);
  assert.match(s, /\[ -s \/root\/\.ssh\/authorized_keys \]/);
  assert.match(s, /REFUSED: \/root\/\.ssh\/authorized_keys is empty/);
  assert.match(s, /fail2ban/);
  // ufw is never trusted: Docker bypasses it.
  assert.match(s, /does NOT protect published Docker ports/);
});

test("ops files ship in the bundle and bootstrap installs the timer", () => {
  const { files, plan: steps } = renderBundle(roebel);
  for (const f of ["ops/backup.sh", "ops/restore.sh", "ops/harden.sh", "ops/netizen-backup.timer", "ops/netizen-backup.service", "ops/README.md"]) {
    assert.ok(files[f], `missing ${f}`);
  }
  assert.match(files["ops/netizen-backup.timer"], /OnCalendar=02:30/);
  // If the box was off at 02:30, run at next boot rather than skipping the night.
  assert.match(files["ops/netizen-backup.timer"], /Persistent=true/);
  const b = renderBootstrap(roebel);
  assert.match(b, /systemctl enable --now netizen-backup\.timer/);
  assert.match(b, /bash ops\/harden\.sh/);
  // The plan names the restore test explicitly — it is the step people skip.
  assert.ok(steps.some((s) => s.id === "backup-restore-test"));
  assert.ok(steps.some((s) => s.id === "firewall"));
});

test("a node declaring no operations renders no ops files (nothing is forced)", () => {
  const bare = { ...roebel };
  delete (bare as Record<string, unknown>).operations;
  const { files } = renderBundle(bare);
  assert.equal(files["ops/backup.sh"], undefined);
  assert.doesNotMatch(renderBootstrap(bare), /netizen-backup\.timer/);
});

test("hardening never treats 'cannot measure' as 'already compliant'", () => {
  const s = renderHardeningScript(roebel);
  // REGRESSION. This shipped once and silently did nothing:
  //   sshd -T | grep -qx "passwordauthentication yes"
  // grep -q exits at the first match -> sshd takes SIGPIPE -> 141 -> `set -o
  // pipefail` promotes it to the pipeline status -> the test reads "no match" ->
  // the script printed "already off" while password auth stayed ON. Capture into
  // a variable; never pipe a long producer into an early-exiting consumer.
  // Comment lines are excluded — the fix is DOCUMENTED in a comment that names
  // the very pattern it bans, so asserting over the raw text would match itself.
  const code = s.split("\n").filter((l) => !l.trim().startsWith("#"));
  for (const producer of ["sshd -T", "ufw status"]) {
    const piped = code.filter((l) => l.includes(producer) && /\|\s*grep -q/.test(l));
    assert.deepEqual(piped, [], `${producer} must not be piped into grep -q (SIGPIPE + pipefail = fail-open)`);
  }
  // No pipe at all: `case` globbing over a captured variable. Nothing to SIGPIPE.
  assert.match(s, /sshd_effective="\$\(sshd -T 2>\/dev\/null\)"/);
  assert.match(s, /case "\$sshd_effective" in/);
  // "cannot determine" is its own branch, and it is an error.
  assert.match(s, /refusing to claim SSH is hardened/);
  // Applying is not the same as working: assert the end state, and exit non-zero.
  assert.match(s, /but sshd does not report password auth off/);
  assert.match(s, /exit "\$HARDEN_ERRORS"/);
  assert.match(s, /ERROR: fail2ban is not active/);
});

test("a hardening failure makes `netizen up` exit non-zero", () => {
  const b = renderBootstrap(roebel);
  assert.match(b, /bash ops\/harden\.sh \|\| HARDEN_RC=\$\?/);
  // Reported at the end, so the rest of the node still finishes converging.
  assert.match(b, /exit "\$\{HARDEN_RC:-0\}"/);
});

test("strfry uses the absolute binary path and tolerates a legitimately empty relay", () => {
  const s = renderBackupScript(roebel);
  // The official strfry image does NOT put the binary on PATH; `strfry export`
  // fails with "executable file not found". Found by running the real backup.
  assert.match(s, /dc exec -T strfry \/app\/strfry export/);
  // A members-only relay with an empty allow-list has zero events. That is a
  // healthy state, not a backup failure — alarming on it nightly trains people
  // to ignore the alarm that matters.
  assert.match(s, /record_allow_empty "strfry-events\.jsonl\.gz"/);
  assert.match(s, /"relayEvents": \$RELAY_EVENTS/);
  // Database dumps get the strict treatment: empty is always failure.
  assert.match(s, /record "pg-\$db\.dump"/);
  assert.match(s, /\|\| fail "\$1 is empty"/);
});

test("the allow-list syncer is rendered as a node service, not hand-wired", () => {
  const compose = renderComposeYml(roebel);
  assert.match(compose, /relay-sync:/);
  // The relay reads the policy dir :ro; the syncer needs the SAME dir writable.
  assert.match(compose, /"\.\/strfry-policy:\/etc\/strfry"/);
  assert.match(compose, /"\.\/strfry-policy:\/etc\/strfry:ro"/);
  // The service-role key is referenced from the box's .env, never inlined.
  assert.match(compose, /SUPABASE_SERVICE_KEY: "\$\{SUPABASE_SERVICE_KEY\}"/);
  assert.match(compose, /CITIZEN_NFT_ADDRESS: "0x59aA26f499D7C2B3EC2c8524Ed06F54fc4E85dE5"/);
  // Declared agent keys reach the syncer, so agents keep relay write access.
  assert.match(compose, /AGENT_PUBKEYS:/);

  // No backend declared => no syncer (there is no registry to read).
  const noBackend = { ...roebel, services: { ...roebel.services, backend: undefined } };
  assert.doesNotMatch(renderComposeYml(noBackend), /relay-sync:/);
});

test("declared agent pubkeys are passed through to the syncer", () => {
  const withAgent = {
    ...roebel,
    agents: { ...roebel.agents, a2a: { ...roebel.agents.a2a, relayPubkeys: ["a".repeat(64), "b".repeat(64)] } },
  };
  assert.match(renderComposeYml(withAgent), new RegExp(`AGENT_PUBKEYS: "${"a".repeat(64)},${"b".repeat(64)}"`));
});

test("a declared watcher becomes a rendered service, not a hand-started container", () => {
  const withWatcher = {
    ...roebel,
    agents: {
      ...roebel.agents,
      watcher: { agent: "mecky", displayName: "Mecky", model: "claude-sonnet-5", perAuthorPerHour: 5, perDay: 100 },
    },
  };
  const compose = renderComposeYml(withWatcher);
  assert.match(compose, /agent-watcher:/);
  assert.match(compose, /AGENT_NAME: "mecky"/);
  assert.match(compose, /AGENT_DISPLAY_NAME: "Mecky"/);
  assert.match(compose, /ANTHROPIC_MODEL: "claude-sonnet-5"/);
  assert.match(compose, /AGENT_PER_AUTHOR_PER_HOUR: "5"/);
  assert.match(compose, /AGENT_PER_DAY: "100"/);
  // Secrets are compose-interpolated from the box's .env, never inlined —
  // and ONLY the two the watcher needs. The old hand-rolled `docker run
  // --env-file .env` handed the agent the Supabase service key too.
  assert.match(compose, /ANTHROPIC_API_KEY: "\$\{ANTHROPIC_API_KEY\}"/);
  assert.match(compose, /NODE_AGENT_SECRET: "\$\{NODE_AGENT_SECRET\}"/);
  const watcherBlock = compose.slice(compose.indexOf("agent-watcher:"));
  const nextService = watcherBlock.slice(watcherBlock.indexOf("\n  "));
  assert.ok(
    !watcherBlock.slice(0, watcherBlock.length - nextService.length).includes("SUPABASE"),
    "the watcher must not receive Supabase credentials",
  );

  // No watcher declared => no service. The stray-duplicate failure mode was a
  // watcher existing outside the declaration.
  const withoutWatcher = { ...roebel, agents: { ...roebel.agents, watcher: undefined } };
  assert.doesNotMatch(renderComposeYml(withoutWatcher), /agent-watcher:/);

  // No relay => nothing to watch; declaring a watcher renders nothing.
  const noNostr = {
    ...withWatcher,
    services: { ...withWatcher.services, chat: { ...withWatcher.services.chat, nostr: undefined } },
  };
  assert.doesNotMatch(renderComposeYml(noNostr), /agent-watcher:/);
});
