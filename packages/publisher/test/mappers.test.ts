import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { berlinToUnix, eventToSpec, movieToSpec, orgToSpec } from "../src/mappers.js";

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
    assert.equal(spec.createdAt, Math.floor(Date.parse(EVENT_ROW.updated_at) / 1000));
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
