export type WalletSignatureVerifier = Readonly<{
  verifyWalletSignature(input: Readonly<{
    address: string;
    message: string;
    signature: string;
  }>): Promise<boolean>;
}>;

/**
 * The gateway is deliberately unable to express civic authority. Its data
 * boundary exposes two write RPCs, one exact owned-source read and two durable
 * mirror-receipt transitions. None can address an arbitrary application row.
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

export type StagingParticipantGatewayConfig = Readonly<{
  origin: string;
  sessionHmacKey: string;
  inviteSha256: string;
  allowedWallets: readonly string[];
  cookieSecure: boolean;
  /** The only agent p-tag that the same-thread mirror may carry. */
  meckyPubkey: string;
}>;
