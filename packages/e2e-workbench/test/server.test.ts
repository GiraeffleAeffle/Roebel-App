import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bindingStatement,
  buildAgentNoteEvent,
  buildBindingEvent,
  buildCivicArgumentEvent,
  buildCivicDiscussionEvent,
  buildCivicPromotionEvent,
  buildCivicTopicPromotionEvent,
  buildCitizenSignedTopicSuggestion,
  buildNoteEvent,
  buildParticipantTopicSuggestion,
  deriveAgentIdentity,
  getPublicKeyHex,
  npubEncode,
} from "@netizen-labs/nostr";
import { parseWorkbenchConfig, startWorkbench } from "../src/server";

const one = "11".repeat(32);
const two = "22".repeat(32);
const mecky = getPublicKeyHex(
  Uint8Array.from(Buffer.from("33".repeat(32), "hex"))
);
const signedMecky = deriveAgentIdentity(
  "test-mecky-node-secret-with-reviewed-entropy-0123456789",
  "roebel-e2e",
  "mecky"
);

function environment() {
  return {
    SYNTHETIC_CITIZENS_JSON: JSON.stringify([
      { id: "citizen-anna", name: "Anna (synthetisch)", secretKeyHex: one },
      { id: "citizen-omar", name: "Omar (synthetisch)", secretKeyHex: two },
    ]),
    MECKY_PUBKEY: mecky,
    CASE_STEWARD_TOKEN: "x".repeat(40),
    CITIZEN_RELAY_ADMISSION_TOKEN: "r".repeat(40),
    GNOSIS_RPC_URL: "https://rpc.gnosischain.com",
    CITIZEN_RELAY_URL:
      "ws://citizen-relay.stadtstack-roebel-e2e.svc.cluster.local:18081",
    AGENT_RELAY_URL:
      "ws://agent-relay.stadtstack-roebel-e2e.svc.cluster.local:18081",
    STADTSTACK_CONTROL_BASE_URL:
      "http://stadtstack-control.stadtstack-roebel-e2e.svc.cluster.local:18081",
    STADTSTACK_PUBLIC_BASE_URL:
      "http://stadtstack-public.stadtstack-roebel-e2e.svc.cluster.local:18080",
    WORKBENCH_BIND_HOST: "127.0.0.1",
    WORKBENCH_PORT: "0",
  };
}

function publicSignedEnvironment() {
  const {
    CASE_STEWARD_TOKEN: _caseStewardToken,
    STADTSTACK_CONTROL_BASE_URL: _controlBaseUrl,
    STADTSTACK_PUBLIC_BASE_URL: _publicBaseUrl,
    SYNTHETIC_CITIZENS_JSON: _syntheticCitizens,
    ...publicEnvironment
  } = environment();
  return {
    ...publicEnvironment,
    WORKBENCH_MODE: "public-signed-only",
  };
}

