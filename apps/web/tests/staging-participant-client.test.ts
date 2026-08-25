import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, test } from "node:test";
import {
  clearPendingStagingParticipantMeckyMirror,
  createStagingParticipantComment,
  createStagingParticipantPost,
  createStagingParticipantSession,
  getStagingParticipantStatus,
  loadPendingStagingParticipantMeckyMirror,
  mirrorStagingParticipantMeckyPost,
  requestStagingParticipantChallenge,
  savePendingStagingParticipantMeckyMirror,
} from "../src/lib/staging-participant/client.ts";
import { createCitizenSession } from "../src/lib/citizen-session/session.ts";
import { isAppConversationMentionEvent, type NostrEvent } from "@netizen-labs/nostr";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("participant status fails closed and uses only the exact same-origin gateway path", async () => {
  let requested: RequestInfo | URL | undefined;
  globalThis.fetch = async (input) => {
    requested = input;
    return new Response(
      JSON.stringify({ available: true, active: true, walletAddress: "0xabc" }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  const status = await getStagingParticipantStatus();
  assert.equal(requested, "/api/staging-participant/v1/status");
  assert.deepEqual(status, {
    available: true,
    active: true,
    walletAddress: "0xabc",
    expiresAt: null,
  });

  globalThis.fetch = async () => {
    throw new Error("offline");
  };
  assert.deepEqual(await getStagingParticipantStatus(), {
    available: false,
    active: false,
    walletAddress: null,
  });
});

test("participant mutations send closed versioned bodies to the six-route gateway", async () => {
  const calls: Array<{ path: string; init: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ path: String(input), init: init ?? {} });
    return new Response(
      JSON.stringify({
        id: "11111111-1111-4111-8111-111111111111",
        wallet_address: "0x1111111111111111111111111111111111111111",
        content: "Test",
        created_at: "2026-08-25T10:00:00.000Z",
      }),
      { status: 201, headers: { "content-type": "application/json" } },
    );
  };

  await requestStagingParticipantChallenge(
    "0x1111111111111111111111111111111111111111",
    "invite",
  );
  await createStagingParticipantSession("0x1234");
  await createStagingParticipantPost("Test");
  await createStagingParticipantComment(
    "11111111-1111-4111-8111-111111111111",
    "Test",
  );

  assert.deepEqual(
    calls.map((call) => call.path),
    [
      "/api/staging-participant/v1/challenge",
      "/api/staging-participant/v1/session",
      "/api/staging-participant/v1/posts",
      "/api/staging-participant/v1/comments",
    ],
  );
  for (const call of calls) {
    assert.equal(call.init.method, "POST");
    assert.equal(call.init.credentials, "same-origin");
    assert.equal(call.init.cache, "no-store");
  }
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
    schemaVersion: "staging_participant_challenge_request_v1",
    walletAddress: "0x1111111111111111111111111111111111111111",
    inviteToken: "invite",
  });
  assert.deepEqual(JSON.parse(String(calls[1].init.body)), {
    schemaVersion: "staging_participant_session_request_v1",
    signature: "0x1234",
  });
  const postBody = JSON.parse(String(calls[2].init.body)) as Record<string, unknown>;
  assert.equal(postBody.schemaVersion, "staging_participant_post_request_v1");
  assert.equal(postBody.content, "Test");
  assert.match(String(postBody.requestId), /^[0-9a-f-]{36}$/u);
  const commentBody = JSON.parse(String(calls[3].init.body)) as Record<string, unknown>;
  assert.equal(commentBody.schemaVersion, "staging_participant_comment_request_v1");
  assert.equal(commentBody.postId, "11111111-1111-4111-8111-111111111111");
  assert.equal(commentBody.content, "Test");
  assert.match(String(commentBody.requestId), /^[0-9a-f-]{36}$/u);
});

test("participant post retries a lost response with the same idempotency key", async () => {
  const bodies: string[] = [];
  globalThis.fetch = async (_input, init) => {
    bodies.push(String(init?.body));
    if (bodies.length === 1) throw new Error("response lost after commit");
    return new Response(JSON.stringify({ data: { id: "11111111-1111-4111-8111-111111111111" } }), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  };

  const result = await createStagingParticipantPost("Test");
  assert.equal(result.success, true);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0], bodies[1]);
});

