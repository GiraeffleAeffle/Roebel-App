/**
 * Supabase rows → Nostr event specs.
 *
 * Pure functions, because the mapping IS the privacy boundary: what a mapper
 * does not copy cannot leak. Publish-the-minimum is enforced here by
 * construction — an event listing needs a title, a time, a place and who is
 * behind it; it does not need the organiser's email, phone or name, and those
 * fields are never read. See docs/PUBLIC_DATA_ON_NOSTR.md §2.
 *
 * Everything editable is a parameterised replaceable event (NIP-01 3xxxx) with
 * the record's canonical id in the `d` tag, so an edit in Supabase becomes a
 * replacement on the relay. `created_at` is the row's `updated_at`, which makes
 * publishing idempotent: an unchanged row builds a byte-identical event (same
 * id), and the relay treats it as a duplicate.
 */

export interface PublishSpec {
  /** Identity scope the event is signed under — deriveOrgIdentity(secret, node, scope). */
  scope: string;
  kind: number;
  /** The `d` tag; "" for plain replaceable kinds (kind 0). */
  d: string;
  content: string;
  tags: string[][];
  createdAt: number;
}

/** NIP-52 time-based calendar event. */
export const KIND_CALENDAR_TIME = 31923;

type Row = Record<string, unknown>;

function str(row: Row, key: string): string | null {
  const v = row[key];
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

/**
 * Bump when any mapper's OUTPUT changes shape (new fields, new tags).
 *
 * created_at = updated_at + version, so a mapper upgrade re-publishes every
 * record strictly newer than its previous incarnation. Without this, an
 * enrichment at an unchanged updated_at ties with the old event on the relay
 * and NIP-01's id tie-break picks the survivor at random — observed live: one
 * org profile stayed stale after gaining its banner.
 */
export const MAPPER_VERSION = 3;

/** Original wall-clock of an IMMUTABLE record (kind 1): no version offset, ever —
 * a version bump must not duplicate every historic post under a new id. */
function unixFromCreatedAt(row: Row): number {
  const raw = str(row, "created_at");
  const parsed = raw ? Date.parse(raw) : NaN;
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0;
}

function unixFromUpdatedAt(row: Row): number {
  const raw = str(row, "updated_at") ?? str(row, "created_at");
  const parsed = raw ? Date.parse(raw) : NaN;
  return (Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0) + MAPPER_VERSION;
}

/**
 * Local Röbel wall-clock ("2026-08-14", "19:30") → unix seconds.
 *
 * The container runs UTC, so the Berlin offset at that instant is read via
 * Intl (full-ICU is standard in Node 13+). Falls back to +01:00 if the runtime
 * lacks the timezone database — an hour of drift beats a crash, and the tzid
 * tag lets any careful reader recompute exactly.
 */
export function berlinToUnix(date: string, time: string | null): number {
  // Rows store "HH:MM" or "HH:MM:SS"; normalise to HH:MM before building ISO.
  const hhmm = (time ?? "00:00").slice(0, 5);
  const guess = new Date(`${date}T${hhmm}:00Z`);
  let offsetMinutes = 60;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Europe/Berlin",
      timeZoneName: "longOffset",
    }).formatToParts(guess);
    const name = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT+01:00";
    const m = name.match(/GMT([+-])(\d{2}):(\d{2})/);
    if (m) offsetMinutes = (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
  } catch {
    // no timezone data in this runtime; keep the +01:00 fallback
  }
  return Math.floor(guess.getTime() / 1000) - offsetMinutes * 60;
}

/** Scope for a record owned by no account — town-curated content. */
export const TOWN_SCOPE = "town";

/**
 * A public Veranstaltung → NIP-52 time-based calendar event.
 *
 * Returns null for rows that must not be published: not approved, or owned by
 * a personal account (a private individual publishing their own name needs the
 * same explicit opt-in the Nostr identity screen uses — until that exists,
 * their events stay off the record).
 */
