import { supabase } from './supabase';
import type {
  FeedType,
  PostRecord,
  PostCommentRecord,
  ServiceAlertRecord,
  CreatePostInput,
  CreateCommentInput,
  CreatePollInput,
  CreatePostLinkInput,
  PollVoteRecord,
  LinkedMiniAppRef,
} from './types/feed';
import type { CivicCaseBinding, NostrEvent } from '@netizen-labs/nostr';
import type { PublicationStatus } from './nostr/publish';

const PAGE_SIZE = 15;

/** Merge top-level `account` join into `author.account` for PostAuthorRow */
function mergeAccountIntoAuthor<T extends { author?: any; account?: any; quoted_post?: any }>(row: T): T {
  if (row.account && row.author) {
    row.author = { ...row.author, account: row.account };
  }
  if (row.quoted_post) {
    row.quoted_post = mergeAccountIntoAuthor(row.quoted_post);
  }
  return row;
}

// ─── Posts ──────────────────────────────────────────────────

/**
 * Fetch paginated posts for a feed tab with author data joined
 */
const FEED_POST_SELECT = `
  *,
  author:users!posts_wallet_address_fkey(
    wallet_address, username, profile_picture_url, is_verified_citizen, tier, equipped_frame_asset_url
  ),
  account:accounts(id, account_type, name, avatar_url),
  links:post_links(*),
  poll:post_polls(*),
  linked_event:events(id, title, date, time, location, image_url, category),
  linked_marketplace:marketplace_listings(id, title, price, price_type, category, condition, media_urls, neighborhood),
  sticker:lootbox_rewards!sticker_reward_id(id, type, name, asset_url)
`;

/**
 * Attach the quoted original onto repost/quote rows. PostgREST can't
 * disambiguate the self-referential posts→posts embed (the column hint
 * resolves to the reverse to-many direction), so originals are hydrated in a
 * second batched query. Deleted originals stay null — repost rows get dropped
 * by the feed, quote previews show a placeholder. One level deep by design.
 */
async function attachQuotedPosts<T extends PostRecord>(rows: T[]): Promise<T[]> {
  const ids = Array.from(
    new Set(rows.map((r) => r.quoted_post_id).filter(Boolean)),
  ) as string[];
  if (ids.length === 0) return rows;

  const { data, error } = await supabase
    .from('posts')
    .select(FEED_POST_SELECT)
    .in('id', ids)
    .eq('status', 'published');
  if (error || !data) return rows;

  const byId = new Map<string, PostRecord>(
    (data as PostRecord[]).map((p) => [p.id, mergeAccountIntoAuthor(p)]),
  );
  rows.forEach((r) => {
    if (r.quoted_post_id) r.quoted_post = byId.get(r.quoted_post_id) ?? null;
  });
  return rows;
}

/**
 * Hydrate `linked_mini_app` onto mini-app-share rows (and their quoted
 * originals) in one batched query. Client-side instead of a PostgREST embed so
 * every feed keeps loading before the add_mini_app_share migration is applied
 * (an unknown embed would fail the whole select). RLS only exposes live apps —
 * shares of delisted apps simply render without the card.
 */
async function attachLinkedMiniApps<T extends PostRecord>(rows: T[]): Promise<T[]> {
  const targets = rows.flatMap((r) => [r, ...(r.quoted_post ? [r.quoted_post] : [])]);
  const ids = Array.from(
    new Set(targets.map((r) => r.linked_mini_app_id).filter(Boolean)),
  ) as string[];
  if (ids.length === 0) return rows;

  const { data, error } = await supabase
    .from('mini_apps')
    .select('id, slug, name, description, icon_url, primary_color, category')
    .in('id', ids)
    .eq('status', 'live');
  if (error || !data) return rows;

  const byId = new Map(
    (data as LinkedMiniAppRef[]).map((a) => [a.id, a]),
  );
  targets.forEach((r) => {
    if (r.linked_mini_app_id) r.linked_mini_app = byId.get(r.linked_mini_app_id) ?? null;
  });
  return rows;
}

// Session-level feature detection: null = untested, true = RPC serving,
// false = function missing (migration not applied) → use the legacy path
// without re-probing on every page.
let feedRpcAvailable: boolean | null = null;

