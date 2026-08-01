import { test } from "node:test";
import assert from "node:assert/strict";
import { articleToSpec, businessToSpec, dealToSpec, eventToSpec, movieToSpec, newsToSpec, orgToSpec } from "@netizen-labs/publisher";
import { deriveOrgIdentity } from "@netizen-labs/nostr";
import { RecordClient } from "../src/index";
import { listArticles, listEvents, listMovies, listNews, listOrgs, unixToBerlin } from "../src/datasets";
import { listDeals } from "../src/civic";
import { asRecordEvent } from "./helpers";

const clientFor = (events: unknown[]) =>
  new RecordClient("https://i", (async () => new Response(JSON.stringify({ events }))) as unknown as typeof fetch);

test("round-trip parity: event row → publisher spec → record row", async () => {
  const row = {
    id: "e1", title: "Hafenfest", description: "Musik am See", date: "2026-08-14", time: "19:30",
    end_time: "23:00", location: "Stadthafen", category: "fest", image_url: "https://x/e.jpg",
    status: "approved", updated_at: "2026-07-02T10:00:00Z", created_at: "2026-07-01T10:00:00Z",
  };
  const spec = eventToSpec(row, new Set(), new Map());
  const [back] = await listEvents(clientFor([asRecordEvent(spec!)]));
  assert.equal(back.id, "e1");
  assert.equal(back.title, "Hafenfest");
  assert.equal(back.date, "2026-08-14");
  assert.equal(back.time, "19:30");
  assert.equal(back.location, "Stadthafen");
  assert.equal(back.image_url, "https://x/e.jpg");
});

// --- Review fix: karte/page.tsx record-mode markers ---
//
// eventToSpec DOES publish latitude/longitude/address tags (mappers.ts
// eventToSpec:142-148) — an earlier pass wrongly treated this as absent from
// the record and rendered an empty map. These pin that the coordinates
// actually survive the wire round-trip, same discipline as the media_urls
// fix before it.

test("round-trip parity: event coordinates and address survive eventToSpec → listEvents", async () => {
  const row = {
    id: "e10", title: "Open-Air-Kino", description: "Filmabend am See", date: "2026-08-22", time: "21:00",
    formatted_address: "Seepromenade 3, 17207 Röbel/Müritz", latitude: 53.3706, longitude: 12.6033,
    status: "approved", updated_at: "2026-07-02T10:00:00Z",
  };
  const spec = eventToSpec(row, new Set(), new Map());
  const [back] = await listEvents(clientFor([asRecordEvent(spec!)]));
  assert.equal(back.address, "Seepromenade 3, 17207 Röbel/Müritz");
  assert.equal(back.latitude, 53.3706);
  assert.equal(back.longitude, 12.6033);
});

test("round-trip parity: event with no address/coordinates round-trips to null, not 0", async () => {
  const row = {
    id: "e11", title: "Sitzung im Rathaus", date: "2026-08-23", time: "18:00",
    status: "approved", updated_at: "2026-07-02T10:00:00Z",
  };
  const spec = eventToSpec(row, new Set(), new Map());
  const [back] = await listEvents(clientFor([asRecordEvent(spec!)]));
  assert.equal(back.address, null);
  assert.equal(back.latitude, null);
  assert.equal(back.longitude, null);
});

test("round-trip parity: business address is recovered on OrgRow; businessToSpec never publishes lat/lng", async () => {
  const bizRow = {
    id: "b1", status: "published", name: "Café am Hafen", address: "Am Hafen 2, 17207 Röbel/Müritz",
    category: "gastronomie", slug: "cafe-am-hafen", updated_at: "2026-07-02T10:00:00Z",
  };
  const spec = businessToSpec(bizRow, "roebel");
  const [org] = await listOrgs(clientFor([asRecordEvent(spec!)]));
  assert.equal(org.address, "Am Hafen 2, 17207 Röbel/Müritz");
  assert.equal(org.is_business, true);
});

test("round-trip parity: news", async () => {
  const spec = newsToSpec(
    { id: "n1", slug: "s1", title: "T", excerpt: "E", content: "<p>Body</p>",
      status: "published", updated_at: "2026-07-02T10:00:00Z" },
    (h) => h.replace(/<[^>]+>/g, ""),
  );
  const [back] = await listNews(clientFor([asRecordEvent(spec!)]));
  assert.equal(back.id, "n1");
  assert.equal(back.slug, "s1");
  assert.equal(back.content_md, "Body");
});

