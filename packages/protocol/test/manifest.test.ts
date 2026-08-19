import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseManifest, safeParseManifest } from "../src/manifest.js";

const roebel = JSON.parse(
  readFileSync(fileURLToPath(new URL("../examples/roebel.netizen.json", import.meta.url)), "utf8"),
);

test("the Röbel dogfood manifest validates against the schema", () => {
  const m = parseManifest(roebel);
  assert.equal(m.id, "roebel");
  // Röbel declares the full civic stack; the non-null assertions are the point —
  // these sections are optional in the schema (see the minimal-node tests) but a
  // town manifest must have them.
  assert.equal(m.chain!.chainId, 100);
  assert.equal(m.identity!.relyingParties.length, 4);
  assert.equal(m.identity!.federation.trustedIssuers.length, 0);
});

test("rejects an inline secret where a reference is required", () => {
  const bad = { ...roebel, chain: { ...roebel.chain, rpc: "not-a-url-and-not-a-ref" } };
  assert.equal(safeParseManifest(bad).success, false);
});

test("Public Mecky declares reviewed evidence and a referenced inference credential", () => {
  const watcher = parseManifest(roebel).agents?.watcher;
  assert.equal(
    watcher?.publicEvidence.baseUrl,
    "https://roebel-stadtstack.agentcart.eu",
  );
  assert.equal(watcher?.publicEvidence.municipalityId, "roebel-mueritz");
  assert.equal(
    watcher?.inference.baseUrl,
    "https://inference.hetzner.com/api/v1",
  );
  assert.equal(watcher?.inference.model, "Qwen/Qwen3.6-35B-A3B-FP8");
  assert.equal(watcher?.inference.apiKey, "$HETZNER_INFERENCE_API_KEY");
  assert.equal(Object.hasOwn(watcher ?? {}, "stadtstackControl"), false);

  const inlineKey = structuredClone(roebel);
  inlineKey.agents.watcher.inference.apiKey = "secret-token";
  assert.equal(safeParseManifest(inlineKey).success, false);

  const overPrivilegedWatcher = structuredClone(roebel) as typeof roebel & {
    agents: { watcher: Record<string, unknown> };
  };
  overPrivilegedWatcher.agents.watcher.stadtstackControl = {
    baseUrl: "http://stadtstack-control.invalid",
    nostrIngestorToken: "$STADTSTACK_NOSTR_INGESTOR_TOKEN",
  };
  assert.equal(safeParseManifest(overPrivilegedWatcher).success, false);

  const legacyUngroundedWatcher = structuredClone(roebel);
  legacyUngroundedWatcher.agents.watcher = {
    agent: "mecky",
    model: "claude-sonnet-5",
  };
  assert.equal(safeParseManifest(legacyUngroundedWatcher).success, false);
});

test("rejects a missing required section", () => {
  // `services` is required: a node with no services is not a node.
  const bad = { ...roebel };
  delete (bad as Record<string, unknown>).services;
  assert.equal(safeParseManifest(bad).success, false);
});

test("a MINIMAL node validates — the civic stack is optional", () => {
  // The contributor case. A relay that federates is a legitimate node, and must
  // not have to invent a Safe, a MACI deployment and six contract addresses to
  // be expressible. If this test ever fails, forking got harder.
  const minimal = {
    nsp: "0",
    manifestVersion: "1.0.0",
    id: "contributor-node",
    name: "A Contributor's Node",
    services: {
      host: { provider: "hetzner", region: "eu-central" },
      chat: { nostr: { relay: "wss://relay.example.org" } },
    },
  };
  const parsed = safeParseManifest(minimal);
  assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues ?? []));
});

test("a minimal node may still federate", () => {
  const minimal = {
    nsp: "0",
    manifestVersion: "1.0.0",
    id: "contributor-node",
    name: "A Contributor's Node",
    services: { host: { provider: "hetzner", region: "eu-central" } },
    peers: [
      {
        id: "roebel",
        name: "Röbel / Müritz",
        relay: "wss://relay.roebel.app",
        kinds: [0, 1],
        why: "Genesis node — mirror its public civic record",
      },
    ],
  };
  assert.equal(safeParseManifest(minimal).success, true);
});

