import { verifyBindingEvent, type NostrEvent } from "@netizen-labs/nostr";

import type {
  CitizenAdmissionProof,
  CitizenCredentialKind,
  CitizenSession,
} from "./session";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ADDRESS = /^0x[0-9a-f]{40}$/;
const HEX_32 = /^[0-9a-f]{64}$/;
const HEX_64 = /^[0-9a-f]{128}$/;
const SIGNATURE = /^0x(?:[0-9a-f]{2})+$/;
const MAX_CHALLENGE_LIFETIME_MS = 10 * 60 * 1_000;
const MAX_CLOCK_SKEW_MS = 60 * 1_000;

type CredentialDescriptor<K extends CitizenCredentialKind> = Readonly<{
  kind: K;
  address: string;
  chainId: 100;
}>;

export type CredentialLinkChallengeV1 = Readonly<{
  schemaVersion: "roebel_credential_link_challenge_v1";
  audience: "roebel-app:credential-link";
  municipalityId: "roebel-mueritz";
  challengeId: string;
  memberId: string;
  appAccountId: string;
  currentCredential: CredentialDescriptor<"thirdweb_smart_account">;
  nostrPubkey: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
}>;

export type CredentialLinkCandidateV1 = Readonly<{
  schemaVersion: "roebel_credential_link_candidate_v1";
  audience: CredentialLinkChallengeV1["audience"];
  municipalityId: CredentialLinkChallengeV1["municipalityId"];
  challengeId: string;
  memberId: string;
  appAccountId: string;
  currentCredential: CredentialDescriptor<"thirdweb_smart_account">;
  nextCredential: CredentialDescriptor<"passkey_safe">;
  nostrPubkey: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
  authorityBinding: "none";
}>;

export type CredentialLinkProofV1 = Readonly<{
  schemaVersion: "roebel_credential_link_proof_v1";
  candidateSha256: `sha256:${string}`;
  candidate: CredentialLinkCandidateV1;
  statement: string;
  currentCredentialSignature: string;
  nextCredentialSignature: string;
  existingAdmissionProof: CitizenAdmissionProof;
  state: "awaiting_server_verification";
  authorityBinding: "none";
  effects: Readonly<{
    memberIdentityChanged: false;
    appAccountChanged: false;
    nostrIdentityChanged: false;
    addressBoundRightsMoved: false;
    thirdwebCredentialRevoked: false;
  }>;
}>;

const CHALLENGE_KEYS = [
  "schemaVersion",
  "audience",
  "municipalityId",
  "challengeId",
  "memberId",
  "appAccountId",
  "currentCredential",
  "nostrPubkey",
  "nonce",
  "issuedAt",
  "expiresAt",
] as const;

const CANDIDATE_KEYS = [
  "schemaVersion",
  "audience",
  "municipalityId",
  "challengeId",
  "memberId",
  "appAccountId",
  "currentCredential",
  "nextCredential",
  "nostrPubkey",
  "nonce",
  "issuedAt",
  "expiresAt",
  "authorityBinding",
] as const;

const PROOF_KEYS = [
  "schemaVersion",
  "candidateSha256",
  "candidate",
  "statement",
  "currentCredentialSignature",
  "nextCredentialSignature",
  "existingAdmissionProof",
  "state",
  "authorityBinding",
  "effects",
] as const;

const EFFECT_KEYS = [
  "memberIdentityChanged",
  "appAccountChanged",
  "nostrIdentityChanged",
  "addressBoundRightsMoved",
  "thirdwebCredentialRevoked",
] as const;

const ADMISSION_KEYS = [
  "schemaVersion",
  "credential",
  "statement",
  "walletSignature",
  "bindingEvent",
] as const;

const NOSTR_EVENT_KEYS = [
  "id",
  "pubkey",
  "created_at",
  "kind",
  "tags",
  "content",
  "sig",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[]
): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function parseNostrEvent(value: unknown): NostrEvent {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, NOSTR_EVENT_KEYS) ||
    typeof value.id !== "string" ||
    !HEX_32.test(value.id) ||
    typeof value.pubkey !== "string" ||
    !HEX_32.test(value.pubkey) ||
    typeof value.created_at !== "number" ||
    !Number.isSafeInteger(value.created_at) ||
    value.created_at < 0 ||
    typeof value.kind !== "number" ||
    !Number.isSafeInteger(value.kind) ||
    value.kind < 0 ||
    !Array.isArray(value.tags) ||
    value.tags.some(
      (tag) =>
        !Array.isArray(tag) || tag.some((entry) => typeof entry !== "string")
    ) ||
    typeof value.content !== "string" ||
    typeof value.sig !== "string" ||
    !HEX_64.test(value.sig)
  ) {
    throw new Error("credential_link_proof_admission_event_invalid");
  }

  const tags = Object.freeze(
    value.tags.map((tag) => Object.freeze([...(tag as string[])]))
  ) as unknown as NostrEvent["tags"];
  return Object.freeze({
    id: value.id,
    pubkey: value.pubkey,
    created_at: value.created_at,
    kind: value.kind,
    tags,
    content: value.content,
    sig: value.sig,
  });
}

