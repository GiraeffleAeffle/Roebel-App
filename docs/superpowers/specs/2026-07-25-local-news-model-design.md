# Local News Model — Phase 1 Design (Persistent Mecky + Story Engine)

**Status:** Design (approved to spec) · **Created:** 2026-07-25 · **Wave:** 2 (mission)
**Roadmap:** [`docs/MECKY_AGENT_ROADMAP.md`](../../MECKY_AGENT_ROADMAP.md) · Skill #6 (Local journalism engine), building on Backbone A (conversation memory)

---

## 1. Goal & value

Rethink local journalism for the countryside: **Mecky becomes Röbel's AI local
newsroom.** A business opens, a Verein hits a milestone, a citizen has a story
worth telling — Mecky interviews them warmly, co-writes a real article, and
publishes it to the feed + blog so the community meets the people and stories
traditional media no longer covers.

Phase 1 delivers the **beating heart**: a saved, multi-thread Mecky where an
org or citizen tells their story in a conversation, Mecky co-writes it, and the
subject self-publishes it to the feed + blog. Two capabilities land together:

1. **Persistent, multi-thread Mecky** (Backbone A "conversation memory") — Mecky
   chats are saved and switchable, so a story can be drafted over several
   sittings and every Mecky use case becomes a resumable thread.
2. **The story engine** — a shared server-side co-writer agent that runs the
   interview and drafts the article, on top of that persistence.

### Non-goals (Phase 1 — deferred to later phases)
- **Münzen tips / reader appreciation / reactions** — Phase 2 (reuses the
  existing on-chain `useRoebelTaler().send`, person byline + author wallet).
- **Proactive outreach** (Mecky initiating interviews) — Phase 3 (Backbone B).
- **GK honorarium / Münzen→€ treasury policy** (real-money author pay) — Phase 4,
  governance-gated. (Münzen are not €-redeemable; that path is a deliberate
  treasury policy, not a market mechanism.)
- No new payment rail in Phase 1. No money moves.

---

## 2. Decisions locked in brainstorming

| # | Decision | Choice |
|---|----------|--------|
| 1 | v1 scope | **Story engine core** — interview → co-write → self-publish (blog + feed). No payment, no proactive outreach. |
| 2 | Authors + surfaces | **Both**: orgs via the web dashboard, citizens via the Expo Mecky thread. Org byline = org account; citizen byline = the citizen's personal account. |
| 3 | Approval gate | **Subject self-publishes** (they own their story; orgs/verified citizens post freely) + automated `moderate-post` safety check. Central editorial review deferred. |
| 4 | Chats persisted + multi-thread | Mecky conversations are **saved** and **switchable** (user request). Foundation of Phase 1. |
| 5 | Agent location | The **story co-writer runs server-side** (quality + no shipped key). Full server-side migration of the existing concierge agent is recommended but scoped separately (see §3.1). |

---

## 3. Architecture — components

Delivered as **two independently shippable plans**:
- **Plan A — Persistent multi-thread Mecky** (§3.1–3.2): the conversation store + thread switcher.
- **Plan B — Story engine** (§3.3–3.6): the co-writer agent + publish flow, on top of Plan A.

### 3.1 Conversation store (Plan A — Backbone A)
Two Supabase tables, **RLS-on**, owner-scoped.

`mecky_conversations`
- `id` uuid pk
- `owner_wallet` text (lowercased) — the human who owns the thread
- `account_id` uuid null → `accounts` (the account the user was acting as, if any)
- `title` text (auto-generated from the first message; editable)
- `kind` text — `'chat' | 'story'` (story threads drive the co-writer flow)
- `status` text — `'active' | 'archived'`
- `last_message_at` timestamptz, `created_at`, `updated_at`
- (story threads) `draft_article_id` uuid null → `blog_articles` (set once a draft exists)

`mecky_messages`
- `id` uuid pk, `conversation_id` uuid → `mecky_conversations` (ON DELETE CASCADE)
- `role` text — `'user' | 'assistant'`
- `content` text
- `tool_calls` jsonb null, `tool_results` jsonb null (preserve the rich-card tool loop)
- `created_at` timestamptz
- index on `(conversation_id, created_at)`

