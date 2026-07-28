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
  plan,
} from "../src/render.js";

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
  direction: "both",
  why: "Federation test fixture — second node on the same host",
};

const withPeers = { ...base, peers: [PEER] };

test("the schema accepts a declared peer and defaults direction to both", () => {
  const parsed = NetizenManifestSchema.parse({
    ...base,
    peers: [{ ...PEER, direction: undefined }],
  });
  assert.equal(parsed.peers?.[0].direction, "both");
});

test("a peer must state why it is trusted", () => {
  // A trust decision with no stated reason is one nobody can review later.
  assert.throws(() => NetizenManifestSchema.parse({ ...base, peers: [{ ...PEER, why: "" }] }));
});

test("a peer must declare kinds — there is no implicit 'sync everything'", () => {
  assert.throws(() => NetizenManifestSchema.parse({ ...base, peers: [{ ...PEER, kinds: [] }] }));
});

test("a peer relay must be wss:// — never plaintext", () => {
  assert.throws(() =>
    NetizenManifestSchema.parse({ ...base, peers: [{ ...PEER, relay: "ws://relay2.roebel.app" }] }),
  );
});

test("sync script emits one strfry sync per peer, with its direction and kind filter", () => {
  const sh = renderFederationSync(withPeers as never);
  assert.match(sh, /strfry sync "wss:\/\/relay2\.roebel\.app" --dir both/);
  assert.match(sh, /--filter '\{"kinds":\[0,1\]\}'/);
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
  const bundle = renderBundle(base);
  assert.equal(bundle.files["federation/sync-peers.sh"], undefined);
  assert.equal(bundle.files["federation/PEERS.md"], undefined);
  assert.ok(!renderComposeYml(base).includes("federation:"));
  assert.ok(!plan(base).some((s) => s.id === "federation"));
});

test("declaring peers adds the service, the files and a plan step", () => {
  const bundle = renderBundle(withPeers as never);
  assert.ok(bundle.files["federation/sync-peers.sh"]);
  assert.ok(bundle.files["federation/PEERS.md"]);

  const compose = renderComposeYml(withPeers as never);
  assert.match(compose, /^ {2}federation:/m);
  // Pull-based: it must add no inbound surface to the node.
  const service = compose.slice(compose.indexOf("  federation:"));
  assert.ok(!/ports:/.test(service.split("\n").slice(0, 12).join("\n")));

  assert.ok(plan(withPeers as never).some((s) => s.id === "federation"));
});
