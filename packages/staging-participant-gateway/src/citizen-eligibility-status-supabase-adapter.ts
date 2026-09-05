import type { MunicipalCivicEligibilityReceiptV1 } from "@netizen-labs/nostr";
import type { CitizenEligibilityStatusReader } from "./citizen-eligibility-status.ts";
import { parseRestrictedPostgrestOrigin } from "./restricted-postgrest-origin.ts";

export type RestrictedSupabaseCitizenStatusConfig = Readonly<{
  url: string;
  /** Public anon/publishable routing key, never a service-role key. */
  anonKey: string;
  /** Private gateway capability, kept off the public status response. */
  rpcSecret: string;
  municipalityId: string;
  policyVersion: string;
  fetch?: typeof fetch;
}>;

function record(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

/** Read-only port; it cannot issue receipts, consume challenges or accept adoptions. */
export function createRestrictedSupabaseCitizenStatusReader(
  config: RestrictedSupabaseCitizenStatusConfig,
): CitizenEligibilityStatusReader {
  const { anonKey, rpcSecret, municipalityId, policyVersion } = config;
  const endpoint = parseRestrictedPostgrestOrigin(config.url);
  const request = config.fetch ?? globalThis.fetch;
  let routingRole: unknown = "anon";
  if (anonKey.split(".").length === 3) {
    try {
      routingRole = JSON.parse(Buffer.from(anonKey.split(".")[1]!, "base64url").toString("utf8"))?.role;
    } catch { routingRole = null; }
  }
  if (!endpoint || anonKey.length < 16 || anonKey.startsWith("sb_secret_") ||
    routingRole !== "anon" || rpcSecret.length < 32 || typeof request !== "function" ||
    !/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u.test(municipalityId) ||
    !/^[a-z0-9][a-z0-9._-]{2,99}$/u.test(policyVersion)
  ) throw new Error("citizen_eligibility_status_reader_config_invalid");
  const prefix = endpoint.directPostgrest ? "/rpc" : "/rest/v1/rpc";
  const url = new URL(`${prefix}/staging_participant_gateway_get_citizen_status_holder`, endpoint.base).href;

  return Object.freeze({
    async resolveForStatus(input) {
      if (!record(input, ["receiptId", "municipalityId", "policyVersion"]) ||
        typeof input.receiptId !== "string" ||
        !/^urn:stadtstack:municipal-civic-eligibility-receipt:[0-9a-f]{64}$/u.test(input.receiptId) ||
        input.municipalityId !== municipalityId || input.policyVersion !== policyVersion
      ) throw new Error("citizen_eligibility_status_reader_request_invalid");
      const receiptId = input.receiptId;
      let value: unknown;
      try {
        const response = await request(url, {
          method: "POST", redirect: "error", cache: "no-store",
          headers: {
            apikey: anonKey, authorization: `Bearer ${anonKey}`,
            "x-staging-participant-rpc-secret": rpcSecret,
            "content-type": "application/json", accept: "application/json",
          },
          body: JSON.stringify({
            p_receipt_id: receiptId, p_municipality_id: municipalityId, p_policy_version: policyVersion,
          }),
          signal: AbortSignal.timeout(8_000),
        });
        if (!response.ok) throw new Error();
        value = await response.json();
      } catch {
        // Never relay a transport error/body containing a private capability or wallet.
        throw new Error("citizen_eligibility_status_reader_unavailable");
      }
      if (value === null) return null;
      if (!record(value, ["receipt", "walletAddress"]) ||
        typeof value.walletAddress !== "string" || !/^0x[0-9a-f]{40}$/u.test(value.walletAddress) ||
        !record(value.receipt, ["schemaVersion", "eligibilityCore", "receiptId", "payloadChecksum", "statusRef", "proof"]) ||
        value.receipt.schemaVersion !== "municipal_civic_eligibility_receipt_v1" ||
        value.receipt.receiptId !== receiptId || value.receipt.payloadChecksum !== receiptId.slice(-64) ||
        !record(value.receipt.eligibilityCore, [
          "municipalityId", "eligibilityClass", "subjectPubkey", "participantSuggestionId", "topicId",
          "policyVersion", "issuer", "issuedAt", "expiresAt", "authorityBinding",
        ]) ||
        value.receipt.eligibilityCore.municipalityId !== municipalityId ||
        value.receipt.eligibilityCore.policyVersion !== policyVersion ||
        !record(value.receipt.proof, ["algorithm", "keyId", "signature"])
      ) throw new Error("citizen_eligibility_status_reader_response_invalid");
      // The issuer resolver still verifies the signature, full policy and fresh eligibility.
      return { receipt: value.receipt as MunicipalCivicEligibilityReceiptV1, walletAddress: value.walletAddress };
    },
  });
}
