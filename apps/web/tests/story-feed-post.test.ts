import assert from "node:assert/strict";
import { test } from "node:test";
import { buildStoryTeaserPost } from "../src/lib/story/feed-post";

const article = {
  id: "article-123",
  title: "Neues Café am Hafen",
  excerpt: "Anna und Ben eröffnen ein Café am Hafen.",
  cover_image_url: "https://example.com/cover.jpg",
};

const subject = {
  accountId: "acc-1",
  walletAddress: "0xABCDEF1234567890abcdef1234567890ABCDEF12",
};

test("buildStoryTeaserPost builds a teaser post referencing the article", () => {
  const { post } = buildStoryTeaserPost(article, subject);

  assert.ok(post.content.includes(article.title), "content should mention the article title");
  assert.equal(post.wallet_address, subject.walletAddress.toLowerCase());
  assert.equal(post.account_id, subject.accountId);
  assert.equal(post.category, "generell");
  assert.equal(post.feed_type, "main");
  assert.equal(post.post_type, "user");
  assert.equal(post.status, "published");
});

test("buildStoryTeaserPost builds a link pointing at the article", () => {
  const { link } = buildStoryTeaserPost(article, subject);

  assert.equal(link.url, `/app/blog/${article.id}`);
  assert.equal(link.og_title, article.title);
  assert.equal(link.og_description, article.excerpt);
  assert.equal(link.og_image, article.cover_image_url);
});

test("buildStoryTeaserPost maps a null cover image straight through", () => {
  const { link } = buildStoryTeaserPost({ ...article, cover_image_url: null }, subject);
  assert.equal(link.og_image, null);
});

test("buildStoryTeaserPost lowercases the wallet address", () => {
  const { post } = buildStoryTeaserPost(article, { ...subject, walletAddress: "0xAbC123" });
  assert.equal(post.wallet_address, "0xabc123");
});

test("buildStoryTeaserPost caps very long content at a sane length", () => {
  const longExcerpt = "x".repeat(500);
  const { post } = buildStoryTeaserPost({ ...article, excerpt: longExcerpt }, subject);
  assert.ok(post.content.length <= 280, `content should be capped, was ${post.content.length}`);
});