export async function fetchFeedPosts(options: {
  feedType: FeedType;
  page: number;
  pageSize?: number;
  walletAddress?: string;
}): Promise<{ data: PostRecord[]; hasMore: boolean; likedPostIds?: string[] | null; repostedPostIds?: string[] | null }> {
  const size = options.pageSize || PAGE_SIZE;

  if (feedRpcAvailable !== false) {
    const { data: rpcData, error: rpcError } = await supabase.rpc('get_feed_page', {
      p_feed_type: options.feedType,
      p_page: options.page,
      p_page_size: size,
      p_wallet: options.walletAddress ?? null,
    });
    const payload = rpcData as any;
    if (!rpcError && payload && Array.isArray(payload.posts)) {
      feedRpcAvailable = true;
      return {
        data: (payload.posts as PostRecord[]).map(mergeAccountIntoAuthor),
        hasMore: !!payload.has_more,
        likedPostIds: payload.liked_post_ids ?? null,
        repostedPostIds: payload.reposted_post_ids ?? null,
      };
    }
    // PGRST202 = function not found → migration not applied yet. Any other
    // error (network blip, transient 5xx) falls through to the legacy path
    // for THIS call but keeps probing on later calls.
    if (rpcError?.code === 'PGRST202') {
      feedRpcAvailable = false;
    }
  }

  // Legacy multi-request path (kept verbatim from before): wide select →
  // pinned query → attachQuotedPosts → attachLinkedMiniApps.
  const from = options.page * size;
  const to = from + size - 1;

  const { data, error } = await supabase
    .from('posts')
    .select(FEED_POST_SELECT)
    .eq('feed_type', options.feedType)
    .eq('status', 'published')
    .order('created_at', { ascending: false })
    .range(from, to);

  if (error) {
    console.error('Error fetching feed posts:', error);
    return { data: [], hasMore: false };
  }

  let rows = (data as PostRecord[]).map(mergeAccountIntoAuthor);

  // On the first page, surface currently-pinned posts at the very top — even a
  // pin on an older post that wouldn't fall inside this page's window. Pins
  // expire by time (a pinned_until in the past no longer matches "> now"), so
  // no cleanup job is needed. Guarded so the feed still loads before the
  // pinning migration is applied (missing column → error → skip silently).
  if (options.page === 0) {
    try {
      const { data: pinnedData, error: pinnedErr } = await supabase
        .from('posts')
        .select(FEED_POST_SELECT)
        .eq('feed_type', options.feedType)
        .eq('status', 'published')
        .gt('pinned_until', new Date().toISOString())
        .order('pinned_until', { ascending: false });

      if (!pinnedErr && pinnedData && pinnedData.length > 0) {
        const pinned = (pinnedData as PostRecord[]).map(mergeAccountIntoAuthor);
        const pinnedIds = new Set(pinned.map((p) => p.id));
        rows = [...pinned, ...rows.filter((r) => !pinnedIds.has(r.id))];
      }
    } catch {
      // Pinning not migrated yet — leave the chronological order untouched.
    }
  }

  return {
    data: await attachLinkedMiniApps(await attachQuotedPosts(rows)),
    hasMore: data.length === size,
  };
}

/**
 * Fetch a user's own posts by wallet address, ordered newest first.
 * Used on the public profile's "Beiträge" tab.
 *
 * A wallet may post as itself (personal account) or on behalf of an
 * organisation account it manages — all rows share the same `wallet_address`,
 * distinguished only by `account_id`. The personal profile shows only the
 * user's own posts, so posts authored as an organisation are excluded. Legacy
 * posts with a NULL `account_id` predate the accounts model and count as
 * personal.
 */
export async function fetchUserPosts(
  walletAddress: string,
  options?: { page?: number; pageSize?: number }
): Promise<{ data: PostRecord[]; hasMore: boolean }> {
  const size = options?.pageSize || PAGE_SIZE;
  const page = options?.page || 0;
  const from = page * size;
  const to = from + size - 1;
  const wallet = walletAddress.toLowerCase();

  // Find the org account ids this wallet has posted as, so we can exclude them.
  const { data: orgRows } = await supabase
    .from('posts')
    .select('account_id, accounts!inner(account_type)')
    .eq('wallet_address', wallet)
    .eq('accounts.account_type', 'organisation');

  const orgAccountIds = Array.from(
    new Set((orgRows ?? []).map((r: any) => r.account_id).filter(Boolean)),
  );

  let query = supabase
    .from('posts')
    .select(`
      *,
      author:users!posts_wallet_address_fkey(
        wallet_address, username, profile_picture_url, is_verified_citizen, tier, equipped_frame_asset_url
      ),
      account:accounts(id, account_type, name, avatar_url),
      links:post_links(*),
      poll:post_polls(*),
      linked_event:events(id, title, date, time, location, image_url, category),
      linked_marketplace:marketplace_listings(id, title, price, price_type, category, condition, media_urls, neighborhood),
      sticker:lootbox_rewards!sticker_reward_id(id, type, name, asset_url)
    `)
    .eq('wallet_address', wallet)
    .eq('status', 'published');

  // Keep NULL-account (legacy) posts, drop org posts. `not.in` alone would also
  // drop NULLs (NULL NOT IN (...) is NULL), so OR the null check back in.
  if (orgAccountIds.length > 0) {
    query = query.or(`account_id.is.null,account_id.not.in.(${orgAccountIds.join(',')})`);
  }

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .range(from, to);

  if (error) {
    console.error('Error fetching user posts:', error);
    return { data: [], hasMore: false };
  }

  return {
    data: await attachLinkedMiniApps(await attachQuotedPosts((data as PostRecord[]).map(mergeAccountIntoAuthor))),
    hasMore: data.length === size,
  };
}

/**
 * Fetch posts authored from a specific organisation account, newest first.
 */
export async function fetchAccountPosts(
  accountId: string,
  options?: { page?: number; pageSize?: number }
): Promise<{ data: PostRecord[]; hasMore: boolean }> {
  const size = options?.pageSize || PAGE_SIZE;
  const page = options?.page || 0;
  const from = page * size;
  const to = from + size - 1;

  const { data, error } = await supabase
    .from('posts')
    .select(`
      *,
      author:users!posts_wallet_address_fkey(
        wallet_address, username, profile_picture_url, is_verified_citizen, tier, equipped_frame_asset_url
      ),
      account:accounts(id, account_type, name, avatar_url),
      links:post_links(*),
      poll:post_polls(*),
      linked_event:events(id, title, date, time, location, image_url, category),
      linked_marketplace:marketplace_listings(id, title, price, price_type, category, condition, media_urls, neighborhood),
      sticker:lootbox_rewards!sticker_reward_id(id, type, name, asset_url)
    `)
    .eq('account_id', accountId)
    .eq('status', 'published')
    .order('created_at', { ascending: false })
    .range(from, to);

  if (error) {
    console.error('Error fetching account posts:', error);
    return { data: [], hasMore: false };
  }

  return {
    data: await attachLinkedMiniApps(await attachQuotedPosts((data as PostRecord[]).map(mergeAccountIntoAuthor))),
    hasMore: data.length === size,
  };
}

