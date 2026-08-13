import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildAgentNoteEvent,
  buildCivicDiscussionEvent,
  buildCitizenSignedSuggestion,
  deriveAgentIdentity,
  getPublicKeyHex,
} from "@netizen-labs/nostr";
import { parseWorkbenchConfig, startWorkbench } from "../src/server";

const one = "11".repeat(32);
const two = "22".repeat(32);
const mecky = getPublicKeyHex(Uint8Array.from(Buffer.from("33".repeat(32), "hex")));
const signedMecky = deriveAgentIdentity("test-mecky-node-secret-with-reviewed-entropy-0123456789", "roebel-e2e", "mecky");

function environment() {
  return {
    SYNTHETIC_CITIZENS_JSON: JSON.stringify([
      { id: "citizen-anna", name: "Anna (synthetisch)", secretKeyHex: one },
      { id: "citizen-omar", name: "Omar (synthetisch)", secretKeyHex: two },
    ]),
    MECKY_PUBKEY: mecky,
    CASE_STEWARD_TOKEN: "x".repeat(40),
    CITIZEN_RELAY_URL: "ws://citizen-relay.stadtstack-roebel-e2e.svc.cluster.local:18081",
    AGENT_RELAY_URL: "ws://agent-relay.stadtstack-roebel-e2e.svc.cluster.local:18081",
    STADTSTACK_CONTROL_BASE_URL: "http://stadtstack-control.stadtstack-roebel-e2e.svc.cluster.local:18081",
    STADTSTACK_PUBLIC_BASE_URL: "http://stadtstack-public.stadtstack-roebel-e2e.svc.cluster.local:18080",
    WORKBENCH_BIND_HOST: "127.0.0.1",
    WORKBENCH_PORT: "0",
  };
}

