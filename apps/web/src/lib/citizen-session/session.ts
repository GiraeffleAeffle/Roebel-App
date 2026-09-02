import {
  APP_CONVERSATION_TOPIC,
  NOSTR_KEY_DERIVATION_MESSAGE,
  buildBindingEvent,
  buildCivicArgumentEvent,
  buildCitizenSignedTopicSuggestion,
  buildParticipantTopicSuggestion,
  buildCivicPromotionEvent,
  buildCivicTopicPromotionEvent,
  buildCitizenTopicSuggestionAdoption,
  buildNoteEvent,
  deriveNostrIdentity,
  type CivicPromotionInput,
  type CivicArgumentInput,
  type CivicTopicPromotionInput,
  type CitizenSignedTopicSuggestionInput,
  type CitizenSignedTopicSuggestionV1,
  type CitizenTopicSuggestionAdoptionInput,
  type CitizenTopicSuggestionAdoptionV1,
  type ParticipantTopicSuggestionInput,
  type ParticipantTopicSuggestionV1,
  type NostrEvent,
} from "@netizen-labs/nostr";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const SIGNATURE = /^0x[0-9a-fA-F]+$/;

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export type CitizenCredentialKind = "thirdweb_smart_account" | "passkey_safe";

export type CitizenCredential = {
  kind: CitizenCredentialKind;
  address: string;
  chainId: number;
  signMessage(args: { message: string }): Promise<string>;
};

export type CitizenSessionSnapshot = Readonly<{
  schemaVersion: "roebel_citizen_session_v1";
  status: "authenticated";
  memberId: string | null;
  appAccountId: string | null;
  credential: Readonly<{
    kind: CitizenCredentialKind;
    address: string;
    chainId: number;
  }>;
  assurance: Readonly<{
    authentication: "provider_authenticated";
    authorization: "legacy_wallet_projection";
    recovery: "provider_managed" | "passkey_recovery_required";
  }>;
  capabilities: readonly ["message_signing", "nostr_signing"];
}>;

export type PublicPostInput = {
  content: string;
  createdAt?: number;
  mentionPubkeys?: readonly string[];
  sourceAppPostId?: string;
};

export type ConversationMentionInput = {
  content: string;
  createdAt: number;
  agentPubkey: string;
  sourceAppPostId: string;
  sourceAppCommentId?: string;
};

export type CitizenAdmissionProof = Readonly<{
  schemaVersion: "roebel_citizen_admission_proof_v1";
  credential: CitizenSessionSnapshot["credential"];
  statement: string;
  walletSignature: string;
  bindingEvent: NostrEvent;
}>;

export type CitizenEligibilityChallengeSigningInput = Readonly<{
  schemaVersion: "municipal_civic_eligibility_challenge_v1";
  challengeId: string;
  audience: "roebel-staging-citizen-adoption";
  sessionBindingSha256: string;
  walletAddress: string;
  chainId: 100;
  subjectPubkey: string;
  municipalityId: string;
  policyVersion: string;
  participantSuggestionId: string;
  topicId: string;
  issuedAt: number;
  expiresAt: number;
  authorityBinding: "civic_eligibility_only";
  canonicalChallenge: string;
  message: string;
}>;

export type SyntheticCitizenPassChallengeSigningInput = Readonly<{
  schemaVersion: "staging_test_citizen_pass_v1";
  challengeId: string;
  audience: "roebel-staging-synthetic-citizen-adoption";
  chainId: 100;
  testCitizenNftContract: string;
  subjectPubkey: string;
  municipalityId: string;
  policyVersion: string;
  participantSuggestionId: string;
  topicId: string;
  issuedAt: number;
  expiresAt: number;
  environment: "staging";
  testOnly: true;
  authorityBinding: "none";
  canonicalChallenge: string;
  message: string;
}>;