/**
 * Fetch a single post with all relations
 */
export async function fetchPostById(postId: string): Promise<PostRecord | null> {
  const { data, error } = await supabase
    .from('posts')
    .select(`
      *,
      author:users!posts_wallet_address_fkey(
        wallet_address, username, profile_picture_url, is_verified_citizen, tier, equipped_frame_asset_url
      ),
      account:accounts(id, account_type, name, avatar_url),
      links:post_links(*),
      poll:post_polls(*),
      linked_event:events(id, title, date, time, location, image_url, category),
      linked_marketplace:marketplace_listings(id, title, price, price_type, category, condition, media_urls, neighborhood),
      sticker:lootbox_rewards!sticker_reward_id(id, type, name, asset_url)
    `)
    .eq('id', postId)
    .single();

  if (error) {
    console.error('Error fetching post:', error);
    return null;
  }

  const [row] = await attachLinkedMiniApps(
    await attachQuotedPosts([mergeAccountIntoAuthor(data as PostRecord)]),
  );
  return row;
}

/**
 * Posting denial codes raised by the `enforce_posting_rules` trigger when a
 * non-citizen attempts to post without meeting the tourist-tier requirements.
 * The trigger raises messages like `ACCOUNT_TOO_YOUNG:2026-05-24T15:00:00+00`
 * which `parsePostingDenial` turns into a structured value.
 */
export type PostingDenialCode =
  | 'LOCATION_REQUIRED'
  | 'ACCOUNT_TOO_YOUNG'
  | 'RATE_LIMIT_DAY'
  | 'RATE_LIMIT_WEEK'
  | 'USER_NOT_FOUND';

export class PostingDeniedError extends Error {
  code: PostingDenialCode;
  unlockAt?: Date;
  constructor(code: PostingDenialCode, unlockAt?: Date) {
    super(code);
    this.name = 'PostingDeniedError';
    this.code = code;
    this.unlockAt = unlockAt;
  }
}

function parsePostingDenial(message: string | undefined): PostingDeniedError | null {
  if (!message) return null;
  const m = message.match(
    /\b(LOCATION_REQUIRED|ACCOUNT_TOO_YOUNG|RATE_LIMIT_DAY|RATE_LIMIT_WEEK|USER_NOT_FOUND)(?::(\S+))?/,
  );
  if (!m) return null;
  const code = m[1] as PostingDenialCode;
  const ts = m[2];
  const unlockAt = ts ? new Date(ts) : undefined;
  return new PostingDeniedError(code, Number.isNaN(unlockAt?.getTime()) ? undefined : unlockAt);
}

/**
 * Create a new post.
 *
 * Throws `PostingDeniedError` when the `enforce_posting_rules` trigger blocks
 * a non-citizen post (location/age/rate-limit gate). Returns null on generic
 * failures, matching the historical contract — callers may keep their old
 * `if (!post)` branch and just add a `catch (PostingDeniedError)` for the new
 * gated path.
 */
async function createPostInternal(
  input: CreatePostInput,
  awaitCivicPublication: boolean,
): Promise<{
  post: PostRecord | null;
  civicPublicationStatus: PublicationStatus | null;
  civicDiscussionEvent: NostrEvent | null;
}> {
  const { data, error } = await supabase
    .from('posts')
    .insert({
      wallet_address: input.wallet_address,
      account_id: input.account_id || null,
      content: input.content,
      category: input.category || 'generell',
      feed_type: input.feed_type || 'main',
      post_type: input.post_type || 'user',
      media_urls: input.media_urls || [],
      video_url: input.video_url || null,
      linked_event_id: input.linked_event_id || null,
      linked_marketplace_id: input.linked_marketplace_id || null,
      linked_mecky_draft_id: input.linked_mecky_draft_id || null,
      sticker_reward_id: input.sticker_reward_id || null,
      // Only reference the column when a snapshot is attached, so normal posting
      // keeps working even before the stadtkasse_snapshot migration is applied.
      ...(input.stadtkasse_snapshot ? { stadtkasse_snapshot: input.stadtkasse_snapshot } : {}),
      ...(input.quoted_post_id ? { quoted_post_id: input.quoted_post_id } : {}),
      // Only reference the column when set — normal posting keeps working
      // before the add_mini_app_share migration is applied.
      ...(input.linked_mini_app_id ? { linked_mini_app_id: input.linked_mini_app_id } : {}),
      status: 'published',
    })
    .select(`
      *,
      author:users!posts_wallet_address_fkey(
        wallet_address, username, profile_picture_url, is_verified_citizen, tier, equipped_frame_asset_url
      ),
      account:accounts(id, account_type, name, avatar_url),
      sticker:lootbox_rewards!sticker_reward_id(id, type, name, asset_url)
    `)
    .single();

  if (error) {
    const denied = parsePostingDenial(error.message);
    if (denied) throw denied;
    console.error('Error creating post:', error);
    return {
      post: null,
      civicPublicationStatus: null,
      civicDiscussionEvent: null,
    };
  }

  const post = mergeAccountIntoAuthor(data as PostRecord);

  // Fire background Claude moderation for non-citizen freeform posts only.
  // Citizens are trusted (CitizenNFT signal); other post_types are auto-generated.
  const isCitizen = !!post.author?.is_verified_citizen;
  if (!isCitizen && post.post_type === 'user') {
    supabase.functions
      .invoke('moderate-post', { body: { post_id: post.id } })
      .catch((err) => console.warn('[moderate-post] invoke failed', err?.message));
  }

  // Mirror public feed posts to the sovereign Nostr relay as signed events, so
  // other nodes and agents can read the town's public record. Strictly
  // best-effort and never awaited: Supabase stays the source of truth for this
  // slice, and a Citizen without a Nostr identity (or not yet allow-listed)
  // simply posts as before. Only main-feed human posts are mirrored — nothing
  // private, nothing auto-generated.
  let civicPublicationStatus: PublicationStatus | null = null;
  let civicDiscussionEvent: NostrEvent | null = null;
  if ((post.post_type === 'user' || post.post_type === 'repost') && post.feed_type === 'main') {
    if (input.civicBinding && awaitCivicPublication) {
      const { publishCivicDiscussionDetailed } = await import('./nostr/publish');
      const createdSec = post.created_at
        ? Math.floor(Date.parse(post.created_at) / 1_000)
        : undefined;
      const publication = await publishCivicDiscussionDetailed(
        post.id,
        post.content,
        input.civicBinding,
        createdSec,
      );
      civicPublicationStatus = publication.status;
      civicDiscussionEvent = publication.event;
    } else {
      void mirrorPostToNostr(post, input.civicBinding);
    }
  }

  return { post, civicPublicationStatus, civicDiscussionEvent };
}

