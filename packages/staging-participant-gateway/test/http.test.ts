import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import { createStagingParticipantGatewayHandler } from "../src/http.ts";
import {
  CHALLENGE_COOKIE,
  MAX_PENDING_CHALLENGES,
  SESSION_COOKIE,
  prepareChallengeStore,
  type ChallengeStore,
} from "../src/protocol.ts";
import type { StagingParticipantDataAdapter, WalletSignatureVerifier } from "../src/types.ts";

const ORIGIN = "https://roebel-web.staging.agentcart.eu";
const WALLET = "0x1111111111111111111111111111111111111111";
const OTHER_WALLET = "0x2222222222222222222222222222222222222222";
const INVITE = "bounded-test-invite";
const INVITE_SHA256 = createHash("sha256").update(INVITE).digest("hex");
const KEY = "k".repeat(32);
const POST_REQUEST_ID = "20000000-0000-4000-8000-000000000001";
const COMMENT_REQUEST_ID = "20000000-0000-4000-8000-000000000002";

function cookieValue(response: Response, name: string): string {
  const setCookie = response.headers.get("set-cookie") ?? "";
  const matched = setCookie.match(new RegExp(`${name}=([^;]+)`));
  assert.ok(matched, `missing ${name} cookie`);
  return `${name}=${matched[1]}`;
}

function request(path: string, init: RequestInit = {}): Request {
  return new Request(`https://participant-gateway.staging.agentcart.eu${path}`, {
    ...init,
    headers: { origin: ORIGIN, ...(init.headers ?? {}) },
  });
}

function jsonRequest(path: string, body: unknown, cookie?: string): Request {
  return request(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

function fixture(input: Partial<{
  verify: boolean;
  nowMs: number;
}> = {}) {
  let nowMs = input.nowMs ?? Date.parse("2026-08-25T12:00:00.000Z");
  const calls: Array<{ kind: "post" | "comment"; walletAddress: string; content: string; postId?: string }> = [];
  const verifier: WalletSignatureVerifier = {
    async verifyWalletSignature({ address, message, signature }) {
      assert.equal(address, WALLET);
      assert.match(message, /Staging-Testteilnahme/);
      return signature === "0xaaaa" && (input.verify ?? true);
    },
  };
  const data: StagingParticipantDataAdapter = {
    async createMainTextPost({ walletAddress, content }) {
      calls.push({ kind: "post", walletAddress, content });
      return {
        id: "10000000-0000-4000-8000-000000000001", wallet_address: walletAddress,
        account_id: null, content, media_urls: [], video_url: null, category: "generell",
        status: "published", likes_count: 0, comments_count: 0,
        created_at: "2026-08-25T12:00:00.000Z", updated_at: "2026-08-25T12:00:00.000Z",
        post_type: "user", feed_type: "main", linked_event_id: null, linked_experience_id: null,
      };
    },
    async createMainTextComment({ walletAddress, postId, content }) {
      calls.push({ kind: "comment", walletAddress, postId, content });
      return {
        id: "10000000-0000-4000-8000-000000000002", post_id: postId, wallet_address: walletAddress,
        account_id: null, content, media_urls: [], video_url: null, status: "published",
        created_at: "2026-08-25T12:00:00.000Z", author_username: null, author_profile_picture_url: null,
      };
    },
  };
  let count = 0;
  const handler = createStagingParticipantGatewayHandler({
    config: {
      origin: ORIGIN,
      sessionHmacKey: KEY,
      inviteSha256: INVITE_SHA256,
      allowedWallets: [WALLET],
      cookieSecure: true,
    },
    verifier,
    data,
    now: () => new Date(nowMs),
    randomId: () => (++count).toString(16).padStart(32, "0"),
  });
  return { handler, calls, setNow: (value: number) => { nowMs = value; } };
}

async function enrolledSession() {
  const setup = fixture();
  const challenge = await setup.handler(jsonRequest("/api/staging-participant/v1/challenge", {
    schemaVersion: "staging_participant_challenge_request_v1",
    walletAddress: WALLET,
    inviteToken: INVITE,
  }));
  assert.equal(challenge.status, 200);
  const challengeCookie = cookieValue(challenge, CHALLENGE_COOKIE);
  const session = await setup.handler(jsonRequest("/api/staging-participant/v1/session", {
    schemaVersion: "staging_participant_session_request_v1",
    signature: "0xaaaa",
  }, challengeCookie));
  assert.equal(session.status, 200);
  return { ...setup, sessionCookie: cookieValue(session, SESSION_COOKIE) };
}

test("requires an exact origin, invite hash and schema before issuing a wallet-bound challenge", async () => {
  const { handler } = fixture();
  assert.equal((await handler(new Request("https://gateway/api/staging-participant/v1/status"))).status, 200);
  assert.equal((await handler(new Request("https://gateway/api/staging-participant/v1/status", {
    headers: { origin: "https://attacker.invalid" },
  }))).status, 403);
  assert.equal((await handler(new Request("https://gateway/api/staging-participant/v1/challenge", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      schemaVersion: "staging_participant_challenge_request_v1",
      walletAddress: WALLET,
      inviteToken: INVITE,
    }),
  }))).status, 403);
  assert.equal((await handler(jsonRequest("/api/staging-participant/v1/challenge", {
    schemaVersion: "staging_participant_challenge_request_v1",
    walletAddress: WALLET,
    inviteToken: "wrong",
  }))).status, 401);
  assert.equal((await handler(jsonRequest("/api/staging-participant/v1/challenge", {
    schemaVersion: "staging_participant_challenge_request_v1",
    walletAddress: OTHER_WALLET,
    inviteToken: INVITE,
  }))).status, 401);
  assert.equal((await handler(jsonRequest("/api/staging-participant/v1/challenge", {
    schemaVersion: "staging_participant_challenge_request_v1",
    walletAddress: WALLET,
    inviteToken: INVITE,
    municipal: true,
  }))).status, 401);
});