function canonicalIso(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`credential_link_${field}_invalid`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== value) {
    throw new Error(`credential_link_${field}_invalid`);
  }
  return value;
}

function parseCredential<K extends CitizenCredentialKind>(
  value: unknown,
  kind: K,
  field: string
): CredentialDescriptor<K> {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["kind", "address", "chainId"]) ||
    value.kind !== kind ||
    typeof value.address !== "string" ||
    !ADDRESS.test(value.address) ||
    value.chainId !== 100
  ) {
    throw new Error(`credential_link_${field}_invalid`);
  }
  return Object.freeze({
    kind,
    address: value.address,
    chainId: 100 as const,
  });
}

function parseChallengeFields(
  value: Record<string, unknown>,
  now: Date
): Omit<CredentialLinkChallengeV1, "schemaVersion"> {
  if (
    value.audience !== "roebel-app:credential-link" ||
    value.municipalityId !== "roebel-mueritz" ||
    typeof value.challengeId !== "string" ||
    !UUID.test(value.challengeId) ||
    typeof value.memberId !== "string" ||
    !UUID.test(value.memberId) ||
    typeof value.appAccountId !== "string" ||
    !UUID.test(value.appAccountId) ||
    typeof value.nostrPubkey !== "string" ||
    !HEX_32.test(value.nostrPubkey)
  ) {
    throw new Error("credential_link_challenge_identity_invalid");
  }
  if (typeof value.nonce !== "string" || !HEX_32.test(value.nonce)) {
    throw new Error("credential_link_challenge_nonce_invalid");
  }
  const issuedAt = canonicalIso(value.issuedAt, "challenge_issued_at");
  const expiresAt = canonicalIso(value.expiresAt, "challenge_expires_at");
  const issued = new Date(issuedAt).getTime();
  const expires = new Date(expiresAt).getTime();
  const current = now.getTime();
  if (!Number.isFinite(current)) {
    throw new Error("credential_link_now_invalid");
  }
  if (expires <= issued || expires - issued > MAX_CHALLENGE_LIFETIME_MS) {
    throw new Error("credential_link_challenge_lifetime_invalid");
  }
  if (issued - current > MAX_CLOCK_SKEW_MS) {
    throw new Error("credential_link_challenge_not_yet_valid");
  }
  if (current >= expires) {
    throw new Error("credential_link_challenge_expired");
  }
  return {
    audience: value.audience,
    municipalityId: value.municipalityId,
    challengeId: value.challengeId,
    memberId: value.memberId,
    appAccountId: value.appAccountId,
    currentCredential: parseCredential(
      value.currentCredential,
      "thirdweb_smart_account",
      "current_credential"
    ),
    nostrPubkey: value.nostrPubkey,
    nonce: value.nonce,
    issuedAt,
    expiresAt,
  };
}

export function parseCredentialLinkChallenge(
  value: unknown,
  now = new Date()
): CredentialLinkChallengeV1 {
  if (!isRecord(value) || !hasExactKeys(value, CHALLENGE_KEYS)) {
    throw new Error("credential_link_challenge_fields_invalid");
  }
  if (value.schemaVersion !== "roebel_credential_link_challenge_v1") {
    throw new Error("credential_link_challenge_schema_invalid");
  }
  return Object.freeze({
    schemaVersion: value.schemaVersion,
    ...parseChallengeFields(value, now),
  });
}

function parseCandidate(value: unknown, now: Date): CredentialLinkCandidateV1 {
  if (!isRecord(value) || !hasExactKeys(value, CANDIDATE_KEYS)) {
    throw new Error("credential_link_candidate_fields_invalid");
  }
  if (
    value.schemaVersion !== "roebel_credential_link_candidate_v1" ||
    value.authorityBinding !== "none"
  ) {
    throw new Error("credential_link_candidate_schema_invalid");
  }
  const challengeFields = parseChallengeFields(value, now);
  const nextCredential = parseCredential(
    value.nextCredential,
    "passkey_safe",
    "next_credential"
  );
  if (nextCredential.address === challengeFields.currentCredential.address) {
    throw new Error("credential_link_candidate_address_reused");
  }
  return Object.freeze({
    schemaVersion: value.schemaVersion,
    ...challengeFields,
    nextCredential,
    authorityBinding: "none",
  });
}

