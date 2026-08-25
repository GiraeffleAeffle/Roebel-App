export type WalletSignatureVerifier = Readonly<{
  verifyWalletSignature(input: Readonly<{
    address: string;
    message: string;
    signature: string;
  }>): Promise<boolean>;
}>;

/**
 * The gateway is deliberately unable to express civic authority. Its data
 * boundary exposes two restricted write RPCs plus one exact owned-source read:
 * a personal text-only main-feed post, a comment, and its later Nostr mirror.
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
   * to bind a later Nostr mirror to the post just admitted by this gateway.
   */
  readOwnedMainTextPost(input: Readonly<{
    walletAddress: string;
    postId: string;
  }>): Promise<StagingParticipantPost | null>;
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

export type StagingParticipantGatewayConfig = Readonly<{
  origin: string;
  sessionHmacKey: string;
  inviteSha256: string;
  allowedWallets: readonly string[];
  cookieSecure: boolean;
  /** The only p-tag that the post-only mirror may carry. */
  meckyPubkey: string;
}>;
