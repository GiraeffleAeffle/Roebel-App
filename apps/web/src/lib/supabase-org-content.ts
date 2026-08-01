/**
 * Account-scoped content for the public org page: posts (in PostWithEngagement
 * shape so <PostCard> can render them), events, and marketplace listings.
 *
 * Record mode: there is no Supabase `accounts` UUID to key on, so every
 * caller here (OrgDetailClient, AccountPostsList) passes the org's SLUG in
 * the `accountId` parameter instead — `getOrgBySlug` resolves it back to the
 * org's signing pubkey, which is the actual join key events/posts/listings
 * carry on the wire (see `EventRow.pubkey` / `RecordPost.author_pubkey` /
 * `ListingRow.pubkey` doc comments in @netizen-labs/record-client).
 */

import { supabase } from "./supabase";
import type {
  PostWithEngagement,
  Post,
  PostCategory,
  PostType,
  FeedType,
  PostLink,
} from "@/types/post";
import { hasSupabase, recordClient } from "@/lib/record";
import {
  getOrgBySlug,
  listEvents,
  listListings,
  listPosts,
  RecordUnavailableError,
} from "@netizen-labs/record-client";

export interface EventRecord {
  id: string;
  account_id: string | null;
  title: string;
  date: string | null;
  time: string | null;
  location: string | null;
  image_url: string | null;
  status: string | null;
}

export interface MarketplaceListingRecord {
  id: string;
  account_id: string | null;
  title: string;
  description: string | null;
  listing_type: "product" | "service";
  price: number | null;
  price_type: string;
  media_urls: string[];
  status: string;
  created_at: string;
}

/**
 * Fetch published posts for an account, enriched to PostWithEngagement so the
 * existing <PostCard> component can render them. viewerWallet (lowercased)
 * drives like/report flags.
 */
export async function fetchAccountPosts(
  accountId: string,
  opts: { pageSize?: number; viewerWallet?: string | null } = {}
): Promise<PostWithEngagement[]> {
  const pageSize = opts.pageSize ?? 30;

  if (!hasSupabase) {
    try {
      const org = await getOrgBySlug(recordClient, accountId);
      if (!org) return [];
      const posts = await listPosts(recordClient, { limit: 200 });
      return posts
        .filter((p) => p.author_pubkey === org.pubkey)
        .slice(0, pageSize)
        .map((p) => ({
          id: p.id,
          wallet_address: p.is_agent ? "mecky_bot" : "",
          account_id: null,
          content: p.content,
          media_urls: p.media_urls,
          video_url: null,
          category: "generell" as PostCategory,
          status: "published" as Post["status"],
          likes_count: p.likes_count,
          comments_count: p.comments_count,
          created_at: p.created_at,
          updated_at: p.created_at,
          post_type: "user" as PostType,
          feed_type: "main" as FeedType,
          linked_event_id: null,
          linked_experience_id: null,
          author_username: p.author_name ?? "Unbekannt",
          author_profile_picture_url: p.author_avatar,
          author_neighborhood: null,
          author_account_name: null,
          author_account_avatar_url: null,
          author_account_type: null,
          links: [],
          is_liked_by_viewer: false,
          is_reported_by_viewer: false,
          poll: null,
          linked_event: null,
        }));
    } catch (error) {
      if (error instanceof RecordUnavailableError) return [];
      throw error;
    }
  }

  const viewer = opts.viewerWallet?.toLowerCase() ?? null;

  const { data: posts, error } = await supabase
    .from("posts")
    .select("*")
    .eq("account_id", accountId)
    .eq("status", "published")
    .order("created_at", { ascending: false })
    .limit(pageSize);

  if (error || !posts || posts.length === 0) {
    if (error) console.error("fetchAccountPosts error:", error);
    return [];
  }

  const rows = posts as Record<string, unknown>[];
  const postIds = rows.map((p) => p.id as string);
  const addresses = [...new Set(rows.map((p) => p.wallet_address as string))];

  const [authorsRes, linksRes, accountRes, likesRes] = await Promise.all([
    supabase
      .from("users")
      .select("wallet_address, username, profile_picture_url, neighborhood")
      .in("wallet_address", addresses),
    supabase.from("post_links").select("*").in("post_id", postIds),
    supabase
      .from("accounts")
      .select("id, name, avatar_url, account_type")
      .eq("id", accountId)
      .maybeSingle(),
    viewer
      ? supabase
          .from("post_likes")
          .select("post_id")
          .eq("wallet_address", viewer)
          .in("post_id", postIds)
      : Promise.resolve({ data: [] as { post_id: string }[] }),
  ]);

  const authorMap = new Map<string, Record<string, unknown>>();
  for (const a of (authorsRes.data as Record<string, unknown>[]) ?? []) {
    authorMap.set(a.wallet_address as string, a);
  }

  const linksMap = new Map<string, PostLink[]>();
  for (const link of (linksRes.data as Record<string, unknown>[]) ?? []) {
    const pid = link.post_id as string;
    if (!linksMap.has(pid)) linksMap.set(pid, []);
    linksMap.get(pid)!.push({
      id: link.id as string,
      post_id: pid,
      url: link.url as string,
      og_title: (link.og_title as string) ?? null,
      og_description: (link.og_description as string) ?? null,
      og_image: (link.og_image as string) ?? null,
      og_site_name: (link.og_site_name as string) ?? null,
    });
  }

  const account = accountRes.data as Record<string, unknown> | null;
  const likedSet = new Set<string>(
    ((likesRes.data as { post_id: string }[]) ?? []).map((l) => l.post_id)
  );

  return rows.map((row) => {
    const author = authorMap.get(row.wallet_address as string);
    return {
      id: row.id as string,
      wallet_address: row.wallet_address as string,
      account_id: (row.account_id as string) || null,
      content: row.content as string,
      media_urls: (row.media_urls as string[]) || [],
      video_url: (row.video_url as string) || null,
      category: ((row.category as string) || "generell") as PostCategory,
      status: row.status as Post["status"],
      likes_count: (row.likes_count as number) || 0,
      comments_count: (row.comments_count as number) || 0,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
      post_type: ((row.post_type as string) || "user") as PostType,
      feed_type: ((row.feed_type as string) || "main") as FeedType,
      linked_event_id: (row.linked_event_id as string) || null,
      linked_experience_id: (row.linked_experience_id as string) || null,
      author_username: (author?.username as string) || null,
      author_profile_picture_url:
        (author?.profile_picture_url as string) || null,
      author_neighborhood: (author?.neighborhood as string) || null,
      author_account_name: (account?.name as string) || null,
      author_account_avatar_url: (account?.avatar_url as string) || null,
      author_account_type: (account?.account_type as string) || null,
      links: linksMap.get(row.id as string) || [],
      is_liked_by_viewer: likedSet.has(row.id as string),
      is_reported_by_viewer: false,
      poll: null,
      linked_event: null,
    };
  });
}

