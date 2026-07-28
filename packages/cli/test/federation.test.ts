import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NetizenManifestSchema } from "@netizen-labs/protocol";
import {
  renderBundle,
  renderComposeYml,
  renderFederationPeers,
  renderFederationSync,
  renderMirrorConf,
  renderMirrorSyncConf,
  renderCaddyfile,
  renderPostgresInit,
  postgresDatabases,
  plan,
} from "../src/render.js";
import { sovereigntyReport } from "../src/doctor.js";

const base = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../protocol/examples/roebel.netizen.json", import.meta.url)),
    "utf8",
  ),
);

const PEER = {
  id: "testnode",
  name: "Netizen Test Node",
  relay: "wss://relay2.roebel.app",
  kinds: [0, 1],
  why: "Federation test fixture — second node on the same host",
};

const withPeers = { ...base, peers: [PEER] };
// Röbel's real manifest now declares a peer, so the "no federation" case must be
// constructed explicitly rather than borrowed from it.
const { peers: _declared, ...withoutPeers } = base as Record<string, unknown>;

test("the schema accepts a declared peer", () => {
  const parsed = NetizenManifestSchema.parse({ ...base, peers: [PEER] });
  assert.equal(parsed.peers?.[0].relay, PEER.relay);
});

test("a peer must state why it is trusted", () => {
  // A trust decision with no stated reason is one nobody can review later.
  assert.throws(() => NetizenManifestSchema.parse({ ...base, peers: [{ ...PEER, why: "" }] }));
});

test("a peer must declare kinds — there is no implicit 'sync everything'", () => {
  assert.throws(() => NetizenManifestSchema.parse({ ...base, peers: [{ ...PEER, kinds: [] }] }));
});

test("a peer relay must be wss:// across any network we do not control", () => {
  // Plaintext to a routable host is the case that matters: it would put a town's
  // public record on the wire in clear.
  assert.throws(() =>
    NetizenManifestSchema.parse({ ...base, peers: [{ ...PEER, relay: "ws://relay2.roebel.app" }] }),
  );
});

test("ws:// is allowed only for a same-host name that cannot leave the machine", () => {
  // A docker service name or localhost. Requiring public DNS + a certificate for a
  // same-box test fixture would just push people toward disabling the check.
  for (const relay of ["ws://testnode-strfry:7777", "ws://localhost:7777", "ws://127.0.0.1:7777"]) {
    const parsed = NetizenManifestSchema.parse({ ...base, peers: [{ ...PEER, relay }] });
    assert.equal(parsed.peers?.[0].relay, relay);
  }
});

test("sync is PULL-ONLY and writes into the mirror, never the authoring relay", () => {
  const sh = renderFederationSync(withPeers as never);
  // --dir down: this node never writes into a peer's database.
  assert.match(sh, /sync "wss:\/\/relay2\.roebel\.app"/);
  assert.match(sh, /--dir down/);
  assert.ok(!/--dir (up|both)/.test(sh), "federation must never push into a peer");
  assert.match(sh, /--filter '\{"kinds":\[0,1\]\}'/);
  // The mirror's config, not the authoring relay's — a synced event is subject to
  // the destination's write policy, so it must land in the separate store.
  assert.match(sh, /--config=\/etc\/strfry-mirror-sync\.conf/);
  // The binary is not on PATH in the strfry image.
  assert.match(sh, /\/app\/strfry /);
});

test("the mirror serves reads but rejects every write", () => {
  const conf = renderMirrorConf(withPeers as never);
  assert.match(conf, /reject-all\.sh/);
  assert.match(conf, /mirror-db/);
});

test("the syncer's config shares the store but installs no write policy", () => {
  // Same DB, different config: that is what lets the mirror be publicly readable
  // without being publicly writable, since strfry cannot tell a syncing peer from
  // a stranger (both arrive as IP4).
  const sync = renderMirrorSyncConf(withPeers as never);
  assert.match(sync, /mirror-db/);
  assert.match(sync, /writePolicy \{ plugin = "" \}/);
  assert.notEqual(renderMirrorConf(withPeers as never), sync);
});