export async function createPost(input: CreatePostInput): Promise<PostRecord | null> {
  return (await createPostInternal(input, false)).post;
}

/**
 * Create the app-visible citizen discussion and wait for its parallel signed
 * Nostr publication attempt. The Supabase post remains visible if the relay is
 * temporarily unavailable, but the caller receives that honest `pending`
 * state and must not present the workflow as admitted or submitted.
 */
export async function createCivicDiscussionPost(input: {
  wallet_address: string;
  content: string;
  civicBinding: CivicCaseBinding;
}): Promise<{
  post: PostRecord | null;
  publicationStatus: PublicationStatus;
  discussionEvent: NostrEvent | null;
}> {
  const result = await createPostInternal(
    {
      wallet_address: input.wallet_address,
      content: input.content,
      category: 'frage',
      feed_type: 'main',
      post_type: 'user',
      civicBinding: input.civicBinding,
    },
    true,
  );
  return {
    post: result.post,
    publicationStatus: result.civicPublicationStatus ?? 'pending',
    discussionEvent: result.civicDiscussionEvent,
  };
}

/** Publish a post to the relay if this device holds a Nostr identity. Swallows everything. */
async function mirrorPostToNostr(
  post: PostRecord,
  civicBinding?: import('@netizen-labs/nostr').CivicCaseBinding,
): Promise<PublicationStatus | null> {
  try {
    // Organisation-account posts are published by the NODE under the org's own
    // key; a citizen's key must never sign an organisation's words.
    if (post.account_id) {
      const { data: acct } = await supabase
        .from('accounts')
        .select('account_type')
        .eq('id', post.account_id)
        .maybeSingle();
      if (acct?.account_type === 'organisation') return null;
    }
    const { publishCivicDiscussion, publishPost, publishRepost } = await import('./nostr/publish');
    if (post.quoted_post_id) {
      // NIP-18: bare repost = kind 6; quote with own words = kind 1 + q tag.
      return publishRepost(post.id, post.quoted_post_id, post.content || undefined);
    }
    const media = (post.media_urls ?? []).join('\n');
    const content = media ? `${post.content}\n\n${media}` : post.content;
    const createdSec = post.created_at ? Math.floor(Date.parse(post.created_at) / 1000) : undefined;
    if (civicBinding) {
      return publishCivicDiscussion(post.id, content, civicBinding, createdSec);
    }
    return publishPost(post.id, content, createdSec);
  } catch (err) {
    console.warn('[nostr] post mirror skipped', (err as Error)?.message);
    return null;
  }
}

/**
 * Hard-delete a post owned by the given wallet via the SECURITY DEFINER RPC
 * `delete_owned_post`. The RPC handles wallet-case normalization, bypasses RLS,
 * and raises a clear error if no row matched.
 *
 * NOTE: account-managed posts (where the deleter is an account manager, not the
 * original author) are not supported — the RPC accepts a single wallet only.
 * Tracked as a follow-up.
 */
export async function deletePost(postId: string, walletAddress: string): Promise<void> {
  const { error } = await supabase.rpc('delete_owned_post', {
    p_post_id: postId,
    p_wallet: walletAddress,
  });

  if (error) {
    console.error('[deletePost] rpc error', error);
    throw error;
  }
}

/**
 * Pin or unpin a post via the SECURITY DEFINER RPC `pin_own_post`. The RPC
 * enforces ownership AND Verified-Citizen status, and — when pinning — clears
 * the wallet's other active pins first (one pin per citizen). Returns the new
 * `pinned_until` (ISO string) when pinning, or null when unpinning.
 */
export async function pinPost(
  postId: string,
  walletAddress: string,
  pin: boolean,
): Promise<string | null> {
  const { data, error } = await supabase.rpc('pin_own_post', {
    p_post_id: postId,
    p_wallet: walletAddress,
    p_pin: pin,
  });

  if (error) {
    console.error('[pinPost] rpc error', error);
    throw error;
  }

  return (data as string | null) ?? null;
}

/**
 * Update a post's content and/or category
 */
export async function updatePost(
  postId: string,
  updates: { content?: string; category?: string }
): Promise<PostRecord | null> {
  const { data, error } = await supabase
    .from('posts')
    .update({ ...updates, edited_at: new Date().toISOString() })
    .eq('id', postId)
    .select(`
      *,
      author:users!posts_wallet_address_fkey(
        wallet_address, username, profile_picture_url, is_verified_citizen, tier, equipped_frame_asset_url
      ),
      account:accounts(id, account_type, name, avatar_url),
      links:post_links(*),
      poll:post_polls(*),
      linked_event:events(id, title, date, time, location, image_url, category),
      linked_marketplace:marketplace_listings(id, title, price, price_type, category, condition, media_urls, neighborhood),
      sticker:lootbox_rewards!sticker_reward_id(id, type, name, asset_url)
    `)
    .single();

  if (error) {
    console.error('Error updating post:', error);
    throw error;
  }

  return mergeAccountIntoAuthor(data as PostRecord);
}

