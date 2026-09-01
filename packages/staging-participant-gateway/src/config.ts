import type { StagingParticipantGatewayConfig, StagingParticipantReadinessPins } from "./types.ts";
import { PRIVATE_WORKBENCH_URL, type PrivateWorkbenchMirrorConfig } from "./workbench-adapter.ts";
import { parseRestrictedPostgrestOrigin } from "./restricted-postgrest-origin.ts";
import { municipalCivicEligibilityReceiptProofPublicKey } from "@netizen-labs/nostr";
import type { CitizenAdoptionPolicy } from "./citizen-adoption.ts";

const CITIZEN_ELIGIBILITY_ISSUER = "roebel-staging-citizen-verifier";
const CITIZEN_CHALLENGE_TTL_SECONDS = 300;
const CITIZEN_RECEIPT_TTL_SECONDS = 900;
const CITIZEN_EVENT_CLOCK_SKEW_SECONDS = 300;

export type ProductionCitizenAdoptionConfig = Readonly<{
  policy: CitizenAdoptionPolicy;
  issuer: Readonly<{ keyId: string; privateKey: Uint8Array }>;
  citizenNftAddress: string;
  citizenNftRuntimeCodeHash: string;
}>;

export type ProductionGatewayConfig = Readonly<{
  gateway: StagingParticipantGatewayConfig;
  gnosisRpcUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseRpcSecret: string;
  host: string;
  port: number;
  workbench: PrivateWorkbenchMirrorConfig;
  readinessPins: StagingParticipantReadinessPins;
  citizenAdoption: ProductionCitizenAdoptionConfig;
}>;

function nonEmpty(value: string | undefined): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function integerPort(value: string | undefined): number | null {
  const parsed = Number(value ?? "");
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 65_535 ? parsed : null;
}

function walletAllowlist(value: string | undefined): readonly string[] | null {
  const wallets = [...new Set(
    (value ?? "").split(",").map((wallet) => wallet.trim().toLowerCase()).filter(Boolean),
  )];
  return wallets.length >= 1 && wallets.length <= 8 &&
    wallets.every((wallet) => /^0x[0-9a-f]{40}$/u.test(wallet))
    ? wallets
    : null;
}

function meckyPubkey(value: string | undefined): string | null {
  const pubkey = nonEmpty(value)?.toLowerCase() ?? null;
  return pubkey && /^[a-f0-9]{64}$/u.test(pubkey) ? pubkey : null;
}

function slug(value: string | undefined): string | null {
  const parsed = nonEmpty(value)?.toLowerCase() ?? null;
  return parsed && /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u.test(parsed) ? parsed : null;
}

function policyVersion(value: string | undefined): string | null {
  const parsed = nonEmpty(value) ?? null;
  return parsed && /^[a-z0-9][a-z0-9._-]{2,99}$/u.test(parsed) ? parsed : null;
}

function workbenchAdmissionHeader(value: string | undefined): PrivateWorkbenchMirrorConfig["admissionHeader"] | null {
  // Keep the existing workbench gate fixed. An arbitrary header would turn
  // this resolver into a generic internal request capability.
  return value === "x-stadtstack-e2e:1"
    ? { name: "x-stadtstack-e2e", value: "1" }
    : null;
}

function sourceRevision(value: string | undefined): string | null {
  const revision = nonEmpty(value);
  return revision && /^[0-9a-f]{40}$/u.test(revision) ? revision : null;
}

function sha256Digest(value: string | undefined): string | null {
  const digest = nonEmpty(value);
  return digest && /^sha256:[0-9a-f]{64}$/u.test(digest) ? digest : null;
}

function hex32(value: string | undefined): Uint8Array | null {
  const parsed = nonEmpty(value);
  return parsed && /^[0-9a-f]{64}$/u.test(parsed)
    ? Uint8Array.from(Buffer.from(parsed, "hex"))
    : null;
}

function issuerKeyId(value: string | undefined): string | null {
  const parsed = nonEmpty(value);
  return parsed && /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/u.test(parsed)
    ? parsed
    : null;
}

function publicKey(value: string | undefined): string | null {
  const parsed = nonEmpty(value)?.toLowerCase() ?? null;
  return parsed && /^[0-9a-f]{64}$/u.test(parsed) ? parsed : null;
}