export interface CitizenSession {
  readonly snapshot: CitizenSessionSnapshot;
  /** Return only the public half of the session-derived Nostr identity. */
  getNostrPubkey(): Promise<string>;
  createAdmissionProof(input?: {
    createdAt?: number;
  }): Promise<CitizenAdmissionProof>;
  signMessage(message: string): Promise<string>;
  signPublicPost(input: PublicPostInput): Promise<NostrEvent>;
  signConversationMention(input: ConversationMentionInput): Promise<NostrEvent>;
  promotePublicPost(input: CivicPromotionInput): Promise<NostrEvent>;
  promotePublicPostToTopic(
    input: CivicTopicPromotionInput
  ): Promise<NostrEvent>;
  signCivicArgument(input: CivicArgumentInput): Promise<NostrEvent>;
  signTopicSuggestion(
    input: CitizenSignedTopicSuggestionInput
  ): Promise<CitizenSignedTopicSuggestionV1>;
  /** ADR-0022 staging hand-off; this deliberately is not citizen adoption. */
  signParticipantTopicSuggestion(
    input: ParticipantTopicSuggestionInput
  ): Promise<ParticipantTopicSuggestionV1>;
  /**
   * Sign the ADR-0023 adoption only after trusted composition has supplied an
   * exact municipal eligibility receipt and deployment-pinned policy.
   * Signing neither submits the adoption nor creates a CivicCase.
   */
  signCitizenTopicSuggestionAdoption(
    input: CitizenTopicSuggestionAdoptionInput
  ): Promise<CitizenTopicSuggestionAdoptionV1>;
  /** Sign one exact, short-lived server challenge without exposing the key. */
  signCitizenEligibilityChallenge(
    input: CitizenEligibilityChallengeSigningInput
  ): Promise<NostrEvent>;
  /** Sign only the incompatible, no-authority staging test-pass challenge. */
  signSyntheticCitizenPassChallenge(
    input: SyntheticCitizenPassChallengeSigningInput
  ): Promise<NostrEvent>;
  dispose(): void;
}

export type CreateCitizenSessionInput = {
  memberId: string | null;
  appAccountId: string | null;
  credential: CitizenCredential;
};

function optionalIdentifier(
  value: string | null,
  field: string
): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.length < 1 || value.length > 200) {
    throw new Error(`citizen_session_${field}_invalid`);
  }
  return value;
}

function timestamp(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("citizen_session_timestamp_invalid");
  }
  return value;
}

function freezeSnapshot(
  value: Omit<
    CitizenSessionSnapshot,
    "credential" | "assurance" | "capabilities"
  > & {
    credential: CitizenSessionSnapshot["credential"];
    assurance: CitizenSessionSnapshot["assurance"];
  }
): CitizenSessionSnapshot {
  return Object.freeze({
    ...value,
    credential: Object.freeze({ ...value.credential }),
    assurance: Object.freeze({ ...value.assurance }),
    capabilities: Object.freeze([
      "message_signing",
      "nostr_signing",
    ]) as CitizenSessionSnapshot["capabilities"],
  });
}

/**
 * The provider-neutral CitizenSession seam used by civic-flow callers.
 *
 * Provider objects and the derived Nostr secret stay inside this module. A
 * caller can ask for one bounded signature or signed public event, but cannot
 * extract the credential implementation or impersonate the citizen elsewhere.
 */
