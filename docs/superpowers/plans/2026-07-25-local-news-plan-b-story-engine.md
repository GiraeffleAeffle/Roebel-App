# Local News — Plan B: Story Engine

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** An org/citizen tells their story to Mecky in a (persisted) thread; Mecky drafts a long-form article; the subject reviews/edits and self-publishes it to `blog_articles` + surfaces it in the feed.

**Architecture:** Server-side, all in the **web codebase as Next.js API routes** (testable prompt builders + AI SDK + the Plan A `conversation-store` admin client). Expo reaches them via its existing `MINIAPP_API_BASE` (`https://www.roebel.app`) fetch. The interview streams (Sonnet); "Artikel schreiben" calls a one-shot draft route (**Opus** `generateObject` → an `ArticleDraft`), which writes a `blog_articles` **draft** (service role) and links it via `mecky_conversations.draft_article_id` (already exists from Plan A). A dedicated **`publishStory`** action (personal-OR-org owner check — *not* the org-only `blog.ts` guard) publishes the article, creates a **teaser feed post + `post_links` card** to it, and notifies. Byline = the subject's account via `author_account_id`.

**Tech Stack:** Next.js API routes + `@ai-sdk/anthropic` (`generateObject`/`streamText`), `zod`, Supabase (admin client), node:test + tsx; Expo fetch to the web API; Tiptap editor reuse.

## Global Constraints

- **No new migration required** (reuse `posts` + `post_links`; `draft_article_id` already exists). Do NOT add `post_type='story'`/`linked_article_id` in Plan B — feed surfacing is a teaser post + OG link card (dedicated story card is a follow-up).
- **Model routing:** interview → `anthropic("claude-sonnet-4-6")` (the model the app already uses) via `streamText`; article draft → `anthropic("claude-opus-4-8")` via `generateObject`. Anthropic gotcha: **no `.min()/.max()` on numeric Zod fields**; clamp in code. Server-side key `ANTHROPIC_API_KEY` (never `EXPO_PUBLIC_*`).
- **Publish authz:** `publishStory` allows `account_type` **personal OR organisation**, owner-checked via `account_owners.wallet_address = wallet.toLowerCase()` (role owner/admin). This is a NEW action in `apps/web/src/app/actions/story.ts` — do NOT modify `blog.ts`'s existing org-only `assertCanWrite`.
- **Reuse:** `conversation-store.ts` (Plan A, `getConversationMessages`/`setDraftArticleId`), `blog_articles` insert shape from `blog.ts` (`account_id, author_account_id, title, slug, excerpt, content, cover_image_url, category, tags, status, published_at`), `uniqueSlug`+`generateSlug` from `@/lib/slug`, `createPost`/`createPostLink` for the feed post, `createAppNotification` for the notification, Tiptap `rich-text-editor.tsx` for editing.
- **Honesty:** the draft is the subject's own account — the prompt forbids invented facts/quotes/figures; every article carries a "Mit Mecky geschrieben" credit.
- **Test command:** `pnpm exec tsx --test apps/web/tests/<f>.test.ts`. **Skip `tsc`** (user rule); keep node:test runs. Route/action/UI wiring has no unit test (verified by review + the user running web/EAS).
- **Commit convention:** `feat(story):`. Stage only files a task changed; commit+push per task.
- **Shared-checkout hazard:** multiple sessions use this checkout; review each task via `<taskcommit>~1..<taskcommit>`; pathspec-only `git add`; merge via a throwaway `git worktree`, never `git checkout main` in the primary.

## Where this sits
Plan B of the Local News Model ([spec](../specs/2026-07-25-local-news-model-design.md)), on top of Plan A (persistent Mecky, merged `ef241f3`). Deferred to later phases: Münzen tips (Phase 2), proactive outreach (Phase 3), GK honorarium (Phase 4), and a dedicated `FeedStoryCard`/`post_type='story'`.

## File Structure
**Create:**
- `apps/web/src/lib/story/prompts.ts` — `STORY_INTERVIEW_SYSTEM`, `buildDraftPrompt`, `ARTICLE_DRAFT_SCHEMA` (zod) + `ArticleDraft` type
- `apps/web/tests/story-prompts.test.ts` — node:test
- `apps/web/src/lib/story/draft.ts` — `createStoryDraft(conversationId, subject, deps)` (pure orchestration, injected sources+generate)
- `apps/web/tests/story-draft.test.ts` — node:test
- `apps/web/src/app/api/mecky/story-draft/route.ts` — POST wiring (Opus)
- `apps/web/src/app/api/mecky/story-chat/route.ts` — POST streaming interview (Sonnet)
- `apps/web/src/app/actions/story.ts` — `publishStory` + `getStoryDraftArticle`
- `apps/web/src/lib/story/feed-post.ts` — `buildStoryTeaserPost(article, subject)` (pure) + test
- `apps/web/tests/story-feed-post.test.ts`
- `apps/web/src/app/dashboard/stories/page.tsx` (+ components) — "Story mit Mecky" flow
- Expo: `apps/expo/lib/story-api.ts` (fetch draft/publish via MINIAPP_API_BASE) + a story entry in the Mecky screen