export function eventToSpec(
  row: Row,
  orgAccountIds: Set<string>,
  ownerPubkeyByAccount: Map<string, string> = new Map(),
): PublishSpec | null {
  if (str(row, "status") !== "approved") return null;
  const id = str(row, "id");
  const title = str(row, "title");
  const date = str(row, "date");
  if (!id || !title || !date) return null;

  const accountId = str(row, "account_id");
  const isOrg = accountId ? orgAccountIds.has(accountId) : false;
  // A personal organiser publishes only after consenting (their wallet holds a
  // binding); the event then carries their npub as attribution while the town
  // curator signs — the node never signs AS a person.
  const ownerPubkey = accountId && !isOrg ? ownerPubkeyByAccount.get(accountId) ?? null : null;
  if (accountId && !isOrg && !ownerPubkey) return null;
  const scope = isOrg && accountId ? `org-${accountId}` : TOWN_SCOPE;

  const start = berlinToUnix(date, str(row, "time"));
  const tags: string[][] = [
    ["d", `event:${id}`],
    ["title", title],
    ["start", String(start)],
    ["start_tzid", "Europe/Berlin"],
  ];
  const endTime = str(row, "end_time");
  if (endTime) tags.push(["end", String(berlinToUnix(date, endTime))]);
  const location = str(row, "location") ?? str(row, "formatted_address");
  if (location) tags.push(["location", location]);
  const category = str(row, "category");
  if (category) tags.push(["t", category]);
  const image = str(row, "image_url");
  if (image) tags.push(["image", image]);
  const website = str(row, "website_url");
  if (website) tags.push(["r", website]);
  const price = str(row, "ticket_price");
  if (price) tags.push(["price", price]);
  const address = str(row, "formatted_address");
  if (address) tags.push(["address", address]);
  const lat = row["latitude"];
  const lon = row["longitude"];
  if (typeof lat === "number" && typeof lon === "number") {
    tags.push(["latitude", String(lat)], ["longitude", String(lon)]);
  }
  const livestream = str(row, "livestream_url");
  if (livestream) tags.push(["r", livestream]);
  const maxAttendees = row["max_attendees"];
  if (typeof maxAttendees === "number") tags.push(["max_attendees", String(maxAttendees)]);
  if (row["is_recurring"] === true) tags.push(["recurring", "true"]);
  if (ownerPubkey) tags.push(["p", ownerPubkey]);
  // NIP-52 status values: planned / confirmed / cancelled.
  tags.push(["status", row["is_cancelled"] === true ? "cancelled" : "confirmed"]);

  return {
    scope,
    kind: KIND_CALENDAR_TIME,
    d: `event:${id}`,
    content: str(row, "description") ?? "",
    tags,
    createdAt: unixFromUpdatedAt(row),
  };
}

/** Scope the cinema publishes under — one venue, one identity. */
export const CINEMA_SCOPE = "kino";

/** A published screening → NIP-52. Zero personal data by construction. */
export function movieToSpec(row: Row): PublishSpec | null {
  if (str(row, "status") !== "published") return null;
  const id = str(row, "id");
  const title = str(row, "title");
  const date = str(row, "date");
  if (!id || !title || !date) return null;

  const tags: string[][] = [
    ["d", `movie:${id}`],
    ["title", title],
    ["start", String(berlinToUnix(date, str(row, "time")))],
    ["start_tzid", "Europe/Berlin"],
    ["t", "kino"],
  ];
  const fsk = row["fsk"];
  if (typeof fsk === "number" || typeof fsk === "string") tags.push(["fsk", String(fsk)]);
  const cover = str(row, "cover_image_url");
  if (cover) tags.push(["image", cover]);
  const trailer = str(row, "trailer_youtube_url");
  if (trailer) tags.push(["r", trailer]);

  return {
    scope: CINEMA_SCOPE,
    kind: KIND_CALENDAR_TIME,
    d: `movie:${id}`,
    content: str(row, "description") ?? "",
    tags,
    createdAt: unixFromUpdatedAt(row),
  };
}

/**
 * An organisation account → its own kind 0 profile, signed by its own derived
 * key. Business data only: name, bio, avatar. Contact *persons* are personal
 * data and stay in the node; even the org's contact email stays off the record
 * because the app is the contact route.
 */