export async function fetchEventsByAccount(
  accountId: string,
  limit = 12
): Promise<EventRecord[]> {
  if (!hasSupabase) {
    try {
      const org = await getOrgBySlug(recordClient, accountId);
      if (!org) return [];
      const events = await listEvents(recordClient, { limit: 200 });
      return events
        .filter((e) => e.pubkey === org.pubkey)
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(0, limit)
        .map((e) => ({
          id: e.id,
          account_id: null,
          title: e.title,
          date: e.date,
          time: e.time,
          location: e.location,
          image_url: e.image_url,
          status: "approved",
        }));
    } catch (error) {
      if (error instanceof RecordUnavailableError) return [];
      throw error;
    }
  }

  const { data, error } = await supabase
    .from("events")
    .select("id, account_id, title, date, time, location, image_url, status")
    .eq("account_id", accountId)
    .eq("status", "approved")
    .order("date", { ascending: true })
    .limit(limit);
  if (error) {
    console.error("fetchEventsByAccount error:", error);
    return [];
  }
  return (data as EventRecord[]) ?? [];
}

export async function fetchOrgListings(
  accountId: string
): Promise<MarketplaceListingRecord[]> {
  if (!hasSupabase) {
    try {
      const org = await getOrgBySlug(recordClient, accountId);
      if (!org) return [];
      const listings = await listListings(recordClient, { limit: 200 });
      return listings
        .filter((l) => l.pubkey === org.pubkey)
        .map((l) => ({
          id: l.id,
          account_id: null,
          title: l.title,
          description: l.description,
          listing_type: l.listing_type === "service" ? "service" : "product",
          // ListingRow.price is a free-text string (mirrors what the
          // listing form submitted) — Number() on a non-numeric price would
          // silently produce NaN, which formatListingPrice-style renderers
          // treat as "no price"; that is the same degrade the Supabase
          // branch's own `Number(row.price) || 0` gets for a malformed value.
          price: l.price !== null && Number.isFinite(Number(l.price)) ? Number(l.price) : null,
          // price_type (fixed/negotiable/free) has no record equivalent —
          // listingToSpec (mappers.ts) never publishes it. "fixed" is the
          // most common real value and, unlike "free"/"negotiable", never
          // changes the displayed price's meaning when it is actually wrong.
          price_type: "fixed",
          media_urls: l.media_urls,
          status: "active",
          created_at: "",
        }));
    } catch (error) {
      if (error instanceof RecordUnavailableError) return [];
      throw error;
    }
  }

  const { data, error } = await supabase
    .from("marketplace_listings")
    .select(
      "id, account_id, title, description, listing_type, price, price_type, media_urls, status, created_at"
    )
    .eq("account_id", accountId)
    .eq("status", "active")
    .order("created_at", { ascending: false });
  if (error) {
    console.error("fetchOrgListings error:", error);
    return [];
  }
  return (data as MarketplaceListingRecord[]) ?? [];
}
