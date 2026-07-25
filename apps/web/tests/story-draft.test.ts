import assert from "node:assert/strict";
import { test } from "node:test";
import { createStoryDraft, type DraftSources } from "../src/lib/story/draft";
import type { GenerateDraft } from "../src/lib/story/draft";
import type { ArticleDraft, StorySubject } from "../src/lib/story/prompts";

const subject: StorySubject = {
  kind: "business_launch",
  name: "Café Hafen",
  sub_type: "unternehmen",
  region: "Röbel",
};

const draft: ArticleDraft = {
  title: "Neues Café am Hafen",
  excerpt: "Anna und Ben eröffnen ein Café am Hafen.",
  content_html: "<p>Anna und Ben eröffnen ein Café am Hafen.</p>",
  category: "wirtschaft",
  tags: ["café", "hafen"],
};

function transcript(userTurns: number) {
  const msgs: { role: "user" | "assistant"; content: string }[] = [];
  for (let i = 0; i < userTurns; i++) {
    msgs.push({ role: "assistant", content: `Frage ${i + 1}` });
    msgs.push({ role: "user", content: `Antwort ${i + 1}` });
  }
  return msgs;
}

function sources(
  transcriptRows: { role: "user" | "assistant"; content: string }[],
  created: { accountId: string; authorAccountId: string; draft: ArticleDraft }[],
  linked: { conversationId: string; articleId: string }[],
): DraftSources {
  return {
    async loadTranscript() {
      return transcriptRows;
    },
    async createDraftArticle(input) {
      created.push(input);
      return { articleId: "article-1", slug: "neues-cafe-am-hafen" };
    },
    async linkDraft(conversationId, articleId) {
      linked.push({ conversationId, articleId });
    },
  };
}

const gen: GenerateDraft = async () => draft;

test("too few user turns short-circuits with empty_transcript and creates no article", async () => {
  const created: { accountId: string; authorAccountId: string; draft: ArticleDraft }[] = [];
  const linked: { conversationId: string; articleId: string }[] = [];
  let generateCalled = false;
  const generateDraft: GenerateDraft = async () => {
    generateCalled = true;
    return draft;
  };

  const r = await createStoryDraft("c1", subject, "acc-1", "acc-1", {
    ...sources(transcript(1), created, linked),
    generateDraft,
  });

  assert.equal(r.ok, false);
  assert.equal(r.reason, "empty_transcript");
  assert.equal(generateCalled, false);
  assert.equal(created.length, 0);
  assert.equal(linked.length, 0);
});

test("zero-turn transcript also short-circuits", async () => {
  const created: { accountId: string; authorAccountId: string; draft: ArticleDraft }[] = [];
  const linked: { conversationId: string; articleId: string }[] = [];

  const r = await createStoryDraft("c1", subject, "acc-1", "acc-1", {
    ...sources(transcript(0), created, linked),
    generateDraft: gen,
  });

  assert.equal(r.ok, false);
  assert.equal(r.reason, "empty_transcript");
  assert.equal(created.length, 0);
});

test("enough user turns generates, creates the article, links it, and returns ids", async () => {
  const created: { accountId: string; authorAccountId: string; draft: ArticleDraft }[] = [];
  const linked: { conversationId: string; articleId: string }[] = [];
  let generatedWith: { subject: StorySubject; transcriptLen: number } | null = null;
  const generateDraft: GenerateDraft = async (s, t) => {
    generatedWith = { subject: s, transcriptLen: t.length };
    return draft;
  };

  const r = await createStoryDraft("c1", subject, "acc-1", "acc-2", {
    ...sources(transcript(3), created, linked),
    generateDraft,
  });

  assert.equal(r.ok, true);
  assert.equal(r.articleId, "article-1");
  assert.equal(r.slug, "neues-cafe-am-hafen");
  assert.ok(generatedWith);
  assert.equal(generatedWith!.subject.name, "Café Hafen");
  assert.equal(generatedWith!.transcriptLen, 6);
  assert.equal(created.length, 1);
  assert.deepEqual(created[0], { accountId: "acc-1", authorAccountId: "acc-2", draft });
  assert.deepEqual(linked, [{ conversationId: "c1", articleId: "article-1" }]);
});

test("minUserTurns override is respected", async () => {
  const created: { accountId: string; authorAccountId: string; draft: ArticleDraft }[] = [];
  const linked: { conversationId: string; articleId: string }[] = [];

  const r = await createStoryDraft("c1", subject, "acc-1", "acc-1", {
    ...sources(transcript(1), created, linked),
    generateDraft: gen,
    minUserTurns: 1,
  });

  assert.equal(r.ok, true);
  assert.equal(created.length, 1);
});
