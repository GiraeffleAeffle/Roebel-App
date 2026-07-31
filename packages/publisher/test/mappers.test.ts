import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { htmlToMarkdown } from "../src/html-to-md.js";
import { articleToSpec, berlinToUnix, businessToSpec, dealToSpec, eventToSpec, listingToSpec, MAPPER_VERSION, movieToSpec, newsToSpec, orgPostToSpec, orgToSpec } from "../src/mappers.js";

const ORG_ID = "11111111-1111-1111-1111-111111111111";
const ORGS = new Set([ORG_ID]);

const EVENT_ROW = {
  id: "ev-1",
  account_id: ORG_ID,
  title: "Seefest",
  description: "Fest am Hafen",
  date: "2026-08-14",
  time: "19:30:00",
  end_time: "23:00:00",
  location: "Hafen Röbel",
  formatted_address: "Am Hafen 1, 17207 Röbel",
  category: "fest",
  image_url: "https://cdn/img.jpg",
  website_url: "https://seefest.example",
  ticket_price: "5 €",
  is_cancelled: false,
  status: "approved",
  updated_at: "2026-07-30T10:00:00+00:00",
  // Fields that must NEVER be copied — present here to prove they are not.
  organizer_email: "privat@example.com",
  organizer_phone: "+49 170 000000",
  organizer_name: "Erika Musterfrau",
};

describe("event mapping", () => {
  it("builds a NIP-52 event with the record id as its d tag", () => {
    const spec = eventToSpec(EVENT_ROW, ORGS)!;
    assert.equal(spec.kind, 31923);
    assert.equal(spec.d, "event:ev-1");
    assert.equal(spec.scope, `org-${ORG_ID}`);
    assert.deepEqual(spec.tags.find((t) => t[0] === "title"), ["title", "Seefest"]);
    assert.deepEqual(spec.tags.find((t) => t[0] === "status"), ["status", "confirmed"]);
    // created_at is the row's updated_at — the idempotency anchor.
    assert.equal(spec.createdAt, Math.floor(Date.parse(EVENT_ROW.updated_at) / 1000) + MAPPER_VERSION);
  });

  it("NEVER copies organiser contact data — the privacy boundary is the mapper", () => {
    const spec = eventToSpec(EVENT_ROW, ORGS)!;
    const serialized = JSON.stringify(spec);
    assert.ok(!serialized.includes("privat@example.com"));
    assert.ok(!serialized.includes("+49 170"));
    assert.ok(!serialized.includes("Musterfrau"));
  });

  it("refuses events owned by personal accounts — publishing a name needs opt-in", () => {
    const personal = { ...EVENT_ROW, account_id: "some-personal-account" };
    assert.equal(eventToSpec(personal, ORGS), null);
  });

  it("publishes accountless (town-curated) events under the town scope", () => {
    const town = { ...EVENT_ROW, account_id: null };
    assert.equal(eventToSpec(town, ORGS)!.scope, "town");
  });

  it("refuses anything not approved", () => {
    assert.equal(eventToSpec({ ...EVENT_ROW, status: "pending" }, ORGS), null);
  });

  it("a cancellation is an edit, not a deletion", () => {
    const spec = eventToSpec({ ...EVENT_ROW, is_cancelled: true }, ORGS)!;
    assert.deepEqual(spec.tags.find((t) => t[0] === "status"), ["status", "cancelled"]);
    assert.equal(spec.d, "event:ev-1");
  });
});

describe("cinema mapping", () => {
  const MOVIE = {
    id: "mv-1",
    title: "Das Boot",
    description: "Klassiker",
    date: "2026-08-01",
    time: "20:00:00",
    fsk: 12,
    cover_image_url: "https://cdn/boot.jpg",
    trailer_youtube_url: "https://youtu.be/x",
    status: "published",
    updated_at: "2026-07-29T08:00:00+00:00",
  };

  it("maps a screening to NIP-52 under the cinema's own identity", () => {
    const spec = movieToSpec(MOVIE)!;
    assert.equal(spec.kind, 31923);
    assert.equal(spec.scope, "kino");
    assert.equal(spec.d, "movie:mv-1");
    assert.deepEqual(spec.tags.find((t) => t[0] === "fsk"), ["fsk", "12"]);
  });

  it("refuses unpublished screenings", () => {
    assert.equal(movieToSpec({ ...MOVIE, status: "draft" }), null);
  });
});

