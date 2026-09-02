import type {
  PublicSyntheticCitizenAdoptionProjectionV1,
  SyntheticCitizenAdoptionChallengeStore,
  SyntheticCitizenAdoptionLedger,
} from "./synthetic-citizen-adoption.ts";
import {
  parseRestrictedPostgrestOrigin,
  type RestrictedPostgrestOrigin,
} from "./restricted-postgrest-origin.ts";

const ISSUE_CHALLENGE_RPC =
  "staging_participant_gateway_issue_synthetic_challenge";
const CONSUME_CHALLENGE_RPC =
  "staging_participant_gateway_consume_synthetic_challenge";
const RESOLVE_REPLAY_RPC =
  "staging_participant_gateway_resolve_synthetic_adoption_replay";
const ACCEPT_TRACER_RPC =
  "staging_participant_gateway_accept_synthetic_adoption";
const READ_PUBLIC_TRACER_RPC =
  "staging_participant_gateway_read_public_synthetic_adoption";

export type RestrictedSupabaseSyntheticCitizenAdoptionConfig = Readonly<{
  url: string;
  anonKey: string;
  rpcSecret: string;
  municipalityId: string;
  fetch?: typeof fetch;
}>;

export type RestrictedSupabaseSyntheticCitizenAdoptionAdapter =
  SyntheticCitizenAdoptionChallengeStore & SyntheticCitizenAdoptionLedger;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function decodeJwtPayload(value: string): Record<string, unknown> | null {
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1]!, "base64url").toString("utf8"),
    ) as unknown;
    return isRecord(payload) ? payload : null;
  } catch {
    return null;
  }
}

function validateConfig(
  config: RestrictedSupabaseSyntheticCitizenAdoptionConfig,
): RestrictedPostgrestOrigin {
  const endpoint = parseRestrictedPostgrestOrigin(config.url);
  const jwt = decodeJwtPayload(config.anonKey);
  if (
    !endpoint || config.anonKey.length < 16 ||
    config.anonKey.startsWith("sb_secret_") ||
    (jwt !== null && jwt.role !== "anon") ||
    config.rpcSecret.length < 32 ||
    !/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u.test(config.municipalityId)
  ) {
    throw new Error("synthetic_citizen_adoption_supabase_config_invalid");
  }
  return endpoint;
}

