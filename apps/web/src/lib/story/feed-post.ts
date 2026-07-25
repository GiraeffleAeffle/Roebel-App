export interface StoryArticleForTeaser {
  id: string;
  title: string;
  excerpt: string;
  cover_image_url: string | null;
}

export interface StoryTeaserSubject {
  accountId: string;
  walletAddress: string;
}

export interface StoryTeaserPost {
  wallet_address: string;
  account_id: string;
  content: string;
  category: string;
  feed_type: string;
  post_type: string;
  status: string;
}

export interface StoryTeaserLink {
  url: string;
  og_title: string;
  og_description: string;
  og_image: string | null;
}

export interface StoryTeaserPostResult {
  post: StoryTeaserPost;
  link: StoryTeaserLink;
}

const MAX_CONTENT_LENGTH = 280;

/**
 * Builds the "new story" teaser post (+ link preview) that surfaces a
 * freshly published `blog_articles` row in the main feed. Pure — no I/O.
 * Reuses the existing `posts.post_type = "user"` (no new post_type invented).
 */
export function buildStoryTeaserPost(
  article: StoryArticleForTeaser,
  subject: StoryTeaserSubject,
): StoryTeaserPostResult {
  const raw = `Neue Geschichte: „${article.title}“ — ${article.excerpt}`.trim();
  const content =
    raw.length > MAX_CONTENT_LENGTH ? `${raw.slice(0, MAX_CONTENT_LENGTH - 1).trimEnd()}…` : raw;

  return {
    post: {
      wallet_address: subject.walletAddress.toLowerCase(),
      account_id: subject.accountId,
      content,
      category: "generell",
      feed_type: "main",
      post_type: "user",
      status: "published",
    },
    link: {
      url: `/app/blog/${article.id}`,
      og_title: article.title,
      og_description: article.excerpt,
      og_image: article.cover_image_url,
    },
  };
}
