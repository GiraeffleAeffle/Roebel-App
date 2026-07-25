# Local News — Plan A: Persistent Multi-Thread Mecky

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make Mecky chats saved and switchable — a user can start a new chat, switch between past chats, and resume them (foundation for the story engine).

**Architecture:** Two Supabase tables (`mecky_conversations`, `mecky_messages`) hold threads + messages. The risky serialization (DB row ↔ `MeckyMessage`, DB rows → Anthropic history, title derivation) lives in **pure functions** unit-tested with Jest; the Supabase CRUD mirrors the existing `supabase-blog-articles.ts` thin-wiring pattern. `MeckyContext` gains a `currentConversationId`, loads a thread's messages on select, and appends each completed turn. `mecky.tsx` gains a "Neuer Chat" + a conversation list. A web-side store module (service client) is included so Plan B's server-side story agent can read/write the same tables.

**Tech Stack:** Expo/React Native (Jest via jest-expo), Next.js (node:test + tsx), Supabase (migrations via Supabase MCP), thirdweb `useActiveAccount` for the owner wallet.

## Global Constraints

- **Migrations:** `supabase/migrations/YYYYMMDD_name.sql`; apply via **Supabase MCP** `mcp__supabase__apply_migration` (project ref `wwbeqhkslxdxhktqzqti`). RLS-on + open `USING (true)` policies; access is enforced app-layer by owner wallet (repo pattern).
- **No generated DB types.** Hand-write interfaces; Expo row/UI types in `apps/expo/lib/types/mecky.ts`, web types in `apps/web/src/types/mecky-conversations.ts`. Query with `.from('table' as any)` casts (repo convention for newer tables).
- **Owner scoping:** the owner is the thirdweb wallet `account?.address`, **lowercased** (matches `account_owners`/blog-articles convention).
- **Expo Supabase client:** `import { supabase } from './supabase'` (anon). **Web:** `createAdminClient()` from `@/lib/supabase/admin` (service role).
- **`MeckyMessage.richCards` is a single object, not an array** — persist one card-set per message (matches current behavior).
- **Skip `tsc` typecheck** (user preference); keep the unit-test runs.
- **Test commands:** Expo Jest (one file, non-watch): `pnpm --filter @roebel/expo exec jest <path> --watchAll=false`. Web: `pnpm exec tsx --test apps/web/tests/<f>.test.ts` (from repo root).
- **Commit convention:** `feat(mecky): …`. Stage only files the task changed. Commit+push per task.
- **RN UI/wiring tasks are verified by code review + the user running the app** (the user runs EAS builds himself); they have no automated test. Testable logic is isolated into pure functions (Task 2 / Task 6 helpers).

---

## Where this plan sits
Plan A of the Local News Model (spec: [`docs/superpowers/specs/2026-07-25-local-news-model-design.md`](../specs/2026-07-25-local-news-model-design.md)). Plan A ships persistent + switchable Mecky (Backbone A). **Plan B** (story engine) builds the co-writer agent + publish flow on top, using the same tables + the web store module from Task 6. The **web Mecky UI switcher** and the **full server-side migration of the concierge agent** are deferred follow-ups (spec §3.1, §10).

## File Structure
**Create:**
- `supabase/migrations/20260725_mecky_conversations.sql`
- `apps/expo/lib/mecky-conversation-helpers.ts` — pure helpers
- `apps/expo/lib/__tests__/mecky-conversation-helpers.test.ts` — Jest
- `apps/expo/lib/supabase-mecky-conversations.ts` — Expo CRUD (anon client)
- `apps/web/src/types/mecky-conversations.ts` — web row types
- `apps/web/src/lib/mecky/conversation-store.ts` — web CRUD (service client, for Plan B)
- `apps/web/src/lib/mecky/derive-title.ts` — pure title helper (shared logic, web copy)
- `apps/web/tests/mecky-derive-title.test.ts` — node:test