// ─── Reposts ────────────────────────────────────────────────

/**
 * Plain repost: a posts row referencing the original. Lands in the main feed
 * (App-feed posts get promoted into "Für Alle"). RLS/posting rules apply — a
 * PostingDeniedError propagates like normal post creation.
 */
export async function createRepost(
  postId: string,
  walletAddress: string,
  accountId?: string,
): Promise<PostRecord | null> {
  return createPost({
    wallet_address: walletAddress,
    account_id: accountId,
    content: '',
    feed_type: 'main',
    post_type: 'repost',
    quoted_post_id: postId,
  });
}

/** Remove the caller's published repost of `postId`. Returns false if none exists. */
export async function undoRepost(postId: string, walletAddress: string): Promise<boolean> {
  const wallet = walletAddress.toLowerCase();
  const { data, error } = await supabase
    .from('posts')
    .select('id')
    .eq('wallet_address', wallet)
    .eq('quoted_post_id', postId)
    .eq('post_type', 'repost')
    .eq('status', 'published')
    .limit(1);
  if (error || !data || data.length === 0) return false;
  await deletePost(data[0].id, walletAddress);
  return true;
}

/** Which of `postIds` (ORIGINAL ids) has this wallet already reposted? */
export async function getUserRepostedPostIds(
  postIds: string[],
  walletAddress: string,
): Promise<Set<string>> {
  if (postIds.length === 0) return new Set();
  const { data, error } = await supabase
    .from('posts')
    .select('quoted_post_id')
    .eq('wallet_address', walletAddress.toLowerCase())
    .eq('post_type', 'repost')
    .eq('status', 'published')
    .in('quoted_post_id', postIds);
  if (error || !data) return new Set();
  return new Set(data.map((r: any) => r.quoted_post_id).filter(Boolean));
}

// ─── Likes ──────────────────────────────────────────────────

/**
 * Toggle like on a post. Returns true if now liked, false if unliked.
 */
export async function togglePostLike(postId: string, walletAddress: string): Promise<boolean> {
  // Check if already liked
  const { data: existing } = await supabase
    .from('post_likes')
    .select('id')
    .eq('post_id', postId)
    .eq('wallet_address', walletAddress)
    .maybeSingle();

  if (existing) {
    // Unlike
    await supabase.from('post_likes').delete().eq('id', existing.id);
    void import('./nostr/publish').then(({ publishUnlike }) => publishUnlike(postId)).catch(() => {});
    // Decrement count
    const { data: post } = await supabase
      .from('posts')
      .select('likes_count')
      .eq('id', postId)
      .single();
    if (post) {
      await supabase
        .from('posts')
        .update({ likes_count: Math.max(0, (post.likes_count || 0) - 1) })
        .eq('id', postId);
    }
    return false;
  } else {
    // Like
    await supabase.from('post_likes').insert({ post_id: postId, wallet_address: walletAddress });
    // Mirror as a NIP-25 reaction; fire-and-forget like the post mirror.
    void import('./nostr/publish').then(({ publishLike }) => publishLike(postId)).catch(() => {});
    // Increment count
    const { data: post } = await supabase
      .from('posts')
      .select('likes_count')
      .eq('id', postId)
      .single();
    if (post) {
      await supabase
        .from('posts')
        .update({ likes_count: (post.likes_count || 0) + 1 })
        .eq('id', postId);
    }
    return true;
  }
}

/**
 * Batch check which posts the user has liked
 */
export async function getUserLikedPostIds(
  postIds: string[],
  walletAddress: string
): Promise<Set<string>> {
  if (postIds.length === 0 || !walletAddress) return new Set();

  const { data, error } = await supabase
    .from('post_likes')
    .select('post_id')
    .in('post_id', postIds)
    .eq('wallet_address', walletAddress);

  if (error) {
    console.error('Error checking liked posts:', error);
    return new Set();
  }

  return new Set(data.map((d) => d.post_id));
}

/** A person who liked a post (display name resolved — never a raw wallet). */
export type PostLiker = {
  wallet_address: string;
  username: string | null;
  display_name: string | null;
  profile_picture_url: string | null;
};

