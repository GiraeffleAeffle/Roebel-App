import { createHash } from "node:crypto";
import {
  createMunicipalCivicEligibilityReceiptProofVerifier,
  municipalCivicEligibilityReceiptProofPublicKey,
  signMunicipalCivicEligibilityStatusProof,
  type MunicipalCivicEligibilityReceiptV1,
  type MunicipalCivicEligibilityStatusV1,
} from "@netizen-labs/nostr";
import type { PinnedCitizenNftEligibilityVerifier } from "@netizen-labs/relay-sync";
import type { CitizenAdoptionPolicy } from "./citizen-adoption.ts";

const CHECKSUM = /^[0-9a-f]{64}$/u;
const RECEIPT_PREFIX = "urn:stadtstack:municipal-civic-eligibility-receipt:";

/** This private port must join the issued receipt to its original verified holder. */
export type CitizenEligibilityStatusReader = Readonly<{
  resolveForStatus(input: Readonly<{
    receiptId: string;
    municipalityId: string;
    policyVersion: string;
  }>): Promise<Readonly<{
    receipt: MunicipalCivicEligibilityReceiptV1;
    walletAddress: string;
  }> | null>;
}>;

export type CitizenEligibilityStatusResolver = Readonly<{
  resolve(input: Readonly<{
    payloadChecksum: string;
    requestNonce: string;
  }>): Promise<MunicipalCivicEligibilityStatusV1 | null>;
}>;

function record(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).length !== keys.length ||
    keys.some((key) => !descriptors[key] || !("value" in descriptors[key]!))) return null;
  return Object.fromEntries(keys.map((key) => [key, descriptors[key]!.value]));
}

