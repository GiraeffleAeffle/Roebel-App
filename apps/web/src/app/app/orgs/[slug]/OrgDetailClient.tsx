"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActiveAccount } from "thirdweb/react";
import {
  ChevronLeft,
  Mail,
  MapPin,
  Users,
  Calendar,
  User as UserIcon,
  Pencil,
} from "lucide-react";

import { ProfileTabs } from "@/components/org/ProfileTabs";
import { AvatarStack } from "@/components/org/AvatarStack";
import { ThumbsVote } from "@/components/org/ThumbsVote";
import { MenuItemThumbs } from "@/components/org/MenuItemThumbs";
import { RatingSummary } from "@/components/org/RatingSummary";
import { RatingModal } from "@/components/org/RatingModal";
import { StickyCategoryBar } from "@/components/org/StickyCategoryBar";
import { MenuCategoriesSheet } from "@/components/org/MenuCategoriesSheet";
import { FeaturedMenuItemsGrid } from "@/components/org/FeaturedMenuItemsGrid";
import { MenuSearchModal } from "@/components/org/MenuSearchModal";
import { AccountPostsList } from "@/components/org/AccountPostsList";
import { HeaderFloatingActions } from "@/components/org/HeaderFloatingActions";
import { Badge } from "@/components/ui/badge";

import { useAccountRating } from "@/hooks/useAccountRating";
import { useAccountVote } from "@/hooks/useAccountVote";
import { useGastroData } from "@/hooks/useGastroData";

import { supabase } from "@/lib/supabase";
import { hasSupabase, recordClient } from "@/lib/record";
import { getOrgBySlug, listArticles, listPosts, RecordUnavailableError } from "@netizen-labs/record-client";
import { fetchMembersWithProfiles } from "@/lib/supabase-member-management";
import {
  fetchEventsByAccount,
  fetchOrgListings,
  type EventRecord,
  type MarketplaceListingRecord,
} from "@/lib/supabase-org-content";
import { listForAccount, type BlogArticle } from "@/lib/supabase-blog-articles";
import {
  resolveOrgLocation,
  fetchDealsByBusiness,
  type OrgLocation,
  type BusinessDealRecord,
} from "@/lib/org-location";
import { getOpenStatus, DAY_LABELS } from "@/lib/opening-hours";
import { formatPrice } from "@/types/restaurant";
import {
  subTypeFeatures,
  SUB_TYPE_LABELS,
  type Account,
  type MemberWithProfile,
} from "@/types/account";

type TabKey = "menu" | "info" | "posts";

function formatEventDate(date: string | null, time: string | null): string {
  if (!date) return "";
  const d = new Date(`${date}T${time ?? "00:00:00"}`);
  if (Number.isNaN(d.getTime())) return date;
  const day = d.toLocaleDateString("de-DE", { day: "2-digit", month: "short" });
  return time ? `${day} · ${String(time).slice(0, 5)}` : day;
}

/**
 * Record mode's blog source for a slug — `supabase-blog-articles.ts`'s
 * `listForAccount` is a Supabase-only file outside this seam, so the
 * org↔article join (by pubkey, same rule as events/posts/listings) lives
 * here instead. RecordUnavailableError propagates to the caller's own
 * try/catch — not swallowed here — so one shared handler covers this
 * alongside the events/listings calls in the effect below.
 */
async function blogArticlesForOrg(slug: string): Promise<BlogArticle[]> {
  const org = await getOrgBySlug(recordClient, slug);
  if (!org) return [];
  const articles = await listArticles(recordClient, { limit: 200 });
  return articles
    .filter((a) => a.pubkey === org.pubkey)
    .map((a) => ({
      id: a.id,
      account_id: org.slug,
      author_account_id: null,
      title: a.title,
      // articleToSpec never publishes a slug tag (only newsToSpec does) —
      // unused here anyway, since the "Artikel" section links by a.id.
      slug: a.slug ?? "",
      excerpt: a.excerpt,
      content: a.content_md,
      cover_image_url: a.cover_image_url,
      category: a.category,
      tags: [],
      status: "published",
      is_featured: false,
      view_count: 0,
      published_at: a.published_at,
      created_at: a.published_at ?? "",
      updated_at: a.published_at ?? "",
    }));
}