function canonicalCandidate(candidate: CredentialLinkCandidateV1): string {
  return JSON.stringify({
    schemaVersion: candidate.schemaVersion,
    audience: candidate.audience,
    municipalityId: candidate.municipalityId,
    challengeId: candidate.challengeId,
    memberId: candidate.memberId,
    appAccountId: candidate.appAccountId,
    currentCredential: candidate.currentCredential,
    nextCredential: candidate.nextCredential,
    nostrPubkey: candidate.nostrPubkey,
    nonce: candidate.nonce,
    issuedAt: candidate.issuedAt,
    expiresAt: candidate.expiresAt,
    authorityBinding: candidate.authorityBinding,
  });
}

async function sha256(value: string): Promise<`sha256:${string}`> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  return `sha256:${hex}`;
}

async function candidateDigest(
  candidate: CredentialLinkCandidateV1
): Promise<`sha256:${string}`> {
  return sha256(canonicalCandidate(candidate));
}

function linkStatement(candidateSha256: `sha256:${string}`): string {
  return [
    "Röbel App credential coexistence proof v1",
    "audience=roebel-app:credential-link",
    "municipality=roebel-mueritz",
    `candidate=${candidateSha256}`,
    "authority=none",
  ].join("\n");
}

function assertSessionBinding(
  session: CitizenSession,
  expected: {
    memberId: string;
    appAccountId: string;
    credential: CredentialDescriptor<CitizenCredentialKind>;
  },
  prefix: "current" | "next"
): void {
  if (session.snapshot.memberId !== expected.memberId) {
    throw new Error(`credential_link_${prefix}_member_mismatch`);
  }
  if (session.snapshot.appAccountId !== expected.appAccountId) {
    throw new Error(`credential_link_${prefix}_account_mismatch`);
  }
  if (
    session.snapshot.credential.kind !== expected.credential.kind ||
    session.snapshot.credential.address !== expected.credential.address ||
    session.snapshot.credential.chainId !== expected.credential.chainId
  ) {
    throw new Error(`credential_link_${prefix}_credential_mismatch`);
  }
}

function parseAdmissionProof(
  value: unknown,
  candidate: CredentialLinkCandidateV1
): CitizenAdmissionProof {
  if (!isRecord(value) || !hasExactKeys(value, ADMISSION_KEYS)) {
    throw new Error("credential_link_proof_admission_invalid");
  }
  const credential = parseCredential(
    value.credential,
    "thirdweb_smart_account",
    "admission_credential"
  );
  if (
    value.schemaVersion !== "roebel_citizen_admission_proof_v1" ||
    typeof value.statement !== "string" ||
    typeof value.walletSignature !== "string" ||
    !SIGNATURE.test(value.walletSignature)
  ) {
    throw new Error("credential_link_proof_admission_invalid");
  }
  const bindingEvent = parseNostrEvent(value.bindingEvent);
  const binding = verifyBindingEvent(bindingEvent, credential.address);
  if (
    !binding.valid ||
    binding.pubkey !== candidate.nostrPubkey ||
    value.statement !== bindingEvent.content ||
    credential.address !== candidate.currentCredential.address
  ) {
    throw new Error("credential_link_proof_nostr_continuity_invalid");
  }
  return Object.freeze({
    schemaVersion: "roebel_citizen_admission_proof_v1",
    credential,
    statement: value.statement,
    walletSignature: value.walletSignature,
    bindingEvent,
  });
}

/**
 * Validate the closed, checksum-bound client envelope and its signed Nostr
 * continuity proof.
 *
 * This function deliberately does not establish control of either wallet. A
 * server-side consumer must atomically consume the challenge nonce and verify
 * both wallet signatures against their declared accounts (including ERC-1271
 * and counterfactual/ERC-6492 support where applicable) before persisting a
 * credential link. Until then the only valid state is
 * `awaiting_server_verification` and every civic effect remains false.
 */