async function fetchPostLikers(postId: string, limit: number): Promise<PostLiker[]> {
  // Newest likers first. post_likes may predate the created_at column, so fall
  // back to an unordered query if the ordered one errors out.
  let likes:
    | { wallet_address: string }[]
    | null = null;

  const ordered = await supabase
    .from('post_likes')
    .select('wallet_address')
    .eq('post_id', postId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (ordered.error) {
    const fallback = await supabase
      .from('post_likes')
      .select('wallet_address')
      .eq('post_id', postId)
      .limit(limit);
    likes = fallback.data;
  } else {
    likes = ordered.data;
  }

  if (!likes || likes.length === 0) return [];

  const wallets = likes.map((l) => l.wallet_address.toLowerCase());

  const { data: users } = await supabase
    .from('users')
    .select('wallet_address, username, display_name, profile_picture_url')
    .in('wallet_address', wallets);

  const userMap = new Map(
    (users ?? []).map((u) => [u.wallet_address.toLowerCase(), u])
  );

  return likes.map((l) => {
    const user = userMap.get(l.wallet_address.toLowerCase());
    // display_name → username, mirroring the like-notification fallback.
    const resolved =
      user?.display_name?.trim() || user?.username?.trim() || null;
    return {
      wallet_address: l.wallet_address,
      username: user?.username ?? null,
      display_name: resolved,
      profile_picture_url: user?.profile_picture_url ?? null,
    };
  });
}

/** Top likers for the avatar facepile on the post detail screen. */
export async function getPostLikers(postId: string, limit = 5): Promise<PostLiker[]> {
  return fetchPostLikers(postId, limit);
}

/** All likers for the dedicated "who liked this" list screen. */
export async function listPostLikers(postId: string): Promise<PostLiker[]> {
  return fetchPostLikers(postId, 500);
}

// ─── Comments ───────────────────────────────────────────────

/**
 * Fetch paginated comments for a post
 */
export async function fetchPostComments(
  postId: string,
  page: number,
  pageSize: number = 20,
  walletAddress?: string
): Promise<{ data: PostCommentRecord[]; hasMore: boolean }> {
  const from = page * pageSize;
  const to = from + pageSize - 1;

  const { data, error } = await supabase
    .from('post_comments')
    .select(`
      *,
      author:users!post_comments_wallet_address_fkey(
        wallet_address, username, profile_picture_url, is_verified_citizen, equipped_frame_asset_url
      ),
      account:accounts(id, account_type, name, avatar_url),
      sticker:lootbox_rewards!sticker_reward_id(id, type, name, asset_url)
    `)
    .eq('post_id', postId)
    .eq('status', 'published')
    .is('parent_comment_id', null) // top-level only — replies load on demand
    .order('created_at', { ascending: true })
    .range(from, to);

  if (error) {
    console.error('Error fetching comments:', error);
    return { data: [], hasMore: false };
  }

  const comments = await hydrateCommentLikes(
    (data as PostCommentRecord[]).map(mergeAccountIntoAuthor),
    walletAddress
  );

  return {
    data: comments,
    hasMore: data.length === pageSize,
  };
}

/**
 * Fetch the replies of a single top-level comment (single-level threads).
 */
export async function fetchCommentReplies(
  parentCommentId: string,
  walletAddress?: string
): Promise<PostCommentRecord[]> {
  const { data, error } = await supabase
    .from('post_comments')
    .select(`
      *,
      author:users!post_comments_wallet_address_fkey(
        wallet_address, username, profile_picture_url, is_verified_citizen, equipped_frame_asset_url
      ),
      account:accounts(id, account_type, name, avatar_url),
      sticker:lootbox_rewards!sticker_reward_id(id, type, name, asset_url)
    `)
    .eq('parent_comment_id', parentCommentId)
    .eq('status', 'published')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Error fetching replies:', error);
    return [];
  }

  return hydrateCommentLikes(
    (data as PostCommentRecord[]).map(mergeAccountIntoAuthor),
    walletAddress
  );
}

/** Set `liked_by_me` on a batch of comments for the given viewer. */
async function hydrateCommentLikes(
  comments: PostCommentRecord[],
  walletAddress?: string
): Promise<PostCommentRecord[]> {
  if (!walletAddress || comments.length === 0) return comments;
  const likedIds = await getUserLikedCommentIds(
    comments.map((c) => c.id),
    walletAddress
  );
  return comments.map((c) => ({ ...c, liked_by_me: likedIds.has(c.id) }));
}

/**
 * Create a comment on a post
 */
export async function createComment(input: CreateCommentInput): Promise<PostCommentRecord | null> {
  const { data, error } = await supabase
    .from('post_comments')
    .insert({
      post_id: input.post_id,
      wallet_address: input.wallet_address,
      account_id: input.account_id || null,
      content: input.content,
      media_urls: input.media_urls || [],
      video_url: input.video_url || null,
      sticker_reward_id: input.sticker_reward_id || null,
      parent_comment_id: input.parent_comment_id || null,
    })
    .select(`
      *,
      author:users!post_comments_wallet_address_fkey(
        wallet_address, username, profile_picture_url, is_verified_citizen, equipped_frame_asset_url
      ),
      account:accounts(id, account_type, name, avatar_url),
      sticker:lootbox_rewards!sticker_reward_id(id, type, name, asset_url)
    `)
    .single();

  if (error) {
    console.error('Error creating comment:', error);
    return null;
  }

  // Mirror top-level comments on mirrored posts as NIP-10 replies. Replies to
  // replies stay app-only for now — threading depth needs its own design.
  if (data && !input.parent_comment_id) {
    void import('./nostr/publish')
      .then(({ publishComment }) => publishComment(data.id, input.post_id, input.content))
      .catch(() => {});
  }

  // posts.comments_count / parent reply_count are maintained by the
  // trg_post_comment_counts DB trigger — no client-side increment needed.
  return mergeAccountIntoAuthor(data as PostCommentRecord);
}

/**
 * Hard-delete a comment owned by the given wallet via the SECURITY DEFINER RPC
 * `delete_owned_post_comment`. The RPC also decrements the parent post's
 * comments_count atomically.
 *
 * The `postId` arg is kept for backwards compatibility with callers — the RPC
 * derives it from the comment row.
 */
export async function deleteComment(
  commentId: string,
  _postId: string,
  walletAddress: string,
): Promise<void> {
  const { error } = await supabase.rpc('delete_owned_post_comment', {
    p_comment_id: commentId,
    p_wallet: walletAddress,
  });

  if (error) {
    console.error('[deleteComment] rpc error', error);
    throw error;
  }
}

/**
 * Update a comment's content
 */