function contractAddress(value: string | undefined): string | null {
  const parsed = nonEmpty(value)?.toLowerCase() ?? null;
  return parsed && /^0x[0-9a-f]{40}$/u.test(parsed) ? parsed : null;
}

function runtimeCodeHash(value: string | undefined): string | null {
  const parsed = nonEmpty(value)?.toLowerCase() ?? null;
  return parsed && /^0x[0-9a-f]{64}$/u.test(parsed) ? parsed : null;
}

/** Fail closed unless the dedicated staging gateway is explicitly enabled. */
export function resolveProductionGatewayConfig(
  env: Record<string, string | undefined> = process.env,
  bakedSourceRevision: string | undefined,
): ProductionGatewayConfig | null {
  if (env.ROEBEL_STAGING_PARTICIPANT_GATEWAY !== "enabled") return null;
  const origin = nonEmpty(env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_ORIGIN);
  const sessionHmacKey = nonEmpty(env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_SESSION_KEY);
  const inviteSha256 = nonEmpty(env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_INVITE_SHA256);
  const allowedWallets = walletAllowlist(
    env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_ALLOWED_WALLETS,
  );
  const gnosisRpcUrl = nonEmpty(env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_GNOSIS_RPC_URL);
  const supabaseUrl = nonEmpty(env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_SUPABASE_URL);
  const supabaseAnonKey = nonEmpty(env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_SUPABASE_ANON_KEY);
  const supabaseRpcSecret = nonEmpty(env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_SUPABASE_RPC_SECRET);
  const host = nonEmpty(env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_HOST) ?? "127.0.0.1";
  const port = integerPort(env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_PORT);
  const configuredMeckyPubkey = meckyPubkey(env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_MECKY_PUBKEY);
  const municipalityId = slug(env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_MUNICIPALITY_ID);
  const sourceConversationTopic = slug(env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_SOURCE_CONVERSATION_TOPIC);
  const configuredPolicyVersion = policyVersion(env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_TOPIC_POLICY_VERSION);
  const workbenchUrl = nonEmpty(env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_PRIVATE_WORKBENCH_URL);
  const admissionHeader = workbenchAdmissionHeader(
    env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_PRIVATE_WORKBENCH_ADMISSION_HEADER,
  );
  // Read by the CLI from an image-owned, read-only file. It is deliberately
  // not an environment variable, which a Deployment could override.
  const immutableSourceRevision = sourceRevision(bakedSourceRevision);
  const deployedSourceRevision = sourceRevision(env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_SOURCE_REVISION);
  const manifestDigest = sha256Digest(env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_MANIFEST_DIGEST);
  const migrationSha256 = sha256Digest(env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_MIGRATION_SHA256);
  const databaseSchemaSha256 = sha256Digest(env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_DATABASE_SCHEMA_SHA256);
  const topicTracerMigrationSha256 = sha256Digest(env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_TOPIC_TRACER_MIGRATION_SHA256);
  const topicTracerDatabaseSchemaSha256 = sha256Digest(env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_TOPIC_TRACER_DATABASE_SCHEMA_SHA256);
  const citizenAdoptionPolicyVersion = policyVersion(
    env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_CITIZEN_ADOPTION_POLICY_VERSION,
  );
  const eligibilityIssuerKeyId = issuerKeyId(
    env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_ELIGIBILITY_ISSUER_KEY_ID,
  );
  const eligibilityIssuerPublicKey = publicKey(
    env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_ELIGIBILITY_ISSUER_PUBLIC_KEY,
  );
  const eligibilityIssuerPrivateKey = hex32(
    env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_ELIGIBILITY_ISSUER_PRIVATE_KEY_HEX,
  );
  const citizenNftAddress = contractAddress(
    env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_CITIZEN_NFT_ADDRESS,
  );
  const citizenNftRuntimeCodeHash = runtimeCodeHash(
    env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_CITIZEN_NFT_RUNTIME_CODE_HASH,
  );
  const citizenAdoptionMigrationSha256 = sha256Digest(
    env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_CITIZEN_ADOPTION_MIGRATION_SHA256,
  );
  const citizenAdoptionDatabaseSchemaSha256 = sha256Digest(
    env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_CITIZEN_ADOPTION_DATABASE_SCHEMA_SHA256,
  );
  if (!origin || !sessionHmacKey || sessionHmacKey.length < 32 || !inviteSha256 ||
    !allowedWallets ||
    !/^[a-f0-9]{64}$/iu.test(inviteSha256) || !gnosisRpcUrl || !supabaseUrl ||
    !supabaseAnonKey || supabaseAnonKey.length < 16 || !supabaseRpcSecret ||
    supabaseRpcSecret.length < 32 || !port || !configuredMeckyPubkey || !municipalityId ||
    !sourceConversationTopic || !configuredPolicyVersion || !workbenchUrl ||
    !admissionHeader || !immutableSourceRevision || !deployedSourceRevision ||
    immutableSourceRevision !== deployedSourceRevision || !manifestDigest || !migrationSha256 ||
    !databaseSchemaSha256 || !topicTracerMigrationSha256 || !topicTracerDatabaseSchemaSha256 ||
    !citizenAdoptionPolicyVersion || !eligibilityIssuerKeyId ||
    !eligibilityIssuerPublicKey || !eligibilityIssuerPrivateKey ||
    !citizenNftAddress || !citizenNftRuntimeCodeHash ||
    !citizenAdoptionMigrationSha256 || !citizenAdoptionDatabaseSchemaSha256 ||
    municipalCivicEligibilityReceiptProofPublicKey(eligibilityIssuerPrivateKey) !==
      eligibilityIssuerPublicKey) return null;
  let originUrl: URL;
  let gnosisUrl: URL;
  let supabaseUrlValue: URL;
  let workbenchUrlValue: URL;
  try {
    originUrl = new URL(origin);
    gnosisUrl = new URL(gnosisRpcUrl);
    supabaseUrlValue = new URL(supabaseUrl);
    workbenchUrlValue = new URL(workbenchUrl);
  } catch {
    return null;
  }
  if (originUrl.origin !== origin || originUrl.protocol !== "https:" ||
    gnosisUrl.protocol !== "https:" || !parseRestrictedPostgrestOrigin(supabaseUrlValue.href) ||
    workbenchUrl !== PRIVATE_WORKBENCH_URL ||
    workbenchUrlValue.href !== PRIVATE_WORKBENCH_URL ||
    workbenchUrlValue.protocol !== "http:" ||
    Boolean(workbenchUrlValue.username) || Boolean(workbenchUrlValue.password) ||
    workbenchUrlValue.pathname !== "/" || Boolean(workbenchUrlValue.search) || Boolean(workbenchUrlValue.hash) ||
    !["127.0.0.1", "0.0.0.0"].includes(host)) return null;
  return {
    gateway: {
      origin,
      sessionHmacKey,
      inviteSha256: inviteSha256.toLowerCase(),
      allowedWallets,
      cookieSecure: true,
      meckyPubkey: configuredMeckyPubkey,
      topicPolicy: {
        municipalityId,
        topicNamespace: `urn:stadtstack:topic:municipality:${municipalityId}`,
        sourceConversationTopic,
        policyVersion: configuredPolicyVersion,
      },
    },
    gnosisRpcUrl,
    supabaseUrl,
    supabaseAnonKey,
    supabaseRpcSecret,
    host,
    port,
    workbench: { url: workbenchUrl, admissionHeader },
    readinessPins: { sourceRevision: immutableSourceRevision, manifestDigest, migrationSha256, databaseSchemaSha256,
      topicTracerMigrationSha256, topicTracerDatabaseSchemaSha256,
      citizenAdoptionMigrationSha256, citizenAdoptionDatabaseSchemaSha256 },
    citizenAdoption: {
      policy: {
        municipalityId,
        policyVersion: citizenAdoptionPolicyVersion,
        issuer: CITIZEN_ELIGIBILITY_ISSUER,
        statusBaseUrl: `${origin}/api/civic/v1/eligibility/status`,
        challengeTtlSeconds: CITIZEN_CHALLENGE_TTL_SECONDS,
        receiptTtlSeconds: CITIZEN_RECEIPT_TTL_SECONDS,
        maxEventClockSkewSeconds: CITIZEN_EVENT_CLOCK_SKEW_SECONDS,
      },
      issuer: {
        keyId: eligibilityIssuerKeyId,
        privateKey: eligibilityIssuerPrivateKey,
      },
      citizenNftAddress,
      citizenNftRuntimeCodeHash,
    },
  };
}
