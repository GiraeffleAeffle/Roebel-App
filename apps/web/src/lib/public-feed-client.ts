import type { PostComment, PostWithEngagement } from "@/types/post";

type PublicFeedEnvelope<T> = Readonly<{
  success: boolean;
  data?: T;
  error?: string;
}>;

/**
 * A public staging reader must never leave the feed's loading state pending
 * forever when its read gateway loses a connection. This is deliberately a
 * client-facing deadline: the server route remains fail-closed and rollout
 * verification still requires a successful direct Service response.
 */
export const PUBLIC_FEED_REQUEST_TIMEOUT_MS = 8_000;

async function publicFeedGet<T>(path: string): Promise<PublicFeedEnvelope<T>> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    PUBLIC_FEED_REQUEST_TIMEOUT_MS
  );
  try {
    const response = await fetch(`/api/public-feed${path}`, {
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    const value = (await response.json().catch(() => null)) as
      | PublicFeedEnvelope<T>
      | null;
    if (!value || typeof value !== "object") {
      return { success: false, error: "Öffentlicher Feed ist nicht erreichbar" };
    }
    return value;
  } catch {
    return {
      success: false,
      error: "Öffentlicher Feed antwortet gerade nicht. Bitte erneut laden.",
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function getPublicFeedPosts(input: {
  limit?: number;
  offset?: number;
  feedType?: "main" | "rathaus" | "app";
  category?: string;
}): Promise<PublicFeedEnvelope<PostWithEngagement[]>> {
  const params = new URLSearchParams();
  if (input.limit !== undefined) params.set("limit", String(input.limit));
  if (input.offset !== undefined) params.set("offset", String(input.offset));
  if (input.feedType) params.set("feedType", input.feedType);
  if (input.category) params.set("category", input.category);
  return publicFeedGet<PostWithEngagement[]>(`/posts?${params.toString()}`);
}

export function getPublicFeedPost(
  postId: string
): Promise<PublicFeedEnvelope<PostWithEngagement>> {
  return publicFeedGet<PostWithEngagement>(
    `/posts/${encodeURIComponent(postId)}`
  );
}

export function getPublicFeedComments(
  postId: string,
  limit = 50,
  offset = 0
): Promise<PublicFeedEnvelope<PostComment[]>> {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });
  return publicFeedGet<PostComment[]>(
    `/posts/${encodeURIComponent(postId)}/comments?${params.toString()}`
  );
}