**Modify:**
- `apps/expo/lib/types/mecky.ts` — add `MeckyConversation` + `MeckyMessageRow` types
- `apps/expo/context/MeckyContext.tsx` — persistence + `currentConversationId`
- `apps/expo/app/messages/mecky.tsx` — "Neuer Chat" + conversation list

---

### Task 1: Migration + types

**Files:**
- Create: `supabase/migrations/20260725_mecky_conversations.sql`
- Modify: `apps/expo/lib/types/mecky.ts` (append)
- Create: `apps/web/src/types/mecky-conversations.ts`

**Interfaces produced:** tables `mecky_conversations`, `mecky_messages`; types `MeckyConversation`, `MeckyMessageRow` (both apps).

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260725_mecky_conversations.sql`:

```sql
-- Persistent, multi-thread Mecky conversations (Backbone A)

CREATE TABLE IF NOT EXISTS public.mecky_conversations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_wallet     TEXT NOT NULL,                       -- lowercased thirdweb address
  account_id       UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
  title            TEXT NOT NULL DEFAULT 'Neuer Chat',
  kind             TEXT NOT NULL DEFAULT 'chat' CHECK (kind IN ('chat','story')),
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  draft_article_id UUID,                                -- set by Plan B (story threads)
  last_message_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mecky_conversations_owner
  ON public.mecky_conversations(owner_wallet, status, last_message_at DESC);
ALTER TABLE public.mecky_conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mecky_conversations_all" ON public.mecky_conversations FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.mecky_messages (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  UUID NOT NULL REFERENCES public.mecky_conversations(id) ON DELETE CASCADE,
  role             TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content          TEXT NOT NULL DEFAULT '',
  rich_cards       JSONB,                                -- one RichCardData object or null
  nav_links        JSONB,                                -- NavigationLink[] or null
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mecky_messages_conversation
  ON public.mecky_messages(conversation_id, created_at);
ALTER TABLE public.mecky_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mecky_messages_all" ON public.mecky_messages FOR ALL USING (true) WITH CHECK (true);
```

- [ ] **Step 2: Apply via the Supabase MCP**

`mcp__supabase__apply_migration` — `project_id: "wwbeqhkslxdxhktqzqti"`, `name: "20260725_mecky_conversations"`, `query` = the SQL above. Expected: success.

- [ ] **Step 3: Verify**

`mcp__supabase__list_tables` (`project_id`, `schemas: ["public"]`) → `mecky_conversations`, `mecky_messages` present, RLS enabled.

- [ ] **Step 4: Add Expo types** — append to `apps/expo/lib/types/mecky.ts`:

```ts
export interface MeckyConversation {
  id: string;
  owner_wallet: string;
  account_id: string | null;
  title: string;
  kind: 'chat' | 'story';
  status: 'active' | 'archived';
  draft_article_id: string | null;
  last_message_at: string;
  created_at: string;
  updated_at: string;
}

export interface MeckyMessageRow {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  rich_cards: RichCardData | null;
  nav_links: NavigationLink[] | null;
  created_at: string;
}
```

- [ ] **Step 5: Add web types** — create `apps/web/src/types/mecky-conversations.ts`:

```ts
export interface MeckyConversationRow {
  id: string;
  owner_wallet: string;
  account_id: string | null;
  title: string;
  kind: "chat" | "story";
  status: "active" | "archived";
  draft_article_id: string | null;
  last_message_at: string;
  created_at: string;
  updated_at: string;
}

export interface MeckyMessageRow {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  rich_cards: unknown | null;
  nav_links: unknown | null;
  created_at: string;
}
```

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260725_mecky_conversations.sql apps/expo/lib/types/mecky.ts apps/web/src/types/mecky-conversations.ts
git commit -m "feat(mecky): persistent conversation schema + types"
git push
```

---

### Task 2: Expo pure conversation helpers (Jest TDD)

**Files:**
- Create: `apps/expo/lib/mecky-conversation-helpers.ts`
- Test: `apps/expo/lib/__tests__/mecky-conversation-helpers.test.ts`