test("a successful participant post can produce only one same-thread Mecky mirror body", async () => {
  let call: { path: string; body: Record<string, unknown> } | undefined;
  globalThis.fetch = async (input, init) => {
    call = { path: String(input), body: JSON.parse(String(init?.body)) };
    return new Response(JSON.stringify({ status: "published", eventId: "a".repeat(64) }), {
      status: 201, headers: { "content-type": "application/json" },
    });
  };
  const session = createCitizenSession({
    memberId: null,
    appAccountId: null,
    credential: {
      kind: "thirdweb_smart_account",
      address: "0x1111111111111111111111111111111111111111",
      chainId: 100,
      async signMessage() {
        return `0x${"12".repeat(65)}`;
      },
    },
  });
  const result = await mirrorStagingParticipantMeckyPost({
    sourcePost: { id: "11111111-1111-4111-8111-111111111111", content: "@Mecky, bitte einordnen" },
    session,
    meckyPubkey: "d".repeat(64),
  });
  assert.equal(result.success, true);
  assert.equal(call?.path, "/api/staging-participant/v1/nostr-post");
  assert.deepEqual(Object.keys(call?.body ?? {}).sort(), [
    "admissionProof", "event", "requestId", "schemaVersion", "sourcePostId",
  ]);
  assert.equal(call?.body.schemaVersion, "staging_participant_nostr_post_request_v1");
  assert.deepEqual(
    (call?.body.event as { tags?: unknown } | undefined)?.tags,
    [
      ["p", "d".repeat(64)],
      ["source-app-post", "11111111-1111-4111-8111-111111111111"],
      ["t", "roebel-app-conversation"],
    ],
  );
  assert.equal(
    isAppConversationMentionEvent(call?.body.event as NostrEvent, {
      agentPubkey: "d".repeat(64),
      sourceAppPostId: "11111111-1111-4111-8111-111111111111",
    }),
    true,
  );
  assert.doesNotMatch(JSON.stringify(call?.body), /promotion|argument|case|vote|treasury/u);
  session.dispose();
});

test("a failed participant mirror retains the exact signed body for retry instead of signing a replacement", async () => {
  const bodies: string[] = [];
  globalThis.fetch = async (_input, init) => {
    bodies.push(String(init?.body));
    return new Response(JSON.stringify({ error: "mirror_unavailable" }), {
      status: 503, headers: { "content-type": "application/json" },
    });
  };
  let admissions = 0;
  let signed = 0;
  const session = {
    snapshot: {
      credential: {
        kind: "thirdweb_smart_account",
        address: "0x1111111111111111111111111111111111111111",
        chainId: 100,
      },
    },
    async createAdmissionProof() {
      admissions += 1;
      return { schemaVersion: "roebel_citizen_admission_proof_v1", attempt: admissions };
    },
    async signConversationMention(input: { content: string; createdAt: number; agentPubkey: string; sourceAppPostId: string }) {
      signed += 1;
      return {
        id: "a".repeat(64), pubkey: "b".repeat(64), created_at: input.createdAt, kind: 1,
        tags: [["p", input.agentPubkey], ["source-app-post", input.sourceAppPostId], ["t", "roebel-app-conversation"]],
        content: input.content, sig: "c".repeat(128),
      };
    },
  } as never;
  const sourcePost = { id: "11111111-1111-4111-8111-111111111111", content: "@Mecky, bitte einordnen" };
  const first = await mirrorStagingParticipantMeckyPost({ sourcePost, session, meckyPubkey: "d".repeat(64) });
  assert.equal(first.success, false);
  assert.ok(first.pending);
  assert.equal("admissionProof" in (first.pending ?? {}), false);
  assert.doesNotMatch(JSON.stringify(first.pending), /walletSignature|admissionProof/u);
  const second = await mirrorStagingParticipantMeckyPost({
    sourcePost,
    session,
    retry: first.pending,
    meckyPubkey: "d".repeat(64),
  });
  assert.equal(second.success, false);
  assert.equal(admissions, 2);
  assert.equal(signed, 1);
  assert.equal(bodies.length, 4);
  const firstBody = JSON.parse(bodies[0]) as Record<string, unknown>;
  const firstRetryBody = JSON.parse(bodies[2]) as Record<string, unknown>;
  assert.equal(bodies[0], bodies[1]);
  assert.equal(bodies[2], bodies[3]);
  assert.equal(firstBody.requestId, firstRetryBody.requestId);
  assert.deepEqual(firstBody.event, firstRetryBody.event);
  assert.notDeepEqual(firstBody.admissionProof, firstRetryBody.admissionProof);
});

