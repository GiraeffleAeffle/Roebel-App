/**
 * The dataset layer: typed functions that turn record events back into the
 * shapes the web app already renders (calendar, cinema, articles, news,
 * organisation profiles).
 *
 * Pure readers over `RecordClient` + the tag helpers — no fetch/parse logic
 * lives here beyond what `RecordClient` already does, and no network calls
 * happen anywhere but through `client.events()`. Kept dependency-free at
 * runtime per package discipline; the mapping rules mirror
 * `docs/CONSUMING_THE_RECORD.md` and MUST stay pinned to
 * `packages/publisher/src/mappers.ts` (see `test/parity.test.ts`).
 *
 * The index's own `kinds`/`d` filters narrow the wire, but every function
 * here re-filters after the fetch: the index only knows `kind`, not the
 * event/movie split hiding inside a shared kind (the `t` tag) or the
 * article/news split hiding inside a shared kind (the `d` prefix) — those
 * distinctions are dataset-layer knowledge, not transport-layer knowledge.
 */

import type { RecordClient, RecordEvent } from "./client";
import { dSuffix, tagValue, tagValues } from "./tags";

/** NIP-52 time-based calendar event — events AND cinema screenings share this kind. */
const KIND_CALENDAR_TIME = 31923;
/** NIP-23 long-form content — org blog articles AND town news share this kind. */
const KIND_LONG_FORM = 30023;
/** Profile (citizens, agents, organisations). */
const KIND_PROFILE = 0;

export interface EventRow {
  id: string;
  title: string;
  description: string | null;
  date: string; // "YYYY-MM-DD" Berlin
  time: string | null; // "HH:MM" Berlin
  end_time: string | null;
  location: string | null;
  category: string | null;
  image_url: string | null;
  website_url: string | null;
  ticket_price: string | null;
  status: "approved";
  account_id: string | null;
  /** From the `address` tag (`eventToSpec` publishes `formatted_address` under
   * this tag name — not to be confused with `location`, which falls back to
   * the same source column but is a separate tag). Only set when the
   * organiser filled in a geocoded address. */
  address: string | null;
  /** From the `latitude`/`longitude` tags — `eventToSpec` only emits them as
   * a pair when both are numeric, so on the record either both are set or
   * both are null. */
  latitude: number | null;
  longitude: number | null;
  /**
   * The signing pubkey — NOT in the brief's original interface block, added
   * per review: org-owned events carry no `p` tag (eventToSpec sets
   * ownerPubkey null whenever isOrg is true), so the signing pubkey is the
   * ONLY signal a record-mode client has to join "this org's events" back to
   * its OrgRow.pubkey, per CONSUMING_THE_RECORD.md's "the org's pubkey is
   * its identity" rule.
   */
  pubkey: string;
}

export interface MovieRow {
  id: string;
  title: string;
  description: string | null;
  date: string;
  time: string | null;
  cover_image_url: string | null;
  trailer_youtube_url: string | null;
  fsk: string | null;
  status: "published";
  created_at: string;
  updated_at: string;
  /** The signing pubkey — cinema screenings are signed by the cinema's own
   * key; carried for the same org↔content join events/articles use. */
  pubkey: string;
} // matches apps/web actions/movies.ts Movie

export interface ArticleRow {
  id: string;
  slug: string | null;
  title: string;
  excerpt: string | null;
  content_md: string;
  cover_image_url: string | null;
  category: string | null;
  published_at: string | null;
  ai_generated: boolean;
  /** The signing pubkey — org blog articles are signed by that org's own
   * key; joins back to OrgRow.pubkey per CONSUMING_THE_RECORD.md. */
  pubkey: string;
}

export interface OrgRow {
  id: string;
  slug: string;
  name: string;
  bio: string | null;
  avatar_url: string | null;
  cover_url: string | null;
  category: string | null;
  opening_hours: string | null;
  is_business: boolean;
  /** `businessToSpec` publishes `profile.address`; `orgToSpec` never does —
   * so this is only ever set for a business-category profile (`is_business`
   * true), null for every other org. Never set for restaurants specifically
   * (no separate restaurant profile is published today — see MenuData's
   * pubkey doc comment in civic.ts), and there is no `latitude`/`longitude`
   * on the wire for any profile kind, so a record-mode map cannot place a
   * business/restaurant marker even with this field. */
  address: string | null;
  pubkey: string;
}

/**
 * unix seconds → Berlin wall-clock date+time. The exact inverse of the
 * publisher's `berlinToUnix` (packages/publisher/src/mappers.ts).
 */
export function unixToBerlin(unix: number): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(unix * 1000));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

/** "" from a `str() ?? ""` mapper default round-trips to null, same as the never-published row. */
function nullIfEmpty(v: string): string | null {
  return v === "" ? null : v;
}

