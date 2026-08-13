"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import { useActiveAccount } from "thirdweb/react";
import { createClient } from "@/lib/supabase/client";
import { getPostsForFeed } from "@/app/actions/posts";
import { PostComposer } from "@/components/app/PostComposer";
import { FeedFilters } from "@/components/app/FeedFilters";
import { FeedCard } from "@/components/app/FeedCard";
import { PostCard } from "@/components/app/PostCard";
import { FeedExperienceCard } from "@/components/app/FeedExperienceCard";
import { HorizontalRow } from "@/components/app/HorizontalRow";
import { AlertCard } from "@/components/app/AlertCard";
import { ContextBar } from "@/components/app/ContextBar";
import { StadtFeed } from "@/components/app/StadtFeed";
import { AppFeed } from "@/components/app/AppFeed";
import { StadtstackStagingFeed } from "@/components/app/StadtstackStagingFeed";
import { FeedProposalHero } from "@/components/proposals/FeedProposalHero";
import { getProposals } from "@/lib/supabase";
import { ProposalState, type Proposal } from "@/lib/proposal-types";
import { useUserProfile } from "@/hooks/useUserProfile";
import type { ServiceAlert } from "@/app/actions/alerts";
import { ListingCard } from "@/components/marketplace/ListingCard";
import { BusinessCard } from "@/components/business/BusinessCard";
import {
  ShoppingBag,
  Store,
  UtensilsCrossed,
  Film,
  Newspaper,
  ClipboardList,
  Landmark,
  Home,
  Sparkles,
} from "lucide-react";
import type { ListingWithSeller } from "@/types/marketplace";
import type { Business } from "@/types/business";
import type { PostWithEngagement } from "@/types/post";
import { resolveStadtstackStagingLab } from "@/lib/stadtstack/staging-lab";

interface FeedItem {
  type: "event" | "news" | "ad";
  id: string;
  title: string;
  description?: string;
  imageUrl?: string | null;
  date: string;
  category?: string;
  slug?: string;
  dealType?: string;
  dealValue?: string | null;
  businessName?: string;
  businessSlug?: string;
  businessLogoUrl?: string | null;
  isBoosted?: boolean;
  mediaUrls?: string[];
}

interface Restaurant {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  logo_url: string | null;
  cover_image_url: string | null;
  address: string | null;
  status: string;
  is_featured: boolean;
}

interface Movie {
  id: string;
  title: string;
  description: string | null;
  date: string | null;
  time: string | null;
  cover_image_url: string | null;
  fsk: string | null;
  status: string;
}

// Helper to map event row to FeedItem
function mapEvent(e: Record<string, unknown>): FeedItem {
  return {
    type: "event" as const,
    id: String(e.id),
    title: String(e.title || ""),
    description: e.description ? String(e.description) : undefined,
    imageUrl: e.image_url ? String(e.image_url) : null,
    date: String(e.date || e.created_at || ""),
    category: e.category ? String(e.category) : undefined,
  };
}

interface NewsArticle {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  cover_image_url: string | null;
  author_name: string;
  category: string | null;
  published_at: string;
}

// Build interleaved feed with horizontal rows inserted at smart positions
type FeedEntry = {
  feedItem?: FeedItem;
  postItem?: PostWithEngagement;
  rowType?: "marketplace" | "businesses" | "restaurants" | "movies" | "news" | "brett";
};