test("reload persistence keeps only one bounded public event and never an admission proof", () => {
  const values = new Map<string, string>();
  const storage: Storage = {
    get length() { return values.size; },
    clear() { values.clear(); },
    getItem(key) { return values.get(key) ?? null; },
    key(index) { return [...values.keys()][index] ?? null; },
    removeItem(key) { values.delete(key); },
    setItem(key, value) { values.set(key, value); },
  };
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: storage },
  });
  try {
    const walletAddress = "0x1111111111111111111111111111111111111111";
    const pending = {
      schemaVersion: "roebel_staging_participant_mecky_mirror_v1" as const,
      sourcePost: {
        id: "11111111-1111-4111-8111-111111111111",
        content: "@Mecky, bitte einordnen",
      },
      requestId: "22222222-2222-4222-8222-222222222222",
      walletAddress,
      event: {
        id: "a".repeat(64),
        pubkey: "b".repeat(64),
        created_at: Math.floor(Date.now() / 1_000),
        kind: 1,
        tags: [
          ["p", "d".repeat(64)],
          ["source-app-post", "11111111-1111-4111-8111-111111111111"],
          ["t", "roebel-app-conversation"],
        ],
        content: "@Mecky, bitte einordnen",
        sig: "c".repeat(128),
      },
      expiresAt: Date.now() + 14 * 60 * 1_000,
    };

    savePendingStagingParticipantMeckyMirror(pending);
    const serialized = [...values.values()][0] ?? "";
    assert.match(serialized, /roebel_staging_participant_mecky_mirror_v1/u);
    assert.doesNotMatch(serialized, /admissionProof|walletSignature|bindingEvent/u);
    assert.deepEqual(loadPendingStagingParticipantMeckyMirror(walletAddress), pending);

    clearPendingStagingParticipantMeckyMirror(walletAddress);
    assert.equal(loadPendingStagingParticipantMeckyMirror(walletAddress), null);
    assert.equal(values.size, 0);
  } finally {
    if (previousWindow) {
      Object.defineProperty(globalThis, "window", previousWindow);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
});

test("participant UI never sends its writes through the public Web server actions", () => {
  const composer = readFileSync(
    new URL("../src/components/app/PostComposer.tsx", import.meta.url),
    "utf8",
  );
  const comments = readFileSync(
    new URL("../src/components/app/CommentSection.tsx", import.meta.url),
    "utf8",
  );
  const actions = readFileSync(
    new URL("../src/app/actions/posts.ts", import.meta.url),
    "utf8",
  );
  const hook = readFileSync(
    new URL("../src/hooks/useStagingTestParticipant.ts", import.meta.url),
    "utf8",
  );

  assert.match(
    composer,
    /isStagingParticipant\s*\?\s*await stagingParticipant\.createPost/,
  );
  assert.match(
    comments,
    /isStagingParticipant\s*\?\s*await stagingParticipant\.createComment/,
  );
  assert.doesNotMatch(actions, /staging[_-](test[_-])?participant/i);
  assert.match(composer, /stagingParticipantGatewayExpected[\s\S]*kein unsicherer Legacy-Schreibweg/u);
  assert.match(comments, /stagingEnabled[\s\S]*begrenzte Staging-Schreibdienst/u);
  assert.match(hook, /checkedWalletAddress === currentWalletAddress/u);
  assert.match(hook, /Wallet wurde während der Anmeldung gewechselt/u);
  assert.match(composer, /submitLockRef\.current/u);
  assert.match(composer, /mirrorStagingParticipantMeckyPost/u);
  assert.match(composer, /loadPendingStagingParticipantMeckyMirror/u);
  assert.match(composer, /Erneut senden/u);
});
