/**
 * The civic layer: marketplace listings, business deals, restaurant menus,
 * governance proposal pointers and town notices — the last dataset slice of
 * the record-client reference implementation.
 *
 * Same discipline as `datasets.ts`: pure readers over `RecordClient` + the
 * tag helpers, no runtime dependency on `@netizen-labs/publisher` (it is a
 * devDependency for the parity fixtures only), and every mapping rule is
 * pinned against `packages/publisher/src/mappers.ts` — the shipped mapper is
 * the truth, not the wire-format prose in the design spec, wherever the two
 * disagree.
 */

import type { RecordClient, RecordEvent } from "./client";
import { dSuffix, tagValue, tagValues } from "./tags";

/** NIP-15 product listing (marketplace). */
const KIND_PRODUCT = 30018;
/** NIP-99 classified listing (business deals). */
const KIND_DEAL = 30402;
/** Netizen proposal metadata — custom kind, see CONSUMING_THE_RECORD.md "Netizen civic kinds". */
const KIND_PROPOSAL_META = 32100;
/** Netizen menu — custom kind, one event per restaurant. */
const KIND_MENU = 32101;
/** Netizen civic notice (service alerts, announcements). */
const KIND_CIVIC_NOTICE = 32102;

/** Civic-record roster is town-scale, not paginated; one generous fetch covers it (mirrors ORG_FETCH_LIMIT in datasets.ts). */
const CIVIC_FETCH_LIMIT = 200;

export interface ListingRow {
  id: string;
  title: string;
  description: string | null;
  price: string | null;
  category: string | null;
  condition: string | null;
  media_urls: string[];
  location: string | null;
  status: "active";
  seller_npub: string | null;
  /**
   * The signing pubkey — NOT in the brief's original interface block, added
   * per the same rule Task 8 established for events/articles: an org-owned
   * listing carries no seller `p` tag (`listingToSpec`, mappers.ts, only
   * pushes `p` when `!isOrg`), so `RecordEvent.pubkey` is the only signal a
   * record-mode client has to join "this org's listings" back to its
   * OrgRow.pubkey. For a personal seller's listing, `seller_npub` already
   * carries the same value redundantly (via the `p` tag) — `pubkey` is what
   * makes the org case joinable too.
   */
  pubkey: string;
}

export interface DealRow {
  id: string;
  business_id: string | null;
  business_name: string | null;
  title: string;
  description: string | null;
  deal_type: string | null;
  deal_value: string | null;
  image_url: string | null;
  start_date: string | null;
  end_date: string | null;
  /**
   * The signing pubkey — added per the org/business join rule (see
   * ListingRow.pubkey doc). `dealToSpec` (mappers.ts) signs every deal under
   * the derived `biz-<businessId>` scope — the SAME scope `businessToSpec`
   * signs that business's own kind-0 profile under — so `pubkey` is how a
   * record-mode client joins a deal back to its business, exactly the way
   * `EventRow.pubkey` joins an event back to its org.
   */
  pubkey: string;
}

export interface MenuData {
  restaurantId: string;
  name: string;
  slug: string | null;
  location: string | null;
  image: string | null;
  categories: { name: string; items: { name: string; description?: string; price?: string; currency: string }[] }[];
  /**
   * The signing pubkey — added per the org/business join rule (see
   * ListingRow.pubkey doc). `menuToSpec` signs under `org-<accountId>` when
   * the restaurant belongs to an organisation account (joinable to that
   * org's own OrgRow.pubkey, same as events/articles), or `resto-<id>`
   * otherwise (no separate restaurant profile is published today, but the
   * field is still the only identity signal available for a future join).
   */
  pubkey: string;
}

export interface ProposalMetaRow {
  proposal_id: string;
  title: string;
  summary: string;
  category: string | null;
  governor: string | null;
  onchain_id: string | null;
  irys_tx: string | null;
  status: string | null;
  published_at: string | null;
}

export interface NoticeRow {
  id: string;
  kind: "service_alert" | "announcement";
  title: string;
  message: string;
  severity: string | null;
  status: "active" | "resolved";
}

/** "" from a `str() ?? ""` mapper default round-trips to null, same as datasets.ts's nullIfEmpty. */
function nullIfEmpty(v: string): string | null {
  return v === "" ? null : v;
}

/**
 * kind 30018 (NIP-15). `listingToSpec` (mappers.ts) tombstones a withdrawn
 * listing as a content-free event carrying only `["status","withdrawn"]` on
 * the same `d` — no `title` tag at all — so filtering on the `status` tag
 * (rather than trying to detect "no title") is both the documented rule and
 * the robust one.
 */
