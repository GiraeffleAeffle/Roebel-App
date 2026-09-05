import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { municipalCivicEligibilityReceiptProofPublicKey } from "@netizen-labs/nostr";

import { resolveProductionGatewayConfig } from "../src/config.ts";
import {
  createRestrictedSupabaseDataAdapter,
  createStagingParticipantReadinessAdapter,
  restrictedStagingParticipantRpcNames,
} from "../src/supabase-adapter.ts";
import { IN_CLUSTER_TRACER_POSTGREST_ORIGIN } from "../src/restricted-postgrest-origin.ts";

const CITIZEN_ISSUER_PRIVATE_KEY_HEX = "11".repeat(32);
const CITIZEN_ISSUER_PUBLIC_KEY =
  municipalCivicEligibilityReceiptProofPublicKey(
    Uint8Array.from(Buffer.from(CITIZEN_ISSUER_PRIVATE_KEY_HEX, "hex")),
  );

const env = {
  ROEBEL_STAGING_PARTICIPANT_GATEWAY: "enabled",
  ROEBEL_STAGING_PARTICIPANT_GATEWAY_ORIGIN: "https://roebel-web.staging.agentcart.eu",
  ROEBEL_STAGING_PARTICIPANT_GATEWAY_SESSION_KEY: "k".repeat(32),
  ROEBEL_STAGING_PARTICIPANT_GATEWAY_INVITE_SHA256: createHash("sha256").update("invite").digest("hex"),
  ROEBEL_STAGING_PARTICIPANT_GATEWAY_ALLOWED_WALLETS: "0x1111111111111111111111111111111111111111",
  ROEBEL_STAGING_PARTICIPANT_GATEWAY_GNOSIS_RPC_URL: "https://rpc.gnosischain.com",
  ROEBEL_STAGING_PARTICIPANT_GATEWAY_SUPABASE_URL: "https://example.supabase.co",
  ROEBEL_STAGING_PARTICIPANT_GATEWAY_SUPABASE_ANON_KEY: "public-anon-key-which-is-long-enough",
  ROEBEL_STAGING_PARTICIPANT_GATEWAY_SUPABASE_RPC_SECRET: "r".repeat(32),
  ROEBEL_STAGING_PARTICIPANT_GATEWAY_PORT: "18085",
  ROEBEL_STAGING_PARTICIPANT_GATEWAY_MECKY_PUBKEY: "a".repeat(64),
  ROEBEL_STAGING_PARTICIPANT_GATEWAY_MUNICIPALITY_ID: "roebel-mueritz",
  ROEBEL_STAGING_PARTICIPANT_GATEWAY_SOURCE_CONVERSATION_TOPIC: "roebel-app-conversation",
  ROEBEL_STAGING_PARTICIPANT_GATEWAY_TOPIC_POLICY_VERSION: "staging-participant-topic-v1",
  ROEBEL_STAGING_PARTICIPANT_GATEWAY_PRIVATE_WORKBENCH_URL:
    "http://e2e-workbench.stadtstack-roebel-staging-lab.svc.cluster.local:18083/",
  ROEBEL_STAGING_PARTICIPANT_GATEWAY_PRIVATE_WORKBENCH_ADMISSION_HEADER: "x-stadtstack-e2e:1",
  ROEBEL_STAGING_PARTICIPANT_GATEWAY_SOURCE_REVISION: "a".repeat(40),
  ROEBEL_STAGING_PARTICIPANT_GATEWAY_MANIFEST_DIGEST: `sha256:${"b".repeat(64)}`,
  ROEBEL_STAGING_PARTICIPANT_GATEWAY_MIGRATION_SHA256: `sha256:${"c".repeat(64)}`,
  ROEBEL_STAGING_PARTICIPANT_GATEWAY_DATABASE_SCHEMA_SHA256: `sha256:${"d".repeat(64)}`,
  ROEBEL_STAGING_PARTICIPANT_GATEWAY_TOPIC_TRACER_MIGRATION_SHA256: `sha256:${"e".repeat(64)}`,
  ROEBEL_STAGING_PARTICIPANT_GATEWAY_TOPIC_TRACER_DATABASE_SCHEMA_SHA256: `sha256:${"f".repeat(64)}`,
  ROEBEL_STAGING_PARTICIPANT_GATEWAY_CITIZEN_ADOPTION_POLICY_VERSION:
    "roebel-citizen-nft-v2-staging-2026-09",
  ROEBEL_STAGING_PARTICIPANT_GATEWAY_ELIGIBILITY_ISSUER_KEY_ID:
    "roebel-staging-eligibility-issuer-2026-09",
  ROEBEL_STAGING_PARTICIPANT_GATEWAY_ELIGIBILITY_ISSUER_PUBLIC_KEY:
    CITIZEN_ISSUER_PUBLIC_KEY,
  ROEBEL_STAGING_PARTICIPANT_GATEWAY_ELIGIBILITY_ISSUER_PRIVATE_KEY_HEX:
    CITIZEN_ISSUER_PRIVATE_KEY_HEX,
  ROEBEL_STAGING_PARTICIPANT_GATEWAY_CITIZEN_NFT_ADDRESS:
    "0x59aA26f499D7C2B3EC2c8524Ed06F54fc4E85dE5",
  ROEBEL_STAGING_PARTICIPANT_GATEWAY_CITIZEN_NFT_RUNTIME_CODE_HASH:
    "0x952276d2d6da4bfe3ed3dbc39f6745f2421b01ad476c286cb7a6fa166c7e4218",
  ROEBEL_STAGING_PARTICIPANT_GATEWAY_CITIZEN_ADOPTION_MIGRATION_SHA256:
    `sha256:${"1".repeat(64)}`,
  ROEBEL_STAGING_PARTICIPANT_GATEWAY_CITIZEN_ADOPTION_DATABASE_SCHEMA_SHA256:
    `sha256:${"2".repeat(64)}`,
};

