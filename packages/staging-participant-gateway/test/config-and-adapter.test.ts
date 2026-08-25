import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import { resolveProductionGatewayConfig } from "../src/config.ts";
import {
  createRestrictedSupabaseDataAdapter,
  restrictedStagingParticipantRpcNames,
} from "../src/supabase-adapter.ts";

const env = {
  ROEBEL_STAGING_PARTICIPANT_GATEWAY: "enabled",
  ROEBEL_STAGING_PARTICIPANT_GATEWAY_ORIGIN: "https://roebel-web.staging.agentcart.eu",
  ROEBEL_STAGING_PARTICIPANT_GATEWAY_SESSION_KEY: "k".repeat(32),
  ROEBEL_STAGING_PARTICIPANT_GATEWAY_INVITE_SHA256: createHash("sha256").update("invite").digest("hex"),
  ROEBEL_STAGING_PARTICIPANT_GATEWAY_GNOSIS_RPC_URL: "https://rpc.gnosischain.com",
  ROEBEL_STAGING_PARTICIPANT_GATEWAY_SUPABASE_URL: "https://example.supabase.co",
  ROEBEL_STAGING_PARTICIPANT_GATEWAY_SUPABASE_ANON_KEY: "public-anon-key-which-is-long-enough",
  ROEBEL_STAGING_PARTICIPANT_GATEWAY_SUPABASE_WRITER_TOKEN: jwt({
    role: "staging_participant_writer",
    exp: Math.floor(Date.now() / 1_000) + 600,
  }),
  ROEBEL_STAGING_PARTICIPANT_GATEWAY_PORT: "18085",
};

function jwt(payload: Record<string, unknown>): string {
  return [
    Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url"),
    Buffer.from(JSON.stringify(payload)).toString("base64url"),
    "test-signature-long-enough",
  ].join(".");
}

const POST = {
  id: "10000000-0000-4000-8000-000000000001",
  wallet_address: "0x1111111111111111111111111111111111111111",
  account_id: null,
  content: "Text",
  media_urls: [],
  video_url: null,
  category: "generell",
  status: "published",
  likes_count: 0,
  comments_count: 0,
  created_at: "2026-08-25T12:00:00.000Z",
  updated_at: "2026-08-25T12:00:00.000Z",
  post_type: "user",
  feed_type: "main",
  linked_event_id: null,
  linked_experience_id: null,
};

const COMMENT = {
  id: "10000000-0000-4000-8000-000000000002",
  post_id: POST.id,
  wallet_address: POST.wallet_address,
  account_id: null,
  content: "Kommentar",
  media_urls: [],
  video_url: null,
  status: "published",
  created_at: "2026-08-25T12:00:00.000Z",
  author_username: null,
  author_profile_picture_url: null,
};

test("production configuration fails closed unless explicit staging mode and every dedicated input is present", () => {
  assert.equal(resolveProductionGatewayConfig({}), null);
  assert.equal(resolveProductionGatewayConfig({ ...env, ROEBEL_STAGING_PARTICIPANT_GATEWAY: "true" }), null);
  assert.equal(resolveProductionGatewayConfig({ ...env, ROEBEL_STAGING_PARTICIPANT_GATEWAY_SESSION_KEY: "short" }), null);
  assert.equal(resolveProductionGatewayConfig({ ...env, ROEBEL_STAGING_PARTICIPANT_GATEWAY_ORIGIN: "https://app.example/path" }), null);
  assert.equal(resolveProductionGatewayConfig(env)?.port, 18085);
});

test("Supabase adapter invokes only named restricted RPCs and never a service role key", async () => {
  const calls: Array<{ url: string; headers: Headers; body: unknown }> = [];
  const adapter = createRestrictedSupabaseDataAdapter({
    url: "https://example.supabase.co",
    anonKey: env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_SUPABASE_ANON_KEY,
    writerToken: env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_SUPABASE_WRITER_TOKEN,
    fetch: async (url, init) => {
      calls.push({ url: String(url), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify(String(url).includes("comment") ? COMMENT : POST), { status: 200 });
    },
  });
  await adapter.createMainTextPost({
    walletAddress: "0x1111111111111111111111111111111111111111", content: "Text",
    requestId: "20000000-0000-4000-8000-000000000001",
  });
  await adapter.createMainTextComment({
    walletAddress: "0x1111111111111111111111111111111111111111",
    postId: "10000000-0000-4000-8000-000000000001",
    content: "Kommentar",
    requestId: "20000000-0000-4000-8000-000000000002",
  });
  assert.deepEqual(calls.map((call) => call.url), [
    `https://example.supabase.co/rest/v1/rpc/${restrictedStagingParticipantRpcNames.createMainTextPost}`,
    `https://example.supabase.co/rest/v1/rpc/${restrictedStagingParticipantRpcNames.createMainTextComment}`,
  ]);
  assert.equal(calls[0]?.headers.get("apikey"), env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_SUPABASE_ANON_KEY);
  assert.equal(calls[0]?.headers.get("authorization"), `Bearer ${env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_SUPABASE_WRITER_TOKEN}`);
  assert.throws(() => createRestrictedSupabaseDataAdapter({
    url: "https://example.supabase.co",
    anonKey: env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_SUPABASE_ANON_KEY,
    writerToken: jwt({ role: "service_role", exp: Math.floor(Date.now() / 1_000) + 600 }),
  }));
});