test("an unreachable peer does not abort the sweep", () => {
  // A node being down is a normal condition in a federation, not a reason to
  // stop syncing every other peer.
  const sh = renderFederationSync(withPeers as never);
  assert.match(sh, /\|\| echo .*unreachable — continuing/);
  assert.ok(!/set -e/.test(sh), "must not abort the loop on a single failure");
});

test("the peer table records who and why, for review", () => {
  const md = renderFederationPeers(withPeers as never);
  assert.match(md, /relay2\.roebel\.app/);
  assert.match(md, /Federation test fixture/);
});

test("a node with no peers ships no federation machinery at all", () => {
  const bundle = renderBundle(withoutPeers as never);
  assert.equal(bundle.files["strfry-mirror/sync-peers.sh"], undefined);
  assert.equal(bundle.files["strfry-mirror/mirror.conf"], undefined);
  assert.ok(!renderComposeYml(withoutPeers as never).includes("federation:"));
  assert.ok(!renderComposeYml(withoutPeers as never).includes("mirror:"));
  assert.ok(!plan(withoutPeers as never).some((s) => s.id === "federation"));
});

test("declaring peers adds the services, the files and a plan step", () => {
  const bundle = renderBundle(withPeers as never);
  assert.ok(bundle.files["strfry-mirror/sync-peers.sh"]);
  assert.ok(bundle.files["strfry-mirror/mirror.conf"]);
  assert.ok(bundle.files["strfry-mirror/mirror-sync.conf"]);
  assert.ok(bundle.files["strfry-mirror/reject-all.sh"]);
  assert.ok(bundle.files["strfry-mirror/PEERS.md"]);

  const compose = renderComposeYml(withPeers as never);
  assert.match(compose, /^ {2}federation:/m);
  assert.match(compose, /^ {2}mirror:/m);
  // Peers' events get their own store — never mingled with what this node's own
  // members authored.
  assert.match(compose, /mirror_db:/);
  // Pull-based: it must add no inbound surface to the node.
  const service = compose.slice(compose.indexOf("  federation:"));
  assert.ok(!/ports:/.test(service.split("\n").slice(0, 12).join("\n")));

  assert.ok(plan(withPeers as never).some((s) => s.id === "federation"));
});

