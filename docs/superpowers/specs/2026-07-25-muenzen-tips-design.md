# Münzen Tips — v1 Design (Local News Phase 2)

**Status:** Design (approved by user 2026-07-25, ready to build) · **Wave:** 2
Local News Model Phase 2 — reader→author appreciation. See [[project_local_news_model]].

## Goal
Readers thank a story's author by sending **Röbel Münzen** directly (citizen→citizen gift; not €, not donor-forwarding — legally clean, no GK). v1 = **Expo, published stories**, built as a **reusable** component (generalizes to any post/content later).

## Locked decisions
1. Surface: **Expo-only** first (reuses the existing on-chain send; web is a fast-follow needing a new browser send path).
2. Scope: **published stories now, built reusable** (`context_type`/`context_id`).
3. Placement (v1): the Expo **article page** `apps/expo/app/blog/[id].tsx`. (Story feed-post card = later bonus.)

## Substrate (already exists — reuse, don't rebuild)
- On-chain send: `apps/expo/context/RoebelTalerProvider.tsx` → `useRoebelTaler().send(toWallet, amount)` (gasless Hub `safeTransferFrom`, returns txHash). In-chat pattern: `apps/expo/components/messages/MuenzenSendSheet.tsx` (amount entry) + `apps/expo/hooks/useConversation.ts` `sendPayment`.
- Author wallet: `blog_articles.author_account_id` → `account_owners` (owner wallet); the story's feed `posts.wallet_address` is the same author.
- Notify: `notifications` table (per-wallet, realtime) — insert one row. Never show raw wallets (resolve to display name).
- Currency label "Röbel Münzen"; never "CRC"/"Circles". `MUENZE_EUR=1` indicative only (not €-redeemable).

## Components
1. **`muenzen_tips` table** (migration, RLS-on open policy + app-layer, like the repo pattern):
   `id uuid pk, from_wallet text, to_wallet text, amount_atto numeric, context_type text default 'story', context_id text, tx_hash text, created_at timestamptz` + indexes on `(context_type, context_id)` and `to_wallet`. Reusable backbone (audit + "❤️ N Münzen" tally + generalization).
2. **Expo data layer** `apps/expo/lib/supabase-muenzen-tips.ts` (mirror `supabase-blog-articles.ts` thin-CRUD): `recordTip({from,to,amountAtto,contextType,contextId,txHash})` (best-effort write), `sumTipsForContext(contextType, contextId)` → total Münzen (for the tally).
3. **`<MuenzenTipButton contextType contextId recipientWallet />`** (`apps/expo/components/muenzen/MuenzenTipButton.tsx`, `useTheme()`+StyleSheet, no NativeWind): "Danke sagen" button; hidden/disabled when `recipientWallet` unresolved OR `recipientWallet === current user's wallet` (no self-tips). On tap → a tip sheet (mirror `MuenzenSendSheet`: presets 1/3/5 + custom) → `useRoebelTaler().send(recipientWallet, amount)`. On success: `recordTip(...)` (best-effort) + notify author (insert `notifications` row, type e.g. `muenzen_tip`, resolved names, link to the story) + receipt toast. Errors surfaced, never block on the best-effort record.
4. **Recipient resolver** (small helper): given the article, resolve author wallet from `author_account_id` → `account_owners`; fall back to the story post's `wallet_address`.

## Wire-in
`apps/expo/app/blog/[id].tsx`: resolve the author wallet, render `<MuenzenTipButton contextType="story" contextId={articleId} recipientWallet={authorWallet} />` + a small "❤️ {sumTipsForContext} Münzen" tally.

## Guardrails
Self-tip blocked · positive amounts · best-effort recording/notify never blocks a successful on-chain send · resolve wallets to display names · gasless via smart account (existing).

## Task breakdown (for writing-plans → subagent-driven build; migrations to PROD via Supabase MCP, ref wwbeqhkslxdxhktqzqti)
- **T1**: `muenzen_tips` migration (apply prod) + `supabase-muenzen-tips.ts` data layer.
- **T2**: `<MuenzenTipButton>` + tip sheet (reuse MuenzenSendSheet + useRoebelTaler().send) + recipient resolver; self-tip guard. (RN — verified in EAS build.)
- **T3**: wire into `app/blog/[id].tsx` (author-wallet resolve, button, tally, author notification on success).
No automated tests for RN UI; a pure helper (amount→atto, self-tip check, tally sum) can be jest-tested. Skip tsc per user rule.

## Deferred (later)
Story feed-post-card tip button; web tipping (new browser send path); generalize `context_type='post'` to any author; "top supporters" display; Phase 4 GK honorarium (real €).
