import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NetizenManifestSchema } from "@netizen-labs/protocol";
import { renderBundle, renderComposeYml, renderVanishExecutor } from "../src/render.js";

const base = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../protocol/examples/roebel.netizen.json", import.meta.url)),
    "utf8",
  ),
);

const m = NetizenManifestSchema.parse(base);
const { peers: _p, ...noPeersRaw } = base as Record<string, unknown>;
const noPeers = NetizenManifestSchema.parse(noPeersRaw);

test("a nostr node ships the vanish pipeline: scanner, executor, durable queue", () => {
  const compose = renderComposeYml(m);
  assert.ok(compose.includes("vanish-scan:"), "scanner service missing");
  assert.ok(compose.includes("vanish-exec:"), "executor service missing");
  assert.ok(compose.includes("vanish_queue:"), "named queue volume missing");
  assert.ok(
    compose.includes(`PUBLIC_RELAY_URLS: "${m.services.chat!.nostr!.relay}"`),
    "scanner must know which relay tags address THIS node",
  );

  const { files } = renderBundle(m);
  assert.ok(files["strfry-vanish/vanish-exec.sh"], "executor script not in bundle");
});

test("without peers there is no mirror half — env and mounts stay authoring-only", () => {
  const compose = renderComposeYml(noPeers);
  assert.ok(compose.includes("vanish-scan:"));
  assert.ok(!compose.includes("MIRROR_WS"), "no mirror socket without peers");
  assert.ok(
    !compose.includes("mirror-sync.conf:/etc/strfry-mirror-sync.conf:ro\"\n      - \"mirror_db"),
    "no mirror mounts on the executor without peers",
  );
});

test("the executor re-validates and never trusts the queue", () => {
  const sh = renderVanishExecutor(m);
  // The two literal validation gates the whole design rests on: 64-hex fields
  // and a digits-only until. If these disappear, queue content reaches a shell.
  assert.ok(sh.includes("*[!0-9a-f]*"), "hex validation gone");
  assert.ok(sh.includes('tr -d 0-9'), "digits-only until validation gone");
  // Skip-forward semantics: every line is marked done exactly once, so a bad
  // line can never wedge the queue.
  assert.ok(sh.includes('>> "$DONE"'));
});