test("invalidates an unconsumed challenge when the single gateway replica restarts", async () => {
  const beforeRestart = fixture();
  const challenge = await beforeRestart.handler(jsonRequest("/api/staging-participant/v1/challenge", {
    schemaVersion: "staging_participant_challenge_request_v1",
    walletAddress: WALLET,
    inviteToken: INVITE,
  }));
  const challengeCookie = cookieValue(challenge, CHALLENGE_COOKIE);

  const afterRestart = fixture();
  const session = await afterRestart.handler(jsonRequest("/api/staging-participant/v1/session", {
    schemaVersion: "staging_participant_session_request_v1",
    signature: "0xaaaa",
  }, challengeCookie));
  assert.equal(session.status, 401);
});

test("consumes each signed challenge once and binds its session to the exact verified wallet", async () => {
  const { handler } = fixture();
  const challenge = await handler(jsonRequest("/api/staging-participant/v1/challenge", {
    schemaVersion: "staging_participant_challenge_request_v1",
    walletAddress: WALLET,
    inviteToken: INVITE,
  }));
  const challengeCookie = cookieValue(challenge, CHALLENGE_COOKIE);
  const bad = await handler(jsonRequest("/api/staging-participant/v1/session", {
    schemaVersion: "staging_participant_session_request_v1",
    signature: "0xbbbb",
  }, challengeCookie));
  assert.equal(bad.status, 401);
  const replay = await handler(jsonRequest("/api/staging-participant/v1/session", {
    schemaVersion: "staging_participant_session_request_v1",
    signature: "0xaaaa",
  }, challengeCookie));
  assert.equal(replay.status, 401);
});