/** A numeric tag value, or `null` if the tag is absent or not a finite number. */
function numOrNull(v: string | null): number | null {
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toEventRow(ev: RecordEvent): EventRow | null {
  const id = dSuffix(ev, "event");
  if (id === null) return null;
  const startRaw = tagValue(ev, "start");
  if (startRaw === null) return null;
  const { date, time } = unixToBerlin(Number(startRaw));
  const endRaw = tagValue(ev, "end");
  return {
    id,
    title: tagValue(ev, "title") ?? "",
    description: nullIfEmpty(ev.content),
    date,
    time,
    end_time: endRaw !== null ? unixToBerlin(Number(endRaw)).time : null,
    location: tagValue(ev, "location"),
    category: tagValue(ev, "t"),
    image_url: tagValue(ev, "image"),
    // eventToSpec pushes website_url's "r" tag before livestream_url's, so the
    // first "r" tag wins when both are present. KNOWN LIMITATION: for a
    // livestream-only event (no website_url set), the single "r" tag IS the
    // livestream URL and will be misreported as website_url here — the wire
    // format has one tag name ("r") for website/trailer/livestream alike
    // (CONSUMING_THE_RECORD.md kind 31923), so a reader cannot tell them
    // apart without a distinguishing marker the mapper does not emit.
    website_url: tagValues(ev, "r")[0] ?? null,
    ticket_price: tagValue(ev, "price"),
    address: tagValue(ev, "address"),
    latitude: numOrNull(tagValue(ev, "latitude")),
    longitude: numOrNull(tagValue(ev, "longitude")),
    status: "approved",
    // Never published to the record (mappers.ts §eventToSpec) — the record's
    // privacy boundary drops the Supabase account id on purpose; a keyless
    // fork has no way to recover it.
    account_id: null,
    pubkey: ev.pubkey,
  };
}

/** kind 31923 where `t` ≠ `kino` — screenings live in `listMovies` instead. */
export async function listEvents(
  client: RecordClient,
  opts?: { limit?: number; until?: number },
): Promise<EventRow[]> {
  const events = await client.events({ kinds: [KIND_CALENDAR_TIME], limit: opts?.limit, until: opts?.until });
  const rows: EventRow[] = [];
  for (const ev of events) {
    if (tagValues(ev, "t").includes("kino")) continue;
    if (tagValue(ev, "status") === "cancelled") continue;
    const row = toEventRow(ev);
    if (row) rows.push(row);
  }
  return rows;
}

/** d = event:<id> */
export async function getEventById(client: RecordClient, id: string): Promise<EventRow | null> {
  const events = await client.events({ kinds: [KIND_CALENDAR_TIME], d: [`event:${id}`] });
  for (const ev of events) {
    if (dSuffix(ev, "event") !== id) continue;
    if (tagValues(ev, "t").includes("kino")) continue;
    if (tagValue(ev, "status") === "cancelled") continue;
    const row = toEventRow(ev);
    if (row) return row;
  }
  return null;
}

/** kind 31923 with `t = kino`. */
export async function listMovies(client: RecordClient, opts?: { limit?: number }): Promise<MovieRow[]> {
  const events = await client.events({ kinds: [KIND_CALENDAR_TIME], limit: opts?.limit });
  const rows: MovieRow[] = [];
  for (const ev of events) {
    if (!tagValues(ev, "t").includes("kino")) continue;
    const id = dSuffix(ev, "movie");
    const startRaw = tagValue(ev, "start");
    if (id === null || startRaw === null) continue;
    const { date, time } = unixToBerlin(Number(startRaw));
    const editedAt = new Date(ev.created_at * 1000).toISOString();
    rows.push({
      id,
      title: tagValue(ev, "title") ?? "",
      description: nullIfEmpty(ev.content),
      date,
      time,
      cover_image_url: tagValue(ev, "image"),
      trailer_youtube_url: tagValue(ev, "r"),
      fsk: tagValue(ev, "fsk"),
      status: "published",
      // movieToSpec carries no separate created_at/updated_at tags — the
      // event's own `created_at` (the row's updated_at + mapper version, see
      // mappers.ts unixFromUpdatedAt) is the only edit-time signal on the wire.
      created_at: editedAt,
      updated_at: editedAt,
      pubkey: ev.pubkey,
    });
  }
  return rows;
}

/**
 * KNOWN LIMITATION (org articles only — marker === null): `articleToSpec`
 * (mappers.ts) tags a formal category the SAME way it tags free-form topics
 * — both are `["t", <value>]`, with the category (when set) pushed first and
 * topics appended after, and NO third field or separate tag name to tell
 * them apart. `newsToSpec` sidesteps this with an explicit `["t","news"]`
 * marker (stripped out here via `marker`), but org articles have no such
 * marker.
 *
 * Consequence: this function returns the FIRST `t` value unconditionally.
 * When a formal category IS set, that is the correct value (it's always
 * pushed before any topic). When NO formal category is set but topic tags
 * exist, the first TOPIC is returned as though it were the category — an
 * actively wrong value, not merely a missing one. This is pinned and
 * documented, not fixed, because fixing it (e.g. always returning `null` for
 * org articles) would just move the wrongness the other way: it would also
 * discard every LEGITIMATE category, which is the more common case an org
 * actually sets one. See test/parity.test.ts "listArticles: no formal
 * category" for the pinned, visible wrong-case assertion. A real fix needs a
 * wire-format change on the publish side (a distinct tag name or a marker
 * tag for "this t is the category"), which is out of scope for a read-only
 * dataset reader.
 */
function articleCategory(ev: RecordEvent, marker: string | null): string | null {
  const ts = tagValues(ev, "t");
  if (marker) return ts.find((t) => t !== marker) ?? null;
  return ts[0] ?? null;
}

function toArticleRow(ev: RecordEvent, id: string, marker: string | null): ArticleRow {
  const publishedAt = tagValue(ev, "published_at");
  return {
    id,
    slug: tagValue(ev, "slug"),
    title: tagValue(ev, "title") ?? "",
    excerpt: tagValue(ev, "summary"),
    content_md: ev.content,
    cover_image_url: tagValue(ev, "image"),
    category: articleCategory(ev, marker),
    published_at: publishedAt !== null ? new Date(Number(publishedAt) * 1000).toISOString() : null,
    ai_generated: tagValue(ev, "ai_generated") === "true",
    pubkey: ev.pubkey,
  };
}

/** kind 30023 with `d` prefix `news:`. News always carries a `t: news` marker tag (mappers.ts newsToSpec). */
export async function listNews(client: RecordClient, opts?: { limit?: number }): Promise<ArticleRow[]> {
  const events = await client.events({ kinds: [KIND_LONG_FORM], limit: opts?.limit });
  const rows: ArticleRow[] = [];
  for (const ev of events) {
    const id = dSuffix(ev, "news");
    if (id === null) continue;
    rows.push(toArticleRow(ev, id, "news"));
  }
  return rows;
}

/** Scans `listNews(limit 200)` for the `slug` tag — town news volume makes this fine. */
export async function getNewsBySlug(client: RecordClient, slug: string): Promise<ArticleRow | null> {
  const news = await listNews(client, { limit: 200 });
  return news.find((n) => n.slug === slug) ?? null;
}

/** kind 30023 with `d` prefix `article:` (org blog articles — no `news` marker tag). */
export async function listArticles(client: RecordClient, opts?: { limit?: number }): Promise<ArticleRow[]> {
  const events = await client.events({ kinds: [KIND_LONG_FORM], limit: opts?.limit });
  const rows: ArticleRow[] = [];
  for (const ev of events) {
    const id = dSuffix(ev, "article");
    if (id === null) continue;
    rows.push(toArticleRow(ev, id, null));
  }
  return rows;
}

/** Org profiles are not paginated town-side; the roster is small, so one generous fetch covers it. */
const ORG_FETCH_LIMIT = 200;

/** kind 0 with a `netizen_org` tag — both `orgToSpec` and `businessToSpec` emit this shape. */
export async function listOrgs(client: RecordClient): Promise<OrgRow[]> {
  const events = await client.events({ kinds: [KIND_PROFILE], limit: ORG_FETCH_LIMIT });
  const rows: OrgRow[] = [];
  for (const ev of events) {
    const orgTag = ev.tags.find((t) => t[0] === "netizen_org");
    if (!orgTag) continue;
    const slug = orgTag[1];
    if (!slug) continue;
    let profile: Record<string, unknown>;
    try {
      profile = JSON.parse(ev.content) as Record<string, unknown>;
    } catch {
      continue;
    }
    const str = (k: string) => (typeof profile[k] === "string" ? (profile[k] as string) : null);
    rows.push({
      // kind 0 carries no `d` tag — the record's account id is not published
      // (orgToSpec/businessToSpec, mappers.ts), so the slug IS the id a
      // keyless fork can key on.
      id: slug,
      slug,
      name: str("name") ?? "",
      bio: str("about"),
      avatar_url: str("picture"),
      cover_url: str("banner"),
      category: str("category"),
      opening_hours: str("opening_hours"),
      is_business: str("category") === "business",
      address: str("address"),
      pubkey: ev.pubkey,
    });
  }
  return rows;
}

export async function getOrgBySlug(client: RecordClient, slug: string): Promise<OrgRow | null> {
  const orgs = await listOrgs(client);
  return orgs.find((o) => o.slug === slug) ?? null;
}