function canonical(value: unknown): string {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function checksum(value: unknown): string {
  return createHash("sha256").update(canonical(value), "utf8").digest("hex");
}

/**
 * Rechecks one existing eligibility receipt. No wallet, issuer, adapter or
 * audience can be selected by the caller. Consuming the one-time admission
 * nonce remains the Case Steward's atomic operation, not an issuer-side cache.
 */
export function createCitizenEligibilityStatusResolver(dependencies: Readonly<{
  policy: Pick<CitizenAdoptionPolicy, "municipalityId" | "policyVersion" | "issuer" | "statusBaseUrl" | "receiptTtlSeconds">;
  issuer: Readonly<{ keyId: string; privateKey: Uint8Array }>;
  receipts: CitizenEligibilityStatusReader;
  eligibilityVerifier: PinnedCitizenNftEligibilityVerifier;
  /** Optional for a pure resolver; production requires the live catalog gate. */
  preflight?: () => Promise<void>;
  now?: () => Date;
  timeoutMs?: number;
}>): CitizenEligibilityStatusResolver {
  const policy = Object.freeze({ ...dependencies.policy });
  const timeoutMs = dependencies.timeoutMs ?? 8_000;
  const now = dependencies.now ?? (() => new Date());
  const statusUrl = new URL(policy.statusBaseUrl);
  if (
    !/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u.test(policy.municipalityId) ||
    !/^[a-z0-9][a-z0-9._-]{2,99}$/u.test(policy.policyVersion) ||
    !policy.issuer || policy.issuer !== policy.issuer.trim() ||
    !Number.isSafeInteger(policy.receiptTtlSeconds) || policy.receiptTtlSeconds < 60 || policy.receiptTtlSeconds > 3_600 ||
    statusUrl.protocol !== "https:" || statusUrl.username || statusUrl.password ||
    statusUrl.search || statusUrl.hash || statusUrl.pathname.endsWith("/") ||
    !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10_000 ||
    !(dependencies.issuer.privateKey instanceof Uint8Array) || dependencies.issuer.privateKey.length !== 32
  ) throw new Error("citizen_eligibility_status_config_invalid");
  const issuer = Object.freeze({
    keyId: dependencies.issuer.keyId,
    privateKey: Uint8Array.from(dependencies.issuer.privateKey),
  });
  const verifyReceipt = createMunicipalCivicEligibilityReceiptProofVerifier({
    keyId: issuer.keyId,
    publicKey: municipalCivicEligibilityReceiptProofPublicKey(issuer.privateKey),
  });
  const timestamp = () => {
    const value = Math.floor(now().getTime() / 1_000);
    if (!Number.isSafeInteger(value) || value < 0) throw new Error("citizen_eligibility_status_time_invalid");
    return value;
  };

  const inspect = async (payloadChecksum: string, checkBudget: () => void) => {
    await dependencies.preflight?.();
    checkBudget();
    const receiptId = `${RECEIPT_PREFIX}${payloadChecksum}`;
    const stored = await dependencies.receipts.resolveForStatus({
      receiptId, municipalityId: policy.municipalityId, policyVersion: policy.policyVersion,
    });
    checkBudget();
    if (stored === null) return null;
    const holder = record(stored, ["receipt", "walletAddress"]);
    const receipt = record(holder?.receipt, [
      "schemaVersion", "eligibilityCore", "receiptId", "payloadChecksum", "statusRef", "proof",
    ]);
    const core = record(receipt?.eligibilityCore, [
      "municipalityId", "eligibilityClass", "subjectPubkey", "participantSuggestionId", "topicId",
      "policyVersion", "issuer", "issuedAt", "expiresAt", "authorityBinding",
    ]);
    const proof = record(receipt?.proof, ["algorithm", "keyId", "signature"]);
    const startedAt = timestamp();
    if (
      !holder || typeof holder.walletAddress !== "string" || !/^0x[0-9a-f]{40}$/u.test(holder.walletAddress) ||
      !receipt || !core || !proof ||
      receipt.schemaVersion !== "municipal_civic_eligibility_receipt_v1" ||
      receipt.receiptId !== receiptId || receipt.payloadChecksum !== payloadChecksum ||
      receipt.statusRef !== `${policy.statusBaseUrl}/${payloadChecksum}` ||
      core.municipalityId !== policy.municipalityId || core.policyVersion !== policy.policyVersion ||
      core.issuer !== policy.issuer || core.eligibilityClass !== "municipal_civic_participation" ||
      core.authorityBinding !== "civic_eligibility_only" ||
      typeof core.subjectPubkey !== "string" || !CHECKSUM.test(core.subjectPubkey) ||
      typeof core.participantSuggestionId !== "string" || !CHECKSUM.test(core.participantSuggestionId) ||
      typeof core.topicId !== "string" || !core.topicId.startsWith(`urn:stadtstack:topic:municipality:${policy.municipalityId}:`) ||
      typeof core.issuedAt !== "number" || !Number.isSafeInteger(core.issuedAt) || core.issuedAt < 0 ||
      typeof core.expiresAt !== "number" || !Number.isSafeInteger(core.expiresAt) || core.expiresAt <= core.issuedAt ||
      core.expiresAt - core.issuedAt !== policy.receiptTtlSeconds ||
      core.issuedAt > startedAt || checksum(core) !== payloadChecksum ||
      !verifyReceipt({
        domain: "municipal-civic-eligibility-receipt/v1",
        schemaVersion: "municipal_civic_eligibility_receipt_v1",
        receiptId, payloadChecksum, statusRef: receipt.statusRef as string,
      }, proof as MunicipalCivicEligibilityReceiptV1["proof"])
    ) throw new Error("citizen_eligibility_status_receipt_invalid");
    if (startedAt >= core.expiresAt) throw new Error("citizen_eligibility_status_receipt_expired");

    // A new finalized-block check on every request. Never reuse issuance evidence.
    const evidence = await dependencies.eligibilityVerifier.verifyActiveCitizen({ address: holder.walletAddress });
    checkBudget();
    const observedAt = timestamp();
    if (observedAt < startedAt) throw new Error("citizen_eligibility_status_time_invalid");
    if (observedAt >= core.expiresAt) throw new Error("citizen_eligibility_status_receipt_expired");
    if (!evidence || typeof evidence.active !== "boolean" || evidence.chainId !== 100 ||
      typeof evidence.contractAddress !== "string" || !/^0x[0-9a-f]{40}$/u.test(evidence.contractAddress) ||
      typeof evidence.finalizedBlockNumber !== "bigint" || evidence.finalizedBlockNumber < 0n ||
      typeof evidence.finalizedBlockHash !== "string" || !/^0x[0-9a-f]{64}$/u.test(evidence.finalizedBlockHash)
    ) throw new Error("citizen_eligibility_status_evidence_invalid");
    return { receiptId, observedAt, state: evidence.active ? "active" as const : "revoked" as const };
  };

  return Object.freeze({
    async resolve(input: Readonly<{ payloadChecksum: string; requestNonce: string }>) {
      const request = record(input, ["payloadChecksum", "requestNonce"]);
      if (!request || typeof request.payloadChecksum !== "string" || !CHECKSUM.test(request.payloadChecksum) ||
        typeof request.requestNonce !== "string" || !CHECKSUM.test(request.requestNonce)
      ) throw new Error("citizen_eligibility_status_request_invalid");
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = performance.now() + timeoutMs;
      let finished = false;
      const checkBudget = () => {
        if (finished || performance.now() >= deadline) throw new Error("citizen_eligibility_status_timeout");
      };
      try {
        const observation = await Promise.race([
          inspect(request.payloadChecksum, checkBudget),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("citizen_eligibility_status_timeout")), timeoutMs);
          }),
        ]);
        checkBudget();
        if (!observation) return null;
        // Sign only after the bounded inspection succeeds; late work cannot sign.
        const statusCore = Object.freeze({
          schemaVersion: "municipal_civic_eligibility_status_v1" as const,
          receiptId: observation.receiptId,
          payloadChecksum: request.payloadChecksum,
          policyVersion: policy.policyVersion,
          state: observation.state,
          effectiveAt: observation.observedAt,
          observedAt: observation.observedAt,
          audience: "stadtstack-case-steward-admission" as const,
          requestNonce: request.requestNonce,
        });
        const statusChecksum = checksum(statusCore);
        return Object.freeze({
          statusCore, statusChecksum,
          proof: signMunicipalCivicEligibilityStatusProof({
            domain: "municipal-civic-eligibility-status/v1",
            schemaVersion: "municipal_civic_eligibility_status_v1",
            statusChecksum,
          }, issuer),
        });
      } finally {
        finished = true;
        if (timer !== undefined) clearTimeout(timer);
      }
    },
  });
}