test("mirror configs use strfry's multi-line info form", () => {
  // strfry's parser REJECTS the compact `info { a = "x"; b = "y"; }` form that
  // appears in some docs — it cost a deploy cycle. Keys go on their own lines.
  for (const conf of [renderMirrorConf(withPeers as never), renderMirrorSyncConf(withPeers as never)]) {
    assert.ok(!/info \{[^\n}]*;/.test(conf), "compact info block will not parse");
    assert.match(conf, /info \{\n\s+name = /);
  }
});

/**
 * The contributor case: a node that is JUST a relay that federates.
 *
 * If these fail, forking got harder — someone wanting to join the network would
 * have to declare a Safe, a MACI deployment and six contract addresses first.
 */
const MINIMAL = {
  nsp: "0",
  manifestVersion: "1.0.0",
  id: "contributor-node",
  name: "A Contributor's Node",
  services: {
    host: { provider: "hetzner", region: "eu-central" },
    chat: { nostr: { relay: "wss://relay.example.org" } },
  },
  peers: [
    {
      id: "roebel",
      name: "Röbel / Müritz",
      relay: "wss://relay.roebel.app",
      kinds: [0, 1],
      why: "Genesis node — mirror its public civic record",
    },
  ],
} as never;

test("a minimal node renders a working bundle with no civic stack", () => {
  const bundle = renderBundle(MINIMAL);
  // It gets a relay, a write policy and federation...
  for (const f of ["strfry.conf", "docker-compose.yml", "Caddyfile", "bootstrap.sh"]) {
    assert.ok(bundle.files[f], `missing ${f}`);
  }
  assert.ok(bundle.files["strfry-mirror/sync-peers.sh"]);
  // ...and nothing that needs an identity provider it never declared.
  assert.equal(bundle.files["roebel-id.env"], undefined);
});

test("a minimal node's plan has no keystone step", () => {
  const ids = plan(MINIMAL).map((s) => s.id);
  assert.ok(!ids.includes("roebel-id"), "nothing to stand up without an IdP");
  assert.ok(!ids.includes("identity"), "nothing to verify without an IdP");
  assert.ok(ids.includes("nostr-relay") && ids.includes("federation"));
});

test("a minimal node renders no allow-list syncer — there is no chain to sync from", () => {
  // Membership-gated writes need an onchain credential. Without `contracts` the
  // node still federates; its own members are granted by hand via add-member.sh.
  assert.ok(!renderComposeYml(MINIMAL).includes("relay-sync:"));
});

test("sovereignty omits layers a node never declared, rather than scoring them false", () => {
  // The score reads "N/M layers under own control". Counting an identity layer a
  // relay-only node deliberately does not run would penalise it for a choice.
  const layers = sovereigntyReport(MINIMAL).map((l) => l.layer);
  assert.ok(!layers.includes("identity-issuer"));
  assert.ok(!layers.includes("identity-keys"));
  assert.ok(layers.includes("hosting"));
  // Durability is different: absence there IS the finding, so it stays reported.
  assert.ok(layers.includes("durability"));
});

/** NSP-10 — the cross-node query layer. */
const baseServices = (base as { services: Record<string, unknown> }).services;
const WITH_INDEXER = {
  ...base,
  peers: [PEER],
  services: { ...baseServices, indexer: { publicRead: "https://index.roebel.app", kinds: [0, 1] } },
} as never;

/** Röbel's manifest now declares an indexer, so the "declares none" case is explicit. */
const { indexer: _idx, ...servicesNoIndexer } = baseServices;
const WITHOUT_INDEXER = { ...base, peers: [PEER], services: servicesNoIndexer } as never;

test("the indexer reads BOTH the node's own relay and the federation mirror", () => {
  // The whole reason it exists: federation created two stores and no way to ask a
  // question across them.
  const compose = renderComposeYml(WITH_INDEXER);
  assert.match(compose, /^ {2}indexer:/m);
  const sources = compose.match(/SOURCES: '(.+?)'/)?.[1];
  assert.ok(sources, "sources must be rendered from the manifest");
  const parsed = JSON.parse(sources!);
  assert.deepEqual(parsed.map((s: { relay: string }) => s.relay), [
    "ws://strfry:7777",
    "ws://mirror:7777",
  ]);
});

test("a node with no peers indexes only its own relay", () => {
  const { peers: _p, ...noPeers } = WITH_INDEXER as Record<string, unknown>;
  const sources = JSON.parse(renderComposeYml(noPeers as never).match(/SOURCES: '(.+?)'/)![1]);
  assert.equal(sources.length, 1);
});

test("declaring publicRead routes the index through Caddy", () => {
  assert.match(renderCaddyfile(WITH_INDEXER), /index\.roebel\.app \{\n\s+reverse_proxy indexer:8080/);
});

test("a node that declares no indexer ships none of it", () => {
  const compose = renderComposeYml(WITHOUT_INDEXER);
  assert.ok(!compose.includes("indexer:"));
  assert.ok(!plan(WITHOUT_INDEXER).some((s) => s.id === "indexer"));
});

test("the indexer's database is created by the installer, not by hand", () => {
  // Matrix once failed with 'password authentication failed for user "mas"'
  // because a service was added after the cluster was initialised. Every service
  // that needs Postgres declares it here so the idempotent init creates it.
  assert.ok(postgresDatabases(WITH_INDEXER).includes("indexer"));
  assert.match(renderPostgresInit(WITH_INDEXER), /ensure_role indexer/);
  // ...and the connection string must name exactly that role and database.
  assert.match(renderComposeYml(WITH_INDEXER), /postgres:\/\/indexer:\$\{POSTGRES_PASSWORD\}@postgres:5432\/indexer/);
});
