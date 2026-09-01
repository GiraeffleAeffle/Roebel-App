import type { NostrEvent } from "@netizen-labs/nostr";

export type WalletSignatureVerifier = Readonly<{
  verifyWalletSignature(input: Readonly<{
    address: string;
    message: string;
    signature: string;
  }>): Promise<boolean>;
}>;

/**
 * The gateway is deliberately unable to express civic authority. Its data
 * boundary exposes ordinary feed writes, one exact owned-source read, and
 * separately versioned mirror/tracer receipt transitions. None can address an
 * arbitrary application row or a civic-authority table.
 */
export type StagingParticipantDataAdapter = Readonly<{
  createMainTextPost(input: Readonly<{
    walletAddress: string;
    content: string;
    requestId: string;
  }>): Promise<StagingParticipantPost>;
  createMainTextComment(input: Readonly<{
    walletAddress: string;
    postId: string;
    content: string;
    requestId: string;
  }>): Promise<StagingParticipantComment>;
  /**
   * Read exactly one ordinary, published main-feed post owned by the session
   * wallet. This is deliberately not a generic feed/read RPC: it exists only
   * to bind a later signed conversation mention to the post just admitted by
   * this gateway.
   */
  readOwnedMainTextPost(input: Readonly<{
    walletAddress: string;
    postId: string;
  }>): Promise<StagingParticipantPost | null>;
  /** Atomically reserves (or re-reads) one immutable post→conversation mention. */
  reserveNostrPostMirror(input: Readonly<{
    walletAddress: string;
    sourcePostId: string;
    requestId: string;
    eventId: string;
    /** Unix seconds from the signed event; checked only for first reservation. */
    eventCreatedAt: number;
    contentSha256: string;
  }>): Promise<StagingParticipantMirrorReceipt>;
  /** Marks only the already-reserved exact event as published. */
  completeNostrPostMirror(input: Readonly<{
    walletAddress: string;
    sourcePostId: string;
    requestId: string;
    eventId: string;
    contentSha256: string;
  }>): Promise<StagingParticipantMirrorReceipt>;
  /** Adds the v2 proof-verified Nostr author binding to a published mirror. */
  bindPublishedNostrPostMirror(input: Readonly<{
    walletAddress: string;
    sourcePostId: string;
    eventId: string;
    nostrPubkey: string;
  }>): Promise<StagingParticipantSourceMirrorBinding>;
  /** Closed resolver; ownership is checked by the database, never workbench input. */
  resolvePublishedNostrPostMirror(input: Readonly<{
    walletAddress: string;
    sourcePostId: string;
  }>): Promise<StagingParticipantSourceMirrorBinding | null>;
  /**
   * Atomically reserves one author-confirmed topic root. The database does not
   * receive a browser-selected table or feed query: it checks the ordinary
   * source row against the active session wallet before recording the claim.
   */
  reserveSourcePostPromotion(input: Readonly<{
    walletAddress: string;
    namespace: string;
    sourcePostId: string;
    requestId: string;
    idempotencyKeySha256: string;
    discussionRootId: string;
    discussionRootSha256: string;
    topicId: string;
    policyVersion: string;
  }>): Promise<StagingParticipantPromotionReceipt>;
  completeSourcePostPromotion(input: Readonly<{
    walletAddress: string;
    namespace: string;
    sourcePostId: string;
    requestId: string;
    idempotencyKeySha256: string;
    discussionRootId: string;
    discussionRootSha256: string;
  }>): Promise<StagingParticipantPromotionReceipt>;
  resolvePublishedSourcePostPromotion(input: Readonly<{
    walletAddress: string;
    namespace: string;
    discussionRootId: string;
    sourceAuthorPubkey: string;
  }>): Promise<StagingParticipantPromotionReceipt | null>;
  /** Same closed, durable hand-off for one root and its source author. */
  reserveTopicSuggestion(input: Readonly<{
    walletAddress: string;
    namespace: string;
    discussionRootId: string;
    sourceAuthorPubkey: string;
    requestId: string;
    idempotencyKeySha256: string;
    suggestionId: string;
    suggestionSha256: string;
    meckyAnswerId: string;
    meckyReceiptId: string;
    topicId: string;
    policyVersion: string;
  }>): Promise<StagingParticipantSuggestionReceipt>;
  completeTopicSuggestion(input: Readonly<{
    walletAddress: string;
    namespace: string;
    discussionRootId: string;
    sourceAuthorPubkey: string;
    requestId: string;
    idempotencyKeySha256: string;
    suggestionId: string;
    suggestionSha256: string;
  }>): Promise<StagingParticipantSuggestionReceipt>;
}>;

/** A single catalog-bound readiness capability; it cannot select any RPC. */
export type StagingParticipantReadinessAdapter = Readonly<{
  preflight(): Promise<Readonly<{ migrationId: string; databaseSchemaSha256: string }>>;
  preflightTopicTracer(): Promise<Readonly<{ migrationId: string; databaseSchemaSha256: string }>>;
  preflightCitizenAdoption(): Promise<Readonly<{ migrationId: string; databaseSchemaSha256: string }>>;
}>;