const BAKED_SOURCE_REVISION = "a".repeat(40);
const syntheticEnv = {
  ...env,
  ROEBEL_STAGING_PARTICIPANT_GATEWAY_SYNTHETIC_CITIZEN_ADOPTION: "enabled",
  ROEBEL_STAGING_PARTICIPANT_GATEWAY_SYNTHETIC_CITIZEN_ADOPTION_POLICY_VERSION:
    "roebel-test-citizen-nft-v2-staging-2026-09",
  ROEBEL_STAGING_PARTICIPANT_GATEWAY_TEST_CITIZEN_NFT_ADDRESS:
    "0x4765cB681E8eB080B3191DD550E81eaA41907323",
  ROEBEL_STAGING_PARTICIPANT_GATEWAY_TEST_CITIZEN_NFT_RUNTIME_CODE_KECCAK256:
    "0x0131b35a46839c2c50e013a5702dd1a75ab2c079890711900071d56486d1bce4",
  ROEBEL_STAGING_PARTICIPANT_GATEWAY_SYNTHETIC_CITIZEN_ADOPTION_MIGRATION_SHA256:
    `sha256:${"3".repeat(64)}`,
  ROEBEL_STAGING_PARTICIPANT_GATEWAY_SYNTHETIC_CITIZEN_ADOPTION_DATABASE_SCHEMA_SHA256:
    "sha256:c072fbc87a8fe6d4be9ef83359e919b639a5afddcef2a0dda337defad272462a",
};
const productionConfig = (input: Record<string, string | undefined>) =>
  resolveProductionGatewayConfig(input, BAKED_SOURCE_REVISION);
const dockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
const buildScript = readFileSync(new URL("../scripts/build.mjs", import.meta.url), "utf8");
const buildConfig = await import("../scripts/build-config.mjs");
const packageManifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const turboConfig = JSON.parse(readFileSync(new URL("../../../turbo.json", import.meta.url), "utf8"));

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

const MIRROR_RECEIPT = {
  wallet_address: POST.wallet_address,
  source_post_id: POST.id,
  request_id: "20000000-0000-4000-8000-000000000003",
  event_id: "a".repeat(64),
  event_created_at: 1_787_659_200,
  content_sha256: "b".repeat(64),
  state: "reserved",
};

const PROMOTION_RECEIPT = {
  namespace: "urn:stadtstack:topic:municipality:roebel-mueritz",
  wallet_address: POST.wallet_address,
  source_post_id: POST.id,
  request_id: "20000000-0000-4000-8000-000000000004",
  idempotency_key_sha256: "a".repeat(64),
  discussion_root_id: "b".repeat(64),
  discussion_root_sha256: "c".repeat(64),
  topic_id: "urn:stadtstack:topic:municipality:roebel-mueritz:marienfelder-strasse",
  policy_version: "staging-participant-topic-v1",
  state: "reserved",
  receipt_checksum: "d".repeat(64),
};