**Modify:**
- `apps/expo/lib/prompts/mecky-system-prompt.ts` (or MeckyContext) — story-mode system prompt for `kind='story'` threads
- `apps/expo/context/MeckyContext.tsx` — pass `kind='story'` + story prompt when starting a story thread

---

### Task 1: Story prompts + draft schema (node:test)

**Files:** Create `apps/web/src/lib/story/prompts.ts`, `apps/web/tests/story-prompts.test.ts`.

**Interfaces produced:**
- `STORY_INTERVIEW_SYSTEM: string` — German; Mecky as a warm local reporter; asks about the who/what/why, the people/founders, what's new/offered; one question at a time; honesty (only what the subject says).
- `interface StorySubject { kind: 'business_launch'|'verein_milestone'|'citizen_story'|'craft'|'event_recap'|'other'; name: string; sub_type?: string; bio?: string; region?: string }`
- `interface ArticleDraft { title: string; excerpt: string; content_html: string; category: string; tags: string[] }`
- `ARTICLE_DRAFT_SCHEMA` — zod for `ArticleDraft` (no numeric min/max).
- `buildDraftPrompt(subject: StorySubject, transcript: {role:'user'|'assistant';content:string}[]): string` — grounds on the subject + the interview transcript; instructs a warm, factual local-news article in German HTML, ending with the "Mit Mecky geschrieben" note; no invented facts.

- [ ] **Step 1: Write the failing test** — `apps/web/tests/story-prompts.test.ts`:

```ts
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
```

- [ ] **Step 2: Run — expect FAIL** — `pnpm exec tsx --test apps/web/tests/story-prompts.test.ts` (module not found).

- [ ] **Step 3: Implement `apps/web/src/lib/story/prompts.ts`:**

```ts
import { z } from "zod";

export type StoryKind = "business_launch" | "verein_milestone" | "citizen_story" | "craft" | "event_recap" | "other";

export interface StorySubject {
  kind: StoryKind;
  name: string;
  sub_type?: string;
  bio?: string;
  region?: string;
}

export interface ArticleDraft {
  title: string;
  excerpt: string;
  content_html: string;
  category: string;
  tags: string[];
}

export const ARTICLE_DRAFT_SCHEMA = z.object({
  title: z.string().describe("prägnante Überschrift"),
  excerpt: z.string().describe("1-2 Sätze Anrisstext"),
  content_html: z.string().describe("Artikel als HTML (Absätze <p>, Zwischenüberschriften <h2>)"),
  category: z.string().describe("z.B. wirtschaft, vereine, kultur, menschen, sport"),
  tags: z.array(z.string()).describe("2-5 kurze Schlagworte"),
});

export const STORY_INTERVIEW_SYSTEM = [
  "Du bist Mecky, die freundliche Lokalreporterin für Röbel/Müritz.",
  "Du hilfst einer Person oder Organisation, ihre Geschichte zu erzählen, damit die Gemeinschaft sie kennenlernt.",
  "Führe ein warmes Interview: frage nach dem Wer, Was und Warum, nach den Menschen/Gründer:innen dahinter, was neu ist und was sie anbieten.",
  "Stelle immer NUR EINE Frage auf einmal, kurz und neugierig. Antworte auf Deutsch.",
  "Sei ehrlich: erfinde niemals Fakten. Du schreibst später nur das, was dir die Person wirklich erzählt.",
  "Wenn du genug für einen Artikel hast, sag das und schlage vor, den Artikel zu schreiben.",
].join(" ");

export function buildDraftPrompt(subject: StorySubject, transcript: { role: "user" | "assistant"; content: string }[]): string {
  const lines = transcript.map((m) => `${m.role === "user" ? "Erzähler:in" : "Mecky"}: ${m.content}`).join("\n");
  return [
    "## Aufgabe",
    "Schreibe aus dem folgenden Interview einen warmen, faktentreuen Lokal-Artikel für die Röbel-Community.",
    "Nutze NUR Informationen aus dem Interview — erfinde KEINE Fakten, Zitate oder Zahlen.",
    "Schreibe auf Deutsch, in HTML (Absätze <p>, ggf. Zwischenüberschriften <h2>), gut lesbar und persönlich.",
    "Beende den Artikel mit einem kurzen Hinweis in <p><em>…</em></p>: \"Mit Mecky geschrieben.\"",
    "",
    "## Über die Erzähler:in / Organisation",
    `Name: ${subject.name}`,
    `Art: ${subject.kind}${subject.sub_type ? ` (${subject.sub_type})` : ""}`,
    `Region: ${subject.region ?? "Röbel/Müritz"}`,
    subject.bio ? `Kurzbeschreibung: ${subject.bio}` : "",
    "",
    "## Interview",
    lines,
  ].filter(Boolean).join("\n");
}
```