test("rejects an unknown nsp version", () => {
  const bad = { ...roebel, nsp: "99" };
  assert.equal(safeParseManifest(bad).success, false);
});

test("a node can be any sovereign entity type (town, individual, business, club, agent, ...)", () => {
  assert.equal(parseManifest(roebel).type, "community");
  for (const t of ["individual", "business", "club", "institution", "agent", "town"]) {
    assert.equal(safeParseManifest({ ...roebel, type: t }).success, true, `type ${t} should be valid`);
  }
  // type is optional (a bare node is still valid)
  const noType = { ...roebel };
  delete (noType as Record<string, unknown>).type;
  assert.equal(safeParseManifest(noType).success, true);
});

test("v2 coverage fields parse — AA infra, data backend, sovereign AI, openDesk suite", () => {
  const m = parseManifest(roebel);
  assert.equal(m.identity!.authBridge.bundlerRpc, "$GNOSIS_BUNDLER_RPC");
  assert.equal(m.services.backend?.provider, "supabase");
  assert.equal(m.ai?.selfHosted, false);
  // the full openDesk suite is expressible (optional) — a node declares its subset
  const withSuite = {
    ...roebel,
    services: {
      ...roebel.services,
      workspace: { ...roebel.services.workspace, mail: "https://mail.roebel.app", wiki: "https://wiki.roebel.app", video: "https://meet.roebel.app", project: "https://project.roebel.app" },
    },
  };
  assert.equal(safeParseManifest(withSuite).success, true);
});

test("rejects treasury splits that do not sum to 100", () => {
  const bad = { ...roebel, treasury: { ...roebel.treasury, splits: { reserve: 50, ops: 30, dividend: 10 } } };
  assert.equal(safeParseManifest(bad).success, false);
});

test("the Röbel manifest adopts the NSP-12 decision record with default kinds", () => {
  const m = parseManifest(roebel);
  assert.ok(m.record, "roebel example must declare the record block");
  assert.equal(m.record!.decisions.kinds.transition, 2100);
  assert.equal(m.record!.decisions.kinds.cycle, 32106);
  // adopting the grammar means indexing it — the six kinds are in the indexer set
  for (const k of [2100, 32100, 32103, 32104, 32105, 32106]) {
    assert.ok(m.services.indexer!.kinds.includes(k), `indexer must include kind ${k}`);
  }
});

test("record agents use watcher-style slugs and default staleAfterDays", () => {
  const withAgents = {
    ...roebel,
    record: {
      decisions: {
        agents: { editor: { agent: "mecky-editor" }, impact: { agent: "mecky-impact" } },
      },
    },
  };
  const m = parseManifest(withAgents);
  assert.equal(m.record!.decisions.agents!.editor!.staleAfterDays, 180);
  assert.deepEqual(m.record!.decisions.agents!.impact!.audiences,
    ["anwohner", "gewerbe", "vereine", "verwaltung"]);
});

test("a bad audience or an uppercase agent slug is rejected", () => {
  const badAudience = {
    ...roebel,
    record: { decisions: { agents: { impact: { agent: "mecky-impact", audiences: ["touristen"] } } } },
  };
  assert.equal(safeParseManifest(badAudience).success, false);
  const badSlug = {
    ...roebel,
    record: { decisions: { agents: { editor: { agent: "Mecky" } } } },
  };
  assert.equal(safeParseManifest(badSlug).success, false);
});

test("a node without a record block still validates — the grammar is optional", () => {
  const bare = { ...roebel } as Record<string, unknown>;
  delete bare.record;
  assert.equal(safeParseManifest(bare).success, true);
});

// ---- services.buzz (line B: the agentic workspace, stock block/buzz) ----