**Persistence path (pragmatic, non-big-bang):** the existing Expo concierge agent
(`apps/expo/lib/services/anthropic-chat.ts` + `context/MeckyContext.tsx`) keeps
running, but now **writes each turn to `mecky_messages`** and **loads history from
`mecky_conversations`** instead of the in-memory `historyRef`. This delivers
"saved chats" without rewriting the 18-tool agent. Fully migrating the concierge
server-side (to drop the shipped `EXPO_PUBLIC_ANTHROPIC_API_KEY`) is a
**recommended follow-up**, not a Phase-1 blocker — the *story* agent (§3.3), which
does the sensitive Opus drafting, is server-side from day one.

### 3.2 Thread switcher UI (Plan A)
- **Expo:** `apps/expo/app/messages/mecky.tsx` gains a conversation list/drawer —
  "Neuer Chat", switch between saved threads, auto-titled, archive. `MeckyContext`
  loads the selected conversation's messages from the store.
- **Web:** the web Mecky (`apps/web/src/app/app/mecky`) gains the same list. (Web
  concierge is tool-less today; the switcher + persistence still apply.)

### 3.3 Story co-writer agent (Plan B — server-side, shared)
A server-side agent both surfaces call (Next.js API route `apps/web/src/app/api/mecky/story/route.ts`, or an Expo edge function — one backend, streamed).
- **Interview:** Mecky runs a warm, structured interview adapted to a **story
  type** (`business_launch | verein_milestone | citizen_story | craft | event_recap | other`):
  who/what/why, the people/founders, what's new, what they offer. It has town +
  org/citizen context (name, sub_type, bio; org profile where present).
- **Co-writing:** when it has enough, it drafts a long-form article (HTML body,
  title, excerpt, suggested category/tags). The thread is `kind='story'`, linked
  to the draft via `mecky_conversations.draft_article_id`.
- **Model routing:** **Sonnet** for the conversational interview; **Opus** for the
  final article draft (quality). All calls server-side.
- **Honesty:** the article is the *subject's own account* — Mecky writes only from
  what the subject tells it; no invented facts, quotes, or figures. A visible "Mit
  Mecky geschrieben" credit makes the co-authorship transparent.

### 3.4 Draft → edit → publish (Plan B)
- The draft is a **`blog_articles`** row (`status='draft'`), owned by the author
  account: the **org account** for org stories, the **citizen's personal account**
  (`accounts.account_type='personal'`) for citizen stories → **person byline**.
- Subject reviews/edits the article (rich text) and adds a **cover photo**
  (`blog-images` bucket), then **self-publishes** (`status='published'`,
  `published_at`).
- On publish: fire the existing **`moderate-post`** safety check in the
  background; do not block the author.

### 3.5 Feed surfacing (Plan B — closes the "articles don't reach the feed" gap)
- Add `posts.linked_article_id uuid null → blog_articles(id)` and a
  `post_type='story'`.
- On publish, insert a `posts` row authored by the subject (`account_id` for orgs;
  `wallet_address` for citizens) with a teaser (`excerpt`) + `linked_article_id`,
  rendered as a story card that taps through to `/app/blog/[id]`.