export async function listListings(client: RecordClient, opts?: { limit?: number }): Promise<ListingRow[]> {
  const events = await client.events({ kinds: [KIND_PRODUCT], limit: opts?.limit });
  const rows: ListingRow[] = [];
  for (const ev of events) {
    if (tagValue(ev, "status") !== "active") continue;
    const id = dSuffix(ev, "listing");
    if (id === null) continue;
    // The description/price/condition trio lives only in the content JSON
    // (listingToSpec, mappers.ts) — not as tags. A malformed body degrades to
    // "these three fields are unknown" rather than dropping the whole row,
    // since everything else a client needs (id, title, category, images,
    // seller/pubkey) is tag-derived and unaffected by a broken content blob.
    let content: Record<string, unknown> = {};
    try {
      content = JSON.parse(ev.content) as Record<string, unknown>;
    } catch {
      content = {};
    }
    const str = (k: string) => (typeof content[k] === "string" && content[k] !== "" ? (content[k] as string) : null);
    rows.push({
      id,
      title: tagValue(ev, "title") ?? "",
      description: str("description"),
      price: str("price"),
      category: tagValue(ev, "t"),
      condition: str("condition"),
      media_urls: tagValues(ev, "image"),
      location: tagValue(ev, "location"),
      status: "active",
      seller_npub: tagValue(ev, "p"),
      pubkey: ev.pubkey,
    });
  }
  return rows;
}

/**
 * kind 30402 (NIP-99). `dealToSpec` never tombstones — it simply stops
 * republishing once a deal is no longer active/is_active, so anything the
 * index still serves under this kind is, by construction, currently active;
 * the `status` tag check is a defensive belt-and-braces re-filter (same
 * discipline as datasets.ts's own kind re-filtering), not a documented
 * requirement.
 */
export async function listDeals(client: RecordClient, opts?: { limit?: number }): Promise<DealRow[]> {
  const events = await client.events({ kinds: [KIND_DEAL], limit: opts?.limit });
  const rows: DealRow[] = [];
  for (const ev of events) {
    if (tagValue(ev, "status") !== "active") continue;
    const id = dSuffix(ev, "deal");
    if (id === null) continue;
    rows.push({
      id,
      // dealToSpec (mappers.ts) never publishes the Supabase business_id
      // anywhere on the wire — only the derived `biz-<businessId>` signing
      // scope encodes it, and scope derivation is one-way. Always null; see
      // the pubkey doc comment above for the actual join key.
      business_id: null,
      business_name: tagValue(ev, "business"),
      title: tagValue(ev, "title") ?? "",
      description: nullIfEmpty(ev.content),
      deal_type: tagValue(ev, "t"),
      deal_value: tagValue(ev, "price"),
      image_url: tagValues(ev, "image")[0] ?? null,
      // dealToSpec pushes the row's raw date string unmodified (unlike
      // eventToSpec, which converts through berlinToUnix) — no timezone
      // math to invert here.
      start_date: tagValue(ev, "start"),
      end_date: tagValue(ev, "end"),
      pubkey: ev.pubkey,
    });
  }
  return rows;
}

/** Parses one menu event's content JSON; `null` on a malformed body (per the brief's explicit rule) or a missing `restaurant:` d-tag. */
function toMenuData(ev: RecordEvent): MenuData | null {
  const restaurantId = dSuffix(ev, "restaurant");
  if (restaurantId === null) return null;
  let parsed: { categories?: unknown };
  try {
    parsed = JSON.parse(ev.content) as { categories?: unknown };
  } catch {
    return null;
  }
  return {
    restaurantId,
    name: tagValue(ev, "title") ?? "",
    slug: tagValue(ev, "slug"),
    location: tagValue(ev, "location"),
    image: tagValue(ev, "image"),
    // menuToSpec's content IS already exactly this shape
    // ({categories:[{name,items:[{name,description?,price?,currency}]}]}) —
    // trusting the parsed JSON directly (rather than re-deriving field by
    // field) keeps the optional-field omission (description/price absent
    // when unset) byte-identical to what was published.
    categories: Array.isArray(parsed.categories) ? (parsed.categories as MenuData["categories"]) : [],
    pubkey: ev.pubkey,
  };
}