const buzzBlock = {
  url: "https://buzz.roebel.app",
  imageTag: "sha-3e48f1b",
  ownerPubkey: "a".repeat(64),
  agentPubkeys: ["b".repeat(64)],
  secrets: {
    postgresPassword: "$BUZZ_POSTGRES_PASSWORD",
    redisPassword: "$BUZZ_REDIS_PASSWORD",
    s3AccessKey: "$BUZZ_S3_ACCESS_KEY",
    s3SecretKey: "$BUZZ_S3_SECRET_KEY",
    relayPrivateKey: "$BUZZ_RELAY_PRIVATE_KEY",
    gitHookHmac: "$BUZZ_GIT_HOOK_HMAC_SECRET",
  },
};

test("a buzz-declaring manifest validates", () => {
  const withBuzz = { ...roebel, services: { ...roebel.services, buzz: buzzBlock } };
  const m = parseManifest(withBuzz);
  assert.equal(m.services.buzz!.imageTag, "sha-3e48f1b");
});

test("buzz refuses an unpinned image tag — main would make every deploy a different Buzz", () => {
  const bad = { ...roebel, services: { ...roebel.services, buzz: { ...buzzBlock, imageTag: "main" } } };
  assert.equal(safeParseManifest(bad).success, false);
  const alsoBad = { ...roebel, services: { ...roebel.services, buzz: { ...buzzBlock, imageTag: "v0.5.2" } } };
  assert.equal(safeParseManifest(alsoBad).success, false);
});

test("buzz refuses an inline secret and an npub owner", () => {
  const inline = {
    ...roebel,
    services: { ...roebel.services, buzz: { ...buzzBlock, secrets: { ...buzzBlock.secrets, redisPassword: "hunter2" } } },
  };
  assert.equal(safeParseManifest(inline).success, false);
  const npubOwner = { ...roebel, services: { ...roebel.services, buzz: { ...buzzBlock, ownerPubkey: "npub1" + "a".repeat(59) } } };
  assert.equal(safeParseManifest(npubOwner).success, false);
});

test("buzz without its secrets block is rejected — it would crash-loop on first boot", () => {
  const { secrets: _drop, ...noSecrets } = buzzBlock;
  const bad = { ...roebel, services: { ...roebel.services, buzz: noSecrets } };
  assert.equal(safeParseManifest(bad).success, false);
});

// ---- services.buzz.acpAgents (resident agents — Autar M1) ----

const meckyResident = {
  name: "mecky",
  privateKey: "$BUZZ_MECKY_PRIVATE_KEY",
  anthropicApiKey: "$ANTHROPIC_API_KEY",
  image: "netizen/buzz-acp:v0.5.2",
};

function withAcpAgents(agents: unknown) {
  return { ...roebel, services: { ...roebel.services, buzz: { ...buzzBlock, acpAgents: agents } } };
}

test("a resident agent declaration validates", () => {
  const m = parseManifest(withAcpAgents([meckyResident]));
  assert.equal(m.services.buzz!.acpAgents![0].name, "mecky");
});

test("a resident agent with an inline key is rejected — an identity must never enter git", () => {
  const inlineKey = withAcpAgents([{ ...meckyResident, privateKey: "deadbeef".repeat(8) }]);
  assert.equal(safeParseManifest(inlineKey).success, false);
});

test("a resident agent image must be pinned — latest would make every boot a different harness", () => {
  const latest = withAcpAgents([{ ...meckyResident, image: "netizen/buzz-acp:latest" }]);
  assert.equal(safeParseManifest(latest).success, false);
  const upstream = withAcpAgents([{ ...meckyResident, image: "ghcr.io/block/buzz:sha-3e48f1b" }]);
  assert.equal(safeParseManifest(upstream).success, false);
});

test("a resident agent name must be a lowercase slug — it names the container and the volume", () => {
  const bad = withAcpAgents([{ ...meckyResident, name: "Mecky Roebel" }]);
  assert.equal(safeParseManifest(bad).success, false);
});