function buildFeedWithRows(
  feedItems: FeedItem[],
  posts: PostWithEngagement[],
  listings: ListingWithSeller[],
  businesses: Business[],
  restaurants: Restaurant[],
  movies: Movie[],
  newsArticles: NewsArticle[],
  boardListings: ListingWithSeller[],
  activeFilter: string
): FeedEntry[] {
  const entries: FeedEntry[] = [];
  const insertRows = activeFilter === "all";

  // If posts-only filter, return just posts
  if (activeFilter === "posts") {
    return posts.map((p) => ({ postItem: p }));
  }

  // For event/news/ads-only filters, return just those feed items sorted by date desc
  if (activeFilter === "events" || activeFilter === "news" || activeFilter === "ads") {
    const sorted = [...feedItems].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );
    return sorted.map((item) => ({ feedItem: item }));
  }

  // "all" and "latest" filters: build a mixed feed with posts as backbone
  const now = new Date();

  // Separate upcoming events from other feed items (news, past events, ads)
  const upcomingEvents = feedItems
    .filter((item) => item.type === "event" && new Date(item.date) >= now)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()); // nearest future first

  const otherFeedItems = feedItems
    .filter((item) => !(item.type === "event" && new Date(item.date) >= now))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()); // newest first

  // Posts are already sorted newest-first from the API
  // Build the mixed feed: posts as backbone, events/other sprinkled in
  const mixed: FeedEntry[] = [];
  let eventIdx = 0;
  let otherIdx = 0;

  for (let i = 0; i < posts.length; i++) {
    mixed.push({ postItem: posts[i] });

    // After every 3 posts, insert an upcoming event (if available)
    if ((i + 1) % 3 === 0 && eventIdx < upcomingEvents.length) {
      mixed.push({ feedItem: upcomingEvents[eventIdx] });
      eventIdx++;
    }

    // After every 2 posts (offset from events), insert other feed items (news, past events)
    if ((i + 1) % 2 === 0 && (i + 1) % 3 !== 0 && otherIdx < otherFeedItems.length) {
      mixed.push({ feedItem: otherFeedItems[otherIdx] });
      otherIdx++;
    }
  }

  // Append remaining upcoming events
  while (eventIdx < upcomingEvents.length) {
    mixed.push({ feedItem: upcomingEvents[eventIdx] });
    eventIdx++;
  }

  // Append remaining other feed items
  while (otherIdx < otherFeedItems.length) {
    mixed.push({ feedItem: otherFeedItems[otherIdx] });
    otherIdx++;
  }

  // If no posts exist, just use feed items sorted by date
  if (posts.length === 0) {
    const sorted = [...feedItems].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );
    for (const item of sorted) {
      mixed.push({ feedItem: item });
    }
  }

  // Determine which horizontal rows to insert
  const rows: FeedEntry["rowType"][] = [];
  if (insertRows) {
    if (newsArticles.length > 0) rows.push("news");
    if (listings.length > 0) rows.push("marketplace");
    if (boardListings.length > 0) rows.push("brett");
    if (movies.length > 0) rows.push("movies");
    if (businesses.length > 0) rows.push("businesses");
    if (restaurants.length > 0) rows.push("restaurants");
  }

  // Insert rows after positions 2, 5, 8, 11, 14, 17
  let rowIndex = 0;
  const rowPositions = [2, 5, 8, 11, 14, 17];

  for (let i = 0; i < mixed.length; i++) {
    entries.push(mixed[i]);

    if (
      rowIndex < rows.length &&
      rowIndex < rowPositions.length &&
      i === rowPositions[rowIndex] - 1
    ) {
      entries.push({ rowType: rows[rowIndex] });
      rowIndex++;
    }
  }

  // Append remaining rows if feed is short
  while (rowIndex < rows.length) {
    entries.push({ rowType: rows[rowIndex] });
    rowIndex++;
  }

  return entries;
}