export async function validateCredentialLinkProofEnvelope(
  value: unknown,
  now = new Date()
): Promise<CredentialLinkProofV1> {
  if (!isRecord(value) || !hasExactKeys(value, PROOF_KEYS)) {
    throw new Error("credential_link_proof_fields_invalid");
  }
  if (
    value.schemaVersion !== "roebel_credential_link_proof_v1" ||
    value.state !== "awaiting_server_verification" ||
    value.authorityBinding !== "none" ||
    typeof value.candidateSha256 !== "string" ||
    !/^sha256:[0-9a-f]{64}$/.test(value.candidateSha256) ||
    typeof value.statement !== "string" ||
    typeof value.currentCredentialSignature !== "string" ||
    !SIGNATURE.test(value.currentCredentialSignature) ||
    typeof value.nextCredentialSignature !== "string" ||
    !SIGNATURE.test(value.nextCredentialSignature)
  ) {
    throw new Error("credential_link_proof_schema_invalid");
  }
  const effects = value.effects;
  if (
    !isRecord(effects) ||
    !hasExactKeys(effects, EFFECT_KEYS) ||
    EFFECT_KEYS.some((key) => effects[key] !== false)
  ) {
    throw new Error("credential_link_proof_effects_invalid");
  }
  const candidate = parseCandidate(value.candidate, now);
  const digest = await candidateDigest(candidate);
  if (digest !== value.candidateSha256) {
    throw new Error("credential_link_proof_candidate_digest_mismatch");
  }
  if (value.statement !== linkStatement(digest)) {
    throw new Error("credential_link_proof_statement_mismatch");
  }
  const existingAdmissionProof = parseAdmissionProof(
    value.existingAdmissionProof,
    candidate
  );
  return Object.freeze({
    schemaVersion: value.schemaVersion,
    candidateSha256: digest,
    candidate,
    statement: value.statement,
    currentCredentialSignature: value.currentCredentialSignature,
    nextCredentialSignature: value.nextCredentialSignature,
    existingAdmissionProof,
    state: value.state,
    authorityBinding: value.authorityBinding,
    effects: Object.freeze({
      memberIdentityChanged: false,
      appAccountChanged: false,
      nostrIdentityChanged: false,
      addressBoundRightsMoved: false,
      thirdwebCredentialRevoked: false,
    }),
  });
}

export async function createCredentialLinkProof(input: {
  challenge: CredentialLinkChallengeV1;
  currentSession: CitizenSession;
  nextSession: CitizenSession;
  now?: Date;
}): Promise<CredentialLinkProofV1> {
  const now = input.now ?? new Date();
  const challenge = parseCredentialLinkChallenge(input.challenge, now);
  assertSessionBinding(
    input.currentSession,
    {
      memberId: challenge.memberId,
      appAccountId: challenge.appAccountId,
      credential: challenge.currentCredential,
    },
    "current"
  );
  const nextCredential = Object.freeze({
    kind: "passkey_safe" as const,
    address: input.nextSession.snapshot.credential.address,
    chainId: 100 as const,
  });
  assertSessionBinding(
    input.nextSession,
    {
      memberId: challenge.memberId,
      appAccountId: challenge.appAccountId,
      credential: nextCredential,
    },
    "next"
  );
  if (nextCredential.address === challenge.currentCredential.address) {
    throw new Error("credential_link_candidate_address_reused");
  }

  const existingAdmissionProof =
    await input.currentSession.createAdmissionProof();
  if (existingAdmissionProof.bindingEvent.pubkey !== challenge.nostrPubkey) {
    throw new Error("credential_link_current_nostr_mismatch");
  }
  const candidate = Object.freeze({
    schemaVersion: "roebel_credential_link_candidate_v1" as const,
    audience: challenge.audience,
    municipalityId: challenge.municipalityId,
    challengeId: challenge.challengeId,
    memberId: challenge.memberId,
    appAccountId: challenge.appAccountId,
    currentCredential: challenge.currentCredential,
    nextCredential,
    nostrPubkey: challenge.nostrPubkey,
    nonce: challenge.nonce,
    issuedAt: challenge.issuedAt,
    expiresAt: challenge.expiresAt,
    authorityBinding: "none" as const,
  });
  const candidateSha256 = await candidateDigest(candidate);
  const statement = linkStatement(candidateSha256);
  const currentCredentialSignature =
    await input.currentSession.signMessage(statement);
  const nextCredentialSignature =
    await input.nextSession.signMessage(statement);
  return validateCredentialLinkProofEnvelope(
    {
      schemaVersion: "roebel_credential_link_proof_v1",
      candidateSha256,
      candidate,
      statement,
      currentCredentialSignature,
      nextCredentialSignature,
      existingAdmissionProof,
      state: "awaiting_server_verification",
      authorityBinding: "none",
      effects: {
        memberIdentityChanged: false,
        appAccountChanged: false,
        nostrIdentityChanged: false,
        addressBoundRightsMoved: false,
        thirdwebCredentialRevoked: false,
      },
    },
    now
  );
}