test("allows only a short-lived session to create personal main-feed text posts and comments", async () => {
  const { handler, calls, sessionCookie } = await enrolledSession();
  const post = await handler(jsonRequest("/api/staging-participant/v1/posts", {
    schemaVersion: "staging_participant_post_request_v1",
    requestId: POST_REQUEST_ID,
    content: "Die Beleuchtung am Weg sollte geprüft werden.",
  }, sessionCookie));
  assert.equal(post.status, 201);
  const comment = await handler(jsonRequest("/api/staging-participant/v1/comments", {
    schemaVersion: "staging_participant_comment_request_v1",
    requestId: COMMENT_REQUEST_ID,
    postId: "10000000-0000-4000-8000-000000000001",
    content: "Ich habe die Stelle ebenfalls beobachtet.",
  }, sessionCookie));
  assert.equal(comment.status, 201);
  assert.deepEqual(calls, [
    { kind: "post", walletAddress: WALLET, content: "Die Beleuchtung am Weg sollte geprüft werden." },
    {
      kind: "comment",
      walletAddress: WALLET,
      postId: "10000000-0000-4000-8000-000000000001",
      content: "Ich habe die Stelle ebenfalls beobachtet.",
    },
  ]);
});

test("fails before the data adapter for missing session, non-text payloads, and civic-authority paths", async () => {
  const { handler, calls, sessionCookie } = await enrolledSession();
  assert.equal((await handler(jsonRequest("/api/staging-participant/v1/posts", {
    schemaVersion: "staging_participant_post_request_v1",
    requestId: POST_REQUEST_ID,
    content: "test",
  }))).status, 401);
  assert.equal((await handler(jsonRequest("/api/staging-participant/v1/posts", {
    schemaVersion: "staging_participant_post_request_v1",
    requestId: POST_REQUEST_ID,
    content: "test",
    poll: {},
  }, sessionCookie))).status, 400);
  assert.equal((await handler(jsonRequest("/api/staging-participant/v1/votes", {
    schemaVersion: "anything",
  }, sessionCookie))).status, 403);
  assert.equal((await handler(jsonRequest("/api/staging-participant/v1/posts", {
    schemaVersion: "staging_participant_post_request_v1",
    requestId: POST_REQUEST_ID,
    content: "x".repeat(251),
  }, sessionCookie))).status, 400);
  assert.equal((await handler(jsonRequest("/api/staging-participant/v1/comments", {
    schemaVersion: "staging_participant_comment_request_v1",
    requestId: COMMENT_REQUEST_ID,
    postId: "10000000-0000-4000-8000-000000000001",
    content: "https://example.invalid",
  }, sessionCookie))).status, 400);
  assert.equal(calls.length, 0);
});

test("expires sessions and exposes only the exact status route", async () => {
  const { handler, setNow, sessionCookie } = await enrolledSession();
  setNow(Date.parse("2026-08-25T14:01:00.000Z"));
  assert.equal((await handler(request("/api/staging-participant/v1/status", { headers: { cookie: sessionCookie } }))).status, 200);
  const expired = await handler(jsonRequest("/api/staging-participant/v1/posts", {
    schemaVersion: "staging_participant_post_request_v1",
    requestId: POST_REQUEST_ID,
    content: "test",
  }, sessionCookie));
  assert.equal(expired.status, 401);
  assert.equal((await handler(request("/api/staging-participant/v1/anything"))).status, 404);
  assert.equal((await handler(request("/api/staging-participant/v1/posts"))).status, 405);
});

test("prunes stale challenges and caps a leaked invite's in-memory footprint", () => {
  const store: ChallengeStore = new Map();
  for (let index = 0; index < MAX_PENDING_CHALLENGES; index += 1) {
    store.set(index.toString(16).padStart(32, "0"), {
      walletAddress: `0x${index.toString(16).padStart(40, "0")}`,
      expiresAt: 2_000,
      consumed: false,
    });
  }
  assert.throws(
    () => prepareChallengeStore(store, 1_000, "0xffffffffffffffffffffffffffffffffffffffff"),
    /capacity_reached/u,
  );
  const first = store.keys().next().value as string;
  store.set(first, { ...store.get(first)!, expiresAt: 999 });
  prepareChallengeStore(store, 1_000, "0xffffffffffffffffffffffffffffffffffffffff");
  assert.equal(store.size, MAX_PENDING_CHALLENGES - 1);
});