export function orgToSpec(row: Row, nodeId: string): PublishSpec | null {
  if (str(row, "account_type") !== "organisation") return null;
  const id = str(row, "id");
  const name = str(row, "name");
  if (!id || !name) return null;

  const profile: Record<string, string> = { name };
  const bio = str(row, "bio");
  if (bio) profile.about = bio;
  const avatar = str(row, "avatar_url");
  if (avatar) profile.picture = avatar;
  // `banner` is the standard Nostr profile field every client renders.
  const cover = str(row, "cover_url");
  if (cover) profile.banner = cover;
  // Business data a directory needs: what kind of org, and when it is open.
  const subType = str(row, "sub_type");
  if (subType) profile.category = subType;
  const hours = str(row, "opening_hours");
  if (hours) profile.opening_hours = hours;
  const slug = str(row, "slug");
  if (slug) profile.slug = slug;

  return {
    scope: `org-${id}`,
    kind: 0,
    d: "",
    content: JSON.stringify(profile),
    tags: [["netizen_org", str(row, "slug") ?? id, nodeId]],
    createdAt: unixFromUpdatedAt(row),
  };
}

/**
 * A business directory entry → kind-0 profile under its own derived scope.
 *
 * The scope is `biz-<id>` — the SAME scope dealToSpec signs that business's
 * deals with, so a record-mode client joins profile and offers by pubkey,
 * exactly the rule organisations already follow. Contact PERSONS are personal
 * data and are never read; the business's own public storefront data is not.
 *
 * Only published businesses show on the record; pending/rejected entries stay
 * private (the app uses status as the moderation gate). This mirrors the
 * eventToSpec guard and ensures deals from unpublished businesses don't leak
 * their names via the deals feed.
 */
export function businessToSpec(row: Row, nodeId: string): PublishSpec | null {
  if (str(row, "status") !== "published") return null;
  const id = str(row, "id");
  const name = str(row, "name");
  if (!id || !name) return null;

  const profile: Record<string, string> = { name, category: "business" };
  const about = str(row, "description");
  if (about) profile.about = about;
  const picture = str(row, "logo_url");
  if (picture) profile.picture = picture;
  const banner = str(row, "cover_image_url");
  if (banner) profile.banner = banner;
  const bizCategory = str(row, "category");
  if (bizCategory) profile.business_category = bizCategory;
  // opening_hours is JSONB; handle both string and object forms.
  const hoursRaw = row["opening_hours"];
  if (hoursRaw) {
    if (typeof hoursRaw === "string" && hoursRaw.trim()) {
      profile.opening_hours = hoursRaw;
    } else if (hoursRaw && typeof hoursRaw === "object") {
      profile.opening_hours = JSON.stringify(hoursRaw);
    }
  }
  const website = str(row, "website_url");
  if (website) profile.website = website;
  const address = str(row, "address");
  if (address) profile.address = address;

  return {
    scope: `biz-${id}`,
    kind: 0,
    d: "",
    content: JSON.stringify(profile),
    tags: [["netizen_org", str(row, "slug") ?? id, nodeId]],
    createdAt: unixFromUpdatedAt(row),
  };
}

/** NIP-23 long-form article. */
export const KIND_LONG_FORM = 30023;
/** NIP-15 product listing. */
export const KIND_PRODUCT = 30018;
/** Scope the marketplace curator publishes under. */
export const MARKET_SCOPE = "markt";

/**
 * A published blog article → NIP-23 long-form content.
 *
 * Only articles owned by organisation accounts (or the town) publish; an
 * article under a personal account is a person's byline, and that needs the
 * same explicit opt-in events do. AI-co-written articles carry their
 * `ai_generated` flag onto the record — the Art. 50 label must survive the
 * trip to other clients, not just render in ours.
 */