describe("organisation mapping", () => {
  const ORG_ROW = {
    id: ORG_ID,
    account_type: "organisation",
    name: "Hafenverein Röbel",
    bio: "Wir kümmern uns um den Hafen.",
    avatar_url: "https://cdn/hafen.png",
    slug: "hafenverein",
    contact_email: "vorstand@hafenverein.example",
    updated_at: "2026-07-28T12:00:00+00:00",
  };

  it("publishes a kind 0 signed by the org's scope, named by its slug", () => {
    const spec = orgToSpec(ORG_ROW, "roebel")!;
    assert.equal(spec.kind, 0);
    assert.equal(spec.scope, `org-${ORG_ID}`);
    assert.deepEqual(spec.tags, [["netizen_org", "hafenverein", "roebel"]]);
    assert.deepEqual(JSON.parse(spec.content), {
      name: "Hafenverein Röbel",
      about: "Wir kümmern uns um den Hafen.",
      picture: "https://cdn/hafen.png",
      slug: "hafenverein",
    });
  });

  it("keeps even the org's contact email off the record", () => {
    const spec = orgToSpec(ORG_ROW, "roebel")!;
    assert.ok(!JSON.stringify(spec).includes("vorstand@hafenverein.example"));
  });

  it("refuses personal accounts outright", () => {
    assert.equal(orgToSpec({ ...ORG_ROW, account_type: "personal" }, "roebel"), null);
  });
});

describe("Berlin wall-clock conversion", () => {
  it("summer is UTC+2, winter is UTC+1", () => {
    // 2026-08-14 19:30 CEST == 17:30 UTC
    assert.equal(berlinToUnix("2026-08-14", "19:30"), Date.parse("2026-08-14T17:30:00Z") / 1000);
    // 2026-01-14 19:30 CET == 18:30 UTC
    assert.equal(berlinToUnix("2026-01-14", "19:30"), Date.parse("2026-01-14T18:30:00Z") / 1000);
  });

  it("accepts HH:MM:SS the way Postgres sends it", () => {
    assert.equal(berlinToUnix("2026-08-14", "19:30:00"), berlinToUnix("2026-08-14", "19:30"));
  });
});

