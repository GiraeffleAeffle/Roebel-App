# Flyer-Generator — v1 Design (Mecky content-creation agent #1)

**Status:** Design approved by user 2026-07-26 · **Wave:** 2 (content creation)
Part of the [[project_mecky_agent_roadmap]] — "best model per use case" principle in
action. First of the content-creation skills the user asked for ("A4 printable
Flyers, OpenAI has the best model").

## 1. Goal & value

An org opens a **Flyer**-Tool in the dashboard, describes what they need (or pulls
an existing event), Claude drafts editable German copy, **gpt-image-1** renders a
text-legible **A4** flyer, and it lands in a **flyer library** they can re-download
(PNG + A4-PDF), attach to an event, or post to the feed.

Small orgs can't afford a designer; a legible, on-brand printable flyer in two
minutes is real acceleration of local life. Diffusion image models (Seedream 4.5,
the repo's current KIE path) garble text — **gpt-image-1 renders legible text**,
which is exactly what a flyer is.

## 2. Locked decisions (brainstorm)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Surface | **Standalone dashboard Flyer-Tool**, can optionally prefill from an event |
| 2 | Copy authoring | **Two-stage** — Claude Sonnet drafts editable copy → gpt-image-1 renders it |
| 3 | Output | **Library + share** — Supabase storage + `flyers` table; re-download, attach-to-event, post-to-feed |
| 4 | Copy model | **Claude Sonnet** (cheap, strong German; Opus overkill for short copy) |
| 5 | Reference image | **Optional single reference** (logo/photo) in v1 — native to gpt-image-1 |
| 6 | Print | **A4-PDF export** in v1 (the literal "printable A4" ask) |

## 3. Model routing (best model per job)

| Job | Model | Why |
|-----|-------|-----|
| Draft structured flyer copy | **Claude Sonnet** | German civic copywriting; editable before render |
| Render the A4 flyer image | **gpt-image-1** (`experimental_generateImage`, `1024x1536`) | Only model that bakes legible text into the poster |

Both server-side (`OPENAI_API_KEY` already used by the shipped flyer-*reader*
`lib/utils/flyer-extraction.ts`; `ANTHROPIC_API_KEY` for Sonnet). AI SDK verified:
`ai@6` exports `experimental_generateImage`, `@ai-sdk/openai@3` exports `openai.image`.

## 4. Architecture — components

### 4.1 `lib/flyer/copy.ts` — copy schema + draft (DI seam, testable)
- `FlyerCopy` = `{ headline, subheadline, date_line?, time_line?, place_line?, body, cta, footer? }` (footer = org name/contact).
- `buildCopyPrompt(brief, event?, style)` (pure) + `draftFlyerCopy(brief, event, style, { generate })` where `generate: GenerateCopy` is injected (real impl = Sonnet `generateObject` with a Zod schema; **no numeric `.min/.max` in the schema** — the @ai-sdk/anthropic 400 gotcha; clamp/trim in code).

### 4.2 `lib/flyer/styles.ts` — style presets
4 curated presets, each `{ id, label, direction, palette }`:
`festlich` (Vereinsfest, warm), `modern` (minimal, viel Weißraum), `amtlich`
(Behörden/seriös), `plakativ` (bold, hoher Kontrast). Default palette = **Röbel
navy `#00498B`** + white + a warm accent. `resolveStyle(id)` → preset (falls back to `modern`).

### 4.3 `lib/flyer/render.ts` — image prompt + render
- `buildFlyerImagePrompt(copy, style)` (pure): assembles a detailed gpt-image-1
  prompt — A4 hochkant poster, clear visual hierarchy (headline dominant, the
  date/time/place as a legible info block, CTA button-like), the exact German
  strings to typeset, the palette, and an explicit **"render all text crisply and
  correctly, no placeholder/lorem/garbled text"** guard.
- `renderFlyerImage(prompt, referenceImage?)`: `experimental_generateImage({
  model: openai.image("gpt-image-1"), size: "1024x1536", prompt, ... })`; when a
  reference image is supplied, pass it through the provider's image input. Returns
  PNG bytes.

### 4.4 Persistence
- Upload PNG to the existing **`images`** bucket at `flyers/<accountId>/<uuid>.png`
  → `getPublicUrl`.
- **`flyers` table** (migration `YYYYMMDD_flyers.sql`), RLS-on + open `USING(true)`
  policy + app-layer (repo convention):
  `id uuid pk, account_id uuid → accounts, created_by_wallet text, title text,
  brief text, copy jsonb, style text, image_url text, event_id uuid null → events,
  source text ('brief'|'event'), status text default 'saved', created_at timestamptz`.
  Index on `(account_id, created_at desc)`.

### 4.5 `app/actions/flyer.ts` — owner-gated server actions
Reuse the `assertOwner(accountId, wallet)` pattern (anon server client +
`account_owners` role; admin client for the writes).
- `draftFlyerCopyAction(accountId, wallet, brief, eventId?, style)` → `FlyerCopy`.
- `generateFlyerAction(accountId, wallet, { title, brief, copy, style, eventId?, referenceUrl? })`
  → enforces the **daily cap**, renders, uploads, inserts the row, returns the flyer.
- `listFlyers(accountId, wallet)`, `deleteFlyer(accountId, wallet, id)`.
- **Slice 2:** `attachFlyerToEvent`, `postFlyerToFeed`.
- **Daily cap:** count `flyers` rows for the account created today; default **15/day**
  (bounds gpt-image-1 cost). Over cap → friendly German error.

### 4.6 `app/dashboard/flyer/page.tsx` + sidebar
New `subTypeFeatures().flyer` flag (on for verein/unternehmen/restaurant/stadt;
off for fraktion/journalist by default) + a "Flyer" sidebar entry. One page:
1. **Brief** free text + optional "aus Event übernehmen" (event picker prefill) +
   style-preset picker + optional reference-image upload.
2. **Text entwerfen** → `draftFlyerCopyAction` → editable copy fields.
3. **Flyer erstellen** → `generateFlyerAction` → A4 preview.
4. Download **PNG** / **A4-PDF** (Slice 2) / An Event anhängen (Slice 2) / Im Feed
   teilen (Slice 2) + a **library** list of past flyers (re-download, delete).

## 5. Data flow (happy path)
brief/event → `draftFlyerCopyAction` (Sonnet) → editable copy →
`buildFlyerImagePrompt` → `renderFlyerImage` (gpt-image-1) → upload to `images`
bucket → insert `flyers` row → preview → download / attach / post.

## 6. Guardrails
- Server-side keys only; per-org **daily cap**; owner/admin-gated everywhere.
- German copy; Röbel navy default; never surface wallet addresses.
- A4 fidelity: the 2:3 image is letterboxed onto a **true A4 page** in the PDF export.
- Reference-image + brief are org-supplied; gpt-image-1 has its own safety; the
  brief can additionally be light-moderated (reuse `moderate-post`) — deferred.

## 7. Error handling
- Missing `OPENAI_API_KEY` / gpt-image-1 not enabled → clear German error, no row written.
- Render/upload failure → no partial row (insert only after a successful upload).
- Draft failure → surface + let the user retry or hand-write the copy.
- Over daily cap → friendly message with the reset hint.

## 8. Testing (node:test, pure — no live OpenAI/Anthropic)
- `buildFlyerImagePrompt`: contains every non-empty copy field, the style
  direction, the palette, and the legibility guard.
- `resolveStyle`: known id → preset; unknown → `modern` fallback.
- `buildCopyPrompt`: includes the brief + event fields + chosen style.
- daily-cap counter logic (given N rows today + cap → allow/deny).
- PDF-fit math (Slice 2): 2:3 image centered on A4 within margins.
- `draftFlyerCopy` via a fake `GenerateCopy`.

## 9. Phase boundaries
- **v1 (this spec):** brief/event → draft → render → library → download (PNG; PDF in
  Slice 2) → attach-to-event + post-to-feed (Slice 2), web dashboard, 4 style
  presets, optional single reference image, daily cap. Built in 2 slices
  (core → share/PDF).
- **Fast-follows:** Expo surface (calls the web API), a Mecky chat tool ("mach mir
  einen Flyer"), edit-existing-flyer (gpt-image-1 edit), other formats (A5 /
  Insta-square), auto-flyer on new-event creation.

## 10. Operational gates (not code)
- **OpenAI org verification** required for gpt-image-1 access.
- `OPENAI_API_KEY` present on Vercel (the shipped flyer-reader implies it is — confirm).
- `flyers` migration applied to prod (Supabase MCP offline → user applies).
- `images` bucket public-read (already, used for blog covers).
