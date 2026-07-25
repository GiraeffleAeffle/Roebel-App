import assert from "node:assert/strict";
import { test } from "node:test";
import { STORY_INTERVIEW_SYSTEM, buildDraftPrompt, ARTICLE_DRAFT_SCHEMA } from "../src/lib/story/prompts";

test("interview system prompt is German, warm, and enforces honesty", () => {
  assert.ok(/ehrlich/i.test(STORY_INTERVIEW_SYSTEM));
  assert.ok(/Geschichte/i.test(STORY_INTERVIEW_SYSTEM));
});

test("draft prompt grounds on subject + transcript and forbids invention", () => {
  const p = buildDraftPrompt(
    { kind: "business_launch", name: "Café Hafen", sub_type: "unternehmen", region: "Röbel" },
    [{ role: "user", content: "Wir eröffnen ein Café am Hafen mit regionalem Kuchen." },
     { role: "assistant", content: "Schön! Wer steckt dahinter?" },
     { role: "user", content: "Anna und Ben, beide aus Röbel." }],
  );
  assert.ok(p.includes("Café Hafen"));
  assert.ok(p.includes("Hafen"));
  assert.ok(p.includes("Anna und Ben"));
  assert.ok(/erfinde|keine erfundenen|nur.*gesagt/i.test(p));
  assert.ok(/Mit Mecky/i.test(p));
});

test("ARTICLE_DRAFT_SCHEMA accepts a valid draft", () => {
  const ok = ARTICLE_DRAFT_SCHEMA.safeParse({
    title: "Neues Café am Hafen", excerpt: "Anna und Ben eröffnen…",
    content_html: "<p>…</p>", category: "wirtschaft", tags: ["café", "hafen"],
  });
  assert.equal(ok.success, true);
});