**Interfaces produced:**
- `deriveTitle(firstUserContent: string): string` — trimmed, collapsed whitespace, ≤48 chars (word-boundary), fallback `"Neuer Chat"`.
- `rowToMeckyMessage(row: MeckyMessageRow): MeckyMessage`
- `rowsToHistory(rows: MeckyMessageRow[]): AnthropicMessage[]` — text-only `{ role, content }` turns for resuming the model context.

- [ ] **Step 1: Write the failing test**

Create `apps/expo/lib/__tests__/mecky-conversation-helpers.test.ts`:

```ts
import { deriveTitle, rowToMeckyMessage, rowsToHistory } from '../mecky-conversation-helpers';
import type { MeckyMessageRow } from '../types/mecky';

describe('deriveTitle', () => {
  it('trims and collapses whitespace', () => {
    expect(deriveTitle('   Hallo   Mecky  ')).toBe('Hallo Mecky');
  });
  it('truncates long text at a word boundary with an ellipsis', () => {
    const t = deriveTitle('Ich moechte die Geschichte unseres neuen Cafés am Hafen erzaehlen bitte');
    expect(t.length).toBeLessThanOrEqual(49);
    expect(t.endsWith('…')).toBe(true);
  });
  it('falls back to "Neuer Chat" on empty input', () => {
    expect(deriveTitle('   ')).toBe('Neuer Chat');
  });
});

describe('rowToMeckyMessage', () => {
  it('maps a row incl. rich cards + nav links and derives a numeric timestamp', () => {
    const row: MeckyMessageRow = {
      id: 'm1', conversation_id: 'c1', role: 'assistant', content: 'Hier sind Events',
      rich_cards: { type: 'events', items: [{ id: 'e1' }] },
      nav_links: [{ route: '/events', label: 'Alle Events' }],
      created_at: '2026-07-25T10:00:00.000Z',
    };
    const m = rowToMeckyMessage(row);
    expect(m.id).toBe('m1');
    expect(m.role).toBe('assistant');
    expect(m.content).toBe('Hier sind Events');
    expect(m.richCards).toEqual({ type: 'events', items: [{ id: 'e1' }] });
    expect(m.navigationLinks).toEqual([{ route: '/events', label: 'Alle Events' }]);
    expect(m.timestamp).toBe(Date.parse('2026-07-25T10:00:00.000Z'));
  });
  it('omits richCards/navigationLinks when null', () => {
    const row: MeckyMessageRow = {
      id: 'm2', conversation_id: 'c1', role: 'user', content: 'Moin',
      rich_cards: null, nav_links: null, created_at: '2026-07-25T10:01:00.000Z',
    };
    const m = rowToMeckyMessage(row);
    expect(m.richCards).toBeUndefined();
    expect(m.navigationLinks).toBeUndefined();
  });
});

describe('rowsToHistory', () => {
  it('produces text-only role/content turns in order', () => {
    const rows: MeckyMessageRow[] = [
      { id: 'm1', conversation_id: 'c1', role: 'user', content: 'Hallo', rich_cards: null, nav_links: null, created_at: '2026-07-25T10:00:00Z' },
      { id: 'm2', conversation_id: 'c1', role: 'assistant', content: 'Moin!', rich_cards: { type: 'events', items: [] }, nav_links: null, created_at: '2026-07-25T10:01:00Z' },
    ];
    expect(rowsToHistory(rows)).toEqual([
      { role: 'user', content: 'Hallo' },
      { role: 'assistant', content: 'Moin!' },
    ]);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

`pnpm --filter @roebel/expo exec jest lib/__tests__/mecky-conversation-helpers.test.ts --watchAll=false`
Expected: FAIL — cannot find module `../mecky-conversation-helpers`.

- [ ] **Step 3: Implement**

Create `apps/expo/lib/mecky-conversation-helpers.ts`:

```ts
import type { MeckyMessage, MeckyMessageRow } from './types/mecky';
import type { AnthropicMessage } from './types/anthropic';