export type StagingParticipantReadinessPins = Readonly<{
  sourceRevision: string;
  manifestDigest: string;
  migrationSha256: string;
  databaseSchemaSha256: string;
  topicTracerMigrationSha256: string;
  topicTracerDatabaseSchemaSha256: string;
  citizenAdoptionMigrationSha256: string;
  citizenAdoptionDatabaseSchemaSha256: string;
}>;

/**
 * A private, capability-contained adapter for the already-deployed signed
 * Nostr workbench. It receives no caller-selected URL, method or intent.
 */
export type MeckyMirrorAdapter = Readonly<{
  mirrorPost(input: Readonly<{
    admissionProof: unknown;
    event: Readonly<{
      id: string;
      pubkey: string;
      created_at: number;
      kind: number;
      tags: string[][];
      content: string;
      sig: string;
    }>;
  }>): Promise<Readonly<{ status: "published"; eventId: string }>>;
}>;

/** Immutable deployment configuration for the ADR-0022 tracer. */
export type StagingParticipantTopicPolicy = Readonly<{
  municipalityId: string;
  /** Exact prefix before the final topic slug, e.g. `urn:...:roebel-mueritz`. */
  topicNamespace: string;
  /** Exact source-app Nostr `t` value. */
  sourceConversationTopic: string;
  policyVersion: string;
}>;

/**
 * A fixed internal resolver/publisher for the ADR-0022 tracer. It has no
 * arbitrary relay URL, query, method, Nostr intent, Case, vote, or treasury
 * capability. The browser can submit signed envelopes but never declares the
 * source facts used to accept them.
 */
export type StagingParticipantTopicTracerAdapter = Readonly<{
  resolvePromotionSource(input: Readonly<{
    sourceNoteEventId: string;
    sourceAuthorPubkey: string;
    sourceAppPostId: string;
  }>): Promise<Readonly<{
    sourceNote: NostrEvent;
    meckyReplyEvent: NostrEvent;
    meckyReceiptId?: string;
  }> | null>;
  publishPromotion(input: Readonly<{ event: NostrEvent }>): Promise<Readonly<{
    status: "published";
    eventId: string;
  }>>;
  resolveTopicSuggestionSources(input: Readonly<{
    discussionRootId: string;
    sourceAuthorPubkey: string;
    sourceNoteEventId: string;
    sourceAppPostId: string;
  }>): Promise<Readonly<{
    sourceNote: NostrEvent;
    discussionRoot: NostrEvent;
    meckyAnswer: NostrEvent;
    meckyReplyEvent: NostrEvent;
    meckyReceiptId?: string;
  }> | null>;
  publishTopicSuggestion(input: Readonly<{ event: NostrEvent }>): Promise<Readonly<{
    status: "published";
    eventId: string;
  }>>;
}>;

/** Public shapes consumed by the Röbel composer/comment UI. */
export type StagingParticipantPost = Readonly<{
  id: string;
  wallet_address: string;
  account_id: null;
  content: string;
  media_urls: [];
  video_url: null;
  category: "generell";
  status: "published";
  likes_count: number;
  comments_count: number;
  created_at: string;
  updated_at: string;
  post_type: "user";
  feed_type: "main";
  linked_event_id: null;
  linked_experience_id: null;
}>;

export type StagingParticipantComment = Readonly<{
  id: string;
  post_id: string;
  wallet_address: string;
  account_id: null;
  content: string;
  media_urls: [];
  video_url: null;
  status: "published";
  created_at: string;
  author_username: null;
  author_profile_picture_url: null;
}>;

export type StagingParticipantMirrorReceipt = Readonly<{
  wallet_address: string;
  source_post_id: string;
  request_id: string;
  event_id: string;
  event_created_at: number;
  content_sha256: string;
  state: "reserved" | "published";
}>;

export type StagingParticipantSourceMirrorBinding = Readonly<{
  wallet_address: string;
  source_post_id: string;
  event_id: string;
  nostr_pubkey: string;
}>;

export type StagingParticipantPromotionReceipt = Readonly<{
  namespace: string;
  wallet_address: string;
  source_post_id: string;
  request_id: string;
  idempotency_key_sha256: string;
  discussion_root_id: string;
  discussion_root_sha256: string;
  topic_id: string;
  policy_version: string;
  state: "reserved" | "published";
  receipt_checksum: string;
}>;

export type StagingParticipantSuggestionReceipt = Readonly<{
  namespace: string;
  wallet_address: string;
  discussion_root_id: string;
  source_author_pubkey: string;
  request_id: string;
  idempotency_key_sha256: string;
  suggestion_id: string;
  suggestion_sha256: string;
  mecky_answer_id: string;
  mecky_receipt_id: string;
  topic_id: string;
  policy_version: string;
  state: "reserved" | "published";
  receipt_checksum: string;
}>;

export type StagingParticipantGatewayConfig = Readonly<{
  origin: string;
  sessionHmacKey: string;
  inviteSha256: string;
  allowedWallets: readonly string[];
  cookieSecure: boolean;
  /** The only agent p-tag that the same-thread mirror may carry. */
  meckyPubkey: string;
  topicPolicy: StagingParticipantTopicPolicy;
}>;