describe("Röbel E2E workbench boundary", () => {
  it("accepts only the exact isolated service topology and two synthetic citizens", () => {
    const config = parseWorkbenchConfig(environment());
    assert.equal(config.personas.length, 2);
    assert.notEqual(config.personas[0]?.publicKey, config.personas[1]?.publicKey);
    assert.equal(config.agentRelayUrl.includes("agent-relay.stadtstack-roebel-e2e"), true);
    assert.throws(() => parseWorkbenchConfig({ ...environment(), CITIZEN_RELAY_URL: "wss://relay.roebel.app" }));
    assert.throws(() => parseWorkbenchConfig({ ...environment(), SYNTHETIC_CITIZENS_JSON: "[]" }));
  });

  it("accepts the owned staging-preview namespace but rejects every production relay and arbitrary namespace", () => {
    const staging = Object.fromEntries(
      Object.entries(environment()).map(([key, value]) => [
        key,
        typeof value === "string" ? value.replaceAll("stadtstack-roebel-e2e", "stadtstack-roebel-web-preview") : value,
      ]),
    );
    assert.equal(parseWorkbenchConfig(staging).citizenRelayUrl.includes("stadtstack-roebel-web-preview"), true);
    assert.throws(() => parseWorkbenchConfig({ ...staging, CITIZEN_RELAY_URL: "wss://relay.roebel.app" }));
    assert.throws(() => parseWorkbenchConfig({ ...staging, CITIZEN_RELAY_URL: "ws://citizen-relay.default.svc.cluster.local:18081" }));
  });

  it("accepts only the dedicated synthetic staging-lab namespace for the public test lane", () => {
    const stagingLab = Object.fromEntries(
      Object.entries(environment()).map(([key, value]) => [
        key,
        typeof value === "string" ? value.replaceAll("stadtstack-roebel-e2e", "stadtstack-roebel-staging-lab") : value,
      ]),
    );
    const parsed = parseWorkbenchConfig(stagingLab);
    assert.equal(parsed.citizenRelayUrl.includes("stadtstack-roebel-staging-lab"), true);
    assert.equal(parsed.controlBaseUrl.includes("stadtstack-roebel-staging-lab"), true);
  });

  it("serves a local-only accessible workflow UI without exposing private keys", async () => {
    const config = parseWorkbenchConfig(environment());
    const relay = { query: async () => [], publish: async () => ({ ok: true, message: "stored" }), close: () => {} };
    const running = await startWorkbench(config, { citizenRelay: relay, agentRelay: relay });
    try {
      const origin = `http://127.0.0.1:${running.port}`;
      const html = await fetch(origin).then((response) => response.text());
      assert.match(html, /Bürgerdiskussion/);
      assert.match(html, /Pi 0\.84\.1/);
      assert.doesNotMatch(html, new RegExp(one));
      const publicConfig = await fetch(`${origin}/api/config`).then((response) => response.json()) as { personas: Array<Record<string, unknown>> };
      assert.equal(publicConfig.personas.length, 2);
      assert.equal(publicConfig.personas.some((entry) => "secretKeyHex" in entry), false);
    } finally {
      await running.close();
    }
  });

  it("serves the workflow beneath the staging ingress prefix without root-relative API leaks", async () => {
    const config = parseWorkbenchConfig(environment());
    const relay = { query: async () => [], publish: async () => ({ ok: true, message: "stored" }), close: () => {} };
    const running = await startWorkbench(config, { citizenRelay: relay, agentRelay: relay });
    try {
      const origin = `http://127.0.0.1:${running.port}`;
      const response = await fetch(`${origin}/stadtstack-test/`);
      const html = await response.text();
      assert.equal(response.status, 200);
      assert.match(html, /const base='\/stadtstack-test'/);
      assert.match(html, /api\(base\+'\/api\/config'/);
      assert.doesNotMatch(html, /api\('\/api\/config'/);

      const publicConfig = await fetch(`${origin}/stadtstack-test/api/config`).then((entry) => entry.json()) as { authorityBinding: string };
      assert.equal(publicConfig.authorityBinding, "none");
      const health = await fetch(`${origin}/stadtstack-test/healthz`).then((entry) => entry.json()) as { mode: string };
      assert.equal(health.mode, "synthetic-e2e");
    } finally {
      await running.close();
    }
  });

  it("groups related signed discussion roots into one civic topic feed card", async () => {
    const config = parseWorkbenchConfig(environment());
    const events: Array<Record<string, unknown>> = [];
    const relay = {
      query: async (filters: Array<Record<string, unknown>>) => events.filter((entry) => {
        const filter = filters[0] ?? {};
        if (Array.isArray(filter.kinds) && !filter.kinds.includes(entry.kind)) return false;
        const expectedTag = filter["#e"];
        if (Array.isArray(expectedTag) && !(entry.tags as string[][]).some((tag) => tag[0] === "e" && expectedTag.includes(tag[1]))) return false;
        return true;
      }),
      publish: async (entry: Record<string, unknown>) => {
        if (!events.some((candidate) => candidate.id === entry.id)) events.push(entry);
        return { ok: true, message: "stored" };
      },
      close: () => {},
    };
    const running = await startWorkbench(config, { citizenRelay: relay as never, agentRelay: relay as never });
    try {
      const origin = `http://127.0.0.1:${running.port}/stadtstack-test`;
      const feed = await fetch(`${origin}/api/feed`).then((response) => response.json()) as {
        schemaVersion: string;
        posts: Array<{ id: string; topicId: string; discussionCount: number; discussionIds: string[]; activityCount: number; author: { name: string }; replyCount: number; meckyAnswered: boolean }>;
      };
      assert.equal(feed.schemaVersion, "roebel_staging_topic_feed_v1");
      assert.equal(feed.posts.length, 1);
      const root = feed.posts[0]!;
      assert.equal(root.topicId, "urn:stadtstack:topic:municipality:roebel-mueritz:marienfelder-strasse");
      assert.equal(root.discussionCount, 2);
      assert.equal(root.discussionIds.length, 2);
      assert.equal(root.activityCount, 4);
      assert.equal(root.author.name, "Anna (synthetisch)");
      assert.equal(root.replyCount, 2);
      assert.equal(root.meckyAnswered, false);

      const thread = await fetch(`${origin}/api/thread?root=${root.id}`).then((response) => response.json()) as {
        arguments: Array<{ stance: string; parentId: string | null }>;
      };
      assert.equal(thread.arguments[0]?.stance, "root");
      assert.deepEqual(new Set(thread.arguments.slice(1).map((entry) => entry.stance)), new Set(["pro", "con"]));

      const claimResponse = await fetch(`${origin}/api/claim`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-stadtstack-e2e": "1" },
        body: JSON.stringify({
          personaId: "citizen-anna",
          rootEventId: root.id,
          parentEventId: root.id,
          stance: "pro",
          content: "Ein zeitlich begrenzter Verkehrsversuch könnte belastbare Daten liefern.",
        }),
      });
      const claim = await claimResponse.json() as { event: { id: string; tags: string[][] } };
      assert.equal(claimResponse.status, 200);
      assert.equal(claim.event.tags.some((tag) => tag[0] === "stance" && tag[1] === "pro"), true);
      assert.equal(claim.event.tags.some((tag) => tag[0] === "e" && tag[1] === root.id && tag[3] === "root"), true);
    } finally {
      await running.close();
    }
  });

  it("keeps the deterministic seed identical across same-day workbench restarts", async () => {
    const config = parseWorkbenchConfig(environment());
    const events: Array<Record<string, unknown>> = [];
    const relay = {
      query: async () => events,
      publish: async (entry: Record<string, unknown>) => {
        if (!events.some((candidate) => candidate.id === entry.id)) events.push(entry);
        return { ok: true, message: "stored" };
      },
      close: () => {},
    };
    const actualNow = Date.now;
    let running: Awaited<ReturnType<typeof startWorkbench>> | null = null;
    try {
      Date.now = () => Date.UTC(2026, 7, 13, 8, 0, 0);
      running = await startWorkbench(config, { citizenRelay: relay as never, agentRelay: relay as never });
      await running.close();
      running = null;
      Date.now = () => Date.UTC(2026, 7, 13, 18, 0, 0);
      running = await startWorkbench(config, { citizenRelay: relay as never, agentRelay: relay as never });
      const feed = await fetch(`http://127.0.0.1:${running.port}/api/feed`).then((response) => response.json()) as {
        posts: Array<{ id: string }>;
      };
      assert.equal(feed.posts.length, 1);
      assert.equal(new Set(feed.posts.map((entry) => entry.id)).size, 1);
    } finally {
      Date.now = actualNow;
      await running?.close();
    }
  });

  it("marks a discussion answered only for a valid reply from the configured Mecky identity", async () => {
    const config = parseWorkbenchConfig({ ...environment(), MECKY_PUBKEY: signedMecky.publicKey });
    const citizenEvents: Array<Record<string, unknown>> = [];
    const agentEvents: Array<Record<string, unknown>> = [];
    const relay = (events: Array<Record<string, unknown>>) => ({
      query: async () => events,
      publish: async (entry: Record<string, unknown>) => {
        if (!events.some((candidate) => candidate.id === entry.id)) events.push(entry);
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
      const first = await fetch(`${origin}/api/feed`).then((response) => response.json()) as {
        posts: Array<{ id: string; meckyMentioned: boolean; meckyAnswered: boolean }>;
      };
      const mentioned = first.posts.find((post) => post.meckyMentioned);
      assert.ok(mentioned);
      assert.equal(mentioned.meckyAnswered, false);

      agentEvents.push(buildAgentNoteEvent(signedMecky, "Signierte Testantwort.", {
        tags: [["e", mentioned.id, "", "reply"]],
      }) as unknown as Record<string, unknown>);
      const thread = await fetch(`${origin}/api/thread?root=${mentioned.id}`).then((response) => response.json()) as {
        rootEvent: { id: string; pubkey: string };
      };
      assert.equal(thread.rootEvent.id, mentioned.id);
      assert.equal(thread.rootEvent.pubkey, config.personas[0]?.publicKey);
      const second = await fetch(`${origin}/api/feed`).then((response) => response.json()) as {
        posts: Array<{ id: string; meckyAnswered: boolean }>;
      };
      assert.equal(second.posts.find((post) => post.id === mentioned.id)?.meckyAnswered, true);
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
        if (!citizenEvents.some((candidate) => candidate.id === entry.id)) citizenEvents.push(entry);
        return { ok: true, message: "stored" };
      },
      close: () => {},
    };
    const running = await startWorkbench(config, { citizenRelay: relay as never, agentRelay: { ...relay, query: async () => [] } as never });
    try {
      const origin = `http://127.0.0.1:${running.port}/stadtstack-test`;
      const published = await fetch(`${origin}/api/discussion`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-stadtstack-e2e": "1" },
        body: JSON.stringify({ personaId: "citizen-anna", question: "Welche geprüften Informationen liegen vor?" }),
      }).then((response) => response.json()) as { event: { id: string } };
      const feed = await fetch(`${origin}/api/feed`).then((response) => response.json()) as {
        posts: Array<{ id: string; meckyMentioned: boolean; discussionCount: number; discussionIds: string[] }>;
      };
      assert.equal(feed.posts.length, 1);
      assert.equal(feed.posts[0]?.meckyMentioned, true);
      assert.equal(feed.posts[0]?.discussionCount, 3);
      assert.equal(feed.posts[0]?.discussionIds.includes(published.event.id), true);
    } finally {
      await running.close();
    }
  });

  it("binds suggestion admission to the coordinator version read immediately before the command", async () => {
    const config = parseWorkbenchConfig({ ...environment(), MECKY_PUBKEY: signedMecky.publicKey });
    const actorSecret = Uint8Array.from(Buffer.from(one, "hex"));
    const discussion = buildCivicDiscussionEvent(actorSecret, {
      municipalityId: "roebel-mueritz",
      sourceCaseId: "marienfelder-strasse",
      canonicalCaseId: "urn:stadtstack:case:municipality:roebel-mueritz:018f0000-0000-7000-8000-000000000001",
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
        ["stadtstack-case", "urn:stadtstack:case:municipality:roebel-mueritz:018f0000-0000-7000-8000-000000000001"],
        ["evidence", `sha256:${"b".repeat(64)}`, "https://stadtstack.example/public/case"],
      ],
    });
    const suggestion = buildCitizenSignedSuggestion(actorSecret, {
      binding: {
        municipalityId: "roebel-mueritz",
        sourceCaseId: "marienfelder-strasse",
        canonicalCaseId: "urn:stadtstack:case:municipality:roebel-mueritz:018f0000-0000-7000-8000-000000000001",
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
    const relay = { query: async () => [], publish: async () => ({ ok: true, message: "stored" }), close: () => {} };
    const running = await startWorkbench(config, { citizenRelay: relay, agentRelay: relay, fetch: fetcher });
    try {
      const response = await fetch(`http://127.0.0.1:${running.port}/api/admit`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-stadtstack-e2e": "1" },
        body: JSON.stringify({ discussion, answer, suggestion }),
      });
      assert.equal(response.status, 200);
      assert.deepEqual(calls.map((entry) => entry.path), ["/v1/e2e/view", "/v1/nostr/suggestions/admit"]);
      assert.deepEqual(calls[0]?.body, { profile: "administration" });
      assert.equal(calls[1]?.body.expectedCaseVersion, 17);
    } finally {
      await running.close();
    }
  });
});