const MAX_TITLE = 48;

export function deriveTitle(firstUserContent: string): string {
  const clean = (firstUserContent ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return 'Neuer Chat';
  if (clean.length <= MAX_TITLE) return clean;
  const slice = clean.slice(0, MAX_TITLE);
  const lastSpace = slice.lastIndexOf(' ');
  const cut = lastSpace > 20 ? slice.slice(0, lastSpace) : slice;
  return `${cut.trimEnd()}…`;
}

export function rowToMeckyMessage(row: MeckyMessageRow): MeckyMessage {
  const msg: MeckyMessage = {
    id: row.id,
    role: row.role,
    content: row.content,
    timestamp: Date.parse(row.created_at),
  };
  if (row.rich_cards) msg.richCards = row.rich_cards;
  if (row.nav_links && row.nav_links.length > 0) msg.navigationLinks = row.nav_links;
  return msg;
}

export function rowsToHistory(rows: MeckyMessageRow[]): AnthropicMessage[] {
  return rows.map((r) => ({ role: r.role, content: r.content }));
}
```

(If `AnthropicMessage` requires a different `content` shape, use its text-content constructor; confirm against `apps/expo/lib/types/anthropic.ts` and match its `role`/`content` string form.)

- [ ] **Step 4: Run test — expect PASS**

`pnpm --filter @roebel/expo exec jest lib/__tests__/mecky-conversation-helpers.test.ts --watchAll=false`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add apps/expo/lib/mecky-conversation-helpers.ts apps/expo/lib/__tests__/mecky-conversation-helpers.test.ts
git commit -m "feat(mecky): pure conversation helpers (title, row↔message, history) + jest tests"
git push
```

---

### Task 3: Expo conversation data-layer (CRUD, wiring)

**Files:**
- Create: `apps/expo/lib/supabase-mecky-conversations.ts`

**Interfaces produced (mirror `supabase-blog-articles.ts` contracts):**
- `listConversations(ownerWallet: string): Promise<MeckyConversation[]>` — `status='active'`, ordered `last_message_at desc`; `[]` on error.
- `createConversation(ownerWallet: string, opts?: { title?: string; kind?: 'chat'|'story'; accountId?: string|null }): Promise<{ success: true; data: MeckyConversation } | { success: false; error: string }>`
- `getConversationMessages(conversationId: string): Promise<MeckyMessageRow[]>` — ordered `created_at asc`; `[]` on error.
- `appendMessage(conversationId: string, msg: { role: 'user'|'assistant'; content: string; richCards?: RichCardData | null; navLinks?: NavigationLink[] | null }): Promise<{ success: boolean; error?: string }>` — inserts the row **and** bumps `mecky_conversations.last_message_at = now()`.
- `renameConversation(conversationId: string, title: string): Promise<{ success: boolean }>`
- `archiveConversation(conversationId: string): Promise<{ success: boolean }>`

- [ ] **Step 1: Implement** — create `apps/expo/lib/supabase-mecky-conversations.ts`, mirroring `supabase-blog-articles.ts` (import `{ supabase } from './supabase'`, `.from('mecky_conversations' as any)` / `.from('mecky_messages' as any)`, lowercase the wallet, `console.error` + return `[]`/`{success:false,error}` on failure). Use the exact signatures above. Store `rich_cards`/`nav_links` as the given objects (or null). After an `appendMessage` insert, run `.from('mecky_conversations' as any).update({ last_message_at: new Date().toISOString() }).eq('id', conversationId)`.

- [ ] **Step 2: Sanity check (no unit test — thin Supabase wiring)**

Confirm by reading the file that: every query lowercases `ownerWallet`; reads return `[]` on error; `appendMessage` inserts then bumps `last_message_at`; `createConversation` returns the inserted row via `.select().single()`.

- [ ] **Step 3: Commit**

```bash
git add apps/expo/lib/supabase-mecky-conversations.ts
git commit -m "feat(mecky): expo conversation data-layer (CRUD)"
git push
```

---

### Task 4: MeckyContext persistence + currentConversationId

**Files:**
- Modify: `apps/expo/context/MeckyContext.tsx`

**Interfaces produced (extend `MeckyContextValue`):**
- `currentConversationId: string | null`
- `conversations: MeckyConversation[]`
- `selectConversation(id: string): Promise<void>` — loads that thread's messages (`getConversationMessages` → `rowToMeckyMessage` into `messages`, `rowsToHistory` into `historyRef`), sets `currentConversationId`.
- `newConversation(): void` — clears `messages`/`historyRef`, sets `currentConversationId = null` (a fresh thread is created lazily on the first user message).
- `refreshConversations(): Promise<void>` — reloads the list for the owner wallet.
- keep existing `clearConversation` as an alias of `newConversation`.

**Wiring requirements:**
- On mount / when `account?.address` becomes available: `refreshConversations()`.
- In `sendMessage`: if `currentConversationId` is null, `createConversation(wallet, { title: deriveTitle(text) })` first, set `currentConversationId`, then persist the user message via `appendMessage`. On stream `onComplete`, persist the assistant message (content + the single `richCards` set + navLinks) via `appendMessage`, then `refreshConversations()` (so `last_message_at` reordering shows).
- Owner wallet = `account?.address?.toLowerCase()`; if absent, fall back to in-memory only (do not persist) — never write with an empty wallet.

- [ ] **Step 1: Implement** the context changes per the requirements above, reusing `deriveTitle`, `rowToMeckyMessage`, `rowsToHistory` (Task 2) and the data-layer (Task 3). Keep the existing streaming/tool-loop logic intact; only add persistence around it. Guard all persistence on a non-empty lowercased wallet.

- [ ] **Step 2: Verify by reading** — confirm: (a) no persistence write happens without a wallet; (b) a new thread is created exactly once per conversation (lazily on first message); (c) assistant persistence stores the same `richCards` object the UI shows; (d) `historyRef` is rebuilt from `rowsToHistory` on `selectConversation` and still trimmed to last 40 as today. (No automated test — RN context; the user verifies in-app.)

- [ ] **Step 3: Commit**

```bash
git add apps/expo/context/MeckyContext.tsx
git commit -m "feat(mecky): persist conversations + multi-thread state in MeckyContext"
git push
```

---

### Task 5: Thread-switcher UI in mecky.tsx

**Files:**
- Modify: `apps/expo/app/messages/mecky.tsx`

**Requirements:**
- Replace the single header "Neu" Pressable with two affordances: a **"Neuer Chat"** action (calls `newConversation()`) and a **conversations list** trigger (opens a modal/drawer listing `conversations` by `title` + relative `last_message_at`; tapping one calls `selectConversation(id)` and closes). Show the current thread's `title` in the header center (fallback "Mecky").
- Use existing theme tokens (`useTheme()`), `StyleSheet.create` (NO NativeWind), and existing iconography. A bottom-sheet Modal or the already-installed `@react-navigation/drawer` are both acceptable; a simple `Modal` list is fine and lowest-risk.
- Pull the new values from `useMecky()`: `conversations`, `currentConversationId`, `selectConversation`, `newConversation`.

- [ ] **Step 1: Implement** the header + conversation-list UI per the requirements. Keep the FlatList message list + ChatInput unchanged. Empty list → show "Noch keine Chats".

- [ ] **Step 2: Verify by reading** — header exposes both New-chat and list; selecting a conversation swaps the visible messages; styling uses `useTheme()` + `StyleSheet` (no NativeWind). (Visual verification in-app by the user.)

- [ ] **Step 3: Commit**

```bash
git add apps/expo/app/messages/mecky.tsx
git commit -m "feat(mecky): thread switcher + new-chat in the Mecky screen"
git push
```

---

### Task 6: Web conversation store (service client) + derive-title (node:test)

**Files:**
- Create: `apps/web/src/lib/mecky/derive-title.ts`
- Create: `apps/web/tests/mecky-derive-title.test.ts`
- Create: `apps/web/src/lib/mecky/conversation-store.ts`

**Interfaces produced (for Plan B's server-side story agent):**
- `deriveTitle(firstUserContent: string): string` — same rules as Task 2 (web copy; keeps the two apps independent).
- `createConversation(ownerWallet, opts?)`, `listConversations(ownerWallet)`, `getConversationMessages(conversationId)`, `appendMessage(conversationId, {role,content,richCards?,navLinks?})`, `setDraftArticleId(conversationId, articleId)`, `renameConversation`, `archiveConversation` — all using `createAdminClient()`, owner wallet lowercased.

- [ ] **Step 1: Write the failing test** — `apps/web/tests/mecky-derive-title.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { deriveTitle } from "../src/lib/mecky/derive-title";

test("trims and collapses whitespace", () => {
  assert.equal(deriveTitle("   Hallo   Mecky  "), "Hallo Mecky");
});
test("truncates long input at a word boundary with an ellipsis", () => {
  const t = deriveTitle("Ich moechte die Geschichte unseres neuen Cafés am Hafen erzaehlen bitte");
  assert.ok(t.length <= 49);
  assert.ok(t.endsWith("…"));
});
test("falls back to Neuer Chat on empty input", () => {
  assert.equal(deriveTitle("   "), "Neuer Chat");
});
```

- [ ] **Step 2: Run — expect FAIL**

`pnpm exec tsx --test apps/web/tests/mecky-derive-title.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `derive-title.ts`** — create `apps/web/src/lib/mecky/derive-title.ts` with the same logic as Task 2's `deriveTitle` (48-char word-boundary truncation, `…` suffix, `"Neuer Chat"` fallback).

- [ ] **Step 4: Run — expect PASS**

`pnpm exec tsx --test apps/web/tests/mecky-derive-title.test.ts` → PASS.

- [ ] **Step 5: Implement `conversation-store.ts`** — create `apps/web/src/lib/mecky/conversation-store.ts` using `createAdminClient()` from `@/lib/supabase/admin`, the signatures above, wallet lowercased, `.from("mecky_conversations")` / `.from("mecky_messages")`. `appendMessage` inserts then bumps `last_message_at`. Reads return `[]` on error; writes return `{ success, error? }`. (Thin wiring; not unit-tested.)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/mecky/derive-title.ts apps/web/tests/mecky-derive-title.test.ts apps/web/src/lib/mecky/conversation-store.ts
git commit -m "feat(mecky): web conversation store (service client) + derive-title tests"
git push
```

---

## Self-Review

**Spec coverage (Plan A slice):** conversation store tables (§3.1) → Task 1; persist the existing concierge + load threads (§3.1) → Tasks 3–4; thread switcher UI (§3.2, Expo) → Task 5; pure serialization tested → Tasks 2 & 6; web store for Plan B's agent (§3.3) → Task 6. Deferred by design: web Mecky UI switcher, full concierge server-side migration (spec §3.1/§10). ✓

**Placeholder scan:** Tasks 1, 2, 6 ship full code/SQL/tests. Tasks 3–5 are Supabase CRUD wiring + RN UI with exact signatures, file targets, and behavioral requirements (no automated test is possible for RN context/UI in this repo; verification = review + the user's in-app run, stated in Global Constraints — not a placeholder). ✓

**Type consistency:** `MeckyConversation`, `MeckyMessageRow`, `MeckyMessage`, `RichCardData`, `NavigationLink`, `AnthropicMessage` used identically across tasks; `deriveTitle`/`rowToMeckyMessage`/`rowsToHistory` signatures match between definition (Task 2) and use (Task 4); web `deriveTitle` (Task 6) mirrors Expo `deriveTitle` (Task 2) intentionally (independent apps). ✓