test("round-trip parity: movie (t=kino) routes to listMovies, not listEvents", async () => {
  const movieRow = {
    id: "m1", title: "Dune", description: "Wüstenplanet", date: "2026-08-20", time: "20:00",
    cover_image_url: "https://x/m.jpg", trailer_youtube_url: "https://y/trailer", fsk: "12",
    status: "published", updated_at: "2026-07-02T10:00:00Z",
  };
  const eventRow = {
    id: "e2", title: "Marktplatzfest", description: null, date: "2026-08-21", time: "10:00",
    status: "approved", updated_at: "2026-07-02T10:00:00Z",
  };
  const movieSpec = movieToSpec(movieRow);
  const eventSpec = eventToSpec(eventRow, new Set(), new Map());
  const events = [asRecordEvent(movieSpec!), asRecordEvent(eventSpec!)];

  const movies = await listMovies(clientFor(events));
  assert.equal(movies.length, 1);
  assert.equal(movies[0].id, "m1");
  assert.equal(movies[0].title, "Dune");
  assert.equal(movies[0].fsk, "12");
  assert.equal(movies[0].cover_image_url, "https://x/m.jpg");
  assert.equal(movies[0].trailer_youtube_url, "https://y/trailer");
  assert.equal(movies[0].status, "published");

  const list = await listEvents(clientFor(events));
  assert.equal(list.length, 1);
  assert.equal(list[0].id, "e2");
});

test("round-trip parity: org profile — pubkey preserved, is_business false", async () => {
  const orgRow = {
    id: "o1", account_type: "organisation", name: "Freiwillige Feuerwehr", bio: "Ehrenamt seit 1900",
    avatar_url: "https://x/a.jpg", cover_url: "https://x/c.jpg", sub_type: "verein",
    opening_hours: "Mo-Fr 9-17", slug: "feuerwehr", updated_at: "2026-07-02T10:00:00Z",
  };
  const spec = orgToSpec(orgRow, "roebel");
  const pubkey = "a".repeat(64);
  const [org] = await listOrgs(clientFor([asRecordEvent(spec!, pubkey)]));
  assert.equal(org.slug, "feuerwehr");
  assert.equal(org.name, "Freiwillige Feuerwehr");
  assert.equal(org.bio, "Ehrenamt seit 1900");
  assert.equal(org.avatar_url, "https://x/a.jpg");
  assert.equal(org.cover_url, "https://x/c.jpg");
  assert.equal(org.opening_hours, "Mo-Fr 9-17");
  assert.equal(org.pubkey, pubkey);
  assert.equal(org.is_business, false);
  // orgToSpec publishes the row's own sub_type under the shared `category`
  // key — for an accounts org (is_business false) that key IS the real
  // sub_type, unlike businessToSpec's hardcoded "business" marker.
  assert.equal(org.category, "verein");
  assert.equal(org.business_category, null);
  assert.equal(org.website, null);
});

// --- business_category / website: on the wire, not previously surfaced ---
//
// businessToSpec publishes the businesses table's real category under
// profile.business_category (mappers.ts:267-268) — separate from the
// hardcoded "business" marker under profile.category, which OrgRow.category
// alone cannot distinguish from an accounts org's real sub_type. Same class
// of gap as the karte/page.tsx lat/lng fix: on the wire, not yet mapped.
test("round-trip parity: business_category and website are recovered on OrgRow", async () => {
  const bizRow = {
    id: "b2", status: "published", name: "Gasthaus Seeblick", category: "gastronomie",
    website_url: "https://gasthaus-seeblick.example", slug: "gasthaus-seeblick",
    updated_at: "2026-07-02T10:00:00Z",
  };
  const spec = businessToSpec(bizRow, "roebel");
  const [org] = await listOrgs(clientFor([asRecordEvent(spec!)]));
  assert.equal(org.is_business, true);
  assert.equal(org.category, "business");
  assert.equal(org.business_category, "gastronomie");
  assert.equal(org.website, "https://gasthaus-seeblick.example");
});

test("unixToBerlin is the exact inverse of berlinToUnix for a Berlin summer (CEST) instant", () => {
  // 2026-08-14 19:30 Europe/Berlin is CEST (UTC+2) -> 17:30 UTC -> unix 1786728600
  const { date, time } = unixToBerlin(1786728600);
  assert.equal(date, "2026-08-14");
  assert.equal(time, "19:30");
});

test("unixToBerlin is the exact inverse of berlinToUnix for a Berlin winter (CET) instant", () => {
  // 2026-01-15 10:15 Europe/Berlin is CET (UTC+1) -> 09:15 UTC -> unix 1768468500
  const { date, time } = unixToBerlin(1768468500);
  assert.equal(date, "2026-01-15");
  assert.equal(time, "10:15");
});

// --- Review fix: the org↔content join (CONSUMING_THE_RECORD.md:46-47) ---
//
// "the org's pubkey is its identity: events and articles signed by the same
// pubkey belong to that org — that is how you join org ↔ their content."
// Org-owned events carry no `p` tag (eventToSpec sets ownerPubkey null
// whenever isOrg is true), so RecordEvent.pubkey is the ONLY signal. This
// test proves the join end to end using the SAME identity derivation
// signSpec (packages/publisher/src/sync.ts) actually uses in production —
// deriveOrgIdentity(nodeSecret, nodeId, scope) — rather than just passing
// the same string into two independent test constructors.