- [ ] **Step 4: Run — expect PASS** (3 tests).
- [ ] **Step 5: Commit** — `git add apps/web/src/lib/story/prompts.ts apps/web/tests/story-prompts.test.ts` · `feat(story): interview + draft prompts and article schema` · push.

---

### Task 2: Draft orchestrator + story-draft route

**Files:** Create `apps/web/src/lib/story/draft.ts`, `apps/web/tests/story-draft.test.ts`, `apps/web/src/app/api/mecky/story-draft/route.ts`.

**Interfaces produced:**
- `interface DraftSources { loadTranscript(conversationId): Promise<{role:'user'|'assistant';content:string}[]>; createDraftArticle(input): Promise<{ articleId: string; slug: string }>; linkDraft(conversationId, articleId): Promise<void>; }`
- `type GenerateDraft = (subject: StorySubject, transcript) => Promise<ArticleDraft>`
- `createStoryDraft(conversationId: string, subject: StorySubject, accountId: string, authorAccountId: string, deps: DraftSources & { generateDraft: GenerateDraft }): Promise<{ ok: boolean; reason?: 'empty_transcript'; articleId?: string; slug?: string }>` — loads transcript; if too few user turns (<2) → `{ok:false, reason:'empty_transcript'}`; else `generateDraft`, `createDraftArticle` (status draft, account_id, author_account_id), `linkDraft`, return ids.

- [ ] **Step 1: Failing test** — `apps/web/tests/story-draft.test.ts`: inject a fake `DraftSources` + `generateDraft`; assert (a) <2 user turns → `empty_transcript`, no article created; (b) normal → `createDraftArticle` called with the generated draft + accountId/authorAccountId, `linkDraft` called, returns ids. (Full test code: mirror the Fördermittel `run-match.test.ts` injected-sources style.)
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement `draft.ts`** (pure orchestration per the interface).
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Implement the route** `apps/web/src/app/api/mecky/story-draft/route.ts`: `export const runtime='nodejs'; export const maxDuration=60;` POST reads `{ conversationId, subject, accountId, authorAccountId, walletAddress }`; owner-check (personal-or-org via `account_owners`, wallet lowercased); real `DraftSources` = conversation-store `getConversationMessages` + a `createDraftArticle` using `createAdminClient()` inserting `blog_articles` (draft, `uniqueSlug`) + `setDraftArticleId`; `generateDraft` = `generateObject({ model: anthropic("claude-opus-4-8"), schema: ARTICLE_DRAFT_SCHEMA, system: STORY_INTERVIEW_SYSTEM, prompt: buildDraftPrompt(subject, transcript) })`. Returns `{ success, articleId?, slug?, error? }` (German errors). (Wiring — not unit-tested.)
- [ ] **Step 6: Commit** — the 3 files · `feat(story): draft orchestrator + Opus story-draft route` · push.

---

### Task 3: publishStory action + feed teaser post

**Files:** Create `apps/web/src/lib/story/feed-post.ts`, `apps/web/tests/story-feed-post.test.ts`, `apps/web/src/app/actions/story.ts`.

**Interfaces produced:**
- `buildStoryTeaserPost(article: { id:string; title:string; excerpt:string; cover_image_url:string|null; slug:string; account_slug?:string }, subject: { accountId:string; walletAddress:string }): { post: {...}; link: {...} }` (pure) — post content = a short teaser (title + excerpt), `account_id`, `wallet_address`; link = `{ url: "/app/blog/"+id, og_title: title, og_description: excerpt, og_image: cover_image_url }`.
- `publishStory(articleId, accountId, walletAddress): Promise<{ success; error?; postId? }>` — owner-check personal-OR-org; set `blog_articles` status published + `published_at`; build+insert the teaser post + `post_links`; `createAppNotification({ type:'story_new', title:'Neue Geschichte aus Röbel', link:'/app/blog/'+id })`; `revalidatePath`.
- `getStoryDraftArticle(conversationId, walletAddress)` — returns the linked draft article for the editor.

- [ ] **Step 1: Failing test** — `apps/web/tests/story-feed-post.test.ts`: `buildStoryTeaserPost` returns a post with the teaser containing the title and a link whose `url` is `/app/blog/<id>`, `og_title`=title, `og_image`=cover. Assert the pure shape.
- [ ] **Step 2: FAIL → Step 3: implement `feed-post.ts` → Step 4: PASS.**
- [ ] **Step 5: Implement `actions/story.ts`** (`publishStory` + `getStoryDraftArticle`, admin client, personal-or-org owner check, German errors, uses `buildStoryTeaserPost`). Wiring — not unit-tested.
- [ ] **Step 6: Commit** — the 3 files · `feat(story): publishStory action + feed teaser post` · push.