export function articleToSpec(
  row: Row,
  orgAccountIds: Set<string>,
  htmlToMd: (html: string) => string,
): PublishSpec | null {
  if (str(row, "status") !== "published") return null;
  const id = str(row, "id");
  const title = str(row, "title");
  if (!id || !title) return null;

  const accountId = str(row, "account_id");
  if (accountId && !orgAccountIds.has(accountId)) return null;
  const scope = accountId ? `org-${accountId}` : TOWN_SCOPE;

  const tags: string[][] = [
    ["d", `article:${id}`],
    ["title", title],
  ];
  const excerpt = str(row, "excerpt");
  if (excerpt) tags.push(["summary", excerpt]);
  const cover = str(row, "cover_image_url");
  if (cover) tags.push(["image", cover]);
  const publishedAt = str(row, "published_at");
  if (publishedAt) tags.push(["published_at", String(Math.floor(Date.parse(publishedAt) / 1000))]);
  const category = str(row, "category");
  if (category) tags.push(["t", category]);
  for (const t of Array.isArray(row["tags"]) ? (row["tags"] as unknown[]) : []) {
    if (typeof t === "string" && t.trim()) tags.push(["t", t.trim()]);
  }
  if (row["ai_generated"] === true) tags.push(["ai_generated", "true"]);

  return {
    scope,
    kind: KIND_LONG_FORM,
    d: `article:${id}`,
    content: htmlToMd(str(row, "content") ?? ""),
    tags,
    createdAt: unixFromUpdatedAt(row),
  };
}

/**
 * A published town news article → NIP-23 long-form content.
 *
 * News is town-curated (admin-authored), so it signs under the town scope and
 * needs no per-owner consent gate. The d prefix `news:` keeps it distinct from
 * org blog articles (`article:`); the `slug` tag lets a record-mode client
 * resolve /news/[slug] routes. The Art. 50 label rides along where present.
 */
export function newsToSpec(row: Row, htmlToMd: (html: string) => string): PublishSpec | null {
  if (str(row, "status") !== "published") return null;
  const id = str(row, "id");
  const title = str(row, "title");
  if (!id || !title) return null;

  const tags: string[][] = [
    ["d", `news:${id}`],
    ["title", title],
    ["t", "news"],
  ];
  const slug = str(row, "slug");
  if (slug) tags.push(["slug", slug]);
  const excerpt = str(row, "excerpt");
  if (excerpt) tags.push(["summary", excerpt]);
  const cover = str(row, "cover_image_url");
  if (cover) tags.push(["image", cover]);
  const publishedAt = str(row, "published_at");
  if (publishedAt) tags.push(["published_at", String(Math.floor(Date.parse(publishedAt) / 1000))]);
  const category = str(row, "category");
  if (category && category !== "news") tags.push(["t", category]);
  // ai_generated does not yet exist on news_articles (only on blog_articles). The guard
  // is harmless when the field is absent and future-proofs the mapper if the column is
  // later added, following the pattern of blog_articles migration.
  if (row["ai_generated"] === true) tags.push(["ai_generated", "true"]);

  return {
    scope: TOWN_SCOPE,
    kind: KIND_LONG_FORM,
    d: `news:${id}`,
    content: htmlToMd(str(row, "content") ?? ""),
    tags,
    createdAt: unixFromUpdatedAt(row),
  };
}

/**
 * A marketplace listing → NIP-15 product, or its withdrawal.
 *
 * Sellers are usually private individuals, so the gate is their own opt-in:
 * the listing publishes only when the seller's wallet holds an unrevoked
 * Nostr binding (they joined the public record), or the listing belongs to an
 * organisation. The seller's npub rides as a `p` tag for attribution — the
 * signing key is the node's market curator, because the node cannot and must
 * not hold the seller's key.
 *
 * Withdrawal is an EDIT, tested before publish by design: any non-active
 * status becomes a content-free tombstone on the same `d`, so a sold or
 * removed listing disappears from every honest client via plain NIP-01
 * replacement — no reliance on advisory deletion.
 */
