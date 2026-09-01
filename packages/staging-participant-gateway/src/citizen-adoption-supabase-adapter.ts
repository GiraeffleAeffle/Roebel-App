import type {
  CitizenEligibilityChallengeV1,
  CitizenAdoptionLedger,
  CitizenAdoptionSourceAdapter,
  CitizenEligibilityChallengeStore,
  CitizenEligibilityReceiptStore,
  PublicCitizenAdoptionProjectionV1,
} from "./citizen-adoption.ts";
import {
  verifyParticipantTopicSuggestionForAdoption,
  type MunicipalCivicEligibilityReceiptV1,
} from "@netizen-labs/nostr";
import {
  parseRestrictedPostgrestOrigin,
  type RestrictedPostgrestOrigin,
} from "./restricted-postgrest-origin.ts";

const ISSUE_CHALLENGE_RPC =
  "staging_participant_gateway_issue_citizen_challenge";
const CONSUME_CHALLENGE_RPC =
  "staging_participant_gateway_consume_citizen_challenge";
const STORE_ELIGIBILITY_RECEIPT_RPC =
  "staging_participant_gateway_store_citizen_eligibility_receipt";
const RESOLVE_ELIGIBILITY_RECEIPT_RPC =
  "staging_participant_gateway_get_citizen_eligibility_receipt";
const RESOLVE_SUGGESTION_ROOT_RPC =
  "staging_participant_gateway_get_citizen_suggestion_root";
const ACCEPT_ADOPTION_RPC =
  "staging_participant_gateway_accept_citizen_adoption";
const RESOLVE_REPLAY_RPC =
  "staging_participant_gateway_resolve_citizen_adoption_replay";
const READ_PUBLIC_ADOPTION_RPC =
  "staging_participant_gateway_read_public_citizen_adoption";

export type RestrictedSupabaseCitizenAdoptionConfig = Readonly<{
  url: string;
  /** Browser-public anon/publishable key used only for PostgREST routing. */
  anonKey: string;
  /** Gateway-only capability checked by every adoption RPC against Vault. */
  rpcSecret: string;
  /** Immutable municipal boundary for every durable lookup. */
  municipalityId: string;
  fetch?: typeof fetch;
  /** Exact, cluster-local discussion-thread resolver. */
  resolveSuggestionThread(input: Readonly<{
    discussionRootId: string;
  }>): Promise<unknown>;
}>;

export type RestrictedSupabaseCitizenAdoptionAdapter =
  CitizenEligibilityChallengeStore &
  CitizenEligibilityReceiptStore &
  CitizenAdoptionLedger &
  CitizenAdoptionSourceAdapter;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index]);
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
  config: RestrictedSupabaseCitizenAdoptionConfig,
): RestrictedPostgrestOrigin {
  const endpoint = parseRestrictedPostgrestOrigin(config.url);
  const jwt = decodeJwtPayload(config.anonKey);
  if (
    !endpoint ||
    config.anonKey.length < 16 ||
    config.anonKey.startsWith("sb_secret_") ||
    (jwt !== null && jwt.role !== "anon") ||
    config.rpcSecret.length < 32 ||
    !/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u.test(
      config.municipalityId,
    ) ||
    typeof config.resolveSuggestionThread !== "function"
  ) {
    throw new Error("citizen_adoption_supabase_config_invalid");
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
    adoptionEventId?: string;
  }>,
): PublicCitizenAdoptionProjectionV1 {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "schemaVersion",
      "participantSuggestionId",
      "adoptionEvent",
      "eligibilityReceipt",
      "acceptanceReceipt",
      "entryState",
      "authorityBinding",
      "submittedToCivicWorkflow",
      "administrativeEndorsement",
      "bindingVote",
      "councilDecision",
      "treasuryEffect",
      "paymentEffect",
    ]) ||
    value.schemaVersion !== "public_citizen_adoption_projection_v1" ||
    typeof value.participantSuggestionId !== "string" ||
    !/^[0-9a-f]{64}$/u.test(value.participantSuggestionId) ||
    (expected?.participantSuggestionId !== undefined &&
      value.participantSuggestionId !== expected.participantSuggestionId) ||
    value.entryState !== "case_steward_review_required" ||
    value.authorityBinding !== "civic_eligibility_only" ||
    value.submittedToCivicWorkflow !== false ||
    value.administrativeEndorsement !== false ||
    value.bindingVote !== false ||
    value.councilDecision !== false ||
    value.treasuryEffect !== false ||
    value.paymentEffect !== false ||
    !isRecord(value.adoptionEvent) ||
    typeof value.adoptionEvent.id !== "string" ||
    (expected?.adoptionEventId !== undefined &&
      value.adoptionEvent.id !== expected.adoptionEventId) ||
    !isRecord(value.eligibilityReceipt) ||
    !exactKeys(value.eligibilityReceipt, [
      "schemaVersion",
      "eligibilityCore",
      "receiptId",
      "payloadChecksum",
      "statusRef",
      "proof",
    ]) ||
    !isRecord(value.eligibilityReceipt.eligibilityCore) ||
    !exactKeys(value.eligibilityReceipt.eligibilityCore, [
      "municipalityId",
      "eligibilityClass",
      "subjectPubkey",
      "participantSuggestionId",
      "topicId",
      "policyVersion",
      "issuer",
      "issuedAt",
      "expiresAt",
      "authorityBinding",
    ]) ||
    !isRecord(value.acceptanceReceipt) ||
    !exactKeys(value.acceptanceReceipt, [
      "schemaVersion",
      "adoptionId",
      "adoptionEventId",
      "municipalityId",
      "topicId",
      "participantSuggestionId",
      "adopterPubkey",
      "eligibilityReceiptId",
      "requestChecksum",
      "eventCreatedAt",
      "receivedAt",
      "policyVersion",
      "status",
      "authorityBinding",
      "receiptChecksum",
    ]) ||
    (expected?.adopterPubkey !== undefined &&
      value.acceptanceReceipt.adopterPubkey !== expected.adopterPubkey)
  ) {
    throw new Error("citizen_adoption_projection_response_invalid");
  }
  return value as PublicCitizenAdoptionProjectionV1;
}