/** Record mode's "Beiträge" tab badge count — same author_pubkey join as
 * fetchAccountPosts (supabase-org-content.ts), computed separately here
 * since the tab count must be known before that tab is ever opened. */
async function postCountForOrg(slug: string): Promise<number> {
  const org = await getOrgBySlug(recordClient, slug);
  if (!org) return 0;
  const posts = await listPosts(recordClient, { limit: 200 });
  return posts.filter((p) => p.author_pubkey === org.pubkey).length;
}

function formatListingPrice(
  price: number | null,
  priceType: string
): string {
  if (priceType === "free") return "Gratis";
  if (typeof price !== "number" || !Number.isFinite(price)) return "";
  const formatted = price.toLocaleString("de-DE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  return `${formatted} €${priceType === "negotiable" ? " VB" : ""}`;
}

export function OrgDetailClient({ account }: { account: Account }) {
  const router = useRouter();
  const activeWallet = useActiveAccount()?.address?.toLowerCase() ?? null;
  const slug = account.slug ?? account.id;
  const isRestaurant = account.sub_type === "restaurant";
  const features = subTypeFeatures(account.sub_type);

  const [tabSelection, setTabSelection] = useState<TabKey | null>(null);
  const activeTab: TabKey = tabSelection ?? (isRestaurant ? "menu" : "info");

  const [members, setMembers] = useState<MemberWithProfile[]>([]);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [blog, setBlog] = useState<BlogArticle[]>([]);
  const [listings, setListings] = useState<MarketplaceListingRecord[]>([]);
  const [deals, setDeals] = useState<BusinessDealRecord[]>([]);
  const [orgLocation, setOrgLocation] = useState<OrgLocation | null>(null);
  const [postCount, setPostCount] = useState(0);

  const [ratingOpen, setRatingOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [activeCategoryIdx, setActiveCategoryIdx] = useState(0);

  const { summary: ratingSummary, userRating, refetch: refetchRating } =
    useAccountRating(account.id);
  const {
    summary: voteSummary,
    userVote,
    isSignedIn: voteSignedIn,
    setVote,
    clearVote,
  } = useAccountVote(account.id);
  const gastro = useGastroData(isRestaurant ? account.id : null);

  const categoryRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Members first (location resolution needs them).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const mem = await fetchMembersWithProfiles(account.id);
      if (!cancelled) setMembers(mem);
    })();
    return () => {
      cancelled = true;
    };
  }, [account.id]);

  // Org content.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!hasSupabase) {
        // Record mode: no Supabase account_id, no owner-member location
        // lookup (resolveOrgLocation/fetchDealsByBusiness are Supabase-only
        // and out of this seam), no raw post-count query. Blog is sourced
        // from listArticles filtered by the org's pubkey (fetchEventsByAccount
        // and fetchOrgListings already branch this way themselves).
        try {
          const [ev, bl, li] = await Promise.all([
            features.events ? fetchEventsByAccount(slug, 12) : Promise.resolve([]),
            features.blog ? blogArticlesForOrg(slug) : Promise.resolve([]),
            features.products ? fetchOrgListings(slug) : Promise.resolve([]),
          ]);
          if (cancelled) return;
          setEvents(ev);
          setBlog(bl);
          setListings(li);
          // No physical-location signal exists on the record for either a
          // restaurant or a linked business (see OrgRow.address's own doc
          // comment: no lat/lng is ever published for a business/restaurant
          // profile) — the "Standort" section stays hidden, honestly, rather
          // than showing a location with no coordinates to link to a map.
          setOrgLocation(null);
          setDeals([]);
          setPostCount(await postCountForOrg(slug));
        } catch (error) {
          if (!(error instanceof RecordUnavailableError)) throw error;
          if (cancelled) return;
          setEvents([]);
          setBlog([]);
          setListings([]);
          setOrgLocation(null);
          setDeals([]);
          setPostCount(0);
        }
        return;
      }

      const [ev, bl, li, loc, countRes] = await Promise.all([
        features.events ? fetchEventsByAccount(account.id, 12) : Promise.resolve([]),
        features.blog ? listForAccount(account.id, { status: "published" }) : Promise.resolve([]),
        features.products ? fetchOrgListings(account.id) : Promise.resolve([]),
        resolveOrgLocation(account, members).catch(() => null),
        supabase
          .from("posts")
          .select("id", { count: "exact", head: true })
          .eq("account_id", account.id)
          .eq("status", "published"),
      ]);
      if (cancelled) return;
      setEvents(ev as EventRecord[]);
      setBlog(bl as BlogArticle[]);
      setListings(li as MarketplaceListingRecord[]);
      setOrgLocation(loc);
      setPostCount(countRes.count ?? 0);

      if (loc?.entityType === "business" && loc.entityId) {
        const d = await fetchDealsByBusiness(loc.entityId).catch(() => []);
        if (!cancelled) setDeals(d);
      }
    })();
    return () => {
      cancelled = true;
    };
    // members is intentionally included so location resolves once loaded
  }, [account, members, slug, features.events, features.blog, features.products]);

  const products = useMemo(
    () => listings.filter((l) => l.listing_type === "product"),
    [listings]
  );
  const services = useMemo(
    () => listings.filter((l) => l.listing_type === "service"),
    [listings]
  );

  const myRole = useMemo(
    () =>
      activeWallet
        ? members.find((m) => m.wallet_address.toLowerCase() === activeWallet)
            ?.role ?? null
        : null,
    [members, activeWallet]
  );
  const canEdit = myRole === "owner" || myRole === "admin";

  const openingHours = account.opening_hours ?? orgLocation?.openingHours ?? null;
  const openStatus = getOpenStatus(openingHours);

  // Track active menu category while scrolling.
  useEffect(() => {
    if (activeTab !== "menu" || !isRestaurant || gastro.categories.length === 0)
      return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length === 0) return;
        const id = visible[0].target.getAttribute("data-cat-id");
        const idx = gastro.categories.findIndex((c) => c.id === id);
        if (idx >= 0) setActiveCategoryIdx(idx);
      },
      { rootMargin: "-80px 0px -70% 0px", threshold: 0 }
    );
    gastro.categories.forEach((c) => {
      const el = categoryRefs.current[c.id];
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [activeTab, isRestaurant, gastro.categories]);

  const jumpToCategory = useCallback(
    (idx: number) => {
      const cat = gastro.categories[idx];
      if (!cat) return;
      const el = categoryRefs.current[cat.id];
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
      setActiveCategoryIdx(idx);
    },
    [gastro.categories]
  );

  const stickyCategories = useMemo(
    () => gastro.categories.map((c) => ({ id: c.id, name: c.name })),
    [gastro.categories]
  );

  const memberAvatars = members.slice(0, 3).map((m) => ({
    avatar_url: m.user?.profile_picture_url ?? null,
    username: m.user?.username ?? null,
  }));

  const showExternBadge =
    account.is_extern && account.extern_status !== "approved";

  const tabs: { key: TabKey; label: string; count?: number }[] = [
    ...(isRestaurant ? [{ key: "menu" as const, label: "Speisekarte" }] : []),
    { key: "info" as const, label: "Info" },
    { key: "posts" as const, label: "Beiträge", count: postCount },
  ];

  return (
    <div className="pb-10">
      {/* Banner */}
      <div className="relative h-44 w-full overflow-hidden rounded-2xl bg-muted sm:h-52">
        {account.cover_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={account.cover_url}
            alt=""
            className="h-full w-full object-cover"
          />
        )}
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Zurück"
          className="absolute left-3 top-3 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-background/90 shadow-sm backdrop-blur hover:bg-background"
        >
          <ChevronLeft size={22} className="text-foreground" />
        </button>
        <HeaderFloatingActions
          actions={[
            ...(isRestaurant
              ? [
                  {
                    kind: "search" as const,
                    onClick: () => setSearchOpen(true),
                    label: "Speisekarte durchsuchen",
                  },
                ]
              : []),
            {
              kind: "rate" as const,
              onClick: () => setRatingOpen(true),
              active: !!userRating,
              label: "Bewerten",
            },
          ]}
        />
      </div>

      {/* Avatar + edit */}
      <div className="flex items-end justify-between px-1">
        <div className="-mt-10 h-24 w-24 overflow-hidden rounded-full border-4 border-background bg-muted">
          {account.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={account.avatar_url}
              alt={account.name}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <UserIcon size={40} className="text-muted-foreground" />
            </div>
          )}
        </div>
        {canEdit && (
          <Link
            href="/app/org/manage"
            className="mb-1 inline-flex items-center gap-1.5 rounded-full border border-border px-3.5 py-1.5 text-sm font-medium text-foreground hover:bg-accent"
          >
            <Pencil size={14} /> Verwalten
          </Link>
        )}
      </div>

      {/* Identity */}
      <div className="mt-3 space-y-2.5 px-1">
        <h1 className="text-2xl font-semibold text-foreground">{account.name}</h1>
        {showExternBadge && (
          <Badge variant="secondary" className="text-xs">
            Extern ·{" "}
            {account.extern_status === "pending" ? "in Prüfung" : "abgelehnt"}
          </Badge>
        )}
        {account.bio && (
          <p className="text-[15px] leading-relaxed text-foreground">
            {account.bio}
          </p>
        )}
        {(ratingSummary?.rating_count ?? 0) > 0 && (
          <RatingSummary summary={ratingSummary} />
        )}
        <div className="pt-1">
          <ThumbsVote
            interactive
            upCount={voteSummary?.up_count ?? null}
            userVote={userVote}
            onVote={(v) => {
              if (!voteSignedIn) return;
              if (userVote === v) clearVote();
              else setVote(v);
            }}
          />
          {!voteSignedIn && (
            <p className="mt-1.5 text-xs text-muted-foreground">
              Melde dich an, um zu bewerten.
            </p>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="mt-5">
        <ProfileTabs
          tabs={tabs}
          active={activeTab}
          onChange={(k) => setTabSelection(k)}
        />
      </div>

      {/* Menu tab */}
      {activeTab === "menu" && isRestaurant && (
        <div>
          {!gastro.loading && gastro.categories.length > 0 && (
            <FeaturedMenuItemsGrid
              slug={slug}
              items={gastro.categories.flatMap((c) => c.items)}
              voteSummaries={gastro.voteSummaries}
            />
          )}

          {gastro.categories.length > 0 && (
            <div className="sticky top-0 z-20">
              <StickyCategoryBar
                categories={stickyCategories}
                activeIndex={activeCategoryIdx}
                onSelect={jumpToCategory}
                onOpenSheet={() => setSheetOpen(true)}
              />
            </div>
          )}

          {gastro.loading ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Speisekarte wird geladen…
            </p>
          ) : gastro.categories.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Noch keine Speisekarte.
            </p>
          ) : (
            gastro.categories.map((cat) => (
              <div
                key={cat.id}
                data-cat-id={cat.id}
                ref={(el) => {
                  categoryRefs.current[cat.id] = el;
                }}
                className="scroll-mt-16 border-t border-border pt-5"
              >
                <h2 className="mb-2 text-xl font-medium text-foreground">
                  {cat.name}
                </h2>
                {cat.items.length === 0 ? (
                  <p className="py-3 text-sm text-muted-foreground">
                    Keine Gerichte
                  </p>
                ) : (
                  cat.items.map((item, idx) => (
                    <Link
                      key={item.id}
                      href={`/app/orgs/${slug}/menu/${item.id}`}
                      className={`flex items-center gap-3 py-3.5 ${
                        idx > 0 ? "border-t border-border" : ""
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-foreground">
                          {item.name}
                        </p>
                        <div className="mt-1 flex items-center gap-3">
                          <span className="text-sm text-foreground">
                            {item.has_variants ? "ab " : ""}
                            {formatPrice(item.price)}
                          </span>
                          <MenuItemThumbs
                            summary={gastro.voteSummaries[item.id] ?? null}
                          />
                        </div>
                        {item.description && (
                          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                            {item.description}
                          </p>
                        )}
                      </div>
                      {item.image_url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.image_url}
                          alt={item.name}
                          className="h-24 w-24 flex-shrink-0 rounded-lg object-cover"
                        />
                      )}
                    </Link>
                  ))
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* Info tab */}
      {activeTab === "info" && (
        <div className="divide-y divide-border">
          {/* Contact */}
          {account.contact_email && (
            <Section title="Kontakt">
              <a
                href={`mailto:${account.contact_email}`}
                className="inline-flex items-center gap-2 text-[15px] font-medium text-primary hover:underline"
              >
                <Mail size={16} /> {account.contact_email}
              </a>
            </Section>
          )}

          {/* Members */}
          {members.length > 0 && (
            <Section title="Mitglieder">
              <div className="flex items-center gap-3">
                <AvatarStack
                  users={memberAvatars}
                  totalCount={members.length}
                  maxVisible={3}
                />
                <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Users size={15} />
                  {members.length}{" "}
                  {members.length === 1 ? "Mitglied" : "Mitglieder"}
                </span>
              </div>
            </Section>
          )}

          {/* Opening hours */}
          {features.openingHours && openingHours && (
            <Section
              title="Öffnungszeiten"
              right={
                openStatus ? (
                  <span
                    className={
                      openStatus.isOpen
                        ? "text-sm font-medium text-green-600"
                        : "text-sm font-medium text-muted-foreground"
                    }
                  >
                    {openStatus.isOpen
                      ? `Offen${openStatus.closesAt ? ` · bis ${openStatus.closesAt}` : ""}`
                      : openStatus.opensAt
                        ? `Geschlossen · öffnet ${openStatus.opensAt}`
                        : "Geschlossen"}
                  </span>
                ) : undefined
              }
            >
              <div className="space-y-1.5">
                {DAY_LABELS.map(({ key, label }) => {
                  const day = openingHours[key];
                  const closed = !day || day.closed || !day.open;
                  return (
                    <div
                      key={key}
                      className="flex items-center justify-between text-sm"
                    >
                      <span className="w-10 font-medium text-muted-foreground">
                        {label}
                      </span>
                      <span className="text-foreground">
                        {closed ? "Geschlossen" : `${day!.open} – ${day!.close}`}
                      </span>
                    </div>
                  );
                })}
              </div>
            </Section>
          )}

          {/* Events */}
          {events.length > 0 && (
            <Section title="Veranstaltungen" count={events.length}>
              <HScroll>
                {events.map((e) => (
                  <Link
                    key={e.id}
                    href={`/app/events/${e.id}`}
                    className="w-48 flex-shrink-0 overflow-hidden rounded-xl border border-border bg-card"
                  >
                    <div className="h-28 w-full bg-muted">
                      {e.image_url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={e.image_url}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      )}
                    </div>
                    <div className="space-y-1 p-2.5">
                      <p className="line-clamp-2 text-sm font-semibold text-foreground">
                        {e.title}
                      </p>
                      <p className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Calendar size={12} />
                        {formatEventDate(e.date, e.time)}
                      </p>
                    </div>
                  </Link>
                ))}
              </HScroll>
            </Section>
          )}

          {/* Blog */}
          {blog.length > 0 && (
            <Section title="Artikel" count={blog.length}>
              <HScroll>
                {blog.map((a) => (
                  <Link
                    key={a.id}
                    href={`/app/blog/${a.id}`}
                    className="w-48 flex-shrink-0 overflow-hidden rounded-xl border border-border bg-card"
                  >
                    <div className="h-28 w-full bg-muted">
                      {a.cover_image_url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={a.cover_image_url}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      )}
                    </div>
                    <div className="space-y-1 p-2.5">
                      <p className="line-clamp-2 text-sm font-semibold text-foreground">
                        {a.title}
                      </p>
                      {a.excerpt && (
                        <p className="line-clamp-2 text-xs text-muted-foreground">
                          {a.excerpt}
                        </p>
                      )}
                    </div>
                  </Link>
                ))}
              </HScroll>
            </Section>
          )}

          {/* Products */}
          {products.length > 0 && (
            <Section title="Produkte" count={products.length}>
              <HScroll>
                {products.map((l) => (
                  <Link
                    key={l.id}
                    href={`/app/marktplatz/${l.id}`}
                    className="w-48 flex-shrink-0 overflow-hidden rounded-xl border border-border bg-card"
                  >
                    <div className="h-28 w-full bg-muted">
                      {l.media_urls?.[0] && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={l.media_urls[0]}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      )}
                    </div>
                    <div className="space-y-1 p-2.5">
                      <p className="line-clamp-2 text-sm font-semibold text-foreground">
                        {l.title}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatListingPrice(l.price, l.price_type)}
                      </p>
                    </div>
                  </Link>
                ))}
              </HScroll>
            </Section>
          )}

          {/* Services */}
          {services.length > 0 && (
            <Section title="Services" count={services.length}>
              <HScroll>
                {services.map((l) => (
                  <Link
                    key={l.id}
                    href={`/app/marktplatz/${l.id}`}
                    className="w-48 flex-shrink-0 overflow-hidden rounded-xl border border-border bg-card"
                  >
                    <div className="h-28 w-full bg-muted">
                      {l.media_urls?.[0] && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={l.media_urls[0]}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      )}
                    </div>
                    <div className="space-y-1 p-2.5">
                      <p className="line-clamp-2 text-sm font-semibold text-foreground">
                        {l.title}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatListingPrice(l.price, l.price_type)}
                      </p>
                    </div>
                  </Link>
                ))}
              </HScroll>
            </Section>
          )}

          {/* Deals */}
          {deals.length > 0 && (
            <Section title="Deals" count={deals.length}>
              <HScroll>
                {deals.map((d) => (
                  <div
                    key={d.id}
                    className="w-48 flex-shrink-0 overflow-hidden rounded-xl border border-border bg-card"
                  >
                    <div className="h-28 w-full bg-muted">
                      {d.image_url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={d.image_url}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      )}
                    </div>
                    <div className="space-y-1 p-2.5">
                      <p className="line-clamp-2 text-sm font-semibold text-foreground">
                        {d.title}
                      </p>
                      {d.deal_value && (
                        <p className="text-xs font-medium text-primary">
                          {d.deal_value}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </HScroll>
            </Section>
          )}

          {/* Location */}
          {orgLocation && (orgLocation.address || orgLocation.lat) && (
            <Section title="Standort">
              {orgLocation.address && (
                <p className="mb-2 text-[15px] text-foreground">
                  {orgLocation.address}
                </p>
              )}
              {orgLocation.lat != null && orgLocation.lon != null && (
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${orgLocation.lat},${orgLocation.lon}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-primary hover:bg-accent"
                >
                  <MapPin size={16} /> Auf Karte ansehen →
                </a>
              )}
            </Section>
          )}
        </div>
      )}

      {/* Posts tab */}
      {activeTab === "posts" && <AccountPostsList accountId={account.id} />}

      {/* Modals */}
      <RatingModal
        open={ratingOpen}
        accountId={account.id}
        accountName={account.name}
        onClose={() => setRatingOpen(false)}
        onChanged={refetchRating}
      />
      {isRestaurant && (
        <MenuCategoriesSheet
          open={sheetOpen}
          categories={stickyCategories}
          activeIndex={activeCategoryIdx}
          onSelect={(idx) => {
            setSheetOpen(false);
            setTimeout(() => jumpToCategory(idx), 150);
          }}
          onClose={() => setSheetOpen(false)}
        />
      )}
      {isRestaurant && (
        <MenuSearchModal
          open={searchOpen}
          accountId={account.id}
          slug={slug}
          onClose={() => setSearchOpen(false)}
        />
      )}
    </div>
  );
}

function Section({
  title,
  count,
  right,
  children,
}: {
  title: string;
  count?: number;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="py-5">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
          {title}
          {typeof count === "number" && (
            <span className="text-sm font-normal text-muted-foreground">
              {count}
            </span>
          )}
        </h2>
        {right}
      </div>
      {children}
    </section>
  );
}

function HScroll({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-none">
      {children}
    </div>
  );
}