export function listingToSpec(
  row: Row,
  orgAccountIds: Set<string>,
  optedInWallets: Map<string, string>,
): PublishSpec | null {
  const id = str(row, "id");
  const title = str(row, "title");
  if (!id || !title) return null;

  const accountId = str(row, "account_id");
  const wallet = (str(row, "seller_wallet_address") ?? "").toLowerCase();
  const isOrg = accountId ? orgAccountIds.has(accountId) : false;
  const sellerPubkey = optedInWallets.get(wallet) ?? null;
  if (!isOrg && !sellerPubkey) return null;

  const scope = isOrg && accountId ? `org-${accountId}` : MARKET_SCOPE;
  const d = `listing:${id}`;

  if (str(row, "status") !== "active") {
    return {
      scope,
      kind: KIND_PRODUCT,
      d,
      content: "",
      tags: [
        ["d", d],
        ["status", "withdrawn"],
      ],
      createdAt: unixFromUpdatedAt(row),
    };
  }

  const tags: string[][] = [
    ["d", d],
    ["title", title],
    ["status", "active"],
  ];
  const category = str(row, "category");
  if (category) tags.push(["t", category]);
  const neighborhood = str(row, "neighborhood");
  if (neighborhood) tags.push(["location", neighborhood]);
  for (const url of Array.isArray(row["media_urls"]) ? (row["media_urls"] as unknown[]) : []) {
    if (typeof url === "string" && url.trim()) tags.push(["image", url]);
  }
  if (!isOrg && sellerPubkey) tags.push(["p", sellerPubkey]);

  const content = JSON.stringify({
    id,
    stall_id: MARKET_SCOPE,
    name: title,
    description: str(row, "description") ?? "",
    currency: "EUR",
    price: str(row, "price") ?? "",
    price_type: str(row, "price_type") ?? undefined,
    condition: str(row, "condition") ?? undefined,
    type: str(row, "listing_type") ?? undefined,
  });

  return { scope, kind: KIND_PRODUCT, d, content, tags, createdAt: unixFromUpdatedAt(row) };
}

/**
 * A feed post published under an ORGANISATION account → kind 1 signed by that
 * org's own node-held key.
 *
 * Kind 1 is immutable, so created_at is the post's original wall-clock with NO
 * mapper-version offset — history must keep its dates, and a version bump must
 * not re-mint the past. The citizen device deliberately does not mirror these:
 * a person's key signing an organisation's words would be false attribution.
 */
export function orgPostToSpec(row: Row, orgAccountIds: Set<string>): PublishSpec | null {
  if (str(row, "status") !== "published") return null;
  const id = str(row, "id");
  const accountId = str(row, "account_id");
  if (!id || !accountId || !orgAccountIds.has(accountId)) return null;
  const body = str(row, "content") ?? "";
  const media = Array.isArray(row["media_urls"])
    ? (row["media_urls"] as unknown[]).filter((u): u is string => typeof u === "string" && !!u)
    : [];
  const content = media.length ? `${body}\n\n${media.join("\n")}`.trim() : body;
  if (!content) return null;

  return {
    scope: `org-${accountId}`,
    kind: 1,
    d: "",
    content,
    tags: [],
    createdAt: unixFromCreatedAt(row),
  };
}

/**
 * A business deal ("Angebot") → NIP-99 classified listing (kind 30402).
 *
 * Business data end to end: the deal, its window, its imagery. The business's
 * contact details stay in the node — the app is the contact route.
 */
export function dealToSpec(row: Row, businessNameById: Map<string, string>): PublishSpec | null {
  if (str(row, "status") !== "active" || row["is_active"] !== true) return null;
  const id = str(row, "id");
  const businessId = str(row, "business_id");
  const title = str(row, "title");
  if (!id || !businessId || !title) return null;

  const tags: string[][] = [
    ["d", `deal:${id}`],
    ["title", title],
    ["status", "active"],
  ];
  const dealType = str(row, "deal_type");
  if (dealType) tags.push(["t", dealType]);
  const value = str(row, "deal_value");
  if (value) tags.push(["price", value]);
  const image = str(row, "image_url");
  if (image) tags.push(["image", image]);
  for (const url of Array.isArray(row["media_urls"]) ? (row["media_urls"] as unknown[]) : []) {
    if (typeof url === "string" && url.trim()) tags.push(["image", url]);
  }
  const start = str(row, "start_date");
  if (start) tags.push(["start", start]);
  const end = str(row, "end_date");
  if (end) tags.push(["end", end]);
  const businessName = businessNameById.get(businessId);
  if (businessName) tags.push(["business", businessName]);

  return {
    scope: `biz-${businessId}`,
    kind: 30402,
    d: `deal:${id}`,
    content: str(row, "description") ?? "",
    tags,
    createdAt: unixFromUpdatedAt(row),
  };
}

/** Netizen civic notice — see the fork-with-fallback spec §3.2. */
export const KIND_CIVIC_NOTICE = 32102;