describe("Röbel E2E workbench boundary", () => {
  it("boots the public signed-only lane without Case Steward or public-projection credentials", async () => {
    const config = parseWorkbenchConfig(publicSignedEnvironment());
    assert.equal(config.mode, "public-signed-only");
    assert.equal(config.caseStewardToken, undefined);
    assert.equal(config.controlBaseUrl, undefined);
    assert.deepEqual(config.personas, []);
    for (const [name, value] of [
      ["CASE_STEWARD_TOKEN", ""],
      ["STADTSTACK_CONTROL_BASE_URL", ""],
      ["STADTSTACK_PUBLIC_BASE_URL", ""],
      ["SYNTHETIC_CITIZENS_JSON", "[]"],
    ] as const) {
      assert.throws(
        () => parseWorkbenchConfig({ ...publicSignedEnvironment(), [name]: value }),
        /workbench_public_signed_forbidden_input/
      );
    }

    let publishCount = 0;
    const relay = {
      query: async () => [],
      publish: async () => {
        publishCount += 1;
        return { ok: true, message: "stored" };
      },
      close: () => {},
    };
    const running = await startWorkbench(config, {
      agentRelay: relay,
      citizenRelay: relay,
    });
    try {
      const origin = `http://127.0.0.1:${running.port}`;
      assert.equal(publishCount, 0);
      const settings = (await fetch(`${origin}/api/config`).then(
        (response) => response.json()
      )) as { mode: string; personas: unknown[] };
      assert.deepEqual(settings, {
        schemaVersion: "roebel_e2e_workbench_config_v1",
        personas: [],
        meckyPubkey: mecky,
        mode: "public-signed-only",
        authorityBinding: "none",
      });
      assert.equal(
        (await fetch(`${origin}/api/administration?case=${encodeURIComponent("urn:stadtstack:case:municipality:roebel-mueritz:018f0000-0000-7000-8000-000000000001")}`)).status,
        404
      );
      assert.equal(
        (await fetch(`${origin}/api/post`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-stadtstack-e2e": "1",
          },
          body: JSON.stringify({ personaId: "citizen-anna", content: "x" }),
        })).status,
        404
      );
      assert.equal(
        (await fetch(`${origin}/api/feed?profile=public`)).status,
        200
      );
      for (const path of [
        "/healthz",
        "/api/config",
        "/api/feed?profile=public",
        `/api/thread?root=${"a".repeat(64)}`,
        "/api/conversation?post=00000000-0000-4000-8000-000000000001",
      ]) {
        const get = await fetch(`${origin}${path}`);
        const head = await fetch(`${origin}${path}`, { method: "HEAD" });
        assert.equal(head.status, get.status);
        assert.equal(head.headers.get("content-length"), get.headers.get("content-length"));
        assert.equal(await head.text(), "");
      }
    } finally {
      await running.close();
    }
  });

  it("keeps participant topic-tracer RPCs off the public staging prefix", async () => {
    const config = parseWorkbenchConfig(publicSignedEnvironment());
    const relay = {
      query: async () => [],
      publish: async () => ({ ok: true, message: "stored" }),
      close: () => {},
    };
    const running = await startWorkbench(config, {
      agentRelay: relay,
      citizenRelay: relay,
    });
    try {
      for (const path of [
        "/api/staging-participant/topic-tracer/promotion-source",
        "/api/staging-participant/topic-tracer/promotions",
        "/api/staging-participant/topic-tracer/suggestion-source",
        "/api/staging-participant/topic-tracer/suggestions",
      ]) {
        const response = await fetch(
          `http://127.0.0.1:${running.port}/stadtstack-test${path}`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-stadtstack-e2e": "1",
            },
            body: "{}",
          },
        );
        assert.equal(response.status, 404, path);
        assert.deepEqual(await response.json(), { error: "not_found" });
      }
      const internal = await fetch(
        `http://127.0.0.1:${running.port}/api/staging-participant/topic-tracer/promotion-source`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-stadtstack-e2e": "1",
          },
          body: JSON.stringify({
            sourceNoteEventId: "a".repeat(64),
            sourceAuthorPubkey: "b".repeat(64),
            sourceAppPostId: "30000000-0000-4000-8000-000000000003",
          }),
        },
      );
      assert.equal(internal.status, 200);
      assert.equal(await internal.json(), null);
    } finally {
      await running.close();
    }
  });

  it("accepts only the exact isolated service topology and two synthetic citizens", () => {
    const config = parseWorkbenchConfig(environment());
    assert.equal(config.personas.length, 2);
    assert.notEqual(
      config.personas[0]?.publicKey,
      config.personas[1]?.publicKey
    );
    assert.equal(
      config.agentRelayUrl.includes("agent-relay.stadtstack-roebel-e2e"),
      true
    );
    assert.throws(() =>
      parseWorkbenchConfig({
        ...environment(),
        CITIZEN_RELAY_URL: "wss://relay.roebel.app",
      })
    );
    assert.throws(() =>
      parseWorkbenchConfig({ ...environment(), SYNTHETIC_CITIZENS_JSON: "[]" })
    );
  });

  it("accepts the owned staging-preview namespace but rejects every production relay and arbitrary namespace", () => {
    const staging = Object.fromEntries(
      Object.entries(environment()).map(([key, value]) => [
        key,
        typeof value === "string"
          ? value.replaceAll(
              "stadtstack-roebel-e2e",
              "stadtstack-roebel-web-preview"
            )
          : value,
      ])
    );
    assert.equal(
      parseWorkbenchConfig(staging).citizenRelayUrl.includes(
        "stadtstack-roebel-web-preview"
      ),
      true
    );
    assert.throws(() =>
      parseWorkbenchConfig({
        ...staging,
        CITIZEN_RELAY_URL: "wss://relay.roebel.app",
      })
    );
    assert.throws(() =>
      parseWorkbenchConfig({
        ...staging,
        CITIZEN_RELAY_URL: "ws://citizen-relay.default.svc.cluster.local:18081",
      })
    );
  });

  it("accepts only the dedicated synthetic staging-lab namespace for the public test lane", () => {
    const stagingLab = Object.fromEntries(
      Object.entries(environment()).map(([key, value]) => [
        key,
        typeof value === "string"
          ? value.replaceAll(
              "stadtstack-roebel-e2e",
              "stadtstack-roebel-staging-lab"
            )
          : value,
      ])
    );
    const parsed = parseWorkbenchConfig(stagingLab);
    assert.equal(
      parsed.citizenRelayUrl.includes("stadtstack-roebel-staging-lab"),
      true
    );
    assert.equal(
      parsed.controlBaseUrl?.includes("stadtstack-roebel-staging-lab"),
      true
    );
  });

  it("serves a local-only accessible workflow UI without exposing private keys", async () => {
    const config = parseWorkbenchConfig(environment());
    const relay = {
      query: async () => [],
      publish: async () => ({ ok: true, message: "stored" }),
      close: () => {},
    };
    const running = await startWorkbench(config, {
      citizenRelay: relay,
      agentRelay: relay,
    });
    try {
      const origin = `http://127.0.0.1:${running.port}`;
      const html = await fetch(origin).then((response) => response.text());
      assert.match(html, /Bürgerdiskussion/);
      assert.match(html, /Pi 0\.84\.1/);
      assert.doesNotMatch(html, new RegExp(one));
      const publicConfig = (await fetch(`${origin}/api/config`).then(
        (response) => response.json()
      )) as { personas: Array<Record<string, unknown>> };
      assert.equal(publicConfig.personas.length, 2);
      assert.equal(
        publicConfig.personas.some((entry) => "secretKeyHex" in entry),
        false
      );
    } finally {
      await running.close();
    }
  });

  it("serves the workflow beneath the staging ingress prefix without root-relative API leaks", async () => {
    const config = parseWorkbenchConfig(environment());
    const relay = {
      query: async () => [],
      publish: async () => ({ ok: true, message: "stored" }),
      close: () => {},
    };
    const running = await startWorkbench(config, {
      citizenRelay: relay,
      agentRelay: relay,
    });
    try {
      const origin = `http://127.0.0.1:${running.port}`;
      const response = await fetch(`${origin}/stadtstack-test/`);
      const html = await response.text();
      assert.equal(response.status, 200);
      assert.match(html, /const base='\/stadtstack-test'/);
      assert.match(html, /api\(base\+'\/api\/config'/);
      assert.doesNotMatch(html, /api\('\/api\/config'/);

      const publicConfig = (await fetch(
        `${origin}/stadtstack-test/api/config`
      ).then((entry) => entry.json())) as { authorityBinding: string };
      assert.equal(publicConfig.authorityBinding, "none");
      const health = (await fetch(`${origin}/stadtstack-test/healthz`).then(
        (entry) => entry.json()
      )) as { mode: string };
      assert.equal(health.mode, "isolated-staging-e2e");
    } finally {
      await running.close();
    }
  });

  it("admits a real credential-bound Nostr identity and publishes only its pre-signed event", async () => {
    const config = parseWorkbenchConfig(environment());
    const events: Array<Record<string, unknown>> = [];
    const admitted: string[] = [];
    const relay = {
      query: async () => events,
      publish: async (entry: Record<string, unknown>) => {
        if (!events.some((candidate) => candidate.id === entry.id))
          events.push(entry);
        return { ok: true, message: "stored" };
      },
      close: () => {},
    };
    const address = "0x1111111111111111111111111111111111111111";
    const walletSignature = `0x${"44".repeat(65)}`;
    const citizenSecret = Uint8Array.from(Buffer.from("55".repeat(32), "hex"));
    const citizenPubkey = getPublicKeyHex(citizenSecret);
    let walletAccepted = false;
    const statement = bindingStatement({
      account: address,
      npub: npubEncode(citizenPubkey),
    });
    const bindingEvent = buildBindingEvent(citizenSecret, address, {
      createdAt: 100,
    });
    const running = await startWorkbench(config, {
      citizenRelay: relay as never,
      agentRelay: relay as never,
      verifyWalletSignature: async (args) => {
        assert.deepEqual(args, {
          address,
          message: statement,
          signature: walletSignature,
        });
        return walletAccepted;
      },
      admitPubkey: async (pubkey) => {
        admitted.push(pubkey);
      },
    });
    try {
      const origin = `http://127.0.0.1:${running.port}/stadtstack-test`;
      const admissionRequest = () =>
        fetch(`${origin}/api/session/admit`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-stadtstack-e2e": "1",
          },
          body: JSON.stringify({
            schemaVersion: "roebel_citizen_admission_proof_v1",
            credential: {
              kind: "thirdweb_smart_account",
              address,
              chainId: 100,
            },
            statement,
            walletSignature,
            bindingEvent,
          }),
        });

      const rejectedAdmission = await admissionRequest();
      assert.equal(rejectedAdmission.status, 422);
      assert.deepEqual(admitted, []);

      walletAccepted = true;
      const admissionResponse = await admissionRequest();
      assert.equal(admissionResponse.status, 200);
      assert.deepEqual(await admissionResponse.json(), {
        status: "admitted",
        pubkey: citizenPubkey,
        assurance: "staging_credential_control",
        authorityBinding: "none",
      });
      assert.deepEqual(admitted, [citizenPubkey]);

      const signedPost = buildNoteEvent(
        citizenSecret,
        "Ein echter signierter Staging-Beitrag",
        { createdAt: 101 }
      );
      const publishResponse = await fetch(`${origin}/api/signed-event`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-stadtstack-e2e": "1",
        },
        body: JSON.stringify({ intent: "post", event: signedPost }),
      });
      assert.equal(publishResponse.status, 200);
      const promotion = buildCivicTopicPromotionEvent(citizenSecret, {
        sourcePost: signedPost,
        municipalityId: "roebel-mueritz",
        topicId:
          "urn:stadtstack:topic:municipality:roebel-mueritz:marienfelder-strasse",
        topicTitle: "Marienfelder Straße",
        agentPubkey: config.meckyPubkey,
        content: "@Mecky, welche geprüften Informationen liegen dazu vor?",
        createdAt: 102,
      });
      const promotionResponse = await fetch(`${origin}/api/signed-event`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-stadtstack-e2e": "1",
        },
        body: JSON.stringify({ intent: "promotion", event: promotion }),
      });
      assert.equal(promotionResponse.status, 200);
      const feed = (await fetch(`${origin}/api/feed`).then(
        (response) => response.json()
      )) as {
        posts: Array<{
          id: string;
          synthetic: boolean;
          promotedDiscussionId?: string | null;
          author: { name: string };
        }>;
      };
      const realPost = feed.posts.find((entry) => entry.id === signedPost.id);
      assert.equal(realPost?.synthetic, false);
      assert.equal(realPost?.promotedDiscussionId, promotion.id);
      assert.match(realPost?.author.name ?? "", /^Bürger:in /);
    } finally {
      await running.close();
    }
  });

  it("projects the immutable Röbel app post bound to a citizen-signed Nostr mirror", async () => {
    const config = parseWorkbenchConfig(environment());
    const events: Array<Record<string, unknown>> = [];
    const relay = {
      query: async () => events,
      publish: async (entry: Record<string, unknown>) => {
        if (!events.some((candidate) => candidate.id === entry.id))
          events.push(entry);
        return { ok: true, message: "stored" };
      },
      close: () => {},
    };
    const running = await startWorkbench(config, {
      citizenRelay: relay as never,
      agentRelay: { ...relay, query: async () => [] } as never,
    });
    try {
      const origin = `http://127.0.0.1:${running.port}/stadtstack-test`;
      const sourceAppPostId = "018f1c63-7b2a-4a11-8a55-2e3d9c4b5a61";
      const signedPost = buildNoteEvent(
        Uint8Array.from(Buffer.from("56".repeat(32), "hex")),
        "Die Querung an der Marienfelder Straße ist unübersichtlich.",
        {
          createdAt: 101,
          tags: [["source-app-post", sourceAppPostId]],
        }
      );

      const publishResponse = await fetch(`${origin}/api/signed-event`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-stadtstack-e2e": "1",
        },
        body: JSON.stringify({ intent: "post", event: signedPost }),
      });
      assert.equal(publishResponse.status, 200);

      const feed = (await fetch(`${origin}/api/feed`).then((response) =>
        response.json()
      )) as {
        posts: Array<{
          id: string;
          entryType: "post" | "topic";
          sourceAppPostId?: string | null;
        }>;
      };
      assert.equal(
        feed.posts.find((entry) => entry.id === signedPost.id)?.sourceAppPostId,
        sourceAppPostId
      );
    } finally {
      await running.close();
    }
  });

  it("accepts a human-started civic topic without inventing a CivicCase", async () => {
    const config = parseWorkbenchConfig(environment());
    const events: Array<Record<string, unknown>> = [];
    const relay = {
      query: async () => events,
      publish: async (entry: Record<string, unknown>) => {
        if (!events.some((candidate) => candidate.id === entry.id))
          events.push(entry);
        return { ok: true, message: "stored" };
      },
      close: () => {},
    };
    const running = await startWorkbench(config, {
      citizenRelay: relay as never,
      agentRelay: { ...relay, query: async () => [] } as never,
    });
    try {
      const origin = `http://127.0.0.1:${running.port}/stadtstack-test`;
      const citizenSecret = Uint8Array.from(
        Buffer.from("57".repeat(32), "hex")
      );
      const sourcePost = buildNoteEvent(
        citizenSecret,
        "In Röbel fehlt ein offener Treffpunkt.",
        {
          createdAt: 101,
          tags: [["source-app-post", "018f1c63-7b2a-4a11-8a55-2e3d9c4b5a61"]],
        }
      );
      const promotion = buildCivicTopicPromotionEvent(citizenSecret, {
        sourcePost,
        municipalityId: "roebel-mueritz",
        topicId:
          "urn:stadtstack:topic:municipality:roebel-mueritz:offener-treffpunkt",
        topicTitle: "Offener Treffpunkt in Röbel",
        agentPubkey: config.meckyPubkey,
        content: "@Mecky, welche geprüften Informationen liegen dazu vor?",
        createdAt: 102,
      });
      for (const [intent, event] of [
        ["post", sourcePost],
        ["promotion", promotion],
      ] as const) {
        const response = await fetch(`${origin}/api/signed-event`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-stadtstack-e2e": "1",
          },
          body: JSON.stringify({ intent, event }),
        });
        assert.equal(response.status, 200);
      }

      const feed = (await fetch(`${origin}/api/feed`).then((response) =>
        response.json()
      )) as {
        posts: Array<{
          id: string;
          entryType: "post" | "topic";
          topicId?: string;
          topicTitle?: string;
        }>;
      };
      const publicFeedResponse = await fetch(
        `${origin}/api/feed?profile=public`
      );
      const publicFeed = (await publicFeedResponse.json()) as {
        posts: Array<{
          id: string;
          entryType: "post" | "topic";
          synthetic: boolean;
          topicId?: string;
          discussions?: Array<{
            id: string;
            content: string;
            synthetic: boolean;
          }>;
        }>;
      };
      assert.equal(publicFeedResponse.status, 200);
      assert.deepEqual(
        publicFeed.posts.map((entry) => entry.id).sort(),
        [promotion.id, sourcePost.id].sort()
      );
      assert.equal(
        publicFeed.posts.every((entry) => !entry.synthetic),
        true
      );
      assert.equal(
        publicFeed.posts.some(
          (entry) =>
            entry.entryType === "topic" &&
            entry.topicId ===
              "urn:stadtstack:topic:municipality:roebel-mueritz:offener-treffpunkt" &&
            entry.discussions?.length === 1 &&
            entry.discussions[0]?.id === promotion.id &&
            entry.discussions[0]?.content === promotion.content &&
            entry.discussions[0]?.synthetic === false
        ),
        true
      );
      const invalidProfile = await fetch(`${origin}/api/feed?profile=all`);
      assert.equal(invalidProfile.status, 400);
      const topic = feed.posts.find(
        (entry) =>
          entry.entryType === "topic" &&
          entry.topicId ===
            "urn:stadtstack:topic:municipality:roebel-mueritz:offener-treffpunkt"
      );
      assert.equal(topic?.id, promotion.id);
      assert.equal(topic?.topicTitle, "Offener Treffpunkt in Röbel");
      assert.equal(
        promotion.tags.some((tag) => tag[0] === "case"),
        false
      );
      assert.equal(
        promotion.tags.some((tag) => tag[0] === "stadtstack-case"),
        false
      );
      const thread = (await fetch(
        `${origin}/api/thread?root=${promotion.id}`
      ).then((response) => response.json())) as {
        topic: { id: string; title: string } | null;
        caseBinding: Record<string, string> | null;
        sourceAppPostId: string | null;
        events: Record<string, { id: string }>;
      };
      assert.deepEqual(thread.topic, {
        id: "urn:stadtstack:topic:municipality:roebel-mueritz:offener-treffpunkt",
        title: "Offener Treffpunkt in Röbel",
      });
      assert.equal(thread.caseBinding, null);
      assert.equal(
        thread.sourceAppPostId,
        "018f1c63-7b2a-4a11-8a55-2e3d9c4b5a61"
      );
      assert.equal(thread.events[promotion.id]?.id, promotion.id);

      const claimResponse = await fetch(`${origin}/api/claim`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-stadtstack-e2e": "1",
        },
        body: JSON.stringify({
          personaId: "citizen-anna",
          rootEventId: promotion.id,
          parentEventId: promotion.id,
          stance: "pro",
          content:
            "Ein zeitlich begrenzter Treffpunkt könnte Erfahrungen liefern.",
        }),
      });
      const claim = (await claimResponse.json()) as {
        event: { tags: string[][] };
      };
      assert.equal(claimResponse.status, 200);
      assert.equal(
        claim.event.tags.some(
          (tag) => tag[0] === "topic" && tag[1] === thread.topic?.id
        ),
        true
      );
      assert.equal(
        claim.event.tags.some((tag) => tag[0] === "case"),
        false
      );

      const signedArgument = buildCivicArgumentEvent(
        Uint8Array.from(Buffer.from("58".repeat(32), "hex")),
        {
          rootEvent: promotion,
          parentEvent: promotion,
          municipalityId: "roebel-mueritz",
          topicId: thread.topic!.id,
          stance: "con",
          content: "Die laufenden Kosten brauchen ein belastbares Modell.",
          createdAt: 103,
        }
      );
      const signedArgumentResponse = await fetch(`${origin}/api/signed-event`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-stadtstack-e2e": "1",
        },
        body: JSON.stringify({ intent: "argument", event: signedArgument }),
      });
      assert.equal(signedArgumentResponse.status, 200);
      const updatedThread = (await fetch(
        `${origin}/api/thread?root=${promotion.id}`
      ).then((response) => response.json())) as {
        arguments: Array<{ id: string; stance: string }>;
      };
      assert.equal(
        updatedThread.arguments.some(
          (entry) => entry.id === signedArgument.id && entry.stance === "con"
        ),
        true
      );
    } finally {
      await running.close();
    }
  });

  it("returns the first signed promotion when the real app retries the same source post", async () => {
    const config = parseWorkbenchConfig(environment());
    const events: Array<Record<string, unknown>> = [];
    const relay = {
      query: async () => events,
      publish: async (entry: Record<string, unknown>) => {
        if (!events.some((candidate) => candidate.id === entry.id))
          events.push(entry);
        return { ok: true, message: "stored" };
      },
      close: () => {},
    };
    const running = await startWorkbench(config, {
      citizenRelay: relay as never,
      agentRelay: { ...relay, query: async () => [] } as never,
    });
    try {
      const origin = `http://127.0.0.1:${running.port}/stadtstack-test`;
      const citizenSecret = Uint8Array.from(
        Buffer.from("5f".repeat(32), "hex")
      );
      const sourcePost = buildNoteEvent(
        citizenSecret,
        "Ein normaler Röbel-Beitrag bleibt die unveränderte Quelle.",
        {
          createdAt: 101,
          tags: [["source-app-post", "018f1c63-7b2a-4a11-8a55-2e3d9c4b5a61"]],
        }
      );
      const firstPromotion = buildCivicTopicPromotionEvent(citizenSecret, {
        sourcePost,
        municipalityId: "roebel-mueritz",
        topicId:
          "urn:stadtstack:topic:municipality:roebel-mueritz:offener-treffpunkt",
        topicTitle: "Offener Treffpunkt in Röbel",
        agentPubkey: config.meckyPubkey,
        content: "@Mecky, welche geprüften Informationen liegen dazu vor?",
        createdAt: 102,
      });
      const retryPromotion = buildCivicTopicPromotionEvent(citizenSecret, {
        sourcePost,
        municipalityId: "roebel-mueritz",
        topicId:
          "urn:stadtstack:topic:municipality:roebel-mueritz:offener-treffpunkt",
        topicTitle: "Offener Treffpunkt in Röbel",
        agentPubkey: config.meckyPubkey,
        content: "@Mecky, welche Optionen sollten wir stattdessen prüfen?",
        createdAt: 103,
      });
      const sourceResponse = await fetch(`${origin}/api/signed-event`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-stadtstack-e2e": "1",
        },
        body: JSON.stringify({ intent: "post", event: sourcePost }),
      });
      assert.equal(sourceResponse.status, 200);

      const authoritySmugglingAttempt = buildNoteEvent(
        citizenSecret,
        firstPromotion.content,
        {
          createdAt: firstPromotion.created_at,
          tags: [...firstPromotion.tags, ["stadtstack-case", "fake-case"]],
        }
      );
      const rejected = await fetch(`${origin}/api/signed-event`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-stadtstack-e2e": "1",
        },
        body: JSON.stringify({
          intent: "promotion",
          event: authoritySmugglingAttempt,
        }),
      });
      assert.equal(rejected.status, 422);
      assert.deepEqual(await rejected.json(), {
        error: "signed_promotion_invalid",
      });
      events.push(
        authoritySmugglingAttempt as unknown as Record<string, unknown>
      );
      const poisonedFeed = (await fetch(`${origin}/api/feed`).then((response) =>
        response.json()
      )) as { posts: Array<{ id: string }> };
      assert.equal(
        poisonedFeed.posts.some(
          (entry) => entry.id === authoritySmugglingAttempt.id
        ),
        false
      );

      for (const [intent, event] of [["promotion", firstPromotion]] as const) {
        const response = await fetch(`${origin}/api/signed-event`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-stadtstack-e2e": "1",
          },
          body: JSON.stringify({ intent, event }),
        });
        assert.equal(response.status, 200);
      }
      events.push(retryPromotion as unknown as Record<string, unknown>);
      const duplicateFeed = (await fetch(`${origin}/api/feed`).then((response) =>
        response.json()
      )) as {
        posts: Array<{
          entryType: "post" | "topic";
          topicId?: string;
          discussionIds?: string[];
        }>;
      };
      const duplicateTopics = duplicateFeed.posts.filter(
        (entry) =>
          entry.entryType === "topic" &&
          entry.topicId ===
            "urn:stadtstack:topic:municipality:roebel-mueritz:offener-treffpunkt"
      );
      assert.equal(duplicateTopics.length, 1);
      assert.deepEqual(duplicateTopics[0]!.discussionIds, [firstPromotion.id]);

      const retryResponse = await fetch(`${origin}/api/signed-event`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-stadtstack-e2e": "1",
        },
        body: JSON.stringify({
          intent: "promotion",
          event: retryPromotion,
        }),
      });
      const retry = (await retryResponse.json()) as {
        status: string;
        event: { id: string };
      };

      assert.equal(retryResponse.status, 200);
      assert.equal(retry.status, "already_promoted");
      assert.equal(retry.event.id, firstPromotion.id);
      assert.equal(
        events.filter(
          (entry) =>
            Array.isArray(entry.tags) &&
            (entry.tags as string[][]).some(
              (tag) => tag[0] === "source-post" && tag[1] === sourcePost.id
            ) &&
            !(entry.tags as string[][]).some(
              (tag) => tag[0] === "stadtstack-case"
            )
        ).length,
        2
      );
    } finally {
      await running.close();
    }
  });

  it("accepts and projects only an exact completed Mecky exchange selected by the post author", async () => {
    const config = parseWorkbenchConfig({
      ...environment(),
      MECKY_PUBKEY: signedMecky.publicKey,
    });
    const citizenEvents: Array<Record<string, unknown>> = [];
    const agentEvents: Array<Record<string, unknown>> = [];
    const relay = (events: Array<Record<string, unknown>>) => ({
      query: async () => events,
      publish: async (entry: Record<string, unknown>) => {
        if (!events.some((candidate) => candidate.id === entry.id))
          events.push(entry);
        return { ok: true, message: "stored" };
      },
      close: () => {},
    });
    const running = await startWorkbench(config, {
      citizenRelay: relay(citizenEvents) as never,
      agentRelay: relay(agentEvents) as never,
    });
    try {
      const origin = `http://127.0.0.1:${running.port}/stadtstack-test`;
      const citizenSecret = Uint8Array.from(
        Buffer.from("61".repeat(32), "hex")
      );
      const participantSecret = Uint8Array.from(
        Buffer.from("62".repeat(32), "hex")
      );
      const sourceAppPostId = "018f1c63-7b2a-4a11-8a55-2e3d9c4b5a61";
      const sourceAppCommentId = "018f1c63-7b2a-4a11-8a55-2e3d9c4b5a62";
      const sourcePost = buildNoteEvent(
        citizenSecret,
        "Ein normaler Beitrag beschreibt den fehlenden Treffpunkt.",
        {
          createdAt: 101,
          tags: [["source-app-post", sourceAppPostId]],
        }
      );
      const mention = buildNoteEvent(
        participantSecret,
        "@Mecky, welche geprüften Hinweise gibt es dazu?",
        {
          createdAt: 102,
          tags: [
            ["p", config.meckyPubkey],
            ["source-app-post", sourceAppPostId],
            ["source-app-comment", sourceAppCommentId],
            ["t", "roebel-app-conversation"],
          ],
        }
      );
      const unprovenAnswer = buildAgentNoteEvent(
        signedMecky,
        "Diese Antwort behauptet etwas, bringt aber keinen Beleg mit.",
        {
          createdAt: 103,
          tags: [
            ["e", mention.id, "", "reply"],
            ["p", mention.pubkey],
            ["source-app-post", sourceAppPostId],
            ["source-app-comment", sourceAppCommentId],
          ],
        }
      );
      const answer = buildAgentNoteEvent(
        signedMecky,
        "Die Antwort trennt belegte Hinweise von offenen Fragen.",
        {
          createdAt: 104,
          tags: [
            ["e", mention.id, "", "reply"],
            ["p", mention.pubkey],
            ["source-app-post", sourceAppPostId],
            ["source-app-comment", sourceAppCommentId],
            ["evidence", `sha256:${"b".repeat(64)}`, "https://roebel.example/evidence/1"],
          ],
        }
      );
      const promotion = buildCivicTopicPromotionEvent(citizenSecret, {
        sourcePost,
        municipalityId: "roebel-mueritz",
        topicId:
          "urn:stadtstack:topic:municipality:roebel-mueritz:offener-treffpunkt",
        topicTitle: "Offener Treffpunkt in Röbel",
        agentPubkey: config.meckyPubkey,
        content: "@Mecky, welche Optionen sollen wir gemeinsam abwägen?",
        conversationSource: {
          kind: "selected_conversation",
          sourceAppPostId,
          sourceAppCommentId,
          mentionEventId: mention.id,
          replyEventId: answer.id,
        },
        createdAt: 105,
      });

      for (const [intent, event] of [
        ["post", sourcePost],
        ["conversation", mention],
      ] as const) {
        const response = await fetch(`${origin}/api/signed-event`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-stadtstack-e2e": "1",
          },
          body: JSON.stringify({ intent, event }),
        });
        assert.equal(response.status, 200);
      }
      agentEvents.push(unprovenAnswer as unknown as Record<string, unknown>);
      const unprovenPromotion = buildCivicTopicPromotionEvent(citizenSecret, {
        sourcePost,
        municipalityId: "roebel-mueritz",
        topicId:
          "urn:stadtstack:topic:municipality:roebel-mueritz:offener-treffpunkt",
        topicTitle: "Offener Treffpunkt in Röbel",
        agentPubkey: config.meckyPubkey,
        content: "@Mecky, welche Optionen sollen wir gemeinsam abwägen?",
        conversationSource: {
          kind: "selected_conversation",
          sourceAppPostId,
          sourceAppCommentId,
          mentionEventId: mention.id,
          replyEventId: unprovenAnswer.id,
        },
        createdAt: 105,
      });
      const unprovenResponse = await fetch(`${origin}/api/signed-event`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-stadtstack-e2e": "1",
        },
        body: JSON.stringify({
          intent: "promotion",
          event: unprovenPromotion,
        }),
      });
      assert.equal(unprovenResponse.status, 422);
      assert.deepEqual(await unprovenResponse.json(), {
        error: "signed_promotion_conversation_invalid",
      });

      agentEvents.push(answer as unknown as Record<string, unknown>);
      const promotionResponse = await fetch(`${origin}/api/signed-event`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-stadtstack-e2e": "1",
        },
        body: JSON.stringify({ intent: "promotion", event: promotion }),
      });
      assert.equal(promotionResponse.status, 200);

      const thread = (await fetch(
        `${origin}/api/thread?root=${promotion.id}`
      ).then((response) => response.json())) as {
        sourceConversation: {
          sourceAppPostId: string;
          sourceAppCommentId: string | null;
          mentionId: string;
          mentionAuthor: {
            name: string;
            kind: "citizen" | "mecky";
            pubkey: string;
            synthetic: boolean;
          };
          replyId: string;
          receiptId: string | null;
          evidenceRefs: Array<{ digest: string; url: string }>;
        } | null;
      };
      assert.deepEqual(thread.sourceConversation, {
        sourceAppPostId,
        sourceAppCommentId,
        mentionId: mention.id,
        mentionAuthor: {
          name: `Bürger:in ${mention.pubkey.slice(0, 8)}`,
          kind: "citizen",
          pubkey: mention.pubkey,
          synthetic: false,
        },
        replyId: answer.id,
        receiptId: null,
        evidenceRefs: [
          {
            digest: `sha256:${"b".repeat(64)}`,
            url: "https://roebel.example/evidence/1",
          },
        ],
      });
    } finally {
      await running.close();
    }
  });

  it("publishes and projects a citizen-signed topic proposal without admitting a CivicCase", async () => {
    const config = parseWorkbenchConfig(environment());
    const citizenEvents: Array<Record<string, unknown>> = [];
    const agentEvents: Array<Record<string, unknown>> = [];
    const relay = (events: Array<Record<string, unknown>>) => ({
      query: async (filters: Array<Record<string, unknown>>) =>
        events.filter((entry) => {
          const filter = filters[0] ?? {};
          if (
            Array.isArray(filter.ids) &&
            !filter.ids.includes(entry.id as string)
          ) {
            return false;
          }
          if (
            Array.isArray(filter.authors) &&
            !filter.authors.includes(entry.pubkey as string)
          ) {
            return false;
          }
          if (
            Array.isArray(filter.kinds) &&
            !filter.kinds.includes(entry.kind as number)
          ) {
            return false;
          }
          const expectedParents = filter["#e"];
          if (
            Array.isArray(expectedParents) &&
            !(entry.tags as string[][]).some(
              (tag) => tag[0] === "e" && expectedParents.includes(tag[1])
            )
          ) {
            return false;
          }
          return true;
        }),
      publish: async (entry: Record<string, unknown>) => {
        if (!events.some((candidate) => candidate.id === entry.id)) {
          events.push(entry);
        }
        return { ok: true, message: "stored" };
      },
      close: () => {},
    });
    let controlCalls = 0;
    const running = await startWorkbench(config, {
      citizenRelay: relay(citizenEvents) as never,
      agentRelay: relay(agentEvents) as never,
      fetch: async () => {
        controlCalls += 1;
        throw new Error("control_must_not_be_called");
      },
    });
    try {
      const origin = `http://127.0.0.1:${running.port}/stadtstack-test`;
      const citizenSecret = Uint8Array.from(
        Buffer.from("11".repeat(32), "hex")
      );
      const meckySecret = Uint8Array.from(Buffer.from("33".repeat(32), "hex"));
      const topicId =
        "urn:stadtstack:topic:municipality:roebel-mueritz:offener-treffpunkt";
      const sourcePost = buildNoteEvent(citizenSecret, "Treffpunkt gesucht", {
        createdAt: 601,
      });
      const discussion = buildCivicTopicPromotionEvent(citizenSecret, {
        sourcePost,
        municipalityId: "roebel-mueritz",
        topicId,
        topicTitle: "Offener Treffpunkt",
        agentPubkey: config.meckyPubkey,
        content: "@Mecky Welche geprüften Optionen gibt es?",
        createdAt: 602,
      });
      citizenEvents.push(
        sourcePost as unknown as Record<string, unknown>,
        discussion as unknown as Record<string, unknown>
      );
      const answer = buildNoteEvent(meckySecret, "Geprüfte Antwort", {
        createdAt: 603,
        tags: [
          ["e", discussion.id, "", "reply"],
          ["p", discussion.pubkey],
          ["mecky-receipt", `urn:stadtstack:mecky-answer:${"d".repeat(64)}`],
          ["municipality", "roebel-mueritz"],
          ["topic", topicId],
          [
            "evidence",
            `sha256:${"e".repeat(64)}`,
            "https://stadtstack.example/public/reviewed-source",
          ],
        ],
      });
      const signed = buildCitizenSignedTopicSuggestion(citizenSecret, {
        binding: { municipalityId: "roebel-mueritz", topicId },
        sourceDiscussion: discussion,
        sourceAnswer: answer,
        agentPubkey: config.meckyPubkey,
        title: "Offenen Treffpunkt prüfen",
        summary: "Die öffentlich diskutierten Optionen sollen geprüft werden.",
        createdAt: 604,
      });

      const beforeEvidence = await fetch(`${origin}/api/signed-event`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-stadtstack-e2e": "1",
        },
        body: JSON.stringify({ intent: "suggestion", event: signed.event }),
      });
      assert.equal(beforeEvidence.status, 422);
      agentEvents.push(answer as unknown as Record<string, unknown>);

      const published = await fetch(`${origin}/api/signed-event`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-stadtstack-e2e": "1",
        },
        body: JSON.stringify({ intent: "suggestion", event: signed.event }),
      });
      const payload = (await published.json()) as {
        status: string;
        suggestion: { candidateId: string; entryState: string };
      };
      assert.equal(published.status, 200);
      assert.equal(payload.status, "signed");
      assert.equal(payload.suggestion.candidateId, signed.candidateId);
      assert.equal(
        payload.suggestion.entryState,
        "awaiting_human_case_admission"
      );

      const duplicate = await fetch(`${origin}/api/signed-event`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-stadtstack-e2e": "1",
        },
        body: JSON.stringify({ intent: "suggestion", event: signed.event }),
      });
      assert.equal(duplicate.status, 200);
      assert.equal(
        citizenEvents.filter((entry) => entry.id === signed.event.id).length,
        1
      );

      const thread = (await fetch(
        `${origin}/api/thread?root=${discussion.id}`
      ).then((response) => response.json())) as {
        caseBinding: unknown;
        suggestion: null | {
          candidateId: string;
          submittedToCivicWorkflow: boolean;
        };
      };
      assert.equal(thread.caseBinding, null);
      assert.equal(thread.suggestion?.candidateId, signed.candidateId);
      assert.equal(thread.suggestion?.submittedToCivicWorkflow, false);
      const feed = (await fetch(`${origin}/api/feed`).then((response) =>
        response.json()
      )) as {
        posts: Array<{
          entryType: string;
          discussions?: Array<{
            id: string;
            suggestionSigned: boolean;
            caseBinding: unknown;
          }>;
        }>;
      };
      const projected = feed.posts
        .flatMap((entry) => entry.discussions ?? [])
        .find((entry) => entry.id === discussion.id);
      assert.equal(projected?.suggestionSigned, true);
      assert.equal(projected?.caseBinding, null);
      assert.equal(controlCalls, 0);
    } finally {
      await running.close();
    }
  });

  it("projects an adoption-required participant suggestion with its exact public conversation witnesses", async () => {
    const config = parseWorkbenchConfig(publicSignedEnvironment());
    const citizenEvents: Array<Record<string, unknown>> = [];
    const agentEvents: Array<Record<string, unknown>> = [];
    const relay = (events: Array<Record<string, unknown>>) => ({
      query: async (filters: Array<Record<string, unknown>>) =>
        events.filter((entry) => {
          const filter = filters[0] ?? {};
          if (Array.isArray(filter.ids) && !filter.ids.includes(entry.id))
            return false;
          if (
            Array.isArray(filter.authors) &&
            !filter.authors.includes(entry.pubkey)
          )
            return false;
          if (Array.isArray(filter.kinds) && !filter.kinds.includes(entry.kind))
            return false;
          const parents = filter["#e"];
          return (
            !Array.isArray(parents) ||
            (entry.tags as string[][]).some(
              (tag) => tag[0] === "e" && parents.includes(tag[1]),
            )
          );
        }),
      publish: async (entry: Record<string, unknown>) => {
        if (!events.some((candidate) => candidate.id === entry.id))
          events.push(entry);
        return { ok: true, message: "stored" };
      },
      close: () => {},
    });
    const running = await startWorkbench(config, {
      citizenRelay: relay(citizenEvents) as never,
      agentRelay: relay(agentEvents) as never,
    });
    try {
      const citizenSecret = Uint8Array.from(Buffer.from("11".repeat(32), "hex"));
      const meckySecret = Uint8Array.from(Buffer.from("33".repeat(32), "hex"));
      const sourceAppPostId = "30000000-0000-4000-8000-000000000003";
      const topicId =
        "urn:stadtstack:topic:municipality:roebel-mueritz:offener-treffpunkt";
      const mention = buildNoteEvent(
        citizenSecret,
        "@Mecky, welche Orte kommen als offener Treffpunkt infrage?",
        {
          createdAt: 701,
          tags: [
            ["p", config.meckyPubkey],
            ["source-app-post", sourceAppPostId],
            ["t", "roebel-app-conversation"],
          ],
        },
      );
      const sourceReceipt = `urn:stadtstack:mecky-answer:${"a".repeat(64)}`;
      const sourceReply = buildNoteEvent(
        meckySecret,
        "Eine veröffentlichte Übersicht nennt mehrere nutzbare Räume.",
        {
          createdAt: 702,
          tags: [
            ["netizen_agent", "Mecky", "roebel-staging"],
            ["e", mention.id, "", "reply"],
            ["p", mention.pubkey],
            ["source-app-post", sourceAppPostId],
            ["mecky-receipt", sourceReceipt],
            [
              "evidence",
              `sha256:${"b".repeat(64)}`,
              "https://stadtstack.example/public/room-overview",
            ],
          ],
        },
      );
      const discussion = buildCivicTopicPromotionEvent(citizenSecret, {
        sourcePost: mention,
        municipalityId: "roebel-mueritz",
        topicId,
        topicTitle: "Offener Treffpunkt",
        agentPubkey: config.meckyPubkey,
        content: "@Mecky, welche Optionen sollten gemeinsam geprüft werden?",
        conversationSource: {
          kind: "selected_conversation",
          sourceAppPostId,
          mentionEventId: mention.id,
          replyEventId: sourceReply.id,
          receiptId: sourceReceipt,
        },
        createdAt: 703,
      });
      const answerReceipt = `urn:stadtstack:mecky-answer:${"c".repeat(64)}`;
      const answer = buildNoteEvent(meckySecret, "Drei Optionen sind belegt.", {
        createdAt: 704,
        tags: [
          ["netizen_agent", "Mecky", "roebel-staging"],
          ["e", discussion.id, "", "reply"],
          ["p", discussion.pubkey],
          ["source-app-post", sourceAppPostId],
          ["mecky-receipt", answerReceipt],
          ["municipality", "roebel-mueritz"],
          ["topic", topicId],
          [
            "evidence",
            `sha256:${"d".repeat(64)}`,
            "https://stadtstack.example/public/options",
          ],
        ],
      });
      const malformedAnswer = buildNoteEvent(
        meckySecret,
        "Diese signierte Antwort trägt keine verpflichtende Agentenkennzeichnung.",
        {
          createdAt: 705,
          tags: [
            ["e", discussion.id, "", "reply"],
            ["p", discussion.pubkey],
            ["source-app-post", sourceAppPostId],
            ["mecky-receipt", `urn:stadtstack:mecky-answer:${"e".repeat(64)}`],
            ["municipality", "roebel-mueritz"],
            ["topic", topicId],
            [
              "evidence",
              `sha256:${"f".repeat(64)}`,
              "https://stadtstack.example/public/malformed-answer",
            ],
          ],
        },
      );
      const suggestion = buildParticipantTopicSuggestion(citizenSecret, {
        binding: { municipalityId: "roebel-mueritz", topicId },
        sourcePost: mention,
        sourceDiscussion: discussion,
        sourceAnswer: answer,
        conversationWitnesses: {
          conversationTopic: "roebel-app-conversation",
          mentionEvent: mention,
          replyEvent: sourceReply,
        },
        agentPubkey: config.meckyPubkey,
        title: "Offenen Treffpunkt prüfen",
        summary: "Die belegten Raumoptionen sollen gemeinsam geprüft werden.",
        createdAt: 705,
      });
      citizenEvents.push(
        mention as unknown as Record<string, unknown>,
        discussion as unknown as Record<string, unknown>,
      );
      agentEvents.push(
        sourceReply as unknown as Record<string, unknown>,
        malformedAnswer as unknown as Record<string, unknown>,
      );

      const origin = `http://127.0.0.1:${running.port}/stadtstack-test`;
      const unverifiedThread = (await fetch(
        `${origin}/api/thread?root=${discussion.id}`,
      ).then((response) => response.json())) as {
        mecky: unknown;
      };
      assert.equal(unverifiedThread.mecky, null);
      const unverifiedFeed = (await fetch(
        `${origin}/api/feed?profile=public`,
      ).then((response) => response.json())) as {
        posts: Array<{
          meckyAnswered: boolean;
          discussions?: Array<{ id: string; meckyAnswered: boolean }>;
        }>;
      };
      const unverifiedTopic = unverifiedFeed.posts.find((entry) =>
        entry.discussions?.some((entry) => entry.id === discussion.id),
      );
      assert.equal(unverifiedTopic?.meckyAnswered, false);
      assert.equal(
        unverifiedFeed.posts
          .flatMap((entry) => entry.discussions ?? [])
          .find((entry) => entry.id === discussion.id)?.meckyAnswered,
        false,
      );

      citizenEvents.push(suggestion.event as unknown as Record<string, unknown>);
      agentEvents.push(answer as unknown as Record<string, unknown>);
      const thread = (await fetch(
        `${origin}/api/thread?root=${discussion.id}`,
      ).then((response) => response.json())) as {
        suggestion: null | {
          schemaVersion: string;
          entryState: string;
          authorityBinding: string;
          submittedToCivicWorkflow: boolean;
        };
        mecky: null | {
          event: { id: string };
          evidenceRefs: Array<{ digest: string; url: string }>;
        };
        sourceConversationWitnesses: null | {
          conversationTopic: string;
          mentionEvent: Record<string, unknown>;
          replyEvent: Record<string, unknown>;
        };
      };
      assert.deepEqual(thread.sourceConversationWitnesses, {
        conversationTopic: "roebel-app-conversation",
        mentionEvent: mention,
        replyEvent: sourceReply,
      });
      assert.equal(thread.mecky?.event.id, answer.id);
      assert.deepEqual(thread.mecky?.evidenceRefs, [
        {
          digest: `sha256:${"d".repeat(64)}`,
          url: "https://stadtstack.example/public/options",
        },
      ]);
      assert.deepEqual(
        {
          schemaVersion: thread.suggestion?.schemaVersion,
          entryState: thread.suggestion?.entryState,
          authorityBinding: thread.suggestion?.authorityBinding,
          submittedToCivicWorkflow: thread.suggestion?.submittedToCivicWorkflow,
        },
        {
          schemaVersion: "staging_participant_signed_topic_suggestion_v1",
          entryState: "citizen_adoption_required",
          authorityBinding: "none",
          submittedToCivicWorkflow: false,
        },
      );
      const feed = (await fetch(`${origin}/api/feed?profile=public`).then(
        (response) => response.json(),
      )) as {
        posts: Array<{
          meckyAnswered: boolean;
          discussions?: Array<{
            id: string;
            meckyAnswered: boolean;
            suggestionSigned: boolean;
          }>;
        }>;
      };
      const topic = feed.posts.find((entry) =>
        entry.discussions?.some((entry) => entry.id === discussion.id),
      );
      assert.equal(topic?.meckyAnswered, true);
      assert.equal(
        feed.posts
          .flatMap((entry) => entry.discussions ?? [])
          .find((entry) => entry.id === discussion.id)?.suggestionSigned,
        true,
      );
      assert.equal(
        feed.posts
          .flatMap((entry) => entry.discussions ?? [])
          .find((entry) => entry.id === discussion.id)?.meckyAnswered,
        true,
      );
    } finally {
      await running.close();
    }
  });

  it("groups related signed discussion roots into one civic topic feed card", async () => {
    const config = parseWorkbenchConfig(environment());
    const events: Array<Record<string, unknown>> = [];
    const relay = {
      query: async (filters: Array<Record<string, unknown>>) =>
        events.filter((entry) => {
          const filter = filters[0] ?? {};
          if (Array.isArray(filter.kinds) && !filter.kinds.includes(entry.kind))
            return false;
          const expectedTag = filter["#e"];
          if (
            Array.isArray(expectedTag) &&
            !(entry.tags as string[][]).some(
              (tag) => tag[0] === "e" && expectedTag.includes(tag[1])
            )
          )
            return false;
          return true;
        }),
      publish: async (entry: Record<string, unknown>) => {
        if (!events.some((candidate) => candidate.id === entry.id))
          events.push(entry);
        return { ok: true, message: "stored" };
      },
      close: () => {},
    };
    const running = await startWorkbench(config, {
      citizenRelay: relay as never,
      agentRelay: relay as never,
    });
    try {
      const origin = `http://127.0.0.1:${running.port}/stadtstack-test`;
      const feed = (await fetch(`${origin}/api/feed`).then((response) =>
        response.json()
      )) as {
        schemaVersion: string;
        posts: Array<{
          id: string;
          entryType: string;
          topicId: string;
          discussionCount: number;
          discussionIds: string[];
          activityCount: number;
          author: { name: string };
          replyCount: number;
          meckyAnswered: boolean;
        }>;
      };
      assert.equal(feed.schemaVersion, "roebel_staging_mixed_feed_v1");
      assert.equal(
        feed.posts.filter((entry) => entry.entryType === "topic").length,
        1
      );
      assert.equal(
        feed.posts.filter((entry) => entry.entryType === "post").length,
        2
      );
      const root = feed.posts.find((entry) => entry.entryType === "topic")!;
      assert.equal(
        root.topicId,
        "urn:stadtstack:topic:municipality:roebel-mueritz:marienfelder-strasse"
      );
      assert.equal(root.discussionCount, 2);
      assert.equal(root.discussionIds.length, 2);
      assert.equal(root.activityCount, 4);
      assert.equal(root.author.name, "Anna (synthetisch)");
      assert.equal(root.replyCount, 2);
      assert.equal(root.meckyAnswered, false);

      const thread = (await fetch(`${origin}/api/thread?root=${root.id}`).then(
        (response) => response.json()
      )) as {
        arguments: Array<{ stance: string; parentId: string | null }>;
      };
      assert.equal(thread.arguments[0]?.stance, "root");
      assert.deepEqual(
        new Set(thread.arguments.slice(1).map((entry) => entry.stance)),
        new Set(["pro", "con"])
      );

      const claimResponse = await fetch(`${origin}/api/claim`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-stadtstack-e2e": "1",
        },
        body: JSON.stringify({
          personaId: "citizen-anna",
          rootEventId: root.id,
          parentEventId: root.id,
          stance: "pro",
          content:
            "Ein zeitlich begrenzter Verkehrsversuch könnte belastbare Daten liefern.",
        }),
      });
      const claim = (await claimResponse.json()) as {
        event: { id: string; tags: string[][] };
      };
      assert.equal(claimResponse.status, 200);
      assert.equal(
        claim.event.tags.some((tag) => tag[0] === "stance" && tag[1] === "pro"),
        true
      );
      assert.equal(
        claim.event.tags.some(
          (tag) => tag[0] === "e" && tag[1] === root.id && tag[3] === "root"
        ),
        true
      );
    } finally {
      await running.close();
    }
  });

  it("seeds a mixed timeline with a standalone post and an attributable promoted source post", async () => {
    const config = parseWorkbenchConfig(environment());
    const events: Array<Record<string, unknown>> = [];
    const relay = {
      query: async () => events,
      publish: async (entry: Record<string, unknown>) => {
        if (!events.some((candidate) => candidate.id === entry.id))
          events.push(entry);
        return { ok: true, message: "stored" };
      },
      close: () => {},
    };
    const running = await startWorkbench(config, {
      citizenRelay: relay as never,
      agentRelay: { ...relay, query: async () => [] } as never,
    });
    try {
      const feed = (await fetch(
        `http://127.0.0.1:${running.port}/stadtstack-test/api/feed`
      ).then((response) => response.json())) as {
        posts: Array<{
          id: string;
          entryType: "post" | "topic";
          promotedTopicId?: string | null;
          sourcePostIds?: string[];
        }>;
      };
      const standalone = feed.posts.find(
        (entry) => entry.entryType === "post" && entry.promotedTopicId === null
      );
      const promoted = feed.posts.find(
        (entry) =>
          entry.entryType === "post" &&
          typeof entry.promotedTopicId === "string"
      );
      const topic = feed.posts.find((entry) => entry.entryType === "topic");
      assert.ok(standalone);
      assert.ok(promoted);
      assert.equal(topic?.sourcePostIds?.includes(promoted.id), true);
    } finally {
      await running.close();
    }
  });

  it("keeps an ordinary signed post in the feed after its author explicitly promotes it", async () => {
    const config = parseWorkbenchConfig(environment());
    const events: Array<Record<string, unknown>> = [];
    const relay = {
      query: async () => events,
      publish: async (entry: Record<string, unknown>) => {
        if (!events.some((candidate) => candidate.id === entry.id))
          events.push(entry);
        return { ok: true, message: "stored" };
      },
      close: () => {},
    };
    const running = await startWorkbench(config, {
      citizenRelay: relay as never,
      agentRelay: { ...relay, query: async () => [] } as never,
    });
    try {
      const origin = `http://127.0.0.1:${running.port}/stadtstack-test`;
      const postResponse = await fetch(`${origin}/api/post`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-stadtstack-e2e": "1",
        },
        body: JSON.stringify({
          personaId: "citizen-anna",
          content: "Am Hafen fehlt abends ein wettergeschuetzter Treffpunkt.",
        }),
      });
      const post = (await postResponse.json()) as {
        event: { id: string; tags: string[][]; pubkey: string };
      };
      assert.equal(postResponse.status, 200);
      assert.deepEqual(post.event.tags, []);

      const before = (await fetch(`${origin}/api/feed`).then((response) =>
        response.json()
      )) as {
        posts: Array<{
          id: string;
          entryType: string;
          promotedTopicId: string | null;
        }>;
      };
      const ordinaryPost = before.posts.find(
        (entry) => entry.id === post.event.id
      );
      assert.equal(ordinaryPost?.entryType, "post");
      assert.equal(ordinaryPost?.promotedTopicId, null);

      const promotionResponse = await fetch(`${origin}/api/promote`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-stadtstack-e2e": "1",
        },
        body: JSON.stringify({
          personaId: "citizen-anna",
          sourcePostId: post.event.id,
          topicId:
            "urn:stadtstack:topic:municipality:roebel-mueritz:marienfelder-strasse",
          question:
            "Welche geprueften Informationen helfen bei einer gemeinsamen Abwaegung?",
        }),
      });
      const promotion = (await promotionResponse.json()) as {
        event: { id: string; tags: string[][]; pubkey: string };
      };
      assert.equal(promotionResponse.status, 200);
      assert.equal(promotion.event.pubkey, post.event.pubkey);
      assert.equal(
        promotion.event.tags.some(
          (tag) => tag[0] === "q" && tag[1] === post.event.id
        ),
        true
      );

      const after = (await fetch(`${origin}/api/feed`).then((response) =>
        response.json()
      )) as {
        posts: Array<{
          id: string;
          entryType: string;
          promotedTopicId?: string | null;
          sourcePostIds?: string[];
        }>;
      };
      assert.equal(
        after.posts.find((entry) => entry.id === post.event.id)
          ?.promotedTopicId,
        "urn:stadtstack:topic:municipality:roebel-mueritz:marienfelder-strasse"
      );
      assert.equal(
        after.posts.some(
          (entry) =>
            entry.entryType === "topic" &&
            entry.sourcePostIds?.includes(post.event.id)
        ),
        true
      );
      assert.equal(
        events.some((entry) => entry.id === post.event.id),
        true
      );
    } finally {
      await running.close();
    }
  });

  it("allows only one civic promotion per source post even when a retry changes the question", async () => {
    const actualNow = Date.now;
    const config = parseWorkbenchConfig(environment());
    const events: Array<Record<string, unknown>> = [];
    const relay = {
      query: async () => events,
      publish: async (entry: Record<string, unknown>) => {
        if (!events.some((candidate) => candidate.id === entry.id))
          events.push(entry);
        return { ok: true, message: "stored" };
      },
      close: () => {},
    };
    let running: Awaited<ReturnType<typeof startWorkbench>> | null = null;
    try {
      Date.now = () => Date.UTC(2026, 7, 13, 8, 0, 0);
      running = await startWorkbench(config, {
        citizenRelay: relay as never,
        agentRelay: { ...relay, query: async () => [] } as never,
      });
      const origin = `http://127.0.0.1:${running.port}/stadtstack-test`;
      const post = (await fetch(`${origin}/api/post`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-stadtstack-e2e": "1",
        },
        body: JSON.stringify({
          personaId: "citizen-anna",
          content: "Ein normaler Beitrag.",
        }),
      }).then((response) => response.json())) as { event: { id: string } };
      const body = {
        personaId: "citizen-anna",
        sourcePostId: post.event.id,
        topicId:
          "urn:stadtstack:topic:municipality:roebel-mueritz:marienfelder-strasse",
        question: "Welche Informationen sollten wir gemeinsam abwaegen?",
      };

      Date.now = () => Date.UTC(2026, 7, 13, 8, 1, 0);
      const first = (await fetch(`${origin}/api/promote`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-stadtstack-e2e": "1",
        },
        body: JSON.stringify(body),
      }).then((response) => response.json())) as { event: { id: string } };
      Date.now = () => Date.UTC(2026, 7, 13, 8, 2, 0);
      const second = (await fetch(`${origin}/api/promote`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-stadtstack-e2e": "1",
        },
        body: JSON.stringify({
          ...body,
          question: "Eine nachtraeglich anders formulierte Leitfrage.",
        }),
      }).then((response) => response.json())) as { event: { id: string } };

      assert.equal(second.event.id, first.event.id);
      assert.equal(
        events.filter(
          (entry) =>
            Array.isArray(entry.tags) &&
            (entry.tags as string[][]).some(
              (tag) => tag[0] === "source-post" && tag[1] === post.event.id
            )
        ).length,
        1
      );
    } finally {
      Date.now = actualNow;
      await running?.close();
    }
  });

  it("keeps the deterministic seed identical across same-day workbench restarts", async () => {
    const config = parseWorkbenchConfig(environment());
    const events: Array<Record<string, unknown>> = [];
    const relay = {
      query: async () => events,
      publish: async (entry: Record<string, unknown>) => {
        if (!events.some((candidate) => candidate.id === entry.id))
          events.push(entry);
        return { ok: true, message: "stored" };
      },
      close: () => {},
    };
    const actualNow = Date.now;
    let running: Awaited<ReturnType<typeof startWorkbench>> | null = null;
    try {
      Date.now = () => Date.UTC(2026, 7, 13, 8, 0, 0);
      running = await startWorkbench(config, {
        citizenRelay: relay as never,
        agentRelay: relay as never,
      });
      await running.close();
      running = null;
      Date.now = () => Date.UTC(2026, 7, 13, 18, 0, 0);
      running = await startWorkbench(config, {
        citizenRelay: relay as never,
        agentRelay: relay as never,
      });
      const feed = (await fetch(
        `http://127.0.0.1:${running.port}/api/feed`
      ).then((response) => response.json())) as {
        posts: Array<{ id: string }>;
      };
      assert.equal(feed.posts.length, 3);
      assert.equal(new Set(feed.posts.map((entry) => entry.id)).size, 3);
    } finally {
      Date.now = actualNow;
      await running?.close();
    }
  });

  it("does not project a loosely tagged Mecky reply as a verified civic answer", async () => {
    const config = parseWorkbenchConfig({
      ...environment(),
      MECKY_PUBKEY: signedMecky.publicKey,
    });
    const citizenEvents: Array<Record<string, unknown>> = [];
    const agentEvents: Array<Record<string, unknown>> = [];
    const relay = (events: Array<Record<string, unknown>>) => ({
      query: async () => events,
      publish: async (entry: Record<string, unknown>) => {
        if (!events.some((candidate) => candidate.id === entry.id))
          events.push(entry);
        return { ok: true, message: "stored" };
      },
      close: () => {},
    });
    const running = await startWorkbench(config, {
      citizenRelay: relay(citizenEvents) as never,
      agentRelay: relay(agentEvents) as never,
    });
    try {
      const origin = `http://127.0.0.1:${running.port}/stadtstack-test`;
      const first = (await fetch(`${origin}/api/feed`).then((response) =>
        response.json()
      )) as {
        posts: Array<{
          id: string;
          meckyMentioned: boolean;
          meckyAnswered: boolean;
        }>;
      };
      const mentioned = first.posts.find((post) => post.meckyMentioned);
      assert.ok(mentioned);
      assert.equal(mentioned.meckyAnswered, false);

      agentEvents.push(
        buildAgentNoteEvent(signedMecky, "Signierte Testantwort.", {
          tags: [["e", mentioned.id, "", "reply"]],
        }) as unknown as Record<string, unknown>
      );
      const thread = (await fetch(
        `${origin}/api/thread?root=${mentioned.id}`
      ).then((response) => response.json())) as {
        rootEvent: { id: string; pubkey: string };
        mecky: unknown;
      };
      assert.equal(thread.rootEvent.id, mentioned.id);
      assert.equal(thread.rootEvent.pubkey, config.personas[0]?.publicKey);
      assert.equal(thread.mecky, null);
      const second = (await fetch(`${origin}/api/feed`).then((response) =>
        response.json()
      )) as {
        posts: Array<{ id: string; meckyAnswered: boolean }>;
      };
      assert.equal(
        second.posts.find((post) => post.id === mentioned.id)?.meckyAnswered,
        false
      );
    } finally {
      await running.close();
    }
  });

  it("selects a later cited Mecky answer when an earlier app-conversation reply is unproven", async () => {
    const config = parseWorkbenchConfig({
      ...environment(),
      MECKY_PUBKEY: signedMecky.publicKey,
    });
    const citizenEvents: Array<Record<string, unknown>> = [];
    const agentEvents: Array<Record<string, unknown>> = [];
    const relay = (events: Array<Record<string, unknown>>) => ({
      query: async () => events,
      publish: async (entry: Record<string, unknown>) => {
        if (!events.some((candidate) => candidate.id === entry.id))
          events.push(entry);
        return { ok: true, message: "stored" };
      },
      close: () => {},
    });
    const running = await startWorkbench(config, {
      citizenRelay: relay(citizenEvents) as never,
      agentRelay: relay(agentEvents) as never,
    });
    const postId = "018f1c63-7b2a-4a11-8a55-2e3d9c4b5a61";
    const commentId = "018f1c63-7b2a-4a11-8a55-2e3d9c4b5a62";
    try {
      const origin = `http://127.0.0.1:${running.port}/stadtstack-test`;
      const mention = buildNoteEvent(
        Uint8Array.from(Buffer.from(one, "hex")),
        "@Mecky, was ist dazu geprüft?",
        {
          createdAt: 1_787_040_000,
          tags: [
            ["p", config.meckyPubkey],
            ["source-app-post", postId],
            ["source-app-comment", commentId],
            ["t", "roebel-app-conversation"],
          ],
        }
      );
      const published = await fetch(`${origin}/api/signed-event`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-stadtstack-e2e": "1",
        },
        body: JSON.stringify({ intent: "conversation", event: mention }),
      });
      assert.equal(published.status, 200);

      let projection = (await fetch(
        `${origin}/api/conversation?post=${postId}`
      ).then((response) => response.json())) as {
        requestCount: number;
        mentionIds: string[];
        pendingCount: number;
        requests: Array<{
          mentionId: string;
          sourceAppCommentId: string | null;
          state: "pending" | "answered";
          replyId: string | null;
        }>;
        replies: Array<{
          id: string;
          mentionEvent: Record<string, unknown>;
          replyEvent: Record<string, unknown>;
        }>;
      };
      assert.equal(projection.requestCount, 1);
      assert.deepEqual(projection.mentionIds, [mention.id]);
      assert.equal(projection.pendingCount, 1);
      assert.deepEqual(projection.requests, [
        {
          mentionId: mention.id,
          sourceAppCommentId: commentId,
          state: "pending",
          replyId: null,
        },
      ]);

      const unprovenAnswer = buildAgentNoteEvent(
        signedMecky,
        "Frühere Antwort ohne prüfbaren Beleg.",
        {
          createdAt: mention.created_at + 1,
          tags: [
            ["e", mention.id, "", "reply"],
            ["p", mention.pubkey],
            ["source-app-post", postId],
            ["source-app-comment", commentId],
          ],
        }
      );
      const answer = buildAgentNoteEvent(signedMecky, "Geprüfte Antwort.", {
        createdAt: mention.created_at + 2,
        tags: [
          ["e", mention.id, "", "reply"],
          ["p", mention.pubkey],
          ["source-app-post", postId],
          ["source-app-comment", commentId],
          [
            "evidence",
            `sha256:${"a".repeat(64)}`,
            "https://roebel.example/evidence/verified-answer",
          ],
        ],
      });
      agentEvents.push(
        unprovenAnswer as unknown as Record<string, unknown>,
        answer as unknown as Record<string, unknown>
      );
      projection = (await fetch(
        `${origin}/api/conversation?post=${postId}`
      ).then((response) => response.json())) as typeof projection;
      assert.equal(projection.pendingCount, 0);
      assert.deepEqual(projection.requests, [
        {
          mentionId: mention.id,
          sourceAppCommentId: commentId,
          state: "answered",
          replyId: answer.id,
        },
      ]);
      assert.deepEqual(
        projection.replies.map((entry) => entry.id),
        [answer.id]
      );
      assert.deepEqual(projection.replies[0]?.mentionEvent, mention);
      assert.deepEqual(projection.replies[0]?.replyEvent, answer);

      const duplicate = await fetch(`${origin}/api/signed-event`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-stadtstack-e2e": "1",
        },
        body: JSON.stringify({ intent: "conversation", event: mention }),
      });
      assert.equal(duplicate.status, 200);
      assert.equal(
        citizenEvents.filter((entry) => entry.id === mention.id).length,
        1
      );
    } finally {
      await running.close();
    }
  });

  it("projects an interactively published signed civic discussion into the normal feed", async () => {
    const config = parseWorkbenchConfig(environment());
    const citizenEvents: Array<Record<string, unknown>> = [];
    const relay = {
      query: async () => citizenEvents,
      publish: async (entry: Record<string, unknown>) => {
        if (!citizenEvents.some((candidate) => candidate.id === entry.id))
          citizenEvents.push(entry);
        return { ok: true, message: "stored" };
      },
      close: () => {},
    };
    const running = await startWorkbench(config, {
      citizenRelay: relay as never,
      agentRelay: { ...relay, query: async () => [] } as never,
    });
    try {
      const origin = `http://127.0.0.1:${running.port}/stadtstack-test`;
      const published = (await fetch(`${origin}/api/discussion`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-stadtstack-e2e": "1",
        },
        body: JSON.stringify({
          personaId: "citizen-anna",
          question: "Welche geprüften Informationen liegen vor?",
        }),
      }).then((response) => response.json())) as { event: { id: string } };
      const feed = (await fetch(`${origin}/api/feed`).then((response) =>
        response.json()
      )) as {
        posts: Array<{
          id: string;
          entryType: string;
          meckyMentioned: boolean;
          discussionCount: number;
          discussionIds: string[];
        }>;
      };
      const topic = feed.posts.find((entry) => entry.entryType === "topic");
      assert.equal(topic?.meckyMentioned, true);
      assert.equal(topic?.discussionCount, 3);
      assert.equal(topic?.discussionIds.includes(published.event.id), true);
    } finally {
      await running.close();
    }
  });

  it("does not expose Case Steward commands from the public workbench", async () => {
    // CASE_STEWARD_TOKEN remains configured only until the privileged control
    // deployment is split from this public process; these public paths must
    // remain unavailable throughout that migration.
    const config = parseWorkbenchConfig(environment());
    const relay = {
      query: async () => [],
      publish: async () => ({ ok: true, message: "stored" }),
      close: () => {},
    };
    let upstreamCalls = 0;
    const running = await startWorkbench(config, {
      citizenRelay: relay,
      agentRelay: relay,
      fetch: async () => {
        upstreamCalls += 1;
        throw new Error("public_case_steward_route_called_upstream");
      },
    });
    try {
      const origin = `http://127.0.0.1:${running.port}`;
      const html = await fetch(`${origin}/stadtstack-test`).then((response) =>
        response.text()
      );
      assert.match(html, /Awaiting role-isolated Case Steward admission/);
      assert.doesNotMatch(html, /api\/(?:admit|complete|view)/);

      for (const path of ["/api/admit", "/api/complete", "/api/view"]) {
        const response = await fetch(`${origin}/stadtstack-test${path}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-stadtstack-e2e": "1",
          },
          body: "{}",
        });
        assert.equal(response.status, 404, path);
        assert.deepEqual(await response.json(), { error: "not_found" });
      }
      assert.equal(upstreamCalls, 0);
    } finally {
      await running.close();
    }
  });

  it("serves one case-bound public administration projection over GET only", async () => {
    const config = parseWorkbenchConfig(environment());
    const caseId =
      "urn:stadtstack:case:municipality:roebel-mueritz:018f0000-0000-7000-8000-000000000001";
    const publicPackage = {
      schemaVersion: "department_package_projection_v1",
      id: "package-planning",
      departmentId: "planning",
      suggestionId: "suggestion-1",
      request: "Planung öffentlich prüfen",
      packageChecksum: `sha256:${"c".repeat(64)}`,
      reviewState: "accepted",
      correctionState: "current",
      artifactChecksum: `sha256:${"d".repeat(64)}`,
      reviewedAt: "2026-08-22T00:00:00.000Z",
      policyVersion: "case-intake-v1",
      publicSummary: "Die öffentliche Planungsantwort.",
      publicCitations: ["https://example.invalid/planning"],
      authorityBinding: "none",
    };
    const projection = {
      schemaVersion: "projection_envelope_v1",
      caseId,
      caseVersion: 4,
      journalHeadChecksum: `sha256:${"a".repeat(64)}`,
      projectionChecksum: `sha256:${"b".repeat(64)}`,
      visibility: "public",
      policyVersion: "case-intake-v1",
      projection: {
        schemaVersion: "case_projection_v1",
        caseId,
        jurisdiction: { scheme: "municipality", value: "roebel-mueritz" },
        municipalityId: "roebel-mueritz",
        sourceScope: {
          municipalityId: "roebel-mueritz",
          caseId: "marienfelder-strasse",
        },
        authorityBinding: "none",
        formalDecision: null,
        discussion: {},
        discussions: [],
        suggestion: { status: "admitted", internalOwner: "must-not-leak" },
        suggestions: [],
        provenance: {},
        departmentPackages: [publicPackage],
      },
    };
    const calls: Array<{ path: string; body: unknown }> = [];
    const fetcher: typeof globalThis.fetch = async (input, init) => {
      calls.push({
        path: new URL(String(input)).pathname,
        body: JSON.parse(String(init?.body)),
      });
      return Response.json(projection);
    };
    const relay = {
      query: async () => [],
      publish: async () => ({ ok: true, message: "stored" }),
      close: () => {},
    };
    const running = await startWorkbench(config, {
      citizenRelay: relay,
      agentRelay: relay,
      fetch: fetcher,
    });
    try {
      const response = await fetch(
        `http://127.0.0.1:${running.port}/api/administration?case=${encodeURIComponent(caseId)}`
      );
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        schemaVersion: projection.schemaVersion,
        caseId,
        caseVersion: projection.caseVersion,
        journalHeadChecksum: projection.journalHeadChecksum,
        projectionChecksum: projection.projectionChecksum,
        visibility: "public",
        policyVersion: projection.policyVersion,
        projection: {
          schemaVersion: "case_projection_v1",
          caseId,
          municipalityId: "roebel-mueritz",
          authorityBinding: "none",
          formalDecision: null,
          suggestion: { status: "admitted" },
          departmentPackages: [publicPackage],
        },
      });
      assert.deepEqual(calls, [
        { path: "/v1/e2e/view", body: { profile: "public" } },
      ]);

      const ambiguous = await fetch(
        `http://127.0.0.1:${running.port}/api/administration?case=${encodeURIComponent(caseId)}&case=${encodeURIComponent(caseId)}`
      );
      assert.equal(ambiguous.status, 400);
      assert.equal(calls.length, 1);

      const wrongMethod = await fetch(
        `http://127.0.0.1:${running.port}/api/administration?case=${encodeURIComponent(caseId)}`,
        { method: "POST" }
      );
      assert.equal(wrongMethod.status, 404);
      assert.equal(calls.length, 1);

      Object.assign(projection.projection.departmentPackages[0]!, {
        privateNotes: "must-not-leak",
      });
      const leaked = await fetch(
        `http://127.0.0.1:${running.port}/api/administration?case=${encodeURIComponent(caseId)}`
      );
      assert.equal(leaked.status, 422);
      assert.deepEqual(await leaked.json(), {
        error: "public_administration_projection_invalid",
      });
      assert.equal(calls.length, 2);
    } finally {
      await running.close();
    }
  });
});