export function createRestrictedSupabaseCitizenAdoptionAdapter(
  config: RestrictedSupabaseCitizenAdoptionConfig,
): RestrictedSupabaseCitizenAdoptionAdapter {
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
        /STAGING_PARTICIPANT_CITIZEN_CHALLENGE_(?:MISSING|USED|EXPIRED|MISMATCH)/u.test(
          failure,
        )
      ) {
        throw new Error("citizen_eligibility_challenge_invalid");
      }
      if (
        (rpc === ACCEPT_ADOPTION_RPC || rpc === RESOLVE_REPLAY_RPC) &&
        /STAGING_PARTICIPANT_CITIZEN_ADOPTION_(?:TUPLE|REQUEST|IDEMPOTENCY|EVENT)_CONFLICT/u.test(
          failure,
        )
      ) {
        throw new Error("citizen_adoption_idempotency_conflict");
      }
      throw new Error("citizen_adoption_restricted_rpc_failed");
    }
    return await response.json() as unknown;
  };

  return {
    async issue(challenge) {
      const value = await invoke(ISSUE_CHALLENGE_RPC, {
        p_challenge: challenge,
      });
      if (!isRecord(value) || stableJson(value) !== stableJson(challenge)) {
        throw new Error("citizen_eligibility_challenge_response_invalid");
      }
      return challenge;
    },
    async consume(input) {
      const value = await invoke(CONSUME_CHALLENGE_RPC, {
        p_challenge_id: input.challengeId,
        p_wallet_address: input.walletAddress,
        p_session_binding_sha256: input.sessionBindingSha256,
        p_consumed_at: String(input.consumedAt),
      });
      if (
        !isRecord(value) ||
        value.challengeId !== input.challengeId ||
        value.walletAddress !== input.walletAddress ||
        value.sessionBindingSha256 !== input.sessionBindingSha256
      ) {
        throw new Error("citizen_eligibility_challenge_response_invalid");
      }
      return value as CitizenEligibilityChallengeV1;
    },
    async store(input) {
      const value = await invoke(STORE_ELIGIBILITY_RECEIPT_RPC, {
        p_challenge_id: input.challenge.challengeId,
        p_receipt: input.receipt,
        p_private_eligibility_evidence: {
          ...input.privateEligibilityEvidence,
          finalizedBlockNumber:
            input.privateEligibilityEvidence.finalizedBlockNumber.toString(10),
        },
      });
      if (
        !isRecord(value) ||
        stableJson(value) !== stableJson(input.receipt)
      ) {
        throw new Error("citizen_eligibility_receipt_response_invalid");
      }
      return input.receipt;
    },
    async resolve(input) {
      const value = await invoke(RESOLVE_ELIGIBILITY_RECEIPT_RPC, {
        p_receipt_id: input.receiptId,
      });
      if (value === null) return null;
      if (
        !isRecord(value) ||
        value.receiptId !== input.receiptId ||
        !isRecord(value.eligibilityCore) ||
        value.eligibilityCore.municipalityId !== config.municipalityId ||
        Object.hasOwn(value, "privateEligibilityEvidence") ||
        Object.hasOwn(value, "walletAddress")
      ) {
        throw new Error("citizen_eligibility_receipt_response_invalid");
      }
      return value as MunicipalCivicEligibilityReceiptV1;
    },
    async resolveParticipantSuggestion(input) {
      const mapping = await invoke(RESOLVE_SUGGESTION_ROOT_RPC, {
        p_municipality_id: config.municipalityId,
        p_suggestion_id: input.participantSuggestionId,
      });
      if (mapping === null) return null;
      if (
        !isRecord(mapping) ||
        !exactKeys(mapping, [
          "municipality_id",
          "suggestion_id",
          "discussion_root_id",
          "source_author_pubkey",
        ]) ||
        mapping.municipality_id !== config.municipalityId ||
        mapping.suggestion_id !== input.participantSuggestionId ||
        typeof mapping.discussion_root_id !== "string" ||
        !/^[0-9a-f]{64}$/u.test(mapping.discussion_root_id) ||
        typeof mapping.source_author_pubkey !== "string" ||
        !/^[0-9a-f]{64}$/u.test(mapping.source_author_pubkey)
      ) {
        throw new Error("citizen_adoption_suggestion_mapping_invalid");
      }
      const thread = await config.resolveSuggestionThread({
        discussionRootId: mapping.discussion_root_id,
      });
      if (
        !isRecord(thread) ||
        thread.schemaVersion !== "roebel_staging_argument_thread_v1" ||
        thread.authorityBinding !== "none" ||
        !isRecord(thread.rootEvent) ||
        thread.rootEvent.id !== mapping.discussion_root_id
      ) {
        throw new Error("citizen_adoption_suggestion_source_invalid");
      }
      let suggestion;
      try {
        suggestion = verifyParticipantTopicSuggestionForAdoption(
          thread.suggestion,
        );
      } catch {
        throw new Error("citizen_adoption_suggestion_source_invalid");
      }
      if (
        suggestion.suggestionId !== input.participantSuggestionId ||
        suggestion.signerPubkey !== mapping.source_author_pubkey
      ) {
        throw new Error("citizen_adoption_suggestion_source_invalid");
      }
      return suggestion;
    },
    async resolveReplay(input) {
      const value = await invoke(RESOLVE_REPLAY_RPC, {
        p_municipality_id: config.municipalityId,
        p_request_id: input.requestId,
        p_idempotency_key_sha256: input.idempotencyKeySha256,
        p_request_checksum: input.requestChecksum,
        p_adoption_event_id: input.adoptionEventId,
      });
      if (value === null) return null;
      return publicProjection(value, {
        adoptionEventId: input.adoptionEventId,
      });
    },
    async accept(input) {
      if (
        input.adoption.adoption.municipalityId !== config.municipalityId ||
        input.acceptanceReceipt.municipalityId !== config.municipalityId
      ) {
        throw new Error("citizen_adoption_municipality_mismatch");
      }
      const expected: PublicCitizenAdoptionProjectionV1 = {
        schemaVersion: "public_citizen_adoption_projection_v1",
        participantSuggestionId: input.adoption.participantSuggestionId,
        adoptionEvent: input.adoption.event,
        eligibilityReceipt: input.eligibilityReceipt,
        acceptanceReceipt: input.acceptanceReceipt,
        entryState: "case_steward_review_required",
        authorityBinding: "civic_eligibility_only",
        submittedToCivicWorkflow: false,
        administrativeEndorsement: false,
        bindingVote: false,
        councilDecision: false,
        treasuryEffect: false,
        paymentEffect: false,
      };
      const value = await invoke(ACCEPT_ADOPTION_RPC, {
        p_municipality_id: config.municipalityId,
        p_request_id: input.requestId,
        p_idempotency_key_sha256: input.idempotencyKeySha256,
        p_request_checksum: input.requestChecksum,
        p_received_at: String(input.receivedAt),
        p_max_event_clock_skew_seconds: String(
          input.maxEventClockSkewSeconds,
        ),
        p_adoption: input.adoption,
        p_eligibility_receipt: input.eligibilityReceipt,
        p_acceptance_receipt: input.acceptanceReceipt,
      });
      if (!isRecord(value) || stableJson(value) !== stableJson(expected)) {
        throw new Error("citizen_adoption_projection_response_invalid");
      }
      return expected;
    },
    async readPublic(input) {
      const value = await invoke(READ_PUBLIC_ADOPTION_RPC, {
        p_municipality_id: config.municipalityId,
        p_participant_suggestion_id: input.participantSuggestionId,
        p_adopter_pubkey: input.adopterPubkey,
      });
      if (value === null) return null;
      return publicProjection(value, input);
    },
  };
}

export const restrictedCitizenAdoptionRpcNames = Object.freeze({
  issueChallenge: ISSUE_CHALLENGE_RPC,
  consumeChallenge: CONSUME_CHALLENGE_RPC,
  storeEligibilityReceipt: STORE_ELIGIBILITY_RECEIPT_RPC,
  resolveEligibilityReceipt: RESOLVE_ELIGIBILITY_RECEIPT_RPC,
  resolveSuggestionRoot: RESOLVE_SUGGESTION_ROOT_RPC,
  resolveReplay: RESOLVE_REPLAY_RPC,
  acceptAdoption: ACCEPT_ADOPTION_RPC,
  readPublicAdoption: READ_PUBLIC_ADOPTION_RPC,
});
