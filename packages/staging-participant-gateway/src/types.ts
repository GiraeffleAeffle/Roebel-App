export type WalletSignatureVerifier = Readonly<{
  verifyWalletSignature(input: Readonly<{
    address: string;
    message: string;
    signature: string;
  }>): Promise<boolean>;
}>;

/**
 * The gateway is deliberately unable to express civic authority. Its data
 * boundary exposes exactly two restricted Supabase RPCs: a personal, text-only
 * main-feed post and a comment on an existing main-feed post.
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
}>;
