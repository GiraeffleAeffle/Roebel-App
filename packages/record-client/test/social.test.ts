import { test } from "node:test";
import assert from "node:assert/strict";
import { orgPostToSpec } from "@netizen-labs/publisher";
import { RecordClient } from "../src/index";
import { getThread, listPosts } from "../src/social";
import { asRecordEvent } from "./helpers";

/** A RecordClient whose transport always answers with these events, ignoring the requested filters. */
const clientFor = (events: unknown[]) =>
  new RecordClient("https://i", (async () => new Response(JSON.stringify({ events }))) as unknown as typeof fetch);

const note = (id: string, pubkey: string, content: string, tags: string[][] = []) => ({
  id, pubkey, kind: 1, created_at: 1753900000, content, tags,
  sig: "0".repeat(128), node_id: "roebel", source: "test",
});
const profile = (pubkey: string, body: Record<string, unknown>, tags: string[][] = []) => ({
  id: "1".repeat(64), pubkey, kind: 0, created_at: 1753900000,
  content: JSON.stringify(body), tags, sig: "0".repeat(128), node_id: "roebel", source: "test",
});
const P1 = "a".repeat(64), P2 = "b".repeat(64), POST = "c".repeat(64), REPLY = "d".repeat(64);

test("listPosts: replies stay out, authors join, counts come from e-filtered kinds", async () => {
  // Router stub: answer per requested kinds — kind 1 list, kind 0 authors, kind 7 reactions, kind 1+e comments.
  const fetchFn = (async (url: RequestInfo | URL) => {
    const u = new URL(String(url));
    const kinds = u.searchParams.get("kinds") ?? "";
    const e = u.searchParams.get("e");
    if (kinds === "1" && !e) return new Response(JSON.stringify({ events: [
      note(POST, P1, "Hallo Röbel"),
      note(REPLY, P2, "Antwort", [["e", POST, "", "reply"]]),
    ] }));
    if (kinds === "0") return new Response(JSON.stringify({ events: [
      profile(P1, { name: "Maxi", picture: "https://x/a.png" }),
      profile(P2, { name: "Mecky", bot: true }, [["netizen_agent", "mecky", "roebel"]]),
    ] }));
    if (kinds === "7") return new Response(JSON.stringify({ events: [
      { ...note("e".repeat(64), P2, "+", [["e", POST]]), kind: 7 },
    ] }));
    if (kinds === "1" && e) return new Response(JSON.stringify({ events: [
      note(REPLY, P2, "Antwort", [["e", POST, "", "reply"]]),
    ] }));
    return new Response(JSON.stringify({ events: [] }));
  }) as unknown as typeof fetch;

  const posts = await listPosts(new RecordClient("https://i", fetchFn));
  assert.equal(posts.length, 1);              // the reply is not a top-level post
  assert.equal(posts[0].author_name, "Maxi");
  assert.equal(posts[0].likes_count, 1);
  assert.equal(posts[0].comments_count, 1);
  assert.equal(posts[0].is_agent, false);
});

test("getThread returns the reply, labelled with its agent author", async () => {
  // Router stub: kind 1 e=POST returns the reply; kind 0 answers the author join;
  // kind 7/kind 1 e=REPLY (the reply's own like/comment counts) are both empty.
  const fetchFn = (async (url: RequestInfo | URL) => {
    const u = new URL(String(url));
    const kinds = u.searchParams.get("kinds") ?? "";
    const e = u.searchParams.get("e");
    if (kinds === "1" && e === POST) return new Response(JSON.stringify({ events: [
      note(REPLY, P2, "Antwort", [["e", POST, "", "reply"]]),
    ] }));
    if (kinds === "0") return new Response(JSON.stringify({ events: [
      profile(P2, { name: "Mecky", bot: true }, [["netizen_agent", "mecky", "roebel"]]),
    ] }));
    if (kinds === "7" && e === REPLY) return new Response(JSON.stringify({ events: [] }));
    if (kinds === "1" && e === REPLY) return new Response(JSON.stringify({ events: [] }));
    return new Response(JSON.stringify({ events: [] }));
  }) as unknown as typeof fetch;

  const posts = await getThread(new RecordClient("https://i", fetchFn), POST);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].event_id, REPLY);
  assert.equal(posts[0].parent_event_id, POST);
  assert.equal(posts[0].author_name, "Mecky");
  // Agent labelling here comes ONLY from the author's kind-0 "bot": true — the
  // reply note itself carries no netizen_agent tag — proving is_agent is a
  // join, not just a same-event tag check.
  assert.equal(posts[0].is_agent, true);
  assert.equal(posts[0].is_org, false);
});