export default function AppHomePage() {
  const stadtstackStagingLab = resolveStadtstackStagingLab(
    process.env.NEXT_PUBLIC_STADTSTACK_STAGING_LAB,
  );
  const account = useActiveAccount();
  const [activeTab, setActiveTab] = useState<"main" | "rathaus" | "app">("main");
  const [activeFilter, setActiveFilter] = useState("all");
  const [activeCategory, setActiveCategory] = useState("all");
  const [feedItems, setFeedItems] = useState<FeedItem[]>([]);
  const [posts, setPosts] = useState<PostWithEngagement[]>([]);
  const [listings, setListings] = useState<ListingWithSeller[]>([]);
  const [boardListings, setBoardListings] = useState<ListingWithSeller[]>([]);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [movies, setMovies] = useState<Movie[]>([]);
  const [newsArticles, setNewsArticles] = useState<NewsArticle[]>([]);
  const [alerts, setAlerts] = useState<ServiceAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  // Open-proposal hero — citizen-gated, mirrors the Expo home feed.
  const { user } = useUserProfile();
  const isCitizen =
    user?.tier === "citizen" || Boolean(user?.is_verified_citizen);
  const [featuredProposal, setFeaturedProposal] = useState<Proposal | null>(null);

  useEffect(() => {
    if (!isCitizen) {
      setFeaturedProposal(null);
      return;
    }
    let cancelled = false;
    getProposals({ orderBy: "created_at", orderDirection: "desc", limit: 10 })
      .then((res) => {
        if (cancelled) return;
        const list = res.data?.proposals ?? [];
        const active = list.find((p) => p.state === ProposalState.Active);
        setFeaturedProposal(active ?? list[0] ?? null);
      })
      .catch(() => {
        if (!cancelled) setFeaturedProposal(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isCitizen, refreshKey]);

  const handleFilterChange = useCallback((filter: string) => {
    setActiveFilter(filter);
    if (filter !== "posts") setActiveCategory("all");
  }, []);

  const handlePostCreated = useCallback(() => {
    setRefreshKey((prev) => prev + 1);
  }, []);

  const handlePostDeleted = useCallback(() => {
    setRefreshKey((prev) => prev + 1);
  }, []);

  useEffect(() => {
    if (activeTab !== "main") {
      // StadtFeed and AppFeed manage their own data fetching
      return;
    }
    async function fetchFeed() {
      setLoading(true);
      const supabase = createClient();
      const now = new Date();
      const today = now.toISOString().split("T")[0];

      // Always fetch active alerts (shown on all filters)
      const { data: alertsData } = await supabase
        .from("service_alerts")
        .select("*")
        .eq("status", "active")
        .order("severity", { ascending: true })
        .order("starts_at", { ascending: false })
        .limit(5);
      setAlerts((alertsData || []) as ServiceAlert[]);

      // Handle "brett" filter — show board listings as grid
      if (activeFilter === "brett") {
        const { data: brettData } = await supabase
          .from("marketplace_listings")
          .select(
            "*, users!marketplace_listings_seller_wallet_address_fkey(username, profile_picture_url, neighborhood)"
          )
          .eq("status", "active")
          .eq("listing_type", "schwarzes_brett")
          .order("created_at", { ascending: false })
          .limit(50);

        if (brettData) {
          setBoardListings(
            brettData.map((l: Record<string, unknown>) => {
              const user = l.users as Record<string, unknown> | null;
              return {
                ...l,
                seller_username: user?.username ? String(user.username) : null,
                seller_profile_picture_url: user?.profile_picture_url ? String(user.profile_picture_url) : null,
                seller_neighborhood: user?.neighborhood ? String(user.neighborhood) : null,
              } as ListingWithSeller;
            })
          );
        }
        setFeedItems([]);
        setPosts([]);
        setLoading(false);
        return;
      }

      const showEvents =
        activeFilter === "all" ||
        activeFilter === "events" ||
        activeFilter === "latest";
      const showNews =
        activeFilter === "all" ||
        activeFilter === "news" ||
        activeFilter === "latest";
      const showAds =
        activeFilter === "all" ||
        activeFilter === "ads" ||
        activeFilter === "latest";
      const showPosts =
        activeFilter === "all" ||
        activeFilter === "posts" ||
        activeFilter === "latest";

      const contentItems: FeedItem[] = [];
      const adItems: FeedItem[] = [];

      // Fetch events — sorted ascending so we can split upcoming/past
      if (showEvents) {
        const { data: events } = await supabase
          .from("events")
          .select("*")
          .eq("status", "approved")
          .order("date", { ascending: true })
          .limit(30);

        if (events) {
          const upcoming = events
            .filter(
              (e: Record<string, unknown>) =>
                new Date(String(e.date)) >= now
            )
            .map(mapEvent);
          const past = events
            .filter(
              (e: Record<string, unknown>) =>
                new Date(String(e.date)) < now
            )
            .reverse()
            .map(mapEvent);
          contentItems.push(...upcoming, ...past);
        }
      }

      // Fetch news — newest first
      if (showNews) {
        const { data: news } = await supabase
          .from("news_articles")
          .select("*")
          .eq("status", "published")
          .order("published_at", { ascending: false })
          .limit(20);

        if (news) {
          contentItems.push(
            ...news.map((n: Record<string, unknown>) => ({
              type: "news" as const,
              id: String(n.id),
              title: String(n.title || ""),
              description: n.excerpt
                ? String(n.excerpt)
                : n.content
                  ? String(n.content).slice(0, 200)
                  : undefined,
              imageUrl: n.cover_image ? String(n.cover_image) : null,
              date: String(n.published_at || n.created_at || ""),
              slug: n.slug ? String(n.slug) : undefined,
            }))
          );
        }
      }

      // Fetch ads for feed interleaving
      if (showAds) {
        const { data: ads } = await supabase
          .from("business_deals")
          .select(
            `*, businesses!inner (name, slug, logo_url, category, status)`
          )
          .eq("is_active", true)
          .neq("businesses.status", "rejected")
          .or(`end_date.is.null,end_date.gte.${today}`)
          .order("is_boosted", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(5);

        if (ads) {
          adItems.push(
            ...ads.map((a: Record<string, unknown>) => {
              const biz = a.businesses as Record<string, unknown>;
              const mediaUrls = (a.media_urls as string[]) || [];
              const imageUrl =
                mediaUrls[0] ||
                (a.image_url ? String(a.image_url) : null);
              return {
                type: "ad" as const,
                id: String(a.id),
                title: String(a.title || ""),
                description: a.description
                  ? String(a.description)
                  : undefined,
                imageUrl,
                date: String(a.created_at || ""),
                dealType: a.deal_type ? String(a.deal_type) : undefined,
                dealValue: a.deal_value ? String(a.deal_value) : null,
                businessName: biz.name ? String(biz.name) : undefined,
                businessSlug: biz.slug ? String(biz.slug) : undefined,
                businessLogoUrl: biz.logo_url
                  ? String(biz.logo_url)
                  : null,
                isBoosted: (a.is_boosted as boolean) || false,
                mediaUrls,
              };
            })
          );
        }
      }

      // Fetch posts (with optional category filter)
      let fetchedPosts: PostWithEngagement[] = [];
      if (showPosts) {
        const categoryFilter = activeFilter === "posts" && activeCategory !== "all" ? activeCategory : undefined;
        const postsResult = await getPostsForFeed({
          limit: 20,
          viewerWallet: account?.address,
          feedType: "main",
          category: categoryFilter,
        });
        if (postsResult.success && postsResult.data) {
          fetchedPosts = postsResult.data;
        }
      }
      setPosts(fetchedPosts);

      // Fetch horizontal row data (only on "all" filter)
      if (activeFilter === "all") {
        const [
          listingsRes,
          boardListingsRes,
          businessesRes,
          restaurantsRes,
          moviesRes,
          newsRes,
        ] = await Promise.all([
          supabase
            .from("marketplace_listings")
            .select(
              "*, users!marketplace_listings_seller_wallet_address_fkey(username, profile_picture_url, neighborhood)"
            )
            .eq("status", "active")
            .neq("listing_type", "schwarzes_brett")
            .order("created_at", { ascending: false })
            .limit(10),
          supabase
            .from("marketplace_listings")
            .select(
              "*, users!marketplace_listings_seller_wallet_address_fkey(username, profile_picture_url, neighborhood)"
            )
            .eq("status", "active")
            .eq("listing_type", "schwarzes_brett")
            .order("created_at", { ascending: false })
            .limit(10),
          supabase
            .from("businesses")
            .select("*")
            .eq("status", "published")
            .order("is_featured", { ascending: false })
            .order("created_at", { ascending: false })
            .limit(10),
          supabase
            .from("restaurants")
            .select("*")
            .in("status", ["approved", "published"])
            .order("is_featured", { ascending: false })
            .order("sort_order", { ascending: true })
            .limit(10),
          supabase
            .from("movies")
            .select("*")
            .eq("status", "published")
            .gte("date", today)
            .order("date", { ascending: true })
            .limit(10),
          supabase
            .from("news_articles")
            .select("id, title, slug, excerpt, cover_image_url: cover_image, author_name, category, published_at")
            .eq("status", "published")
            .order("published_at", { ascending: false })
            .limit(10),
        ]);

        const mapListingWithSeller = (l: Record<string, unknown>) => {
          const user = l.users as Record<string, unknown> | null;
          return {
            ...l,
            seller_username: user?.username
              ? String(user.username)
              : null,
            seller_profile_picture_url: user?.profile_picture_url
              ? String(user.profile_picture_url)
              : null,
            seller_neighborhood: user?.neighborhood
              ? String(user.neighborhood)
              : null,
          } as ListingWithSeller;
        };
        if (listingsRes.data) {
          setListings(listingsRes.data.map(mapListingWithSeller));
        }
        if (boardListingsRes.data) {
          setBoardListings(boardListingsRes.data.map(mapListingWithSeller));
        }
        if (businessesRes.data)
          setBusinesses(businessesRes.data as Business[]);
        if (restaurantsRes.data)
          setRestaurants(restaurantsRes.data as Restaurant[]);
        if (moviesRes.data) setMovies(moviesRes.data as Movie[]);
        if (newsRes.data) setNewsArticles(newsRes.data as NewsArticle[]);
      }

      // Build final feed
      if (activeFilter === "ads") {
        setFeedItems(adItems);
        setLoading(false);
        return;
      }

      // Sort: upcoming events first (nearest date), then everything else newest-first
      contentItems.sort((a, b) => {
        const dateA = new Date(a.date).getTime();
        const dateB = new Date(b.date).getTime();
        const nowMs = now.getTime();

        const aIsUpcoming = a.type === "event" && dateA >= nowMs;
        const bIsUpcoming = b.type === "event" && dateB >= nowMs;

        if (aIsUpcoming && bIsUpcoming) return dateA - dateB;
        if (aIsUpcoming && !bIsUpcoming) return -1;
        if (!aIsUpcoming && bIsUpcoming) return 1;
        return dateB - dateA;
      });

      // Interleave ads after position 2, then every 4 items
      const merged: FeedItem[] = [];
      let adIndex = 0;
      for (let i = 0; i < contentItems.length; i++) {
        merged.push(contentItems[i]);
        if (
          (i === 1 || (i > 1 && (i - 1) % 4 === 0)) &&
          adIndex < adItems.length
        ) {
          merged.push(adItems[adIndex]);
          adIndex++;
        }
      }
      while (adIndex < adItems.length) {
        merged.push(adItems[adIndex]);
        adIndex++;
      }

      setFeedItems(merged);
      setLoading(false);
    }

    fetchFeed();
  }, [activeTab, activeFilter, activeCategory, refreshKey, account?.address]);

  const feedWithRows = buildFeedWithRows(
    feedItems,
    posts,
    listings,
    businesses,
    restaurants,
    movies,
    newsArticles,
    boardListings,
    activeFilter
  );

  return (
    <div className="space-y-4">
      {/* Context bar */}
      <ContextBar />

      {/* Top tabs: Alles / Stadt / App */}
      <div className="flex gap-1 bg-card rounded-lg border border-border p-1">
        <button
          onClick={() => setActiveTab("main")}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-md text-sm font-medium transition-colors ${
            activeTab === "main"
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-accent"
          }`}
        >
          <Home className="h-4 w-4" />
          Alles
        </button>
        <button
          onClick={() => setActiveTab("rathaus")}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-md text-sm font-medium transition-colors ${
            activeTab === "rathaus"
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-accent"
          }`}
        >
          <Landmark className="h-4 w-4" />
          Stadt
        </button>
        <button
          onClick={() => setActiveTab("app")}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-md text-sm font-medium transition-colors ${
            activeTab === "app"
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-accent"
          }`}
        >
          <Sparkles className="h-4 w-4" />
          App
        </button>
      </div>

      {activeTab === "rathaus" ? (
        <StadtFeed />
      ) : activeTab === "app" ? (
        <AppFeed />
      ) : (
      <>
      <PostComposer onPostCreated={handlePostCreated} defaultFeedType="main" />
      <FeedFilters
        activeFilter={activeFilter}
        onFilterChange={handleFilterChange}
        activeCategory={activeCategory}
        onCategoryChange={setActiveCategory}
      />

      {stadtstackStagingLab && (activeFilter === "all" || activeFilter === "latest" || activeFilter === "posts") && (
        <StadtstackStagingFeed />
      )}

      {isCitizen && featuredProposal && (
        <FeedProposalHero proposal={featuredProposal} basePath="/app/proposals" />
      )}

      {loading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="bg-card rounded-lg border border-border animate-pulse h-48"
            />
          ))}
        </div>
      ) : activeFilter === "brett" ? (
        boardListings.length > 0 ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <ClipboardList className="h-5 w-5" />
                Schwarzes Brett
              </h2>
              <Link
                href="/app/marktplatz?tab=brett"
                className="text-xs text-primary hover:text-primary/80"
              >
                Alle ansehen
              </Link>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {boardListings.map((listing) => (
                <ListingCard key={listing.id} listing={listing} />
              ))}
            </div>
          </div>
        ) : (
          <div className="bg-card rounded-lg border border-border p-8 text-center">
            <ClipboardList className="h-10 w-10 text-muted-foreground mx-auto mb-2" />
            <p className="text-muted-foreground text-sm">
              Noch keine Aushänge vorhanden. Schau später nochmal vorbei!
            </p>
          </div>
        )
      ) : feedWithRows.length === 0 ? (
        <div className="bg-card rounded-lg border border-border p-8 text-center">
          <p className="text-muted-foreground text-sm">
            {activeFilter === "posts"
              ? "Noch keine Beiträge. Sei der Erste!"
              : "Keine Beiträge gefunden. Schau später nochmal vorbei!"}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {alerts.map((alert) => (
            <AlertCard key={`alert-${alert.id}`} {...alert} />
          ))}
          {feedWithRows.map((item, index) => {
            if (item.rowType === "marketplace" && listings.length > 0) {
              return (
                <HorizontalRow
                  key="row-marketplace"
                  title="Marktplatz"
                  href="/app/marktplatz"
                  icon={
                    <ShoppingBag className="h-4 w-4 text-muted-foreground" />
                  }
                >
                  {listings.map((listing) => (
                    <div
                      key={listing.id}
                      className="w-[220px] flex-shrink-0 snap-start"
                    >
                      <ListingCard listing={listing} />
                    </div>
                  ))}
                </HorizontalRow>
              );
            }

            if (item.rowType === "brett" && boardListings.length > 0) {
              return (
                <HorizontalRow
                  key="row-brett"
                  title="Schwarzes Brett"
                  href="/app/marktplatz?tab=brett"
                  icon={
                    <ClipboardList className="h-4 w-4 text-muted-foreground" />
                  }
                >
                  {boardListings.map((listing) => (
                    <div
                      key={listing.id}
                      className="w-[220px] flex-shrink-0 snap-start"
                    >
                      <ListingCard listing={listing} />
                    </div>
                  ))}
                </HorizontalRow>
              );
            }

            if (item.rowType === "news" && newsArticles.length > 0) {
              return (
                <HorizontalRow
                  key="row-news"
                  title="Neuigkeiten"
                  href="/app/news"
                  icon={
                    <Newspaper className="h-4 w-4 text-muted-foreground" />
                  }
                >
                  {newsArticles.map((article) => (
                    <Link
                      key={article.id}
                      href={`/app/news/${article.slug}`}
                      className="w-[220px] flex-shrink-0 snap-start block"
                    >
                      <div className="bg-card rounded-lg border border-border overflow-hidden hover:shadow-md transition-shadow">
                        <div className="relative h-28 overflow-hidden">
                          {article.cover_image_url ? (
                            <>
                              <Image
                                src={article.cover_image_url}
                                alt=""
                                fill
                                className="object-cover blur-xl scale-110"
                                aria-hidden="true"
                                sizes="220px"
                              />
                              <Image
                                src={article.cover_image_url}
                                alt={article.title}
                                fill
                                className="object-contain relative z-10"
                                sizes="220px"
                              />
                            </>
                          ) : (
                            <div className="flex items-center justify-center h-full bg-muted">
                              <Newspaper className="h-8 w-8 text-muted-foreground" />
                            </div>
                          )}
                        </div>
                        <div className="p-2.5">
                          {article.category && (
                            <span className="inline-block text-[10px] font-medium text-primary bg-primary/10 px-1.5 py-0.5 rounded mb-1">
                              {article.category}
                            </span>
                          )}
                          <h4 className="text-xs font-semibold text-foreground line-clamp-2">
                            {article.title}
                          </h4>
                          <p className="text-[11px] text-muted-foreground mt-1">
                            {new Date(article.published_at).toLocaleDateString(
                              "de-DE",
                              { day: "numeric", month: "short" }
                            )}
                          </p>
                        </div>
                      </div>
                    </Link>
                  ))}
                </HorizontalRow>
              );
            }

            if (item.rowType === "businesses" && businesses.length > 0) {
              return (
                <HorizontalRow
                  key="row-businesses"
                  title="Lokale Gewerbe"
                  href="/app/gewerbe"
                  icon={
                    <Store className="h-4 w-4 text-muted-foreground" />
                  }
                >
                  {businesses.map((biz) => (
                    <div
                      key={biz.id}
                      className="w-[260px] flex-shrink-0 snap-start"
                    >
                      <BusinessCard business={biz} />
                    </div>
                  ))}
                </HorizontalRow>
              );
            }

            if (item.rowType === "restaurants" && restaurants.length > 0) {
              return (
                <HorizontalRow
                  key="row-restaurants"
                  title="Speisekarten"
                  href="/app/gewerbe"
                  linkLabel="Alle Restaurants"
                  icon={
                    <UtensilsCrossed className="h-4 w-4 text-muted-foreground" />
                  }
                >
                  {restaurants.map((r) => (
                    <Link
                      key={r.id}
                      href={`/app/gewerbe/${r.slug}`}
                      className="w-[180px] flex-shrink-0 snap-start block"
                    >
                      <div className="bg-card rounded-lg border border-border overflow-hidden hover:shadow-md transition-shadow">
                        <div className="relative h-24 overflow-hidden">
                          {r.cover_image_url ? (
                            <>
                              <Image
                                src={r.cover_image_url}
                                alt=""
                                fill
                                className="object-cover blur-xl scale-110"
                                aria-hidden="true"
                                sizes="180px"
                              />
                              <Image
                                src={r.cover_image_url}
                                alt={r.name}
                                fill
                                className="object-contain relative z-10"
                                sizes="180px"
                              />
                            </>
                          ) : (
                            <div className="flex items-center justify-center h-full bg-muted">
                              <UtensilsCrossed className="h-8 w-8 text-muted-foreground" />
                            </div>
                          )}
                        </div>
                        <div className="p-2.5">
                          <div className="flex items-center gap-2">
                            {r.logo_url && (
                              <Image
                                src={r.logo_url}
                                alt=""
                                width={20}
                                height={20}
                                className="rounded-full object-cover"
                              />
                            )}
                            <h4 className="text-xs font-semibold text-foreground truncate">
                              {r.name}
                            </h4>
                          </div>
                          {r.address && (
                            <p className="text-xs text-muted-foreground mt-1 truncate">
                              {r.address}
                            </p>
                          )}
                        </div>
                      </div>
                    </Link>
                  ))}
                </HorizontalRow>
              );
            }

            if (item.rowType === "movies" && movies.length > 0) {
              return (
                <HorizontalRow
                  key="row-movies"
                  title="Kino"
                  icon={<Film className="h-4 w-4 text-muted-foreground" />}
                >
                  {movies.map((m) => (
                    <div
                      key={m.id}
                      className="w-[160px] flex-shrink-0 snap-start"
                    >
                      <div className="bg-card rounded-lg border border-border overflow-hidden">
                        <div className="relative h-36 overflow-hidden">
                          {m.cover_image_url ? (
                            <>
                              <Image
                                src={m.cover_image_url}
                                alt=""
                                fill
                                className="object-cover blur-xl scale-110"
                                aria-hidden="true"
                                sizes="160px"
                              />
                              <Image
                                src={m.cover_image_url}
                                alt={m.title}
                                fill
                                className="object-contain relative z-10"
                                sizes="160px"
                              />
                            </>
                          ) : (
                            <div className="flex items-center justify-center h-full bg-muted">
                              <Film className="h-8 w-8 text-muted-foreground" />
                            </div>
                          )}
                          {m.fsk && (
                            <span className="absolute top-1.5 right-1.5 bg-foreground/80 text-background text-[10px] font-bold px-1.5 py-0.5 rounded">
                              FSK {m.fsk}
                            </span>
                          )}
                        </div>
                        <div className="p-2.5">
                          <h4 className="text-xs font-semibold text-foreground line-clamp-2">
                            {m.title}
                          </h4>
                          {m.date && (
                            <p className="text-xs text-muted-foreground mt-1">
                              {new Date(m.date).toLocaleDateString("de-DE", {
                                day: "numeric",
                                month: "short",
                              })}
                              {m.time && `, ${m.time}`}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </HorizontalRow>
              );
            }

            // Post card
            if (item.postItem) {
              if (item.postItem.post_type === "event_experience") {
                return (
                  <FeedExperienceCard
                    key={`exp-${item.postItem.id}`}
                    post={item.postItem}
                  />
                );
              }
              return (
                <PostCard
                  key={`post-${item.postItem.id}`}
                  {...item.postItem}
                  onDeleted={handlePostDeleted}
                />
              );
            }

            // Regular feed card
            if (item.feedItem) {
              return (
                <FeedCard
                  key={`${item.feedItem.type}-${item.feedItem.id}-${index}`}
                  {...item.feedItem}
                />
              );
            }

            return null;
          })}
        </div>
      )}
      </>
      )}
    </div>
  );
}