const SUGGESTION_RECEIPT = {
  namespace: PROMOTION_RECEIPT.namespace,
  wallet_address: POST.wallet_address,
  discussion_root_id: PROMOTION_RECEIPT.discussion_root_id,
  source_author_pubkey: "e".repeat(64),
  request_id: "20000000-0000-4000-8000-000000000005",
  idempotency_key_sha256: "f".repeat(64),
  suggestion_id: "1".repeat(64),
  suggestion_sha256: "2".repeat(64),
  mecky_answer_id: "3".repeat(64),
  mecky_receipt_id: `urn:stadtstack:mecky-answer:${"4".repeat(64)}`,
  topic_id: PROMOTION_RECEIPT.topic_id,
  policy_version: PROMOTION_RECEIPT.policy_version,
  state: "reserved",
  receipt_checksum: "5".repeat(64),
};

test("production configuration fails closed unless explicit staging mode and every dedicated input is present", () => {
  assert.equal(productionConfig({}), null);
  assert.equal(productionConfig({ ...env, ROEBEL_STAGING_PARTICIPANT_GATEWAY: "true" }), null);
  assert.equal(productionConfig({ ...env, ROEBEL_STAGING_PARTICIPANT_GATEWAY_SESSION_KEY: "short" }), null);
  assert.equal(productionConfig({ ...env, ROEBEL_STAGING_PARTICIPANT_GATEWAY_ALLOWED_WALLETS: "" }), null);
  assert.equal(productionConfig({ ...env, ROEBEL_STAGING_PARTICIPANT_GATEWAY_MUNICIPALITY_ID: undefined }), null);
  assert.equal(productionConfig({ ...env, ROEBEL_STAGING_PARTICIPANT_GATEWAY_SOURCE_CONVERSATION_TOPIC: "not a slug" }), null);
  assert.equal(productionConfig({ ...env, ROEBEL_STAGING_PARTICIPANT_GATEWAY_TOPIC_POLICY_VERSION: "!!" }), null);
  assert.equal(productionConfig({ ...env, ROEBEL_STAGING_PARTICIPANT_GATEWAY_ALLOWED_WALLETS: "0xABC" }), null);
  assert.equal(productionConfig({ ...env, ROEBEL_STAGING_PARTICIPANT_GATEWAY_ORIGIN: "https://app.example/path" }), null);
  assert.equal(productionConfig({ ...env, ROEBEL_STAGING_PARTICIPANT_GATEWAY_ORIGIN: "http://app.example" }), null);
  assert.equal(productionConfig({ ...env, ROEBEL_STAGING_PARTICIPANT_GATEWAY_COOKIE_SECURE: "false" })?.gateway.cookieSecure, true);
  assert.equal(productionConfig(env)?.port, 18085);
  assert.equal(productionConfig({
    ...env,
    ROEBEL_STAGING_PARTICIPANT_GATEWAY_SUPABASE_URL:
      IN_CLUSTER_TRACER_POSTGREST_ORIGIN,
  })?.supabaseUrl, IN_CLUSTER_TRACER_POSTGREST_ORIGIN);
  assert.equal(productionConfig({
    ...env,
    ROEBEL_STAGING_PARTICIPANT_GATEWAY_SUPABASE_URL:
      "http://unreviewed.stadtstack-roebel-staging-lab.svc.cluster.local:3000",
  }), null);
  assert.equal(productionConfig({
    ...env,
    ROEBEL_STAGING_PARTICIPANT_GATEWAY_PRIVATE_WORKBENCH_URL: "https://public.example",
  }), null);
  assert.equal(productionConfig({
    ...env,
    ROEBEL_STAGING_PARTICIPANT_GATEWAY_PRIVATE_WORKBENCH_URL:
      "http://e2e-workbench.other.svc.cluster.local:18083/",
  }), null);
  assert.equal(productionConfig({
    ...env,
    ROEBEL_STAGING_PARTICIPANT_GATEWAY_PRIVATE_WORKBENCH_ADMISSION_HEADER: "authorization:Bearer any",
  }), null);
  assert.equal(productionConfig({
    ...env,
    ROEBEL_STAGING_PARTICIPANT_GATEWAY_ELIGIBILITY_ISSUER_PRIVATE_KEY_HEX:
      undefined,
  }), null);
  assert.equal(productionConfig({
    ...env,
    ROEBEL_STAGING_PARTICIPANT_GATEWAY_ELIGIBILITY_ISSUER_PUBLIC_KEY:
      "0".repeat(64),
  }), null);
  assert.equal(productionConfig({
    ...env,
    ROEBEL_STAGING_PARTICIPANT_GATEWAY_CITIZEN_NFT_ADDRESS: "0x1234",
  }), null);
  assert.equal(productionConfig({
    ...env,
    ROEBEL_STAGING_PARTICIPANT_GATEWAY_CITIZEN_NFT_RUNTIME_CODE_HASH:
      `0x${"0".repeat(64)}`,
  })?.citizenAdoption.citizenNftRuntimeCodeHash, `0x${"0".repeat(64)}`);
  assert.equal(productionConfig({
    ...env,
    ROEBEL_STAGING_PARTICIPANT_GATEWAY_CITIZEN_ADOPTION_MIGRATION_SHA256:
      undefined,
  }), null);
  assert.equal(productionConfig({
    ...env,
    // A Deployment pin cannot substitute the compiled source constant.
    ROEBEL_STAGING_PARTICIPANT_GATEWAY_SOURCE_REVISION: "e".repeat(40),
  }), null);
  assert.equal(resolveProductionGatewayConfig(env, "e".repeat(40)), null);
  assert.equal(productionConfig({
    ...env,
    ROEBEL_STAGING_PARTICIPANT_GATEWAY_SYNTHETIC_CITIZEN_ADOPTION: "enabled",
  }), null);
  assert.equal(productionConfig({
    ...env,
    ROEBEL_STAGING_PARTICIPANT_GATEWAY_TEST_CITIZEN_NFT_ADDRESS:
      syntheticEnv.ROEBEL_STAGING_PARTICIPANT_GATEWAY_TEST_CITIZEN_NFT_ADDRESS,
  }), null);
  assert.equal(productionConfig(Object.fromEntries(
    Object.entries(syntheticEnv).filter(([key]) =>
      key !== "ROEBEL_STAGING_PARTICIPANT_GATEWAY_SYNTHETIC_CITIZEN_ADOPTION"),
  )), null);
  assert.equal(productionConfig({
    ...syntheticEnv,
    ROEBEL_STAGING_PARTICIPANT_GATEWAY_TEST_CITIZEN_NFT_RUNTIME_CODE_KECCAK256:
      undefined,
  }), null);
  const synthetic = productionConfig(syntheticEnv)?.syntheticCitizenAdoption;
  assert.equal(
    synthetic?.policy.testCitizenNftAddress,
    "0x4765cb681e8eb080b3191dd550e81eaa41907323",
  );
  assert.equal(
    synthetic?.policy.testCitizenNftRuntimeCodeKeccak256,
    syntheticEnv.ROEBEL_STAGING_PARTICIPANT_GATEWAY_TEST_CITIZEN_NFT_RUNTIME_CODE_KECCAK256,
  );
  assert.equal(synthetic?.policy.challengeTtlSeconds, 300);
  assert.equal(synthetic?.policy.maxEventClockSkewSeconds, 300);
  assert.equal(synthetic?.policy.testCitizenNftAddress ===
    productionConfig(syntheticEnv)?.citizenAdoption.citizenNftAddress, false);
  const citizenAdoption = productionConfig(env)?.citizenAdoption;
  assert.equal(citizenAdoption?.policy.municipalityId, "roebel-mueritz");
  assert.equal(
    citizenAdoption?.policy.statusBaseUrl,
    `${env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_ORIGIN}/api/civic/v1/eligibility/status`,
  );
  assert.equal(citizenAdoption?.policy.challengeTtlSeconds, 300);
  assert.equal(citizenAdoption?.policy.receiptTtlSeconds, 900);
  assert.equal(citizenAdoption?.policy.maxEventClockSkewSeconds, 300);
  assert.equal(citizenAdoption?.issuer.privateKey.length, 32);
  assert.equal(
    citizenAdoption?.citizenNftAddress,
    env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_CITIZEN_NFT_ADDRESS.toLowerCase(),
  );
  assert.match(dockerfile, /SOURCE_REVISION="\$SOURCE_REVISION" pnpm/u);
  assert.doesNotMatch(dockerfile, /\/app\/source-revision|ROEBEL_STAGING_PARTICIPANT_GATEWAY_BAKED_SOURCE_REVISION/u);
  assert.doesNotMatch(readFileSync(new URL("../src/cli.ts", import.meta.url), "utf8"), /process\.env\.[A-Z_]*SOURCE_REVISION|source-revision/u);
  assert.match(readFileSync(new URL("../scripts/build-config.mjs", import.meta.url), "utf8"), /SOURCE_REVISION/u);
  assert.match(buildScript, /git", \["rev-parse", "HEAD"\]/u);
  assert.match(buildScript, /git", \["status", "--porcelain"\]/u);
  assert.match(buildScript, /JSON\.stringify\(revision\)/u);
  assert.match(
    dockerfile,
    /node packages\/staging-participant-gateway\/dist\/staging-participant-gateway\.cjs[\s\S]*?staging_participant_gateway_not_explicitly_configured/u,
  );
  assert.match(readFileSync(new URL("../src/cli.ts", import.meta.url), "utf8"), /COMPILED_SOURCE_REVISION/u);
  const cliSource = readFileSync(new URL("../src/cli.ts", import.meta.url), "utf8");
  for (const composition of [
    "createCitizenAdoptionService",
    "createRestrictedSupabaseCitizenAdoptionAdapter",
    "createPrivateWorkbenchCitizenSuggestionThreadResolver",
    "createPinnedCitizenNftEligibilityVerifier",
  ]) assert.match(cliSource, new RegExp(composition, "u"));
  assert.match(readFileSync(new URL("../src/build-constants.ts", import.meta.url), "utf8"), /__ROEBEL_STAGING_PARTICIPANT_GATEWAY_SOURCE_REVISION__/u);
  assert.equal(buildConfig.resolveSourceRevision({ SOURCE_REVISION: "b".repeat(40) }, () => "a".repeat(40)), "b".repeat(40));
  assert.equal(buildConfig.resolveSourceRevision({}, () => "a".repeat(40)), "a".repeat(40));
  assert.throws(() => buildConfig.resolveSourceRevision({ SOURCE_REVISION: "" }, () => "a".repeat(40)));
  assert.throws(
    () => buildConfig.resolveSourceRevision({}, () => "a".repeat(40), () => false),
    /dirty_checkout/u,
  );
  assert.equal(
    buildConfig.resolveSourceRevision({ SOURCE_REVISION: "b".repeat(40) }, () => "a".repeat(40), () => false),
    "b".repeat(40),
  );
  assert.equal(packageManifest.scripts.start, "node dist/staging-participant-gateway.cjs");
  assert.equal(packageManifest.bin["roebel-staging-participant-gateway"], "dist/staging-participant-gateway.cjs");
  assert.ok(packageManifest.files.includes("dist"));
  assert.ok(!turboConfig.tasks.build.env.includes("SOURCE_REVISION"));
  assert.deepEqual(
    turboConfig.tasks["@roebel/staging-participant-gateway#build"].env,
    ["SOURCE_REVISION"],
  );
});
test("the exact NetworkPolicy-bound PostgREST origin uses its raw RPC path", async () => {
  const calls: string[] = [];
  const adapter = createRestrictedSupabaseDataAdapter({
    url: IN_CLUSTER_TRACER_POSTGREST_ORIGIN,
    anonKey: env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_SUPABASE_ANON_KEY,
    rpcSecret: env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_SUPABASE_RPC_SECRET,
    fetch: async (url) => {
      calls.push(String(url));
      return new Response(JSON.stringify(POST), { status: 200 });
    },
  });
  await adapter.createMainTextPost({
    walletAddress: POST.wallet_address,
    content: POST.content,
    requestId: "20000000-0000-4000-8000-000000000001",
  });
  assert.deepEqual(calls, [
    `${IN_CLUSTER_TRACER_POSTGREST_ORIGIN}/rpc/${restrictedStagingParticipantRpcNames.createMainTextPost}`,
  ]);
  assert.throws(() => createRestrictedSupabaseDataAdapter({
    url: `${IN_CLUSTER_TRACER_POSTGREST_ORIGIN}/unexpected`,
    anonKey: env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_SUPABASE_ANON_KEY,
    rpcSecret: env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_SUPABASE_RPC_SECRET,
  }));
});

test("PostgREST RPC names fit PostgreSQL identifiers and bind the promotion resolver to its catalog name", () => {
  for (const [operation, rpc] of Object.entries(restrictedStagingParticipantRpcNames)) {
    assert.ok(
      Buffer.byteLength(rpc, "utf8") <= 63,
      `${operation} exceeds PostgreSQL's 63-byte identifier limit`,
    );
  }
  assert.equal(
    restrictedStagingParticipantRpcNames.resolvePublishedSourcePostPromotion,
    "staging_participant_gateway_resolve_published_source_post_promo",
  );
});

test("published promotion resolution uses the catalog-exposed RPC and a closed request", async () => {
  const calls: Array<{ url: string; body: Record<string, string> }> = [];
  const adapter = createRestrictedSupabaseDataAdapter({
    url: "https://example.supabase.co",
    anonKey: env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_SUPABASE_ANON_KEY,
    rpcSecret: env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_SUPABASE_RPC_SECRET,
    fetch: async (url, init) => {
      calls.push({
        url: String(url),
        body: JSON.parse(String(init?.body)) as Record<string, string>,
      });
      return new Response(JSON.stringify({ ...PROMOTION_RECEIPT, state: "published" }), {
        status: 200,
      });
    },
  });

  const resolved = await adapter.resolvePublishedSourcePostPromotion({
    walletAddress: PROMOTION_RECEIPT.wallet_address,
    namespace: PROMOTION_RECEIPT.namespace,
    discussionRootId: PROMOTION_RECEIPT.discussion_root_id,
    sourceAuthorPubkey: SUGGESTION_RECEIPT.source_author_pubkey,
  });

  assert.equal(resolved?.state, "published");
  assert.deepEqual(calls, [{
    url: "https://example.supabase.co/rest/v1/rpc/staging_participant_gateway_resolve_published_source_post_promo",
    body: {
      p_wallet_address: PROMOTION_RECEIPT.wallet_address,
      p_namespace: PROMOTION_RECEIPT.namespace,
      p_discussion_root_id: PROMOTION_RECEIPT.discussion_root_id,
      p_source_author_pubkey: SUGGESTION_RECEIPT.source_author_pubkey,
    },
  }]);
});

test("Supabase adapter rejects a valid-looking row that is not correlated to its request", async () => {
  const adapter = createRestrictedSupabaseDataAdapter({
    url: "https://example.supabase.co",
    anonKey: env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_SUPABASE_ANON_KEY,
    rpcSecret: env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_SUPABASE_RPC_SECRET,
    fetch: async () => new Response(JSON.stringify({ ...POST, content: "Anderer Text" }), { status: 200 }),
  });
  await assert.rejects(
    adapter.createMainTextPost({
      walletAddress: POST.wallet_address,
      content: POST.content,
      requestId: "20000000-0000-4000-8000-000000000003",
    }),
    /response_mismatch/u,
  );
});

test("Supabase adapter invokes only named Vault-checked RPCs and never a service role key", async () => {
  const calls: Array<{ url: string; headers: Headers; body: unknown }> = [];
  const adapter = createRestrictedSupabaseDataAdapter({
    url: "https://example.supabase.co",
    anonKey: env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_SUPABASE_ANON_KEY,
    rpcSecret: env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_SUPABASE_RPC_SECRET,
    fetch: async (url, init) => {
      calls.push({ url: String(url), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
      const target = String(url);
      if (target.includes("reserve_nostr_post_mirror")) {
        return new Response(JSON.stringify(MIRROR_RECEIPT), { status: 200 });
      }
      if (target.includes("complete_nostr_post_mirror")) {
        return new Response(JSON.stringify({ ...MIRROR_RECEIPT, state: "published" }), { status: 200 });
      }
      return new Response(JSON.stringify(target.includes("comment") ? COMMENT : POST), { status: 200 });
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
  await adapter.readOwnedMainTextPost({
    walletAddress: "0x1111111111111111111111111111111111111111",
    postId: "10000000-0000-4000-8000-000000000001",
  });
  await adapter.reserveNostrPostMirror({
    walletAddress: POST.wallet_address, sourcePostId: POST.id,
    requestId: MIRROR_RECEIPT.request_id, eventId: MIRROR_RECEIPT.event_id,
    eventCreatedAt: 1_787_659_200,
    contentSha256: MIRROR_RECEIPT.content_sha256,
  });
  await adapter.completeNostrPostMirror({
    walletAddress: POST.wallet_address, sourcePostId: POST.id,
    requestId: MIRROR_RECEIPT.request_id, eventId: MIRROR_RECEIPT.event_id,
    contentSha256: MIRROR_RECEIPT.content_sha256,
  });
  assert.deepEqual(calls.map((call) => call.url), [
    `https://example.supabase.co/rest/v1/rpc/${restrictedStagingParticipantRpcNames.createMainTextPost}`,
    `https://example.supabase.co/rest/v1/rpc/${restrictedStagingParticipantRpcNames.createMainTextComment}`,
    `https://example.supabase.co/rest/v1/rpc/${restrictedStagingParticipantRpcNames.readOwnedMainTextPost}`,
    `https://example.supabase.co/rest/v1/rpc/${restrictedStagingParticipantRpcNames.reserveNostrPostMirror}`,
    `https://example.supabase.co/rest/v1/rpc/${restrictedStagingParticipantRpcNames.completeNostrPostMirror}`,
  ]);
  assert.equal(calls[0]?.headers.get("apikey"), env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_SUPABASE_ANON_KEY);
  assert.equal(calls[0]?.headers.get("authorization"), `Bearer ${env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_SUPABASE_ANON_KEY}`);
  assert.equal(
    calls[0]?.headers.get("x-staging-participant-rpc-secret"),
    env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_SUPABASE_RPC_SECRET,
  );
  assert.equal((calls[3]?.body as { p_event_created_at?: unknown }).p_event_created_at, "1787659200");
  assert.throws(() => createRestrictedSupabaseDataAdapter({
    url: "https://example.supabase.co",
    anonKey: jwt({ role: "service_role" }),
    rpcSecret: env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_SUPABASE_RPC_SECRET,
  }));
  assert.throws(() => createRestrictedSupabaseDataAdapter({
    url: "https://example.supabase.co",
    anonKey: "sb_secret_this-is-not-a-public-key",
    rpcSecret: env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_SUPABASE_RPC_SECRET,
  }));
});

test("ADR-0022 ledger adapter sends only closed claim bodies and rejects a drifted receipt", async () => {
  const calls: Array<{ url: string; body: Record<string, string> }> = [];
  const adapter = createRestrictedSupabaseDataAdapter({
    url: "https://example.supabase.co",
    anonKey: env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_SUPABASE_ANON_KEY,
    rpcSecret: env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_SUPABASE_RPC_SECRET,
    fetch: async (url, init) => {
      const target = String(url);
      calls.push({ url: target, body: JSON.parse(String(init?.body)) as Record<string, string> });
      const isPromotion = target.includes("source_post_promotion");
      const isComplete = target.includes("complete_");
      const receipt = isPromotion ? PROMOTION_RECEIPT : SUGGESTION_RECEIPT;
      return new Response(JSON.stringify(isComplete ? { ...receipt, state: "published" } : receipt), { status: 200 });
    },
  });
  const promotion = {
    walletAddress: POST.wallet_address, namespace: PROMOTION_RECEIPT.namespace, sourcePostId: POST.id,
    requestId: PROMOTION_RECEIPT.request_id, idempotencyKeySha256: PROMOTION_RECEIPT.idempotency_key_sha256,
    discussionRootId: PROMOTION_RECEIPT.discussion_root_id,
    discussionRootSha256: PROMOTION_RECEIPT.discussion_root_sha256,
    topicId: PROMOTION_RECEIPT.topic_id, policyVersion: PROMOTION_RECEIPT.policy_version,
  };
  const suggestion = {
    walletAddress: POST.wallet_address, namespace: SUGGESTION_RECEIPT.namespace,
    discussionRootId: SUGGESTION_RECEIPT.discussion_root_id,
    sourceAuthorPubkey: SUGGESTION_RECEIPT.source_author_pubkey,
    requestId: SUGGESTION_RECEIPT.request_id, idempotencyKeySha256: SUGGESTION_RECEIPT.idempotency_key_sha256,
    suggestionId: SUGGESTION_RECEIPT.suggestion_id, suggestionSha256: SUGGESTION_RECEIPT.suggestion_sha256,
    meckyAnswerId: SUGGESTION_RECEIPT.mecky_answer_id, meckyReceiptId: SUGGESTION_RECEIPT.mecky_receipt_id,
    topicId: SUGGESTION_RECEIPT.topic_id, policyVersion: SUGGESTION_RECEIPT.policy_version,
  };
  assert.equal((await adapter.reserveSourcePostPromotion(promotion)).state, "reserved");
  assert.equal((await adapter.completeSourcePostPromotion(promotion)).state, "published");
  assert.equal((await adapter.reserveTopicSuggestion(suggestion)).state, "reserved");
  assert.equal((await adapter.completeTopicSuggestion(suggestion)).state, "published");
  assert.deepEqual(calls.map(({ url }) => url), [
    `https://example.supabase.co/rest/v1/rpc/${restrictedStagingParticipantRpcNames.reserveSourcePostPromotion}`,
    `https://example.supabase.co/rest/v1/rpc/${restrictedStagingParticipantRpcNames.completeSourcePostPromotion}`,
    `https://example.supabase.co/rest/v1/rpc/${restrictedStagingParticipantRpcNames.reserveTopicSuggestion}`,
    `https://example.supabase.co/rest/v1/rpc/${restrictedStagingParticipantRpcNames.completeTopicSuggestion}`,
  ]);
  assert.deepEqual(Object.keys(calls[0]!.body).sort(), [
    "p_discussion_root_id", "p_discussion_root_sha256", "p_idempotency_key_sha256", "p_namespace",
    "p_policy_version", "p_request_id", "p_source_post_id", "p_topic_id", "p_wallet_address",
  ]);
  assert.deepEqual(Object.keys(calls[2]!.body).sort(), [
    "p_discussion_root_id", "p_idempotency_key_sha256", "p_mecky_answer_id", "p_mecky_receipt_id",
    "p_namespace", "p_policy_version", "p_request_id", "p_source_author_pubkey", "p_suggestion_id",
    "p_suggestion_sha256", "p_topic_id", "p_wallet_address",
  ]);
  const malformed = createRestrictedSupabaseDataAdapter({
    url: "https://example.supabase.co", anonKey: env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_SUPABASE_ANON_KEY,
    rpcSecret: env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_SUPABASE_RPC_SECRET,
    fetch: async () => new Response(JSON.stringify({ ...PROMOTION_RECEIPT, topic_id: "drifted" }), { status: 200 }),
  });
  await assert.rejects(malformed.reserveSourcePostPromotion(promotion), /promotion_receipt_mismatch/u);
});

test("readiness adapter can call only the four fixed empty preflight RPCs and rejects drifted rows", async () => {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const adapter = createStagingParticipantReadinessAdapter({
    url: "https://example.supabase.co",
    anonKey: env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_SUPABASE_ANON_KEY,
    rpcSecret: env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_SUPABASE_RPC_SECRET,
    fetch: async (url, init) => {
      calls.push({ url: String(url), init });
      const target = String(url);
      const migrationId = target.includes("synthetic_adoption")
        ? "20260905_staging_synthetic_citizen_pass_v2"
        : target.includes("citizen_adoption")
        ? "20260901_staging_citizen_adoption"
        : target.includes("topic_tracer")
          ? "20260825_staging_participant_topic_tracer"
          : "20260825_staging_participant_gateway";
      return new Response(JSON.stringify({
        migration_id: migrationId,
        database_schema_sha256: `sha256:${"d".repeat(64)}`,
      }), { status: 200 });
    },
  });
  assert.deepEqual(await adapter.preflight(), {
    migrationId: "20260825_staging_participant_gateway",
    databaseSchemaSha256: `sha256:${"d".repeat(64)}`,
  });
  assert.equal(calls[0]?.url, `https://example.supabase.co/rest/v1/rpc/${restrictedStagingParticipantRpcNames.preflight}`);
  assert.equal(calls[0]?.init?.method, "POST");
  assert.equal(calls[0]?.init?.body, "{}");
  assert.equal(new Headers(calls[0]?.init?.headers).get("x-staging-participant-rpc-secret"), env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_SUPABASE_RPC_SECRET);
  assert.equal(
    (await adapter.preflightTopicTracer()).migrationId,
    "20260825_staging_participant_topic_tracer",
  );
  assert.equal(
    (await adapter.preflightCitizenAdoption()).migrationId,
    "20260901_staging_citizen_adoption",
  );
  assert.equal(
    (await adapter.preflightSyntheticCitizenAdoption!()).migrationId,
    "20260905_staging_synthetic_citizen_pass_v2",
  );
  assert.deepEqual(calls.map(({ url }) => url), [
    `https://example.supabase.co/rest/v1/rpc/${restrictedStagingParticipantRpcNames.preflight}`,
    `https://example.supabase.co/rest/v1/rpc/${restrictedStagingParticipantRpcNames.topicTracerPreflight}`,
    `https://example.supabase.co/rest/v1/rpc/${restrictedStagingParticipantRpcNames.citizenAdoptionPreflight}`,
    `https://example.supabase.co/rest/v1/rpc/${restrictedStagingParticipantRpcNames.syntheticCitizenAdoptionPreflight}`,
  ]);
  const malformed = createStagingParticipantReadinessAdapter({
    url: "https://example.supabase.co",
    anonKey: env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_SUPABASE_ANON_KEY,
    rpcSecret: env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_SUPABASE_RPC_SECRET,
    fetch: async () => new Response(JSON.stringify({ migration_id: "unexpected" }), { status: 200 }),
  });
  await assert.rejects(malformed.preflight(), /preflight_response_invalid/u);
});