/**
 * A service alert or town announcement → civic notice.
 *
 * Deliberately replaceable: a resolved alert is an EDIT carrying
 * status=resolved, because a civic record where warnings silently vanish is
 * worse than one where they visibly end. Town-signed; alerts and
 * announcements are town speech, not personal speech.
 */
export function noticeToSpec(
  row: Row,
  source: "service_alert" | "announcement",
): PublishSpec | null {
  const id = str(row, "id");
  const title = str(row, "title");
  if (!id || !title) return null;

  // Draft service alerts do not publish — resolved alerts are edits, not filtered.
  if (source === "service_alert" && str(row, "status") === "draft") return null;

  const d = `${source === "service_alert" ? "alert" : "announcement"}:${id}`;
  const active = source === "service_alert" ? row["status"] === "active" : row["is_active"] === true;
  const tags: string[][] = [
    ["d", d],
    ["title", title],
    ["t", source],
    ["status", active ? "active" : "resolved"],
  ];
  const severity = str(row, "severity");
  if (severity) tags.push(["severity", severity]);

  return {
    scope: TOWN_SCOPE,
    kind: KIND_CIVIC_NOTICE,
    d,
    content: str(row, "description") ?? str(row, "content") ?? "",
    tags,
    createdAt: unixFromUpdatedAt(row),
  };
}

/** Netizen menu — see the fork-with-fallback spec §3.2. */
export const KIND_MENU = 32101;

export interface MenuInput {
  restaurant: Row;
  categories: Row[];
  itemsByCategory: Map<string, Row[]>;
}

/**
 * A restaurant's whole menu → one parameterised replaceable event.
 *
 * One event per restaurant, not per dish: menus change as a unit, and a
 * single `d = restaurant:<id>` makes every menu edit a clean NIP-01
 * replacement. Custom kind — no NIP covers menus — documented in
 * CONSUMING_THE_RECORD.md. Prices publish as raw decimal strings + EUR;
 * formatting is the client's job.
 *
 * Returns null for restaurants that are not publicly visible (pending/rejected/unpublished).
 */
export function menuToSpec(input: MenuInput, orgAccountIds: Set<string>): PublishSpec | null {
  const row = input.restaurant;
  const id = str(row, "id");
  const name = str(row, "name");
  if (!id || !name) return null;

  // Gate: only publish menus for approved or published restaurants.
  // Matches apps/web/src/app/karte/page.tsx:29 which uses .in("status", ["approved", "published"]).
  const status = str(row, "status");
  if (status && !["approved", "published"].includes(status)) return null;

  const accountId = str(row, "account_id");
  const scope = accountId && orgAccountIds.has(accountId) ? `org-${accountId}` : `resto-${id}`;

  const sorted = [...input.categories].sort(
    (a, b) => Number(a["sort_order"] ?? 0) - Number(b["sort_order"] ?? 0),
  );
  const categories = sorted.flatMap((cat) => {
    const catId = str(cat, "id");
    const catName = str(cat, "name");
    if (!catId || !catName) return [];
    // Skip inactive categories (parity with app's strict .eq("is_active", true)).
    if (cat["is_active"] !== true) return [];
    const items = (input.itemsByCategory.get(catId) ?? [])
      .filter((i) => i["is_available"] !== false)
      .flatMap((i) => {
        const itemName = str(i, "name");
        if (!itemName) return [];
        const item: Record<string, string> = { name: itemName, currency: "EUR" };
        const desc = str(i, "description");
        if (desc) item.description = desc;
        const price = i["price"];
        if (price !== null && price !== undefined && String(price).trim() !== "") {
          item.price = String(price);
        }
        return [item];
      });
    return [{ name: catName, items }];
  });

  const tags: string[][] = [
    ["d", `restaurant:${id}`],
    ["title", name],
    ["t", "menu"],
  ];
  const slug = str(row, "slug");
  if (slug) tags.push(["slug", slug]);
  const address = str(row, "address");
  if (address) tags.push(["location", address]);
  const image = str(row, "logo_url");
  if (image) tags.push(["image", image]);

  return {
    scope,
    kind: KIND_MENU,
    d: `restaurant:${id}`,
    content: JSON.stringify({ categories }),
    tags,
    createdAt: unixFromUpdatedAt(row),
  };
}