---

### Task 4: story-chat interview route (Sonnet, persisted)

**Files:** Create `apps/web/src/app/api/mecky/story-chat/route.ts`.

- POST reads `{ conversationId, walletAddress, messages }`; persists the new user message via `conversation-store.appendMessage`; `streamText({ model: anthropic("claude-sonnet-4-6"), system: STORY_INTERVIEW_SYSTEM, messages })`; on finish, persist the assistant message; return `toUIMessageStreamResponse()`. (Wiring — verified by review + running the web app.)
- [ ] Implement · sanity-read (persists both turns; uses STORY_INTERVIEW_SYSTEM) · Commit `feat(story): server-side story interview route` · push.

---

### Task 5: Web dashboard "Story mit Mecky" flow

**Files:** Create `apps/web/src/app/dashboard/stories/page.tsx` (+ small components); add a nav entry.

- A page: (1) a chat panel driving `/api/mecky/story-chat` (reuse the `useChat` pattern from `app/app/mecky/page.tsx`) seeded from a `kind='story'` conversation; (2) an **"Artikel schreiben"** button → POST `/api/mecky/story-draft` with the active account as `accountId`/`authorAccountId`; (3) on success, load the draft into the **Tiptap** `rich-text-editor.tsx` (reuse) for edits (save via `updateBlogArticle` OR a story update), + cover upload (`blog-images`); (4) **"Veröffentlichen"** → `publishStory`. Gate the page to signed-in accounts; use existing dashboard layout/theme.
- [ ] Implement · sanity-read (chat → draft → edit → publish wired to the routes/actions above) · Commit `feat(story): Story mit Mecky dashboard flow` · push.

---

### Task 6: Expo story entry

**Files:** Modify `apps/expo/context/MeckyContext.tsx` + `apps/expo/app/messages/mecky.tsx`; create `apps/expo/lib/story-api.ts`.

- `story-api.ts`: `requestStoryDraft(conversationId, subject, accountId, walletAddress)` and `publishStoryRemote(articleId, accountId, walletAddress)` — `fetch` to `${MINIAPP_API_BASE}/api/mecky/story-draft` and a publish route/action bridge (add `apps/web/src/app/api/mecky/story-publish/route.ts` wrapping `publishStory` so expo can call it). (Add that route in this task.)
- MeckyContext: when a thread is `kind='story'`, use `STORY_INTERVIEW_SYSTEM` (add a story system prompt to `apps/expo/lib/prompts/mecky-system-prompt.ts`) instead of the concierge prompt; expose `startStoryThread()`.
- mecky.tsx: an **"Erzähl deine Geschichte"** entry (e.g. in the New-chat area) → `startStoryThread()`; when the story thread has ≥2 user turns, show **"Artikel schreiben"** → `requestStoryDraft` → navigate to the draft (reuse expo blog edit if present, else a simple preview) → **"Veröffentlichen"** → `publishStoryRemote`.
- [ ] Implement · sanity-read (story thread uses the story prompt; draft+publish call the web API via MINIAPP_API_BASE) · Commit `feat(story): expo story entry + draft/publish bridge` · push.

---

## Self-Review

**Spec coverage:** interview (Task 4/6 + prompts Task 1) → co-write draft (Task 2, Opus) → subject edit + self-publish (Task 3 `publishStory`, personal-or-org) → feed surfacing (Task 3 teaser post + link) → both surfaces (Task 5 web, Task 6 expo) → person byline (`author_account_id`, Tasks 2/3). Honesty (Task 1 prompt + credit). Deferred: tips/proactive/honorarium + dedicated story card. ✓

**Placeholder scan:** Tasks 1 ships full code + tests. Tasks 2/3 give full interfaces + testable pure cores (draft orchestration, teaser-post builder) with node:test, routes/actions specified as wiring. Tasks 4-6 are wiring/UI with exact endpoints, payloads, and reuse targets; no automated test possible (verified by review + running web/EAS — stated in Global Constraints). ✓

**Type consistency:** `StorySubject`/`ArticleDraft`/`ARTICLE_DRAFT_SCHEMA` (Task 1) are consumed by Task 2's `GenerateDraft`/`createStoryDraft` and Task 5/6 payloads; `conversation-store` (Plan A) `getConversationMessages`/`setDraftArticleId` used in Task 2; `blog_articles` insert shape matches `blog.ts`; `publishStory` (Task 3) called by Task 5 + the Task 6 publish route. ✓

**Build order note:** Tasks 1-3 are the testable engine core (draft + publish work end-to-end via API); Tasks 4-6 are the UIs. Build 1-3 first; the UIs (4-6) are large and best verified in the running apps.