export async function updateComment(
  commentId: string,
  content: string
): Promise<PostCommentRecord | null> {
  const { data, error } = await supabase
    .from('post_comments')
    .update({ content, edited_at: new Date().toISOString() })
    .eq('id', commentId)
    .select(`
      *,
      author:users!post_comments_wallet_address_fkey(
        wallet_address, username, profile_picture_url, is_verified_citizen, equipped_frame_asset_url
      ),
      account:accounts(id, account_type, name, avatar_url),
      sticker:lootbox_rewards!sticker_reward_id(id, type, name, asset_url)
    `)
    .single();

  if (error) {
    console.error('Error updating comment:', error);
    throw error;
  }

  return mergeAccountIntoAuthor(data as PostCommentRecord);
}

// ─── Comment likes ──────────────────────────────────────────

/**
 * Toggle like on a comment. Returns true if now liked, false if unliked.
 * The denormalized post_comments.likes_count is maintained by a DB trigger.
 */
export async function toggleCommentLike(
  commentId: string,
  walletAddress: string
): Promise<boolean> {
  const { data: existing } = await supabase
    .from('post_comment_likes')
    .select('id')
    .eq('comment_id', commentId)
    .eq('wallet_address', walletAddress)
    .maybeSingle();

  if (existing) {
    await supabase.from('post_comment_likes').delete().eq('id', existing.id);
    return false;
  }

  await supabase
    .from('post_comment_likes')
    .insert({ comment_id: commentId, wallet_address: walletAddress });
  return true;
}

/**
 * Batch check which of the given comments the user has liked.
 */
export async function getUserLikedCommentIds(
  commentIds: string[],
  walletAddress: string
): Promise<Set<string>> {
  if (commentIds.length === 0 || !walletAddress) return new Set();

  const { data, error } = await supabase
    .from('post_comment_likes')
    .select('comment_id')
    .in('comment_id', commentIds)
    .eq('wallet_address', walletAddress);

  if (error) {
    console.error('Error checking liked comments:', error);
    return new Set();
  }

  return new Set(data.map((d) => d.comment_id));
}

// ─── Polls ──────────────────────────────────────────────────

/**
 * Create a poll for a post
 */
export async function createPoll(input: CreatePollInput): Promise<void> {
  const { error } = await supabase.from('post_polls').insert({
    post_id: input.post_id,
    poll_type: input.poll_type,
    options: input.options,
    expires_at: input.expires_at,
  });

  if (error) {
    console.error('Error creating poll:', error);
    throw error;
  }
}

/**
 * Submit a vote on a poll
 */
export async function submitPollVote(
  pollId: string,
  walletAddress: string,
  selectedOptions: number[]
): Promise<void> {
  const { error } = await supabase.from('poll_votes').insert({
    poll_id: pollId,
    wallet_address: walletAddress,
    selected_options: selectedOptions,
  });

  if (error) {
    console.error('Error submitting poll vote:', error);
    throw error;
  }
}

/**
 * Fetch all votes for a poll
 */
export async function fetchPollVotes(pollId: string): Promise<PollVoteRecord[]> {
  const { data, error } = await supabase
    .from('poll_votes')
    .select('*')
    .eq('poll_id', pollId);

  if (error) {
    console.error('Error fetching poll votes:', error);
    return [];
  }

  return data as PollVoteRecord[];
}

/**
 * Check if user has voted on a poll
 */
export async function getUserPollVote(
  pollId: string,
  walletAddress: string
): Promise<number[] | null> {
  const { data } = await supabase
    .from('poll_votes')
    .select('selected_options')
    .eq('poll_id', pollId)
    .eq('wallet_address', walletAddress)
    .maybeSingle();

  return data?.selected_options || null;
}

// ─── Links ──────────────────────────────────────────────────

/**
 * Create a link preview for a post
 */
export async function createPostLink(input: CreatePostLinkInput): Promise<void> {
  const { error } = await supabase.from('post_links').insert({
    post_id: input.post_id,
    url: input.url,
    og_title: input.og_title || null,
    og_description: input.og_description || null,
    og_image: input.og_image || null,
    og_site_name: input.og_site_name || null,
  });

  if (error) {
    console.error('Error creating post link:', error);
    throw error;
  }
}

// ─── Service Alerts ─────────────────────────────────────────

/**
 * Fetch active service alerts ordered by severity
 */
export async function fetchActiveServiceAlerts(): Promise<ServiceAlertRecord[]> {
  const { data, error } = await supabase
    .from('service_alerts')
    .select('*')
    .eq('status', 'active')
    .order('is_pinned', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching service alerts:', error);
    return [];
  }

  // Sort by severity client-side (critical > warning > info)
  const severityOrder: Record<string, number> = { critical: 0, warning: 1, info: 2 };
  return (data as ServiceAlertRecord[]).sort(
    (a, b) => (severityOrder[a.severity] || 2) - (severityOrder[b.severity] || 2)
  );
}

// ─── Reports ────────────────────────────────────────────────

export class DuplicateReportError extends Error {
  constructor() {
    super('DUPLICATE_REPORT');
    this.name = 'DuplicateReportError';
  }
}

/**
 * Report a post. A user may only report a given post once — the unique index
 * `post_reports_unique_reporter` (added in 20260523_posting_rules) raises a
 * 23505 unique_violation that this function turns into `DuplicateReportError`.
 */
export async function reportPost(
  postId: string,
  reporterWalletAddress: string,
  reason: string
): Promise<void> {
  const { error } = await supabase.from('post_reports').insert({
    post_id: postId,
    reporter_wallet_address: reporterWalletAddress,
    reason,
  });

  if (error) {
    if (error.code === '23505') {
      throw new DuplicateReportError();
    }
    console.error('Error reporting post:', error);
    throw error;
  }
}

// ─── Upcoming Events for Feed ───────────────────────────────

