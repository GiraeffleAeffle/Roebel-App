import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, test } from "node:test";
import {
  createStagingParticipantComment,
  createStagingParticipantPost,
  createStagingParticipantSession,
  getStagingParticipantStatus,
  requestStagingParticipantChallenge,
} from "../src/lib/staging-participant/client.ts";

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

test("participant mutations send closed versioned bodies to the five-route gateway", async () => {
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
});