function rpcUrl(endpoint: RestrictedPostgrestOrigin, rpc: string): URL {
  const prefix = endpoint.directPostgrest ? "/rpc" : "/rest/v1/rpc";
  return new URL(`${prefix}/${rpc}`, endpoint.base);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(
      (key) => `${JSON.stringify(key)}:${stableJson(record[key])}`,
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function publicProjection(
  value: unknown,
  expected?: Readonly<{
    participantSuggestionId?: string;
    adopterPubkey?: string;
    proofEventId?: string;
  }>,
): PublicSyntheticCitizenAdoptionProjectionV1 {
  if (
    !isRecord(value) ||
    value.schemaVersion !== "public_synthetic_citizen_adoption_projection_v1" ||
    typeof value.participantSuggestionId !== "string" ||
    !/^[0-9a-f]{64}$/u.test(value.participantSuggestionId) ||
    (expected?.participantSuggestionId !== undefined &&
      value.participantSuggestionId !== expected.participantSuggestionId) ||
    value.environment !== "staging" || value.testOnly !== true ||
    value.authorityBinding !== "none" ||
    value.submittedToCivicWorkflow !== false ||
    value.civicCaseCreated !== false ||
    value.administrativeEndorsement !== false || value.bindingVote !== false ||
    value.councilDecision !== false || value.treasuryEffect !== false ||
    value.paymentEffect !== false ||
    !isRecord(value.proofEvent) ||
    (expected?.proofEventId !== undefined && value.proofEvent.id !== expected.proofEventId) ||
    !isRecord(value.tracer) ||
    value.tracer.schemaVersion !== "synthetic_citizen_adoption_tracer_v1" ||
    (expected?.adopterPubkey !== undefined &&
      value.tracer.adopterPubkey !== expected.adopterPubkey) ||
    !isRecord(value.acceptanceReceipt) ||
    value.acceptanceReceipt.schemaVersion !==
      "synthetic_citizen_adoption_tracer_acceptance_v1" ||
    !isRecord(value.labels) ||
    value.labels.citizenship !==
      "Test-Bürger-Pass – keine reale Bürgerberechtigung"
  ) {
    throw new Error("synthetic_citizen_adoption_projection_response_invalid");
  }
  return value as PublicSyntheticCitizenAdoptionProjectionV1;
}

export function createRestrictedSupabaseSyntheticCitizenAdoptionAdapter(
  config: RestrictedSupabaseSyntheticCitizenAdoptionConfig,
): RestrictedSupabaseSyntheticCitizenAdoptionAdapter {
  const endpoint = validateConfig(config);
  const request = config.fetch ?? globalThis.fetch;
  if (typeof request !== "function") {
    throw new Error("staging_participant_fetch_unavailable");
  }
  const invoke = async (rpc: string, body: Record<string, unknown>) => {
    const response = await request(rpcUrl(endpoint, rpc), {
      method: "POST",
      headers: {
        apikey: config.anonKey,
        authorization: `Bearer ${config.anonKey}`,
        "x-staging-participant-rpc-secret": config.rpcSecret,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      const failure = await response.text();
      if (
        rpc === CONSUME_CHALLENGE_RPC &&
        /STAGING_PARTICIPANT_SYNTHETIC_CHALLENGE_(?:MISSING|USED|EXPIRED|MISMATCH)/u.test(failure)
      ) {
        throw new Error("synthetic_citizen_adoption_challenge_invalid");
      }
      if (
        (rpc === ACCEPT_TRACER_RPC || rpc === RESOLVE_REPLAY_RPC) &&
        /STAGING_PARTICIPANT_SYNTHETIC_ADOPTION_(?:TUPLE|REQUEST|IDEMPOTENCY|EVENT)_CONFLICT/u.test(failure)
      ) {
        throw new Error("synthetic_citizen_adoption_idempotency_conflict");
      }
      throw new Error("synthetic_citizen_adoption_restricted_rpc_failed");
    }
    return await response.json() as unknown;
  };

  return Object.freeze({
    async issue(input) {
      const value = await invoke(ISSUE_CHALLENGE_RPC, {
        p_challenge: input.challenge,
        p_wallet_address: input.walletAddress,
        p_session_binding_sha256: input.sessionBindingSha256,
      });
      if (!isRecord(value) || stableJson(value) !== stableJson(input.challenge)) {
        throw new Error("synthetic_citizen_adoption_challenge_response_invalid");
      }
      return input.challenge;
    },
    async consume(input) {
      const value = await invoke(CONSUME_CHALLENGE_RPC, {
        p_challenge_id: input.challengeId,
        p_wallet_address: input.walletAddress,
        p_session_binding_sha256: input.sessionBindingSha256,
        p_consumed_at: String(input.consumedAt),
      });
      if (!isRecord(value) || value.challengeId !== input.challengeId) {
        throw new Error("synthetic_citizen_adoption_challenge_response_invalid");
      }
      return value as never;
    },
    async resolveReplay(input) {
      const value = await invoke(RESOLVE_REPLAY_RPC, {
        p_municipality_id: config.municipalityId,
        p_request_id: input.requestId,
        p_idempotency_key_sha256: input.idempotencyKeySha256,
        p_request_checksum: input.requestChecksum,
        p_proof_event_id: input.proofEventId,
      });
      if (value === null) return null;
      return publicProjection(value, { proofEventId: input.proofEventId });
    },
    async accept(input) {
      if (
        input.projection.tracer.municipalityId !== config.municipalityId ||
        input.projection.acceptanceReceipt.municipalityId !== config.municipalityId
      ) {
        throw new Error("synthetic_citizen_adoption_municipality_mismatch");
      }
      const value = await invoke(ACCEPT_TRACER_RPC, {
        p_municipality_id: config.municipalityId,
        p_request_id: input.requestId,
        p_idempotency_key_sha256: input.idempotencyKeySha256,
        p_request_checksum: input.requestChecksum,
        p_received_at: String(input.receivedAt),
        p_max_event_clock_skew_seconds: String(input.maxEventClockSkewSeconds),
        p_proof_event: input.proofEvent,
        p_private_eligibility_evidence: {
          ...input.privateEligibilityEvidence,
          finalizedBlockNumber:
            input.privateEligibilityEvidence.finalizedBlockNumber.toString(10),
        },
        p_public_projection: input.projection,
      });
      if (!isRecord(value) || stableJson(value) !== stableJson(input.projection)) {
        throw new Error("synthetic_citizen_adoption_projection_response_invalid");
      }
      return input.projection;
    },
    async readPublic(input) {
      const value = await invoke(READ_PUBLIC_TRACER_RPC, {
        p_municipality_id: config.municipalityId,
        p_participant_suggestion_id: input.participantSuggestionId,
        p_adopter_pubkey: input.adopterPubkey,
      });
      if (value === null) return null;
      return publicProjection(value, input);
    },
  });
}

export const restrictedSyntheticCitizenAdoptionRpcNames = Object.freeze({
  issueChallenge: ISSUE_CHALLENGE_RPC,
  consumeChallenge: CONSUME_CHALLENGE_RPC,
  resolveReplay: RESOLVE_REPLAY_RPC,
  acceptTracer: ACCEPT_TRACER_RPC,
  readPublicTracer: READ_PUBLIC_TRACER_RPC,
});
