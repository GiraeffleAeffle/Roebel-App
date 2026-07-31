import { test } from "node:test";
import assert from "node:assert/strict";
import { RecordClient } from "../src/index";
import { getThread, listPosts } from "../src/social";

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