/**
 * Fetch upcoming approved events for feed injection (next 7 days)
 */
export async function fetchUpcomingEventsForFeed(limit: number = 5): Promise<any[]> {
  const today = new Date().toISOString().split('T')[0];
  const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('status', 'approved')
    .gte('date', today)
    .lte('date', nextWeek)
    .order('date', { ascending: true })
    .limit(limit);

  if (error) {
    console.error('Error fetching upcoming events:', error);
    return [];
  }

  return data || [];
}

// ─── Events for an Org Account ──────────────────────────────

/**
 * Fetch approved events authored by an organisation account.
 * Upcoming events first (date >= today, ascending), then past (date < today, descending).
 */
export async function fetchEventsByAccount(accountId: string, limit: number = 20): Promise<any[]> {
  const today = new Date().toISOString().split('T')[0];

  const [upcoming, past] = await Promise.all([
    supabase
      .from('events')
      .select('*, account:accounts(id, name, avatar_url)')
      .eq('status', 'approved')
      .eq('account_id', accountId)
      .gte('date', today)
      .order('date', { ascending: true })
      .limit(limit),
    supabase
      .from('events')
      .select('*, account:accounts(id, name, avatar_url)')
      .eq('status', 'approved')
      .eq('account_id', accountId)
      .lt('date', today)
      .order('date', { ascending: false })
      .limit(limit),
  ]);

  if (upcoming.error) {
    console.error('Error fetching upcoming account events:', upcoming.error);
  }
  if (past.error) {
    console.error('Error fetching past account events:', past.error);
  }

  return [...(upcoming.data ?? []), ...(past.data ?? [])];
}

// ─── This Week's Events for Story Bar ───────────────────────

/**
 * Fetch approved events from today through end of this week (Sunday),
 * with account data joined for the story bar avatar.
 */
export async function fetchThisWeekEvents(): Promise<any[]> {
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];

  // End of this ISO week: next Sunday (day 0) or this Sunday
  const endOfWeek = new Date(today);
  const daysUntilSunday = (7 - today.getDay()) % 7 || 7;
  endOfWeek.setDate(today.getDate() + daysUntilSunday);
  const endOfWeekStr = endOfWeek.toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('events')
    .select('*, account:accounts(id, name, avatar_url, account_type)')
    .eq('status', 'approved')
    .gte('date', todayStr)
    .lte('date', endOfWeekStr)
    .order('date', { ascending: true })
    .limit(10);

  if (error) {
    console.error('Error fetching this week events:', error);
    return [];
  }

  const events = (data ?? []) as any[];
  await resolveEventAuthors(events);
  return events;
}

/**
 * Mutates the given event rows in place, attaching a normalized `author`
 * ({ name, avatarUrl }) that is safe to display — NEVER a wallet address.
 *
 * - Organisation accounts: use the account's own name + avatar.
 * - Personal (citizen) accounts: the `accounts` row is unreliable (its name
 *   can be a truncated wallet and its avatar goes stale), so resolve the
 *   owner's `users` row (username/display_name + profile_picture_url), which
 *   is the source of truth — same logic PostAuthorRow uses for feed posts.
 *
 * Uses two simple queries rather than a chained `!inner` embed, which is
 * flaky in PostgREST (see note in supabase-roebel-card-partners.ts).
 */
async function resolveEventAuthors(events: any[]): Promise<void> {
  const isWalletLike = (s?: string | null) =>
    !!s && /^0x[0-9a-fA-F]{4,}/.test(s.trim());

  // Personal account ids that need owner → user resolution.
  const personalAccountIds = Array.from(
    new Set(
      events
        .filter((e) => e.account?.account_type === 'personal' && e.account?.id)
        .map((e) => e.account.id as string),
    ),
  );

  // accountId → owner user record (username/display_name/avatar).
  const userByAccountId = new Map<
    string,
    { username: string | null; display_name: string | null; profile_picture_url: string | null }
  >();

  if (personalAccountIds.length > 0) {
    const { data: owners } = await supabase
      .from('account_owners' as any)
      .select('account_id, wallet_address')
      .in('account_id', personalAccountIds);

    const ownerRows = (owners ?? []) as {
      account_id: string;
      wallet_address: string;
    }[];
    const wallets = Array.from(
      new Set(ownerRows.map((r) => r.wallet_address.toLowerCase())),
    );

    if (wallets.length > 0) {
      const { data: users } = await supabase
        .from('users')
        .select('wallet_address, username, display_name, profile_picture_url')
        .in('wallet_address', wallets);

      const userByWallet = new Map(
        ((users ?? []) as any[]).map((u) => [
          (u.wallet_address as string).toLowerCase(),
          u,
        ]),
      );

      for (const row of ownerRows) {
        const u = userByWallet.get(row.wallet_address.toLowerCase());
        if (u && !userByAccountId.has(row.account_id)) {
          userByAccountId.set(row.account_id, u);
        }
      }
    }
  }

  for (const event of events) {
    const acc = event.account;
    let name: string | undefined;
    let avatarUrl: string | null = null;

    if (acc?.account_type === 'organisation') {
      name = acc.name ?? undefined;
      avatarUrl = acc.avatar_url ?? null;
    } else if (acc?.id && userByAccountId.has(acc.id)) {
      const u = userByAccountId.get(acc.id)!;
      name = u.username || u.display_name || undefined;
      avatarUrl = u.profile_picture_url ?? null;
    }

    // Never expose a wallet-like string as the display name.
    if (isWalletLike(name)) name = undefined;
    if (!name && !isWalletLike(event.organizer_name)) {
      name = event.organizer_name || undefined;
    }

    event.author = { name: name || 'Veranstalter', avatarUrl };
  }
}