- Fire a community notification (reuse `createAppNotification`, e.g. "Neue
  Geschichte aus Röbel").

### 3.6 Surfaces (Plan B)
- **Web org dashboard:** "Story mit Mecky" (under `dashboard/blog` or new
  `dashboard/stories`) — a chat interview (persisted `kind='story'` thread) → draft
  editor (reuse blog authoring) → publish.
- **Expo Mecky:** an "Erzähl deine Geschichte" entry starts a `kind='story'`
  thread → interview → draft → publish (reuse `apps/expo` blog authoring +
  `blog-images`).

---

## 4. Data flow (happy path)

1. **Start:** an org (web) or citizen (Expo) opens Mecky and starts a story thread
   ("Erzähl deine Geschichte" / "Story mit Mecky"). A `mecky_conversations` row
   (`kind='story'`) is created.
2. **Interview:** Mecky (server-side, Sonnet) asks about the story; each turn is
   saved to `mecky_messages`. The subject can leave and resume the thread later.
3. **Draft:** when ready, Mecky drafts the article (Opus) → a `blog_articles` row
   (`status='draft'`), linked from the conversation.
4. **Edit:** the subject reviews/edits in the article editor + adds a cover photo.
5. **Publish:** subject self-publishes → `moderate-post` runs → a `posts` row with
   `linked_article_id` surfaces the story in the feed → community notification.
6. **Read:** the community sees the story card in the feed → taps → article detail
   (`/app/blog/[id]`), byline = the org/citizen, "Mit Mecky geschrieben".

---

## 5. Model routing

| Job | Model | Why |
|-----|-------|-----|
| Story interview (conversation) | Claude Sonnet | Warm, cost-balanced multi-turn |
| Article drafting | **Claude Opus 4.8** | Long-form quality is the product |
| Post-publish moderation | existing `moderate-post` (Claude) | Reuse |
| (Concierge, unchanged in P1) | current client agent | Persist-only change |

Story-agent calls run **server-side**; the concierge key move is a follow-up.

---

## 6. Guardrails

- **Privacy:** `mecky_conversations`/`mecky_messages` are **owner-private** (RLS,
  service-role writes + explicit owner filter, per repo pattern).
- **Honesty:** Mecky writes only from what the subject says; no fabricated facts,
  quotes, or figures; transparent "Mit Mecky geschrieben" credit.
- **Safety:** every published story runs the `moderate-post` check.
- **Keys:** the story agent is server-side; no new client-shipped keys.
- **Ownership:** subject self-publishes their own story (orgs + verified citizens
  already post freely; `account_id`/citizen posts bypass the posting gate).

---

## 7. Error handling

- **Resume:** an interrupted interview resumes from the stored thread (the whole
  point of persistence).
- **Draft failure:** an Opus drafting error surfaces a friendly retry; the thread
  and interview transcript are preserved.
- **Publish failure / moderation flag:** the article stays `draft`; the subject is
  told why; no half-published state (article + feed post are created together or
  not at all).
- **Empty/thin interview:** Mecky asks for more rather than drafting a hollow
  article.

---

## 8. Testing

- **Conversation store:** persistence round-trip (create thread → append messages →
  reload restores order + tool payloads); owner-scoping (a user can't read another's
  thread); archive.
- **Story agent:** interview→draft pipeline as pure/injected functions where
  possible (prompt builders tested; the model call injected, per the Fördermittel
  pattern); "thin interview → asks for more, does not draft."
- **Publish:** publishing a draft creates exactly one `blog_articles` (published) +
  one `posts` row with `linked_article_id`; person vs org byline resolves correctly;
  moderation-flag path leaves it `draft`.
- **Feed:** a published story renders as a story card linking the article.

---

## 9. Decomposition into plans

- **Plan A — Persistent multi-thread Mecky:** conversation store (§3.1), persist
  the existing concierge to it + thread switcher UI on Expo + web (§3.2). Ships the
  "saved chats + switch between them" ask on its own.
- **Plan B — Story engine:** server-side story co-writer agent (§3.3), draft →
  edit → publish (§3.4), feed surfacing via `linked_article_id` + `post_type='story'`
  (§3.5), both story entry points + person byline (§3.6). Depends on Plan A.

Each plan gets its own `brainstorm-informed plan → subagent-driven build` cycle.

---

## 10. Open items / operational gates (not code)

- **Concierge server-side migration** (drop `EXPO_PUBLIC_ANTHROPIC_API_KEY`):
  recommended follow-up after Plan A; decide timing.
- **Story types** starter set + interview prompt tuning (German voice) — refine
  with the first real stories.
- **Cover-image** source: subject upload only, or optional AI cover (gpt-image-1 /
  Seedream, per the roadmap's model routing) — decide at Plan B.
- **Backfill:** existing ephemeral Mecky chats are not migrated (start fresh).
