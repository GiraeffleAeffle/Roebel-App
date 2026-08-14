import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bindingStatement,
  buildAgentNoteEvent,
  buildBindingEvent,
  buildCivicDiscussionEvent,
  buildCivicPromotionEvent,
  buildCitizenSignedSuggestion,
  buildNoteEvent,
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

describe("Röbel E2E workbench boundary", () => {
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
      parsed.controlBaseUrl.includes("stadtstack-roebel-staging-lab"),
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
      const promotion = buildCivicPromotionEvent(citizenSecret, {
        sourcePost: signedPost,
        municipalityId: "roebel-mueritz",
        sourceCaseId: "marienfelder-strasse",
        canonicalCaseId:
          "urn:stadtstack:case:municipality:roebel-mueritz:018f0000-0000-7000-8000-000000000001",
        topicId:
          "urn:stadtstack:topic:municipality:roebel-mueritz:marienfelder-strasse",
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
      const feed = (await fetch(`${origin}/api/feed`).then((response) =>
        response.json()
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

  it("marks a discussion answered only for a valid reply from the configured Mecky identity", async () => {
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
      };
      assert.equal(thread.rootEvent.id, mentioned.id);
      assert.equal(thread.rootEvent.pubkey, config.personas[0]?.publicKey);
      const second = (await fetch(`${origin}/api/feed`).then((response) =>
        response.json()
      )) as {
        posts: Array<{ id: string; meckyAnswered: boolean }>;
      };
      assert.equal(
        second.posts.find((post) => post.id === mentioned.id)?.meckyAnswered,
        true
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

  it("binds suggestion admission to the coordinator version read immediately before the command", async () => {
    const config = parseWorkbenchConfig({
      ...environment(),
      MECKY_PUBKEY: signedMecky.publicKey,
    });
    const actorSecret = Uint8Array.from(Buffer.from(one, "hex"));
    const discussion = buildCivicDiscussionEvent(actorSecret, {
      municipalityId: "roebel-mueritz",
      sourceCaseId: "marienfelder-strasse",
      canonicalCaseId:
        "urn:stadtstack:case:municipality:roebel-mueritz:018f0000-0000-7000-8000-000000000001",
      agentPubkey: signedMecky.publicKey,
      content: "@Mecky Welche geprüften Informationen liegen vor?",
      createdAt: 1_786_464_000,
    });
    const answer = buildAgentNoteEvent(signedMecky, "Geprüfte Testantwort.", {
      createdAt: discussion.created_at + 1,
      tags: [
        ["e", discussion.id, "", "reply"],
        ["p", discussion.pubkey],
        ["mecky-receipt", `urn:stadtstack:mecky-answer:${"a".repeat(64)}`],
        ["municipality", "roebel-mueritz"],
        ["case", "marienfelder-strasse"],
        [
          "stadtstack-case",
          "urn:stadtstack:case:municipality:roebel-mueritz:018f0000-0000-7000-8000-000000000001",
        ],
        [
          "evidence",
          `sha256:${"b".repeat(64)}`,
          "https://stadtstack.example/public/case",
        ],
      ],
    });
    const suggestion = buildCitizenSignedSuggestion(actorSecret, {
      binding: {
        municipalityId: "roebel-mueritz",
        sourceCaseId: "marienfelder-strasse",
        canonicalCaseId:
          "urn:stadtstack:case:municipality:roebel-mueritz:018f0000-0000-7000-8000-000000000001",
      },
      agentPubkey: signedMecky.publicKey,
      sourceDiscussion: discussion,
      sourceAnswer: answer,
      title: "Sichere Querung prüfen",
      summary: "Geprüfte Varianten sollen öffentlich abgewogen werden.",
      createdAt: discussion.created_at + 2,
    });
    const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
    const fetcher: typeof globalThis.fetch = async (input, init) => {
      const path = new URL(String(input)).pathname;
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      calls.push({ path, body });
      if (path === "/v1/e2e/view") return Response.json({ caseVersion: 17 });
      return Response.json({ status: "admitted", caseVersion: 18 });
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
        `http://127.0.0.1:${running.port}/api/admit`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-stadtstack-e2e": "1",
          },
          body: JSON.stringify({ discussion, answer, suggestion }),
        }
      );
      assert.equal(response.status, 200);
      assert.deepEqual(
        calls.map((entry) => entry.path),
        ["/v1/e2e/view", "/v1/nostr/suggestions/admit"]
      );
      assert.deepEqual(calls[0]?.body, { profile: "administration" });
      assert.equal(calls[1]?.body.expectedCaseVersion, 17);
    } finally {
      await running.close();
    }
  });
});