test("listPosts batches exactly one query per kind, regardless of post/author count — never per-post", async () => {
  const P3 = "e".repeat(64);
  const POST2 = "1".repeat(64);
  const POST3 = "2".repeat(64);
  let calls = 0;
  const fetchFn = (async (url: RequestInfo | URL) => {
    calls += 1;
    const u = new URL(String(url));
    const kinds = u.searchParams.get("kinds") ?? "";
    const e = u.searchParams.get("e");
    if (kinds === "1" && !e) return new Response(JSON.stringify({ events: [
      note(POST, P1, "Eins"), note(POST2, P2, "Zwei"), note(POST3, P3, "Drei"),
    ] }));
    if (kinds === "0") return new Response(JSON.stringify({ events: [] }));
    return new Response(JSON.stringify({ events: [] })); // kind 7, and kind 1+e for comments
  }) as unknown as typeof fetch;

  const posts = await listPosts(new RecordClient("https://i", fetchFn));
  assert.equal(posts.length, 3);
  // 1 top-level list + 1 batched authors (kind 0) + 1 batched reactions (kind 7)
  // + 1 batched comment count (kind 1, e-filtered) — four total, not 3×4.
  assert.equal(calls, 4);
});

test("listPosts returns [] without any enrichment queries when the index has no posts", async () => {
  let calls = 0;
  const fetchFn = (async () => {
    calls += 1;
    return new Response(JSON.stringify({ events: [] }));
  }) as unknown as typeof fetch;

  const posts = await listPosts(new RecordClient("https://i", fetchFn));
  assert.deepEqual(posts, []);
  assert.equal(calls, 1); // the initial kind-1 list only — no author/like/comment queries for zero posts
});

// --- Review fix: media_urls is data on the wire, not a wire limit ---
//
// orgPostToSpec (packages/publisher/src/mappers.ts:477-497) and the device-side
// publishPost/repairMisdatedMirrors (apps/expo/lib/nostr/publish.ts:487-489,
// 552-553) fold media into content as `${body}\n\n${url1}\n${url2}...`.trim().
// A keyless fork's feed must recover it, not silently drop every post image.

test("listPosts: trailing media URLs are extracted in order and stripped from content", async () => {
  const content = "Hallo Röbel\n\nhttps://x/1.jpg\nhttps://x/2.jpg";
  const posts = await listPosts(clientFor([note(POST, P1, content)]));
  assert.equal(posts.length, 1);
  assert.equal(posts[0].content, "Hallo Röbel");
  assert.deepEqual(posts[0].media_urls, ["https://x/1.jpg", "https://x/2.jpg"]);
});

test("listPosts: a sentence that legitimately ends with a link is NOT treated as media", async () => {
  const content = "Mehr dazu: https://x/info";
  const posts = await listPosts(clientFor([note(POST, P1, content)]));
  assert.equal(posts.length, 1);
  assert.equal(posts[0].content, content);
  assert.deepEqual(posts[0].media_urls, []);
});

test("listPosts: a post that is nothing but a bare URL, with no blank-line separator, is not treated as media", async () => {
  const content = "https://x/onlyurl.jpg";
  const posts = await listPosts(clientFor([note(POST, P1, content)]));
  assert.equal(posts.length, 1);
  assert.equal(posts[0].content, content); // it is the body, not attached media
  assert.deepEqual(posts[0].media_urls, []);
});

test("round-trip parity: orgPostToSpec's folded media URLs are recovered in order and stripped from content", async () => {
  const row = {
    id: "post1", account_id: "acc1", content: "Sommerfest war toll!",
    media_urls: ["https://x/1.jpg", "https://x/2.jpg"],
    status: "published", created_at: "2026-07-15T12:00:00Z",
  };
  const spec = orgPostToSpec(row, new Set(["acc1"]))!;
  const posts = await listPosts(clientFor([asRecordEvent(spec)]));
  assert.equal(posts.length, 1);
  assert.equal(posts[0].content, "Sommerfest war toll!");
  assert.deepEqual(posts[0].media_urls, ["https://x/1.jpg", "https://x/2.jpg"]);
});

// --- Review fix (MINOR A): the tag-only agent signal, isolated from the profile-bot signal ---

test("is_agent: the post's own netizen_agent tag suffices even when the author profile is NOT a bot", async () => {
  const fetchFn = (async (url: RequestInfo | URL) => {
    const u = new URL(String(url));
    const kinds = u.searchParams.get("kinds") ?? "";
    const e = u.searchParams.get("e");
    if (kinds === "1" && !e) return new Response(JSON.stringify({ events: [
      note(POST, P1, "Ich bin ein Agent", [["netizen_agent", "mecky", "roebel"]]),
    ] }));
    if (kinds === "0") return new Response(JSON.stringify({ events: [
      profile(P1, { name: "Maxi" }), // no "bot": true — this profile is NOT how is_agent becomes true here
    ] }));
    return new Response(JSON.stringify({ events: [] })); // kind 7, and kind 1+e for comments
  }) as unknown as typeof fetch;

  const posts = await listPosts(new RecordClient("https://i", fetchFn));
  assert.equal(posts.length, 1);
  assert.equal(posts[0].is_agent, true);
});