describe("article mapping (NIP-23)", () => {
  const ARTICLE = {
    id: "ar-1",
    account_id: ORG_ID,
    title: "Seefest war ein Erfolg",
    excerpt: "Kurzfassung",
    content: "<h2>Titel</h2><p>Ein <strong>guter</strong> Tag am <a href=\"https://roebel.app\">Hafen</a>.</p>",
    cover_image_url: "https://cdn/cover.jpg",
    category: "news",
    tags: ["hafen", "fest"],
    status: "published",
    published_at: "2026-07-29T18:00:00+00:00",
    ai_generated: true,
    updated_at: "2026-07-30T09:00:00+00:00",
  };


  it("converts the HTML body to Markdown — kind 30023 specifies Markdown", () => {
    const spec = articleToSpec(ARTICLE, ORGS, htmlToMarkdown)!;
    assert.equal(spec.kind, 30023);
    assert.equal(spec.d, "article:ar-1");
    assert.match(spec.content, /## Titel/);
    assert.match(spec.content, /\*\*guter\*\*/);
    assert.match(spec.content, /\[Hafen\]\(https:\/\/roebel\.app\)/);
    assert.doesNotMatch(spec.content, /<[a-z]+>/i);
  });

  it("carries the Art. 50 label onto the record", () => {
    const spec = articleToSpec(ARTICLE, ORGS, htmlToMarkdown)!;
    assert.deepEqual(spec.tags.find((t) => t[0] === "ai_generated"), ["ai_generated", "true"]);
  });

  it("refuses personal-account articles — a byline needs opt-in", () => {
    assert.equal(articleToSpec({ ...ARTICLE, account_id: "someone-personal" }, ORGS, htmlToMarkdown), null);
  });
});

describe("town news mapping (NIP-23)", () => {
  const NEWS = {
    id: "n1",
    slug: "stadtfest-2026",
    title: "Stadtfest",
    excerpt: "Kurz",
    content: "<p>Hallo <b>Röbel</b></p>",
    cover_image_url: "https://x/img.jpg",
    category: "stadt",
    published_at: "2026-07-01T10:00:00Z",
    status: "published",
    updated_at: "2026-07-02T10:00:00Z",
    ai_generated: true,
  };

  it("newsToSpec: published article becomes NIP-23 under the town scope", () => {
    const spec = newsToSpec(NEWS, htmlToMarkdown)!;
    assert.ok(spec);
    assert.equal(spec.kind, 30023);
    assert.equal(spec.scope, "town");
    assert.equal(spec.d, "news:n1");
    const tag = (n: string) => spec.tags.find((t) => t[0] === n)?.[1];
    assert.equal(tag("title"), "Stadtfest");
    assert.equal(tag("slug"), "stadtfest-2026");
    // Verify HTML→Markdown: no HTML tags remain, real Markdown produced (bold as **)
    assert.match(spec.content, /Hallo \*\*Röbel\*\*/);
    assert.doesNotMatch(spec.content, /<[a-z]+>/i);
    // Collect ALL t tags (not just the first) — should have both "news" and category "stadt"
    const allTags = spec.tags.filter((t) => t[0] === "t").map((t) => t[1]);
    assert.ok(allTags.includes("news"));
    assert.ok(allTags.includes("stadt"));
    assert.equal(tag("ai_generated"), "true");
  });

  it("newsToSpec: drafts stay off the record", () => {
    assert.equal(newsToSpec({ id: "n2", title: "x", status: "draft" }, htmlToMarkdown), null);
  });

  it("newsToSpec: planted PII cannot appear in the serialized event", () => {
    const spec = newsToSpec(
      {
        id: "n3",
        slug: "s",
        title: "T",
        content: "ok",
        status: "published",
        updated_at: "2026-07-02T10:00:00Z",
        author_email: "leak@example.com",
        author_wallet: "0xDEADBEEF",
      },
      htmlToMarkdown,
    )!;
    const json = JSON.stringify(spec);
    assert.ok(!json.includes("leak@example.com"));
    assert.ok(!json.includes("0xDEADBEEF"));
  });

  it("newsToSpec: ai_generated flag is future-proofed (column does not exist on news_articles yet)", () => {
    // ai_generated exists only on blog_articles; when the schema adds it to news_articles,
    // the mapper already has the guard ready. Test with synthetic row to pin the intent.
    const spec = newsToSpec(
      { id: "n4", slug: "s", title: "T", content: "ok", status: "published", updated_at: "2026-07-02T10:00:00Z", ai_generated: true },
      htmlToMarkdown,
    )!;
    assert.deepEqual(spec.tags.find((t) => t[0] === "ai_generated"), ["ai_generated", "true"]);
  });
});

describe("marketplace mapping (NIP-15) — withdrawal FIRST", () => {
  const SELLER = "0x1234abcd1234abcd1234abcd1234abcd1234abcd";
  const SELLER_PUB = "e".repeat(64);
  const OPTED = new Map([[SELLER, SELLER_PUB]]);
  const LISTING = {
    id: "l-1",
    account_id: null,
    title: "Fahrrad",
    description: "28 Zoll",
    price: "80",
    price_type: "VB",
    category: "sport",
    condition: "gebraucht",
    media_urls: ["https://cdn/rad.jpg"],
    neighborhood: "Altstadt",
    listing_type: "product",
    seller_wallet_address: SELLER.toUpperCase(),
    status: "active",
    updated_at: "2026-07-30T08:00:00+00:00",
  };

  it("a withdrawn listing becomes a content-free tombstone on the same d", () => {
    const spec = listingToSpec({ ...LISTING, status: "deleted" }, ORGS, OPTED)!;
    assert.equal(spec.kind, 30018);
    assert.equal(spec.d, "listing:l-1");
    assert.equal(spec.content, "");
    assert.deepEqual(spec.tags, [["d", "listing:l-1"], ["status", "withdrawn"]]);
  });

  it("publishes an active listing only when the seller opted into the record", () => {
    const spec = listingToSpec(LISTING, ORGS, OPTED)!;
    assert.equal(spec.scope, "markt");
    assert.deepEqual(spec.tags.find((t) => t[0] === "p"), ["p", SELLER_PUB]);
    const content = JSON.parse(spec.content);
    assert.equal(content.name, "Fahrrad");
    assert.equal(content.currency, "EUR");
  });

  it("REFUSES a listing whose seller has no binding — no opt-in, no record", () => {
    assert.equal(listingToSpec(LISTING, ORGS, new Map()), null);
  });

  it("the seller wallet address itself never reaches the record", () => {
    const spec = listingToSpec(LISTING, ORGS, OPTED)!;
    assert.ok(!JSON.stringify(spec).toLowerCase().includes(SELLER));
  });
});

describe("consented personal organisers and the wider record", () => {
  const OWNER_MAP = new Map([["personal-acc-1", "f".repeat(64)]]);

  it("a consented personal organiser's event publishes with npub attribution", () => {
    const row = { ...EVENT_ROW, account_id: "personal-acc-1" };
    const spec = eventToSpec(row, ORGS, OWNER_MAP)!;
    assert.equal(spec.scope, "town");
    assert.deepEqual(spec.tags.find((t) => t[0] === "p"), ["p", "f".repeat(64)]);
  });

  it("an unconsented personal organiser stays off the record", () => {
    const row = { ...EVENT_ROW, account_id: "personal-acc-2" };
    assert.equal(eventToSpec(row, ORGS, OWNER_MAP), null);
  });

  it("an org feed post signs under the org's key with its ORIGINAL date", () => {
    const post = {
      id: "p-1",
      account_id: ORG_ID,
      content: "Vereinsnachricht",
      media_urls: ["https://cdn/foto.jpg"],
      status: "published",
      created_at: "2026-03-02T09:00:00+00:00",
    };
    const spec = orgPostToSpec(post, ORGS)!;
    assert.equal(spec.kind, 1);
    assert.equal(spec.scope, `org-${ORG_ID}`);
    // Immutable kind: original wall-clock, NO mapper-version offset.
    assert.equal(spec.createdAt, Math.floor(Date.parse(post.created_at) / 1000));
    assert.match(spec.content, /Vereinsnachricht/);
    assert.match(spec.content, /foto\.jpg/);
  });

  it("a personal-account post is NOT the node's to publish", () => {
    const post = { id: "p-2", account_id: "personal-acc-1", content: "x", status: "published", created_at: "2026-03-02T09:00:00+00:00" };
    assert.equal(orgPostToSpec(post, ORGS), null);
  });

  it("an active deal maps to NIP-99 under the business's own scope", () => {
    const deal = {
      id: "d-1",
      business_id: "biz-uuid-1",
      title: "2-für-1 Pizza",
      description: "Nur diese Woche",
      deal_type: "rabatt",
      deal_value: "50%",
      image_url: "https://cdn/pizza.jpg",
      start_date: "2026-08-01",
      end_date: "2026-08-07",
      status: "active",
      is_active: true,
      updated_at: "2026-07-30T10:00:00+00:00",
    };
    const spec = dealToSpec(deal, new Map([["biz-uuid-1", "Pizzeria Müritz"]]))!;
    assert.equal(spec.kind, 30402);
    assert.equal(spec.scope, "biz-biz-uuid-1");
    assert.deepEqual(spec.tags.find((t) => t[0] === "business"), ["business", "Pizzeria Müritz"]);
    assert.deepEqual(spec.tags.find((t) => t[0] === "price"), ["price", "50%"]);
  });

  it("an inactive deal never publishes", () => {
    assert.equal(dealToSpec({ id: "d-2", business_id: "b", title: "x", status: "active", is_active: false }, new Map()), null);
  });

  it("businessToSpec: a business becomes a kind-0 profile under its biz scope", () => {
    const spec = businessToSpec(
      { id: "b1", name: "Bäckerei Müritz", description: "Brot seit 1904",
        category: "handwerk", logo_url: "https://x/l.png", cover_image_url: "https://x/c.png",
        address: "Marktplatz 1", opening_hours: "Mo-Fr 6-18", website_url: "https://baeckerei.example",
        status: "published",
        updated_at: "2026-07-02T10:00:00Z" },
      "roebel",
    );
    assert.ok(spec);
    assert.equal(spec!.kind, 0);
    assert.equal(spec!.scope, "biz-b1");
    assert.equal(spec!.d, "");
    const profile = JSON.parse(spec!.content);
    assert.equal(profile.name, "Bäckerei Müritz");
    assert.equal(profile.category, "business");
    assert.deepEqual(spec!.tags[0], ["netizen_org", "b1", "roebel"]);
  });

  it("businessToSpec: refuses unpublished businesses — status is the moderation gate", () => {
    assert.equal(businessToSpec(
      { id: "b3", name: "Hidden", status: "pending", updated_at: "2026-07-02T10:00:00Z" },
      "roebel",
    ), null);
    assert.equal(businessToSpec(
      { id: "b4", name: "Rejected", status: "rejected", updated_at: "2026-07-02T10:00:00Z" },
      "roebel",
    ), null);
  });

  it("businessToSpec: opening_hours accepts both string and JSONB object forms", () => {
    const stringHours = businessToSpec(
      { id: "b5", name: "Cafe", status: "published", opening_hours: "Mo-Fr 8-20",
        updated_at: "2026-07-02T10:00:00Z" },
      "roebel",
    )!;
    const stringProfile = JSON.parse(stringHours.content);
    assert.equal(stringProfile.opening_hours, "Mo-Fr 8-20");

    const objectHours = businessToSpec(
      { id: "b6", name: "Restaurant", status: "published",
        opening_hours: { montag: { open: "09:00", close: "22:00" }, dienstag: { open: "09:00", close: "22:00" } },
        updated_at: "2026-07-02T10:00:00Z" },
      "roebel",
    )!;
    const objectProfile = JSON.parse(objectHours.content);
    const hoursObj = JSON.parse(objectProfile.opening_hours);
    assert.deepEqual(hoursObj.montag, { open: "09:00", close: "22:00" });
  });

  it("businessToSpec: planted contact PII never serializes", () => {
    const spec = businessToSpec(
      { id: "b2", name: "X", email: "leak@example.com", phone: "01761234567",
        status: "published",
        updated_at: "2026-07-02T10:00:00Z" },
      "roebel",
    );
    const json = JSON.stringify(spec);
    assert.ok(!json.includes("leak@example.com"));
    assert.ok(!json.includes("01761234567"));
  });
});
