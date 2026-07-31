import { test } from "node:test";
import assert from "node:assert/strict";
import { eventToSpec, movieToSpec, newsToSpec, orgToSpec } from "@netizen-labs/publisher";
import { RecordClient } from "../src/index";
import { listEvents, listMovies, listNews, listOrgs, unixToBerlin } from "../src/datasets";
import type { PublishSpec } from "@netizen-labs/publisher";

/** A PublishSpec becomes the IndexedEvent the index would serve (crypto stubbed — parity is about content+tags). */
function asRecordEvent(spec: PublishSpec, pubkey = "f".repeat(64)) {
  return {
    id: "0".repeat(64), pubkey, kind: spec.kind, created_at: spec.createdAt,
    content: spec.content, tags: [["d", spec.d], ...spec.tags.filter((t) => t[0] !== "d")].filter((t) => t[1] !== ""),
    sig: "0".repeat(128), node_id: "roebel", source: "test",
  };
}
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
});

test("unixToBerlin is the exact inverse of berlinToUnix for a Berlin summer (CEST) instant", () => {
  // 2026-08-14 19:30 Europe/Berlin is CEST (UTC+2) -> 17:30 UTC -> unix 1786728600
  const { date, time } = unixToBerlin(1786728600);
  assert.equal(date, "2026-08-14");
  assert.equal(time, "19:30");
});
