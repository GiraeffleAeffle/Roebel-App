// ============================================
// Post Types
// ============================================

export type PostCategory =
  | "frage"
  | "empfehlungen"
  | "verloren_gefunden"
  | "hilfe_gebraucht"
  | "im_angebot"
  | "generell";

export type PostType =
  | "user"
  | "mecky"
  | "event_share"
  | "marketplace_share"
  | "event_experience";

export type FeedType = "main" | "rathaus" | "app";

export const FEED_TYPES: { id: FeedType; label: string }[] = [
  { id: "main", label: "Alles" },
  { id: "rathaus", label: "Stadt" },
  { id: "app", label: "App" },
];

export const POST_CATEGORIES: { id: PostCategory; label: string }[] = [
  { id: "frage", label: "Frage" },
  { id: "empfehlungen", label: "Empfehlungen" },
  { id: "verloren_gefunden", label: "Verloren & Gefunden" },
  { id: "hilfe_gebraucht", label: "Hilfe gebraucht" },
  { id: "im_angebot", label: "Im Angebot" },
  { id: "generell", label: "Generell" },
];

export interface Post {
  id: string;
  wallet_address: string;
  account_id?: string | null;
  content: string;
  media_urls: string[];
  video_url: string | null;
  category: PostCategory;
  status: "published" | "deleted" | "flagged";
  likes_count: number;
  comments_count: number;
  created_at: string;
  updated_at: string;
  post_type: PostType;
  feed_type: FeedType;
  linked_event_id: string | null;
  linked_experience_id: string | null;
}

export interface LinkedEventPreview {
  id: string;
  title: string;
  date: string;
  time: string | null;
  location: string;
  image_url: string | null;
}

export interface PostWithAuthor extends Post {
  author_username: string | null;
  author_profile_picture_url: string | null;
  author_neighborhood: string | null;
  author_account_name?: string | null;
  author_account_avatar_url?: string | null;
  author_account_type?: string | null;
}

export interface PostWithEngagement extends PostWithAuthor {
  links: PostLink[];
  is_liked_by_viewer: boolean;
  is_reported_by_viewer: boolean;
  poll: PollWithResults | null;
  linked_event: LinkedEventPreview | null;
}

export interface PostLink {
  id: string;
  post_id: string;
  url: string;
  og_title: string | null;
  og_description: string | null;
  og_image: string | null;
  og_site_name: string | null;
}

export interface PostComment {
  id: string;
  post_id: string;
  wallet_address: string;
  account_id?: string | null;
  content: string;
  media_urls: string[];
  video_url: string | null;
  status: "published" | "deleted";
  created_at: string;
  author_username: string | null;
  author_profile_picture_url: string | null;
  agent?: {
    kind: "public_mecky";
    pubkey: string;
    authorityBinding: "none";
    evidenceRefs: Array<{ digest: string; url: string }>;
  };
}

// ============================================
// Poll Types
// ============================================

export interface PostPoll {
  id: string;
  post_id: string;
  poll_type: "single" | "multi";
  options: string[];
  expires_at: string;
  created_at: string;
}

export interface PollWithResults extends PostPoll {
  total_votes: number;
  vote_counts: number[];
  viewer_vote: number[] | null;
  is_expired: boolean;
}

export interface CreatePollInput {
  poll_type: "single" | "multi";
  options: string[];
  duration_days: 1 | 3 | 7;
}

// ============================================
// Input Types
// ============================================

export interface CreatePostInput {
  wallet_address: string;
  account_id?: string;
  content: string;
  category: PostCategory;
  feed_type?: FeedType;
  media_urls?: string[];
  video_url?: string | null;
  link_urls?: string[];
  poll?: CreatePollInput;
}

// ============================================
// Proposal feed items (Stadt tab)
// ============================================

export type ProposalState = number;

export interface ProposalPreviewRef {
  proposal_id: string;
  proposal_number: number | null;
  title: string;
  state: ProposalState;
  for_votes: string;
  against_votes: string;
  abstain_votes: string;
}

export interface ProposalFeedItem {
  id: string;
  proposal_id: string;
  proposal_number: number | null;
  title: string;
  summary: string | null;
  category: string | null;
  state: ProposalState;
  for_votes: string;
  against_votes: string;
  abstain_votes: string;
  proposer_address: string;
  created_at: string;
}

export interface ProposalCommentFeedItem {
  id: string;
  proposal_id: string;
  wallet_address: string;
  account_id: string | null;
  content: string;
  media_urls: string[];
  video_url: string | null;
  emoji: string | null;
  status: "published" | "deleted";
  created_at: string;
  author_username: string | null;
  author_profile_picture_url: string | null;
  author_account_name: string | null;
  author_account_avatar_url: string | null;
  proposal: ProposalPreviewRef | null;
}

export interface CreateProposalCommentInput {
  proposal_id: string;
  wallet_address: string;
  account_id?: string;
  content: string;
  media_urls?: string[];
  video_url?: string | null;
  emoji?: string | null;
}

export interface CreateCommentInput {
  post_id: string;
  wallet_address: string;
  account_id?: string;
  content: string;
  media_urls?: string[];
  video_url?: string | null;
}

// ============================================
// OG Metadata
// ============================================

export interface OGMetadata {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
}