/** kind 32101, `d = restaurant:<id>`. */
export async function getMenu(client: RecordClient, restaurantId: string): Promise<MenuData | null> {
  const events = await client.events({ kinds: [KIND_MENU], d: [`restaurant:${restaurantId}`] });
  for (const ev of events) {
    if (dSuffix(ev, "restaurant") !== restaurantId) continue;
    const menu = toMenuData(ev);
    if (menu) return menu;
  }
  return null;
}

/**
 * kind 32101, scanned for a `slug` tag. Menus carry no `d`-indexable slug (the
 * `d` tag is always `restaurant:<uuid>`), so — same pattern as
 * `getNewsBySlug`'s scan of `listNews(limit 200)` — this fetches a generous
 * page and filters client-side.
 */
export async function getMenuBySlug(client: RecordClient, slug: string): Promise<MenuData | null> {
  const events = await client.events({ kinds: [KIND_MENU], limit: CIVIC_FETCH_LIMIT });
  for (const ev of events) {
    const menu = toMenuData(ev);
    if (menu && menu.slug === slug) return menu;
  }
  return null;
}

/**
 * kind 32100. `proposalToSpec` (mappers.ts) has a genuine naming collision
 * the brief's prose does not warn about: the row's OWN `proposal_id` field
 * becomes the `d`-tag suffix (`proposal:<proposal_id>`), while a DIFFERENT
 * row field (`blockchain_proposal_id`) is published under a tag ALSO named
 * `"proposal_id"`. `ProposalMetaRow.proposal_id` must resolve from the
 * `d` tag; `ProposalMetaRow.onchain_id` must resolve from the `proposal_id`
 * TAG — reading the tag for both would silently collapse two distinct ids
 * into one.
 *
 * `category` shares the `t` tag with a `"proposal"` type marker
 * (`["t","proposal"]` is always pushed, `["t", category]` only when a
 * category is set) — same overloaded-tag shape as `newsToSpec`'s `news`
 * marker in datasets.ts, so the fix is the same: strip the known marker,
 * keep whatever's left.
 */
export async function listProposals(client: RecordClient, opts?: { limit?: number }): Promise<ProposalMetaRow[]> {
  const events = await client.events({ kinds: [KIND_PROPOSAL_META], limit: opts?.limit });
  const rows: ProposalMetaRow[] = [];
  for (const ev of events) {
    const proposalId = dSuffix(ev, "proposal");
    const title = tagValue(ev, "title");
    if (proposalId === null || title === null) continue;
    const publishedAt = tagValue(ev, "published_at");
    rows.push({
      proposal_id: proposalId,
      title,
      summary: ev.content,
      category: tagValues(ev, "t").find((t) => t !== "proposal") ?? null,
      governor: tagValue(ev, "governor"),
      onchain_id: tagValue(ev, "proposal_id"),
      irys_tx: tagValue(ev, "irys"),
      status: tagValue(ev, "status"),
      published_at: publishedAt !== null ? new Date(Number(publishedAt) * 1000).toISOString() : null,
    });
  }
  return rows;
}

/**
 * kind 32102. Both `d` prefixes (`alert:`/`announcement:`) share this one
 * kind — the `t` tag (`service_alert` | `announcement`) tells them apart
 * directly and unambiguously, so it also picks which `d` prefix to strip
 * (rather than trying both). The index already serves only the current
 * version per `(pubkey, d)`, so no client-side de-dup is needed — a resolved
 * notice is an EDIT (mappers.ts noticeToSpec), never removed. Active-first
 * ordering matches the design spec's "listNotices — active first"
 * (2026-07-31-fork-with-fallback-design.md §3.2): a fork operator scanning
 * civic notices should see live warnings before resolved history.
 */
export async function listNotices(client: RecordClient): Promise<NoticeRow[]> {
  const events = await client.events({ kinds: [KIND_CIVIC_NOTICE], limit: CIVIC_FETCH_LIMIT });
  const rows: NoticeRow[] = [];
  for (const ev of events) {
    const kind = tagValue(ev, "t");
    if (kind !== "service_alert" && kind !== "announcement") continue;
    const id = dSuffix(ev, kind === "service_alert" ? "alert" : "announcement");
    const title = tagValue(ev, "title");
    if (id === null || title === null) continue;
    rows.push({
      id,
      kind,
      title,
      message: ev.content,
      severity: tagValue(ev, "severity"),
      status: tagValue(ev, "status") === "resolved" ? "resolved" : "active",
    });
  }
  return rows.sort((a, b) => (a.status === "active" ? 0 : 1) - (b.status === "active" ? 0 : 1));
}