export function createCitizenSession(
  input: CreateCitizenSessionInput
): CitizenSession {
  if (!ADDRESS.test(input.credential.address)) {
    throw new Error("citizen_session_address_invalid");
  }
  if (
    !Number.isSafeInteger(input.credential.chainId) ||
    input.credential.chainId < 1
  ) {
    throw new Error("citizen_session_chain_invalid");
  }

  const snapshot = freezeSnapshot({
    schemaVersion: "roebel_citizen_session_v1",
    status: "authenticated",
    memberId: optionalIdentifier(input.memberId, "member_id"),
    appAccountId: optionalIdentifier(input.appAccountId, "app_account_id"),
    credential: {
      kind: input.credential.kind,
      address: input.credential.address.toLowerCase(),
      chainId: input.credential.chainId,
    },
    assurance: {
      authentication: "provider_authenticated",
      authorization: "legacy_wallet_projection",
      recovery:
        input.credential.kind === "passkey_safe"
          ? "passkey_recovery_required"
          : "provider_managed",
    },
  });

  let disposed = false;
  let identityPromise:
    | Promise<ReturnType<typeof deriveNostrIdentity>>
    | undefined;

  const ensureActive = () => {
    if (disposed) throw new Error("citizen_session_disposed");
  };

  const signMessage = async (message: string): Promise<string> => {
    ensureActive();
    if (
      typeof message !== "string" ||
      message.length < 1 ||
      message.length > 10_000
    ) {
      throw new Error("citizen_session_message_invalid");
    }
    const signature = await input.credential.signMessage({ message });
    if (!SIGNATURE.test(signature) || (signature.length - 2) % 2 !== 0) {
      throw new Error("citizen_session_signature_invalid");
    }
    return signature.toLowerCase();
  };

  const identity = () => {
    ensureActive();
    identityPromise ??= signMessage(NOSTR_KEY_DERIVATION_MESSAGE).then(
      deriveNostrIdentity
    );
    return identityPromise;
  };

  return Object.freeze({
    snapshot,
    signMessage,
    async getNostrPubkey(): Promise<string> {
      return (await identity()).publicKey;
    },
    async createAdmissionProof(
      input: { createdAt?: number } = {}
    ): Promise<CitizenAdmissionProof> {
      ensureActive();
      const signer = await identity();
      const bindingEvent = buildBindingEvent(
        signer.secretKey,
        snapshot.credential.address,
        input.createdAt === undefined
          ? {}
          : { createdAt: timestamp(input.createdAt) }
      );
      const statement = bindingEvent.content;
      const walletSignature = await signMessage(statement);
      return Object.freeze({
        schemaVersion: "roebel_citizen_admission_proof_v1" as const,
        credential: snapshot.credential,
        statement,
        walletSignature,
        bindingEvent,
      });
    },
    async signPublicPost(input: PublicPostInput): Promise<NostrEvent> {
      ensureActive();
      if (
        typeof input.content !== "string" ||
        input.content !== input.content.trim() ||
        input.content.length < 1 ||
        input.content.length > 2_000
      ) {
        throw new Error("citizen_session_post_invalid");
      }
      const mentions = [...new Set(input.mentionPubkeys ?? [])];
      if (
        mentions.length > 8 ||
        mentions.some((pubkey) => !/^[0-9a-f]{64}$/.test(pubkey))
      ) {
        throw new Error("citizen_session_mentions_invalid");
      }
      if (
        input.sourceAppPostId !== undefined &&
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
          input.sourceAppPostId
        )
      ) {
        throw new Error("citizen_session_source_app_post_invalid");
      }
      const signer = await identity();
      return buildNoteEvent(signer.secretKey, input.content, {
        ...(input.createdAt === undefined
          ? {}
          : { createdAt: timestamp(input.createdAt) }),
        ...(mentions.length === 0 && input.sourceAppPostId === undefined
          ? {}
          : {
              tags: [
                ...mentions.map((pubkey) => ["p", pubkey]),
                ...(input.sourceAppPostId === undefined
                  ? []
                  : [["source-app-post", input.sourceAppPostId]]),
              ],
            }),
      });
    },
    async signConversationMention(
      input: ConversationMentionInput
    ): Promise<NostrEvent> {
      ensureActive();
      const uuid =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
      if (
        typeof input.content !== "string" ||
        input.content !== input.content.trim() ||
        input.content.length < 1 ||
        input.content.length > 2_000 ||
        !/^[0-9a-f]{64}$/.test(input.agentPubkey) ||
        !uuid.test(input.sourceAppPostId) ||
        (input.sourceAppCommentId !== undefined &&
          !uuid.test(input.sourceAppCommentId))
      ) {
        throw new Error("citizen_session_conversation_mention_invalid");
      }
      const signer = await identity();
      return buildNoteEvent(signer.secretKey, input.content, {
        createdAt: timestamp(input.createdAt),
        tags: [
          ["p", input.agentPubkey],
          ["source-app-post", input.sourceAppPostId],
          ...(input.sourceAppCommentId === undefined
            ? []
            : [["source-app-comment", input.sourceAppCommentId]]),
          ["t", APP_CONVERSATION_TOPIC],
        ],
      });
    },
    async promotePublicPost(input: CivicPromotionInput): Promise<NostrEvent> {
      ensureActive();
      const signer = await identity();
      return buildCivicPromotionEvent(signer.secretKey, input);
    },
    async promotePublicPostToTopic(
      input: CivicTopicPromotionInput
    ): Promise<NostrEvent> {
      ensureActive();
      const signer = await identity();
      return buildCivicTopicPromotionEvent(signer.secretKey, input);
    },
    async signCivicArgument(input: CivicArgumentInput): Promise<NostrEvent> {
      ensureActive();
      const signer = await identity();
      return buildCivicArgumentEvent(signer.secretKey, input);
    },
    async signTopicSuggestion(
      input: CitizenSignedTopicSuggestionInput
    ): Promise<CitizenSignedTopicSuggestionV1> {
      ensureActive();
      const signer = await identity();
      return buildCitizenSignedTopicSuggestion(signer.secretKey, input);
    },
    async signParticipantTopicSuggestion(
      input: ParticipantTopicSuggestionInput
    ): Promise<ParticipantTopicSuggestionV1> {
      ensureActive();
      const signer = await identity();
      return buildParticipantTopicSuggestion(signer.secretKey, input);
    },
    async signCitizenTopicSuggestionAdoption(
      input: CitizenTopicSuggestionAdoptionInput
    ): Promise<CitizenTopicSuggestionAdoptionV1> {
      ensureActive();
      const signer = await identity();
      return buildCitizenTopicSuggestionAdoption(signer.secretKey, input);
    },
    async signCitizenEligibilityChallenge(
      input: CitizenEligibilityChallengeSigningInput
    ): Promise<NostrEvent> {
      ensureActive();
      const signer = await identity();
      const expectedKeys = [
        "schemaVersion",
        "challengeId",
        "audience",
        "sessionBindingSha256",
        "walletAddress",
        "chainId",
        "subjectPubkey",
        "municipalityId",
        "policyVersion",
        "participantSuggestionId",
        "topicId",
        "issuedAt",
        "expiresAt",
        "authorityBinding",
        "canonicalChallenge",
        "message",
      ].sort();
      const challengeCore = {
        schemaVersion: input.schemaVersion,
        challengeId: input.challengeId,
        audience: input.audience,
        sessionBindingSha256: input.sessionBindingSha256,
        walletAddress: input.walletAddress,
        chainId: input.chainId,
        subjectPubkey: input.subjectPubkey,
        municipalityId: input.municipalityId,
        policyVersion: input.policyVersion,
        participantSuggestionId: input.participantSuggestionId,
        topicId: input.topicId,
        issuedAt: input.issuedAt,
        expiresAt: input.expiresAt,
        authorityBinding: input.authorityBinding,
      };
      if (
        Object.keys(input).sort().join("\n") !== expectedKeys.join("\n") ||
        input.schemaVersion !== "municipal_civic_eligibility_challenge_v1" ||
        !/^[0-9a-f]{32}$/u.test(input.challengeId) ||
        input.audience !== "roebel-staging-citizen-adoption" ||
        !/^[0-9a-f]{64}$/u.test(input.sessionBindingSha256) ||
        typeof input.walletAddress !== "string" ||
        !ADDRESS.test(input.walletAddress) ||
        input.walletAddress.toLowerCase() !== snapshot.credential.address ||
        input.chainId !== 100 ||
        input.chainId !== snapshot.credential.chainId ||
        input.subjectPubkey !== signer.publicKey ||
        !/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u.test(input.municipalityId) ||
        typeof input.policyVersion !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(input.policyVersion) ||
        !/^[0-9a-f]{64}$/u.test(input.participantSuggestionId) ||
        typeof input.topicId !== "string" ||
        input.topicId.length < 1 ||
        input.topicId.length > 500 ||
        !/^[\x21-\x7e]+$/u.test(input.topicId) ||
        !Number.isSafeInteger(input.issuedAt) ||
        input.issuedAt < 0 ||
        !Number.isSafeInteger(input.expiresAt) ||
        input.expiresAt <= input.issuedAt ||
        input.authorityBinding !== "civic_eligibility_only" ||
        typeof input.canonicalChallenge !== "string" ||
        input.canonicalChallenge !== stableJson(challengeCore) ||
        typeof input.message !== "string" ||
        input.message.length < 1 ||
        input.message.length > 10_000 ||
        input.message !== input.canonicalChallenge
      ) {
        throw new Error("citizen_eligibility_challenge_invalid");
      }
      return buildNoteEvent(signer.secretKey, input.message, {
        createdAt: input.issuedAt,
        tags: [
          ["schema", "municipal_civic_eligibility_challenge_proof_v1"],
          ["challenge", input.challengeId],
          [
            "e",
            input.participantSuggestionId,
            "",
            "eligibility-for-suggestion",
          ],
          ["municipality", input.municipalityId],
        ],
      });
    },
    async signSyntheticCitizenPassChallenge(
      input: SyntheticCitizenPassChallengeSigningInput
    ): Promise<NostrEvent> {
      ensureActive();
      const signer = await identity();
      const expectedKeys = [
        "schemaVersion", "challengeId", "audience", "chainId",
        "testCitizenNftContract", "subjectPubkey", "municipalityId",
        "policyVersion", "participantSuggestionId", "topicId", "issuedAt",
        "expiresAt", "environment", "testOnly", "authorityBinding",
        "canonicalChallenge", "message",
      ].sort();
      const core = {
        schemaVersion: input.schemaVersion,
        challengeId: input.challengeId,
        audience: input.audience,
        chainId: input.chainId,
        testCitizenNftContract: input.testCitizenNftContract,
        subjectPubkey: input.subjectPubkey,
        municipalityId: input.municipalityId,
        policyVersion: input.policyVersion,
        participantSuggestionId: input.participantSuggestionId,
        topicId: input.topicId,
        issuedAt: input.issuedAt,
        expiresAt: input.expiresAt,
        environment: input.environment,
        testOnly: input.testOnly,
        authorityBinding: input.authorityBinding,
      };
      if (
        Object.keys(input).sort().join("\n") !== expectedKeys.join("\n") ||
        input.schemaVersion !== "staging_test_citizen_pass_v1" ||
        !/^[0-9a-f]{32}$/u.test(input.challengeId) ||
        input.audience !== "roebel-staging-synthetic-citizen-adoption" ||
        input.chainId !== 100 || input.chainId !== snapshot.credential.chainId ||
        input.testCitizenNftContract !==
          "0x0be374808a567c9088ac8208b90a4239432b3220" ||
        input.subjectPubkey !== signer.publicKey ||
        !/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u.test(input.municipalityId) ||
        !/^[a-z0-9][a-z0-9._-]{2,99}$/u.test(input.policyVersion) ||
        !/^[0-9a-f]{64}$/u.test(input.participantSuggestionId) ||
        typeof input.topicId !== "string" || input.topicId.length < 1 ||
        input.topicId.length > 500 || !/^[\x21-\x7e]+$/u.test(input.topicId) ||
        !Number.isSafeInteger(input.issuedAt) || input.issuedAt < 0 ||
        !Number.isSafeInteger(input.expiresAt) ||
        input.expiresAt - input.issuedAt !== 300 ||
        input.environment !== "staging" || input.testOnly !== true ||
        input.authorityBinding !== "none" ||
        input.canonicalChallenge !== stableJson(core) ||
        input.message !== input.canonicalChallenge
      ) {
        throw new Error("synthetic_citizen_pass_challenge_invalid");
      }
      return buildNoteEvent(signer.secretKey, input.message, {
        createdAt: input.issuedAt,
        tags: [
          ["schema", "staging_test_citizen_pass_proof_v1"],
          ["challenge", input.challengeId],
          ["e", input.participantSuggestionId, "", "synthetic-adoption-test"],
          ["municipality", input.municipalityId],
          ["test-only", "true"],
        ],
      });
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      void identityPromise?.then((value) => value.secretKey.fill(0));
      identityPromise = undefined;
    },
  });
}
