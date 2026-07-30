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

function unixFromUpdatedAt(row: Row): number {
  const raw = str(row, "updated_at") ?? str(row, "created_at");
  const parsed = raw ? Date.parse(raw) : NaN;
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0;
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
export function eventToSpec(row: Row, orgAccountIds: Set<string>): PublishSpec | null {
  if (str(row, "status") !== "approved") return null;
  const id = str(row, "id");
  const title = str(row, "title");
  const date = str(row, "date");
  if (!id || !title || !date) return null;

  const accountId = str(row, "account_id");
  if (accountId && !orgAccountIds.has(accountId)) return null;
  const scope = accountId ? `org-${accountId}` : TOWN_SCOPE;

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

  return {
    scope: `org-${id}`,
    kind: 0,
    d: "",
    content: JSON.stringify(profile),
    tags: [["netizen_org", str(row, "slug") ?? id, nodeId]],
    createdAt: unixFromUpdatedAt(row),
  };
}