test("org-signed event's pubkey joins to that org's own profile pubkey", async () => {
  const nodeSecret = "s".repeat(32);
  const nodeId = "roebel";
  const accountId = "acc-feuerwehr";

  const orgRow = {
    id: accountId, account_type: "organisation", name: "Freiwillige Feuerwehr",
    slug: "feuerwehr", updated_at: "2026-07-02T10:00:00Z",
  };
  const eventRow = {
    id: "e9", title: "Vereinsabend", date: "2026-09-01", time: "18:00",
    account_id: accountId, status: "approved", updated_at: "2026-07-02T10:00:00Z",
  };

  const orgSpec = orgToSpec(orgRow, nodeId)!;
  const eventSpec = eventToSpec(eventRow, new Set([accountId]), new Map())!;
  // Both specs must land on the same scope, or there is nothing to prove —
  // this is exactly the invariant signSpec relies on to sign an org's
  // profile and its events under one identity.
  assert.equal(orgSpec.scope, eventSpec.scope);
  const identity = deriveOrgIdentity(nodeSecret, nodeId, orgSpec.scope);

  const [org] = await listOrgs(clientFor([asRecordEvent(orgSpec, identity.publicKey)]));
  const [event] = await listEvents(clientFor([asRecordEvent(eventSpec, identity.publicKey)]));

  assert.equal(event.pubkey, identity.publicKey);
  assert.equal(org.pubkey, identity.publicKey);
  assert.equal(event.pubkey, org.pubkey, "an org's event and its own profile must resolve to the same pubkey");
});

// --- Review fix: listArticles category ambiguity, pinned not accidental ---

test("round-trip parity: listArticles — a formal category is recovered correctly, slug is null", async () => {
  const spec = articleToSpec(
    { id: "a1", title: "Vereinsfest 2026", excerpt: "Zusammenfassung", content: "<p>Inhalt</p>",
      category: "Veranstaltung", status: "published", updated_at: "2026-07-02T10:00:00Z" },
    new Set(),
    (h) => h.replace(/<[^>]+>/g, ""),
  );
  const [back] = await listArticles(clientFor([asRecordEvent(spec!)]));
  assert.equal(back.id, "a1");
  assert.equal(back.category, "Veranstaltung");
  // articleToSpec never emits a "slug" tag (only newsToSpec does) — pinned null.
  assert.equal(back.slug, null);
});

test("round-trip parity: listArticles — KNOWN LIMITATION: no formal category, first topic is misreported as category", async () => {
  const spec = articleToSpec(
    { id: "a2", title: "Sommerfest Rückblick", content: "<p>Rückblick</p>",
      tags: ["sommer", "rueckblick"], status: "published", updated_at: "2026-07-02T10:00:00Z" },
    new Set(),
    (h) => h.replace(/<[^>]+>/g, ""),
  );
  const [back] = await listArticles(clientFor([asRecordEvent(spec!)]));
  // This is the documented wire-format ambiguity, pinned so it is visible and
  // deliberate rather than an accidental regression: with no formal category,
  // "sommer" (the first topic tag) is indistinguishable from a category tag
  // at read time and is reported as one. See the articleCategory doc comment
  // in src/datasets.ts.
  assert.equal(back.category, "sommer");
});

// --- Task 12: DealRow.media_urls — every `image` tag, not just the first ---
//
// dealToSpec pushes one `image` tag for the primary image_url, then one more
// per media_urls entry (mappers.ts:523-527) — all on the wire. DealRow used
// to surface only tagValues(...)[0] as image_url; a business-deal card that
// wants the full gallery needs the whole list. The `createDeal`/`updateDeal`
// actions (apps/web) always sync image_url = media_urls[0], so a second,
// DISTINCT photo is the realistic case that proves the fuller gallery is
// recovered.
test("round-trip parity: deal media_urls carries every image tag, not just the first", async () => {
  const dealRow = {
    id: "d1", business_id: "b1", title: "Sommer-Rabatt", description: "20% auf alles",
    deal_type: "discount", deal_value: "20%", image_url: "https://x/cover.jpg",
    media_urls: ["https://x/cover.jpg", "https://x/second.jpg"],
    start_date: "2026-08-01", end_date: "2026-08-31", status: "active", is_active: true,
    updated_at: "2026-07-02T10:00:00Z",
  };
  const spec = dealToSpec(dealRow, new Map([["b1", "Café am Hafen"]]));
  const [deal] = await listDeals(clientFor([asRecordEvent(spec!)]));
  assert.equal(deal.image_url, "https://x/cover.jpg");
  // dealToSpec pushes image_url's own tag first, then one per media_urls
  // entry — since media_urls[0] IS image_url in real usage, the cover photo
  // is genuinely duplicated on the wire. Pinned as-is rather than deduped,
  // same "trust the wire" discipline as the rest of this file.
  assert.deepEqual(deal.media_urls, ["https://x/cover.jpg", "https://x/cover.jpg", "https://x/second.jpg"]);
  assert.equal(deal.business_name, "Café am Hafen");
});
