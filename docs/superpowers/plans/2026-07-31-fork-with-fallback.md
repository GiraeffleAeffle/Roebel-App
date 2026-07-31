# Fork-with-Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A fork of `apps/web` with no Supabase credentials renders the whole public record from the node index (`https://index.roebel.app`), because every public dataset is on Nostr and every public read path falls back to a record client.

**Architecture:** Three layers, built in order: (1) the indexer gains `e`/`p`/`d` tag filters so threads and single records are queryable; (2) five new publisher mappers complete the record (news, businesses, notices, menus, proposals — civic kinds 32100–32102); (3) a new dependency-free `@netizen-labs/record-client` package reads the index and returns app-shaped rows, and each web read function branches on `hasSupabase`.

**Tech Stack:** TypeScript, node:test via `tsx --test` (packages), Next.js 15 (apps/web), PostgREST select strings (publisher input), NIP-01/23/52/15/99 event shapes.

**Spec:** `docs/superpowers/specs/2026-07-31-fork-with-fallback-design.md` — read it first.

## Global Constraints

- **pnpm only**, never npm/yarn. Package tests run with `pnpm --filter @netizen-labs/<pkg> test` (`tsx --test test/*.test.ts`).
- **Pathspec-only commits** (`git add <file> <file>`), never `git add .` — parallel sessions are active on this repo. Push after every commit.
- **Civic kinds:** proposal = `32100`, menu = `32101`, notice = `32102`. Before Task 2, spend 5 minutes verifying none is claimed in the current NIP registry (https://github.com/nostr-protocol/nips, search "32100" etc.); if claimed, shift the whole block and update the spec.
- **Do NOT bump `MAPPER_VERSION`** — it exists for changes to *existing* mapper output; new mappers don't retro-change old events.
- **No PII on the record:** no email, phone, wallet address (`0x…`), or private person's name in any spec/tag/content. Every new mapper gets a planted-PII test.
- **German-first UI copy**; the currency is always "Röbel Münzen", never CRC; never render a raw wallet address.
- `apps/web` typecheck needs heap: `NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter web exec tsc --noEmit`. Run it once per web task, not per step.
- `apps/web` has **no test runner** — all TDD happens in the packages; web tasks verify by typecheck + build.
- New datasets must be registered in THREE places: `packages/publisher/src/sync.ts` (`DatasetName` + `buildSpecs`), `packages/protocol/src/manifest.ts:201` (zod enum), `packages/protocol/examples/roebel.netizen.json` (`services.publisher.datasets`).
- Docs rule: each mapper task updates the table in `docs/PUBLIC_DATA_ON_NOSTR.md` §1 in the same commit.

---

### Task 1: Indexer tag filters (`e`, `p`, `d`)

**Files:**
- Modify: `packages/indexer/src/query.ts` (EventQuery interface ~line 11, buildEventQuery ~line 39)
- Modify: `packages/indexer/src/api.ts` (parseQuery, ~line 69-90)
- Modify: `packages/indexer/src/schema.ts` (SCHEMA_SQL, after the FTS index ~line 57)
- Test: `packages/indexer/test/query.test.ts`

**Interfaces:**
- Consumes: existing `EventQuery`, `buildEventQuery` (returns `{text, values}`).
- Produces: `EventQuery` gains `eTags?: string[]`, `pTags?: string[]`, `dTags?: string[]`; HTTP params `e`, `p`, `d` (comma-separated) on `GET /events`. Task 7's client sends them.

- [ ] **Step 1: Write failing tests** — append to `packages/indexer/test/query.test.ts`:

```typescript
test("e filter becomes JSONB containment over ['e', id] pairs", () => {
  const { text, values } = buildEventQuery({ eTags: ["a".repeat(64)] });
  assert.match(text, /tags @> ANY\(\$1::jsonb\[\]\)/);
  assert.deepEqual(values[0], [JSON.stringify(["e", "a".repeat(64)])].map((p) => `[${p}]`));
});

test("d filter uses the d_tag column, not JSONB", () => {
  const { text, values } = buildEventQuery({ dTags: ["event:123", "news:456"] });
  assert.match(text, /d_tag = ANY\(\$1::text\[\]\)/);
  assert.deepEqual(values[0], ["event:123", "news:456"]);
});

test("p filter matches ['p', pubkey] pairs and lowercases", () => {
  const { text, values } = buildEventQuery({ pTags: ["B".repeat(64)] });
  assert.match(text, /tags @> ANY\(\$1::jsonb\[\]\)/);
  assert.deepEqual(values[0], [`[${JSON.stringify(["p", "b".repeat(64)])}]`]);
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @netizen-labs/indexer test` → FAIL (properties not in `EventQuery`).

- [ ] **Step 3: Implement in `query.ts`.** Add to `EventQuery`:

```typescript
  /** Events carrying an ["e", <id>] tag — replies/reactions to these ids. */
  eTags?: string[];
  /** Events carrying a ["p", <pubkey>] tag — mentions/attributions. */
  pTags?: string[];
  /** Parameterised replaceable records by stable identity (the d tag). */
  dTags?: string[];
```

In `buildEventQuery`, after the `authors` clause:

```typescript
  const tagContain = (name: string, vals: string[]) =>
    where.push(`tags @> ANY(${bind(vals.map((v) => `[${JSON.stringify([name, v])}]`))}::jsonb[])`);
  if (query.eTags?.length) tagContain("e", query.eTags.map((v) => v.toLowerCase()));
  if (query.pTags?.length) tagContain("p", query.pTags.map((v) => v.toLowerCase()));
  if (query.dTags?.length) where.push(`d_tag = ANY(${bind(query.dTags)}::text[])`);
```

Note: `d_tag` is only set for replaceable kinds — exactly the records the `d` filter is for. Bound parameters throughout; no interpolation.

- [ ] **Step 4: Run tests** — `pnpm --filter @netizen-labs/indexer test` → PASS.

- [ ] **Step 5: Wire HTTP params in `api.ts` parseQuery**, following the existing `authors` parsing style:

```typescript
  const list = (key: string) =>
    p.get(key)?.split(",").map((s) => s.trim()).filter(Boolean) ?? undefined;
  const e = list("e");
  if (e?.length) query.eTags = e;
  const pp = list("p");
  if (pp?.length) query.pTags = pp;
  const d = list("d");
  if (d?.length) query.dTags = d;
```

(Adapt variable names to the function's local style — read the surrounding 20 lines first.)

- [ ] **Step 6: GIN index in `schema.ts`** — add after the FTS index, inside `SCHEMA_SQL`:

```sql
-- Tag containment (e/p filters): replies, reactions, attributions.
CREATE INDEX IF NOT EXISTS idx_nostr_events_tags
  ON nostr_events USING GIN (tags jsonb_path_ops);
```

- [ ] **Step 7: Typecheck + full test** — `pnpm --filter @netizen-labs/indexer typecheck && pnpm --filter @netizen-labs/indexer test` → green.

- [ ] **Step 8: Commit**

```bash
git add packages/indexer/src/query.ts packages/indexer/src/api.ts packages/indexer/src/schema.ts packages/indexer/test/query.test.ts
git commit -m "feat(indexer): e/p/d tag filters — threads and stable records become queryable"
git push
```

---

### Task 2: Publisher — news articles (NIP-23, `d = news:<uuid>`)

**Files:**
- Modify: `packages/publisher/src/mappers.ts` (add `newsToSpec` after `articleToSpec`)
- Modify: `packages/publisher/src/sync.ts` (`DatasetName` line 37, `buildSpecs`)
- Modify: `packages/protocol/src/manifest.ts:201` (add `"news"` to the datasets enum), `packages/protocol/examples/roebel.netizen.json` (datasets array)
- Modify: `docs/PUBLIC_DATA_ON_NOSTR.md` (§1 table row)
- Test: `packages/publisher/test/mappers.test.ts`

**Interfaces:**
- Consumes: `PublishSpec`, `str()`, `unixFromUpdatedAt()`, `TOWN_SCOPE`, `KIND_LONG_FORM` (30023), `htmlToMarkdown` — all existing in the package.
- Produces: `newsToSpec(row: Row, htmlToMd: (html: string) => string): PublishSpec | null`; dataset name `"news"`. Record shape: kind 30023, `d = news:<id>`, tags `title`, `slug`, `summary?`, `image?`, `published_at?`, `["t","news"]`, `["ai_generated","true"]?`, scope `town`.

- [ ] **Step 1: Check the real column names.** Open `apps/web/src/app/news/page.tsx` and `apps/web/src/app/news/[slug]/page.tsx` and note the exact `news_articles` columns selected (expect: `id, slug, title, excerpt, content, cover_image_url, category, published_at, status, updated_at, created_at`, possibly `ai_generated`). Adjust the select string in Step 4 and the mapper's field names to match — nothing else.

- [ ] **Step 2: Write failing tests** in `packages/publisher/test/mappers.test.ts` (follow the file's existing fixture style):

```typescript
test("newsToSpec: published article becomes NIP-23 under the town scope", () => {
  const spec = newsToSpec(
    {
      id: "n1", slug: "stadtfest-2026", title: "Stadtfest", excerpt: "Kurz",
      content: "<p>Hallo <b>Röbel</b></p>", cover_image_url: "https://x/img.jpg",
      category: "stadt", published_at: "2026-07-01T10:00:00Z", status: "published",
      updated_at: "2026-07-02T10:00:00Z", ai_generated: true,
    },
    (html) => html.replace(/<[^>]+>/g, ""),
  );
  assert.ok(spec);
  assert.equal(spec!.kind, 30023);
  assert.equal(spec!.scope, "town");
  assert.equal(spec!.d, "news:n1");
  assert.equal(spec!.content, "Hallo Röbel");
  const tag = (n: string) => spec!.tags.find((t) => t[0] === n)?.[1];
  assert.equal(tag("title"), "Stadtfest");
  assert.equal(tag("slug"), "stadtfest-2026");
  assert.equal(tag("t"), "news");
  assert.equal(tag("ai_generated"), "true");
});

test("newsToSpec: drafts stay off the record", () => {
  assert.equal(newsToSpec({ id: "n2", title: "x", status: "draft" }, (h) => h), null);
});

test("newsToSpec: planted PII cannot appear in the serialized event", () => {
  const spec = newsToSpec(
    { id: "n3", slug: "s", title: "T", content: "ok", status: "published",
      updated_at: "2026-07-02T10:00:00Z",
      author_email: "leak@example.com", author_wallet: "0xDEADBEEF" },
    (h) => h,
  );
  const json = JSON.stringify(spec);
  assert.ok(!json.includes("leak@example.com"));
  assert.ok(!json.includes("0xDEADBEEF"));
});
```

- [ ] **Step 3: Run to verify failure** — `pnpm --filter @netizen-labs/publisher test` → FAIL (`newsToSpec` not exported).

- [ ] **Step 4: Implement `newsToSpec`** in `mappers.ts`, directly under `articleToSpec`:

```typescript
/**
 * A published town news article → NIP-23 long-form content.
 *
 * News is town-curated (admin-authored), so it signs under the town scope and
 * needs no per-owner consent gate. The d prefix `news:` keeps it distinct from
 * org blog articles (`article:`); the `slug` tag lets a record-mode client
 * resolve /news/[slug] routes. The Art. 50 label rides along where present.
 */
export function newsToSpec(row: Row, htmlToMd: (html: string) => string): PublishSpec | null {
  if (str(row, "status") !== "published") return null;
  const id = str(row, "id");
  const title = str(row, "title");
  if (!id || !title) return null;

  const tags: string[][] = [
    ["d", `news:${id}`],
    ["title", title],
    ["t", "news"],
  ];
  const slug = str(row, "slug");
  if (slug) tags.push(["slug", slug]);
  const excerpt = str(row, "excerpt");
  if (excerpt) tags.push(["summary", excerpt]);
  const cover = str(row, "cover_image_url");
  if (cover) tags.push(["image", cover]);
  const publishedAt = str(row, "published_at");
  if (publishedAt) tags.push(["published_at", String(Math.floor(Date.parse(publishedAt) / 1000))]);
  const category = str(row, "category");
  if (category && category !== "news") tags.push(["t", category]);
  if (row["ai_generated"] === true) tags.push(["ai_generated", "true"]);

  return {
    scope: TOWN_SCOPE,
    kind: KIND_LONG_FORM,
    d: `news:${id}`,
    content: htmlToMd(str(row, "content") ?? ""),
    tags,
    createdAt: unixFromUpdatedAt(row),
  };
}
```

- [ ] **Step 5: Run tests** → PASS.

- [ ] **Step 6: Wire the dataset.** In `sync.ts`: extend the union —

```typescript
export type DatasetName =
  | "events" | "cinema" | "orgs" | "articles" | "marketplace" | "deals"
  | "news" | "businesses" | "notices" | "menus" | "proposals";
```

(add all five now so this line is edited once; later tasks only add `buildSpecs` blocks). Add to `buildSpecs`, after the `articles` block:

```typescript
  if (deps.datasets.includes("news")) {
    const rows = await deps.fetchRows(
      "news_articles",
      "select=id,slug,title,excerpt,content,cover_image_url,category,published_at,ai_generated,status,updated_at,created_at&status=eq.published",
    );
    for (const row of rows) {
      const spec = newsToSpec(row, htmlToMarkdown);
      if (spec) specs.push(spec);
    }
  }
```

In `packages/protocol/src/manifest.ts:201` extend the enum to
`["events", "cinema", "orgs", "articles", "marketplace", "deals", "news", "businesses", "notices", "menus", "proposals"]`
(also once, now). Add `"news"` to the datasets array in `packages/protocol/examples/roebel.netizen.json`.

- [ ] **Step 7: Docs.** In `docs/PUBLIC_DATA_ON_NOSTR.md` §1 "Published" table add: `| **town news** — NIP-23 30023, d=news:<uuid>, town-signed, slug tag for routing | |`.

- [ ] **Step 8: Typecheck + tests both packages** — `pnpm --filter @netizen-labs/publisher test && pnpm --filter @netizen-labs/publisher typecheck && pnpm --filter @netizen-labs/protocol test` → green.

- [ ] **Step 9: Commit**

```bash
git add packages/publisher/src/mappers.ts packages/publisher/src/sync.ts packages/publisher/test/mappers.test.ts packages/protocol/src/manifest.ts packages/protocol/examples/roebel.netizen.json docs/PUBLIC_DATA_ON_NOSTR.md
git commit -m "feat(publisher): town news joins the record — NIP-23 under news:<id>"
git push
```

---

### Task 3: Publisher — business profiles (kind 0, `biz-<id>` scope)

**Files:**
- Modify: `packages/publisher/src/mappers.ts` (add `businessToSpec` near `orgToSpec`, ~line 207)
- Modify: `packages/publisher/src/sync.ts` (`buildSpecs`)
- Modify: `packages/protocol/examples/roebel.netizen.json`, `docs/PUBLIC_DATA_ON_NOSTR.md`
- Test: `packages/publisher/test/mappers.test.ts`

**Interfaces:**
- Consumes: `PublishSpec`, `str()`, `unixFromUpdatedAt()`.
- Produces: `businessToSpec(row: Row, nodeId: string): PublishSpec | null` — kind 0, scope `biz-<id>` (the same scope ids `dealToSpec` already signs deals with, so profile ↔ deals join by pubkey), tag `["netizen_org", <slug-or-id>, nodeId]`, content JSON `{name, about?, picture?, banner?, category: "business", business_category?, opening_hours?, website?, address?}`.

- [ ] **Step 1: Check columns.** Open `apps/web/src/app/actions/businesses.ts:62` and note the `businesses` columns (expect `id, name, description, category, logo_url, cover_url, address, opening_hours, website, updated_at, created_at`, possibly `slug`). Contact-person fields (email/phone), if present, are NEVER selected.

- [ ] **Step 2: Failing tests:**

```typescript
test("businessToSpec: a business becomes a kind-0 profile under its biz scope", () => {
  const spec = businessToSpec(
    { id: "b1", name: "Bäckerei Müritz", description: "Brot seit 1904",
      category: "handwerk", logo_url: "https://x/l.png", cover_url: "https://x/c.png",
      address: "Marktplatz 1", opening_hours: "Mo-Fr 6-18", website: "https://baeckerei.example",
      updated_at: "2026-07-02T10:00:00Z" },
    "roebel",
  );
  assert.ok(spec);
  assert.equal(spec!.kind, 0);
  assert.equal(spec!.scope, "biz-b1");
  assert.equal(spec!.d, "");
  const profile = JSON.parse(spec!.content);
  assert.equal(profile.name, "Bäckerei Müritz");
  assert.equal(profile.category, "business");
  assert.deepEqual(spec!.tags[0], ["netizen_org", "b1", "roebel"]);
});

test("businessToSpec: planted contact PII never serializes", () => {
  const spec = businessToSpec(
    { id: "b2", name: "X", contact_email: "leak@example.com", phone: "01761234567",
      updated_at: "2026-07-02T10:00:00Z" },
    "roebel",
  );
  const json = JSON.stringify(spec);
  assert.ok(!json.includes("leak@example.com"));
  assert.ok(!json.includes("01761234567"));
});
```

- [ ] **Step 3: Verify failure** — `pnpm --filter @netizen-labs/publisher test` → FAIL.

- [ ] **Step 4: Implement:**

```typescript
/**
 * A business directory entry → kind-0 profile under its own derived scope.
 *
 * The scope is `biz-<id>` — the SAME scope dealToSpec signs that business's
 * deals with, so a record-mode client joins profile and offers by pubkey,
 * exactly the rule organisations already follow. Contact PERSONS are personal
 * data and are never read; the business's own public storefront data is not.
 */
export function businessToSpec(row: Row, nodeId: string): PublishSpec | null {
  const id = str(row, "id");
  const name = str(row, "name");
  if (!id || !name) return null;

  const profile: Record<string, string> = { name, category: "business" };
  const about = str(row, "description");
  if (about) profile.about = about;
  const picture = str(row, "logo_url");
  if (picture) profile.picture = picture;
  const banner = str(row, "cover_url");
  if (banner) profile.banner = banner;
  const bizCategory = str(row, "category");
  if (bizCategory) profile.business_category = bizCategory;
  const hours = str(row, "opening_hours");
  if (hours) profile.opening_hours = hours;
  const website = str(row, "website");
  if (website) profile.website = website;
  const address = str(row, "address");
  if (address) profile.address = address;

  return {
    scope: `biz-${id}`,
    kind: 0,
    d: "",
    content: JSON.stringify(profile),
    tags: [["netizen_org", str(row, "slug") ?? id, nodeId]],
    createdAt: unixFromUpdatedAt(row),
  };
}
```

- [ ] **Step 5: Tests** → PASS.

- [ ] **Step 6: Wire `buildSpecs`** (after the `deals` block; reuse its `businesses` fetch when both datasets are on — restructure so the table is fetched once):

```typescript
  const wantsDeals = deps.datasets.includes("deals");
  const wantsBusinesses = deps.datasets.includes("businesses");
  if (wantsDeals || wantsBusinesses) {
    const businesses = await deps.fetchRows(
      "businesses",
      "select=id,name,description,category,logo_url,cover_url,address,opening_hours,website,updated_at,created_at",
    );
    if (wantsBusinesses) {
      for (const row of businesses) {
        const spec = businessToSpec(row, deps.nodeId);
        if (spec) specs.push(spec);
      }
    }
    if (wantsDeals) {
      const nameById = new Map(
        businesses.filter((b) => b.id && typeof b.name === "string").map((b) => [String(b.id), String(b.name)]),
      );
      // ... existing business_deals fetch + dealToSpec loop moves inside here unchanged
    }
  }
```

(The existing `deals` block's separate `select=id,name` fetch is deleted — one fetch serves both.)

- [ ] **Step 7: Docs + example manifest** — add `"businesses"` to the example datasets; PUBLIC_DATA table row.

- [ ] **Step 8: Full package tests + typecheck** → green (`sync.test.ts` covers buildSpecs — extend its fetch stub if it asserts call counts).

- [ ] **Step 9: Commit**

```bash
git add packages/publisher/src/mappers.ts packages/publisher/src/sync.ts packages/publisher/test/mappers.test.ts packages/publisher/test/sync.test.ts packages/protocol/examples/roebel.netizen.json docs/PUBLIC_DATA_ON_NOSTR.md
git commit -m "feat(publisher): business profiles join the record — kind 0 under the biz scope deals already sign with"
git push
```

---

### Task 4: Publisher — civic notices (kind 32102)

**Files:**
- Modify: `packages/publisher/src/mappers.ts`, `packages/publisher/src/sync.ts`
- Modify: `packages/protocol/examples/roebel.netizen.json`, `docs/PUBLIC_DATA_ON_NOSTR.md`
- Test: `packages/publisher/test/mappers.test.ts`

**Interfaces:**
- Consumes: `PublishSpec`, `str()`, `unixFromUpdatedAt()`, `TOWN_SCOPE`.
- Produces: `export const KIND_CIVIC_NOTICE = 32102;` and `noticeToSpec(row: Row, source: "service_alert" | "announcement"): PublishSpec | null`. `d = alert:<id>` / `announcement:<id>`, town scope, tags `title`, `["t", source]`, `severity?`, `status` (`active`/`resolved`). Resolution is an edit (replaceable), never a deletion.

- [ ] **Step 1: Check columns** in `apps/web/src/components/app/StadtFeed.tsx` — the `service_alerts` and `announcements` selects (expect alerts: `id, title, message, severity, is_active, starts_at, ends_at, updated_at, created_at`; announcements: `id, title, content, is_active, updated_at, created_at`). Adjust field reads to match.

- [ ] **Step 2: Failing tests:**

```typescript
test("noticeToSpec: an active alert publishes as kind 32102", () => {
  const spec = noticeToSpec(
    { id: "a1", title: "Wasserrohrbruch", message: "Marktstraße gesperrt",
      severity: "warning", is_active: true, updated_at: "2026-07-02T10:00:00Z" },
    "service_alert",
  );
  assert.ok(spec);
  assert.equal(spec!.kind, 32102);
  assert.equal(spec!.scope, "town");
  assert.equal(spec!.d, "alert:a1");
  assert.equal(spec!.content, "Marktstraße gesperrt");
  const tag = (n: string) => spec!.tags.find((t) => t[0] === n)?.[1];
  assert.equal(tag("status"), "active");
  assert.equal(tag("severity"), "warning");
  assert.equal(tag("t"), "service_alert");
});

test("noticeToSpec: a resolved alert is an EDIT with status resolved, not null", () => {
  const spec = noticeToSpec(
    { id: "a1", title: "Wasserrohrbruch", message: "behoben", is_active: false,
      updated_at: "2026-07-03T10:00:00Z" },
    "service_alert",
  );
  assert.ok(spec);
  assert.equal(spec!.tags.find((t) => t[0] === "status")?.[1], "resolved");
});

test("noticeToSpec: announcements use their own d prefix", () => {
  const spec = noticeToSpec(
    { id: "n1", title: "Bürgersprechstunde", content: "Donnerstag 16 Uhr",
      is_active: true, updated_at: "2026-07-02T10:00:00Z" },
    "announcement",
  );
  assert.equal(spec!.d, "announcement:n1");
  assert.equal(spec!.content, "Donnerstag 16 Uhr");
});
```

- [ ] **Step 3: Verify failure**, **Step 4: Implement:**

```typescript
/** Netizen civic notice — see the fork-with-fallback spec §3.2. */
export const KIND_CIVIC_NOTICE = 32102;

/**
 * A service alert or town announcement → civic notice.
 *
 * Deliberately replaceable: a resolved alert is an EDIT carrying
 * status=resolved, because a civic record where warnings silently vanish is
 * worse than one where they visibly end. Town-signed; alerts and
 * announcements are town speech, not personal speech.
 */
export function noticeToSpec(
  row: Row,
  source: "service_alert" | "announcement",
): PublishSpec | null {
  const id = str(row, "id");
  const title = str(row, "title");
  if (!id || !title) return null;

  const d = `${source === "service_alert" ? "alert" : "announcement"}:${id}`;
  const active = row["is_active"] === true;
  const tags: string[][] = [
    ["d", d],
    ["title", title],
    ["t", source],
    ["status", active ? "active" : "resolved"],
  ];
  const severity = str(row, "severity");
  if (severity) tags.push(["severity", severity]);

  return {
    scope: TOWN_SCOPE,
    kind: KIND_CIVIC_NOTICE,
    d,
    content: str(row, "message") ?? str(row, "content") ?? "",
    tags,
    createdAt: unixFromUpdatedAt(row),
  };
}
```

- [ ] **Step 5: Tests** → PASS. **Step 6: Wire `buildSpecs`:**

```typescript
  if (deps.datasets.includes("notices")) {
    const alerts = await deps.fetchRows(
      "service_alerts",
      "select=id,title,message,severity,is_active,updated_at,created_at",
    );
    for (const row of alerts) {
      const spec = noticeToSpec(row, "service_alert");
      if (spec) specs.push(spec);
    }
    const announcements = await deps.fetchRows(
      "announcements",
      "select=id,title,content,is_active,updated_at,created_at",
    );
    for (const row of announcements) {
      const spec = noticeToSpec(row, "announcement");
      if (spec) specs.push(spec);
    }
  }
```

- [ ] **Step 7: Docs + example manifest.** Also make sure `32102` lands in `services.indexer.kinds` in the example manifest (with `32100`/`32101` — add all three once, here).

- [ ] **Step 8: Package tests + typecheck** → green. **Step 9: Commit**

```bash
git add packages/publisher/src/mappers.ts packages/publisher/src/sync.ts packages/publisher/test/mappers.test.ts packages/protocol/examples/roebel.netizen.json docs/PUBLIC_DATA_ON_NOSTR.md
git commit -m "feat(publisher): civic notices — kind 32102, resolution is an edit"
git push
```

---

### Task 5: Publisher — menus (kind 32101, one event per restaurant)

**Files:**
- Modify: `packages/publisher/src/mappers.ts`, `packages/publisher/src/sync.ts`
- Modify: `packages/protocol/examples/roebel.netizen.json`, `docs/PUBLIC_DATA_ON_NOSTR.md`
- Test: `packages/publisher/test/mappers.test.ts`

**Interfaces:**
- Consumes: `PublishSpec`, `str()`, `unixFromUpdatedAt()`.
- Produces: `export const KIND_MENU = 32101;` and

```typescript
export interface MenuInput {
  restaurant: Row;
  categories: Row[];   // menu_categories rows for this restaurant
  itemsByCategory: Map<string, Row[]>; // menu_items keyed by category id
}
export function menuToSpec(input: MenuInput, orgAccountIds: Set<string>): PublishSpec | null;
```

Content JSON: `{categories: [{name, items: [{name, description?, price?, currency: "EUR"}]}]}`. `d = restaurant:<uuid>`; scope `org-<account_id>` when the restaurant belongs to an org account, else `resto-<id>` (the spec's `biz-<id>` wording is amended here: restaurant ids are not `businesses` ids, and scope strings must not collide across tables). Tags: `title` (restaurant name), `slug?`, `location?`, `image?`, `["t","menu"]`.

- [ ] **Step 1: Check columns** in `apps/web/src/lib/supabase-gastro.ts:55-165` — exact column names for `restaurants` (expect `id, name, slug, description, image_url, address, account_id, updated_at`), `menu_categories` (`id, restaurant_id, name, sort_order`), `menu_items` (`id, category_id, name, description, price, is_available`). Only `is_available=true` items publish; unavailable is absence, price formatting stays client-side (publish the raw numeric as string).

- [ ] **Step 2: Failing tests:**

```typescript
test("menuToSpec: a restaurant's menu becomes one replaceable event", () => {
  const spec = menuToSpec(
    {
      restaurant: { id: "r1", name: "Seeblick", slug: "seeblick", address: "Hafen 2",
        image_url: "https://x/r.jpg", updated_at: "2026-07-02T10:00:00Z" },
      categories: [
        { id: "c1", restaurant_id: "r1", name: "Hauptgerichte", sort_order: 1 },
        { id: "c2", restaurant_id: "r1", name: "Desserts", sort_order: 2 },
      ],
      itemsByCategory: new Map([
        ["c1", [{ id: "i1", name: "Zanderfilet", description: "mit Kartoffeln", price: "18.50", is_available: true },
                { id: "i2", name: "Aus", price: "9", is_available: false }]],
        ["c2", [{ id: "i3", name: "Rote Grütze", price: "6.50", is_available: true }]],
      ]),
    },
    new Set(),
  );
  assert.ok(spec);
  assert.equal(spec!.kind, 32101);
  assert.equal(spec!.scope, "resto-r1");
  assert.equal(spec!.d, "restaurant:r1");
  const menu = JSON.parse(spec!.content);
  assert.equal(menu.categories.length, 2);
  assert.equal(menu.categories[0].items.length, 1); // unavailable item absent
  assert.equal(menu.categories[0].items[0].name, "Zanderfilet");
  assert.equal(menu.categories[0].items[0].currency, "EUR");
});

test("menuToSpec: org-owned restaurant signs under the org scope", () => {
  const spec = menuToSpec(
    { restaurant: { id: "r2", name: "X", account_id: "acc9", updated_at: "2026-07-02T10:00:00Z" },
      categories: [], itemsByCategory: new Map() },
    new Set(["acc9"]),
  );
  assert.equal(spec!.scope, "org-acc9");
});
```

- [ ] **Step 3: Verify failure**, **Step 4: Implement:**

```typescript
/** Netizen menu — see the fork-with-fallback spec §3.2. */
export const KIND_MENU = 32101;

export interface MenuInput {
  restaurant: Row;
  categories: Row[];
  itemsByCategory: Map<string, Row[]>;
}

/**
 * A restaurant's whole menu → one parameterised replaceable event.
 *
 * One event per restaurant, not per dish: menus change as a unit, and a
 * single `d = restaurant:<id>` makes every menu edit a clean NIP-01
 * replacement. Custom kind — no NIP covers menus — documented in
 * CONSUMING_THE_RECORD.md. Prices publish as raw decimal strings + EUR;
 * formatting is the client's job.
 */
export function menuToSpec(input: MenuInput, orgAccountIds: Set<string>): PublishSpec | null {
  const row = input.restaurant;
  const id = str(row, "id");
  const name = str(row, "name");
  if (!id || !name) return null;

  const accountId = str(row, "account_id");
  const scope = accountId && orgAccountIds.has(accountId) ? `org-${accountId}` : `resto-${id}`;

  const sorted = [...input.categories].sort(
    (a, b) => Number(a["sort_order"] ?? 0) - Number(b["sort_order"] ?? 0),
  );
  const categories = sorted.flatMap((cat) => {
    const catId = str(cat, "id");
    const catName = str(cat, "name");
    if (!catId || !catName) return [];
    const items = (input.itemsByCategory.get(catId) ?? [])
      .filter((i) => i["is_available"] !== false)
      .flatMap((i) => {
        const itemName = str(i, "name");
        if (!itemName) return [];
        const item: Record<string, string> = { name: itemName, currency: "EUR" };
        const desc = str(i, "description");
        if (desc) item.description = desc;
        const price = i["price"];
        if (price !== null && price !== undefined && String(price).trim() !== "") {
          item.price = String(price);
        }
        return [item];
      });
    return [{ name: catName, items }];
  });

  const tags: string[][] = [
    ["d", `restaurant:${id}`],
    ["title", name],
    ["t", "menu"],
  ];
  const slug = str(row, "slug");
  if (slug) tags.push(["slug", slug]);
  const address = str(row, "address");
  if (address) tags.push(["location", address]);
  const image = str(row, "image_url");
  if (image) tags.push(["image", image]);

  return {
    scope,
    kind: KIND_MENU,
    d: `restaurant:${id}`,
    content: JSON.stringify({ categories }),
    tags,
    createdAt: unixFromUpdatedAt(row),
  };
}
```

- [ ] **Step 5: Tests** → PASS. **Step 6: Wire `buildSpecs`:**

```typescript
  if (deps.datasets.includes("menus")) {
    const restaurants = await deps.fetchRows(
      "restaurants",
      "select=id,name,slug,description,image_url,address,account_id,updated_at,created_at",
    );
    const cats = await deps.fetchRows(
      "menu_categories", "select=id,restaurant_id,name,sort_order",
    );
    const items = await deps.fetchRows(
      "menu_items", "select=id,category_id,name,description,price,is_available",
    );
    const itemsByCategory = new Map<string, Record<string, unknown>[]>();
    for (const i of items) {
      const key = String(i.category_id ?? "");
      if (!itemsByCategory.has(key)) itemsByCategory.set(key, []);
      itemsByCategory.get(key)!.push(i);
    }
    for (const r of restaurants) {
      const spec = menuToSpec(
        {
          restaurant: r,
          categories: cats.filter((c) => String(c.restaurant_id) === String(r.id)),
          itemsByCategory,
        },
        orgIds,
      );
      if (spec) specs.push(spec);
    }
  }
```

(Note: `orgIds` must be in scope — extend the `wantsOrgs || wantsEvents` condition at the top of `buildSpecs` to include `deps.datasets.includes("menus")`.)

- [ ] **Step 7: Docs + example manifest.** **Step 8: Tests + typecheck** → green. **Step 9: Commit**

```bash
git add packages/publisher/src/mappers.ts packages/publisher/src/sync.ts packages/publisher/test/mappers.test.ts packages/protocol/examples/roebel.netizen.json docs/PUBLIC_DATA_ON_NOSTR.md
git commit -m "feat(publisher): menus — kind 32101, one replaceable event per restaurant"
git push
```

---

### Task 6: Publisher — proposal metadata (kind 32100)

**Files:**
- Modify: `packages/publisher/src/mappers.ts`, `packages/publisher/src/sync.ts`, `packages/publisher/src/cli.ts`
- Modify: `packages/protocol/examples/roebel.netizen.json`, `docs/PUBLIC_DATA_ON_NOSTR.md`
- Test: `packages/publisher/test/mappers.test.ts`

**Interfaces:**
- Consumes: `PublishSpec`, `str()`, `unixFromUpdatedAt()`, `TOWN_SCOPE`; `proposals` columns known from `apps/web/src/lib/supabase.ts:56-75` (`proposal_id, blockchain_proposal_id, proposal_number, title, summary, category, irys_content_id, irys_url, state, created_at, updated_at`).
- Produces: `export const KIND_PROPOSAL_META = 32100;`, `proposalToSpec(row: Row, governor: string): PublishSpec | null` (`governor` = `"<chainId>:<address>"`); `PublisherDeps` gains `governor?: string`; CLI env `PROPOSAL_GOVERNOR`. The record event is a POINTER: body on Irys, authoritative state on-chain.

- [ ] **Step 1: Failing tests:**

```typescript
test("proposalToSpec: a proposal becomes a discoverable pointer", () => {
  const spec = proposalToSpec(
    { id: "p-row-1", proposal_id: "42", blockchain_proposal_id: "0xabc123", proposal_number: 7,
      title: "Neuer Spielplatz", summary: "Am Hafen", category: "infrastruktur",
      irys_content_id: "IRYS_TX_1", state: 1, created_at: "2026-07-01T10:00:00Z",
      updated_at: "2026-07-02T10:00:00Z",
      proposer_address: "0x5e6528DEADBEEF" },
    "100:0x5F5e499Dc1872c2Ce19a4b50cd10f680e78E3Ba3",
  );
  assert.ok(spec);
  assert.equal(spec!.kind, 32100);
  assert.equal(spec!.scope, "town");
  assert.equal(spec!.d, "proposal:42");
  assert.equal(spec!.content, "Am Hafen");
  const tag = (n: string) => spec!.tags.find((t) => t[0] === n)?.[1];
  assert.equal(tag("title"), "Neuer Spielplatz");
  assert.equal(tag("governor"), "100:0x5F5e499Dc1872c2Ce19a4b50cd10f680e78E3Ba3");
  assert.equal(tag("proposal_id"), "0xabc123");
  assert.equal(tag("irys"), "IRYS_TX_1");
  assert.equal(tag("status"), "1");
  // The proposer's wallet must NOT ride on the record event.
  assert.ok(!JSON.stringify(spec).includes("0x5e6528DEADBEEF"));
});

test("proposalToSpec: no governor configured → nothing publishes", () => {
  assert.equal(proposalToSpec({ id: "x", proposal_id: "1", title: "t" }, ""), null);
});
```

- [ ] **Step 2: Verify failure**, **Step 3: Implement:**

```typescript
/** Netizen proposal metadata — see the fork-with-fallback spec §3.2. */
export const KIND_PROPOSAL_META = 32100;

/**
 * A governance proposal → a discoverable pointer on the record.
 *
 * The body is already permanent on Irys and the authoritative state (votes,
 * tallies, execution) lives on-chain; this event makes both findable and
 * joinable from the record. The `status` tag is a SNAPSHOT for list rendering
 * — clients needing truth read the Governor. The proposer's wallet is
 * deliberately absent: it is on-chain for those who need it, and the record
 * never carries raw addresses.
 */
export function proposalToSpec(row: Row, governor: string): PublishSpec | null {
  if (!governor) return null;
  const proposalId = str(row, "proposal_id");
  const title = str(row, "title");
  if (!proposalId || !title) return null;

  const tags: string[][] = [
    ["d", `proposal:${proposalId}`],
    ["title", title],
    ["governor", governor],
    ["t", "proposal"],
  ];
  const chainId = str(row, "blockchain_proposal_id");
  if (chainId) tags.push(["proposal_id", chainId]);
  const irys = str(row, "irys_content_id");
  if (irys) tags.push(["irys", irys]);
  const category = str(row, "category");
  if (category) tags.push(["t", category]);
  const state = row["state"];
  if (state !== null && state !== undefined) tags.push(["status", String(state)]);
  const createdAt = str(row, "created_at");
  if (createdAt) tags.push(["published_at", String(Math.floor(Date.parse(createdAt) / 1000))]);

  return {
    scope: TOWN_SCOPE,
    kind: KIND_PROPOSAL_META,
    d: `proposal:${proposalId}`,
    content: str(row, "summary") ?? "",
    tags,
    createdAt: unixFromUpdatedAt(row),
  };
}
```

- [ ] **Step 4: Tests** → PASS.

- [ ] **Step 5: Wire deps + buildSpecs + CLI.** `PublisherDeps` gains `governor?: string` (doc comment: `"<chainId>:<governorAddress>", e.g. "100:0x5F5e…"`). `buildSpecs` signature: extend the `Pick` to include `"governor"`. Block:

```typescript
  if (deps.datasets.includes("proposals")) {
    if (!deps.governor) {
      // Deliberately loud: a configured dataset that silently publishes nothing is a lie.
      throw new Error("datasets includes 'proposals' but PROPOSAL_GOVERNOR is not set");
    }
    const rows = await deps.fetchRows(
      "proposals",
      "select=id,proposal_id,blockchain_proposal_id,proposal_number,title,summary,category,irys_content_id,state,created_at,updated_at",
    );
    for (const row of rows) {
      const spec = proposalToSpec(row, deps.governor);
      if (spec) specs.push(spec);
    }
  }
```

In `cli.ts`, read `governor: process.env.PROPOSAL_GOVERNOR` into the deps it builds (mirror how the other env vars flow).

- [ ] **Step 6: Docs + example manifest** (add `"proposals"` to datasets; note the `PROPOSAL_GOVERNOR` env in the publisher section of `docs/NOSTR_RELAY_SETUP.md` if it documents publisher env).

- [ ] **Step 7: Package tests + typecheck** → green. **Step 8: Commit**

```bash
git add packages/publisher/src/mappers.ts packages/publisher/src/sync.ts packages/publisher/src/cli.ts packages/publisher/test/mappers.test.ts packages/protocol/examples/roebel.netizen.json docs/PUBLIC_DATA_ON_NOSTR.md docs/NOSTR_RELAY_SETUP.md
git commit -m "feat(publisher): proposal pointers — kind 32100 joins record, Irys and chain"
git push
```

---

### Task 7: `@netizen-labs/record-client` — package + HTTP core

**Files:**
- Create: `packages/record-client/package.json`, `packages/record-client/tsconfig.json`, `packages/record-client/src/index.ts`, `packages/record-client/src/client.ts`, `packages/record-client/src/tags.ts`
- Test: `packages/record-client/test/client.test.ts`

**Interfaces:**
- Produces (consumed by Tasks 8–13):

```typescript
export interface RecordEvent {
  id: string; pubkey: string; kind: number; created_at: number;
  content: string; tags: string[][]; sig: string; node_id: string; source: string;
}
export interface EventFilters {
  kinds?: number[]; authors?: string[]; ids?: string[]; e?: string[]; p?: string[]; d?: string[];
  since?: number; until?: number; q?: string; limit?: number; node?: string;
}
export class RecordUnavailableError extends Error {}
export class RecordClient {
  constructor(baseUrl: string, fetchFn?: typeof fetch);
  events(filters: EventFilters): Promise<RecordEvent[]>;
  manifest(): Promise<Record<string, unknown>>;
  mediaUrl(sha256: string): string;
}
// tags.ts
export function tagValue(ev: RecordEvent, name: string): string | null;
export function tagValues(ev: RecordEvent, name: string): string[];
export function dTag(ev: RecordEvent): string | null;
export function dSuffix(ev: RecordEvent, prefix: string): string | null; // "event:123" → "123"
```

- [ ] **Step 1: Scaffold.** `package.json` — copy the shape of `packages/nostr/package.json`: name `@netizen-labs/record-client`, `"type": "module"`, `"main": "src/index.ts"`, `"exports": {".": "./src/index.ts"}`, scripts `test: "tsx --test test/*.test.ts"`, `typecheck: "tsc --noEmit"`, devDeps `@types/node`, `tsx`, `typescript`, and devDep `"@netizen-labs/publisher": "workspace:*"` (parity fixtures only — NEVER a runtime dep; the package stays dependency-free). `tsconfig.json`: copy from `packages/nostr`. **Imports between src files use extensionless relative paths** (Metro rule — this package will serve Expo later).

- [ ] **Step 2: Failing tests** (fetch injected, no network):

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { RecordClient, RecordUnavailableError } from "../src/index";

const fakeFetch = (payload: unknown, status = 200) =>
  (async () => new Response(JSON.stringify(payload), { status })) as unknown as typeof fetch;

test("events() builds the filter query string and unwraps rows", async () => {
  let seen = "";
  const fetchFn = (async (url: RequestInfo | URL) => {
    seen = String(url);
    return new Response(JSON.stringify({ events: [] }));
  }) as unknown as typeof fetch;
  const c = new RecordClient("https://index.example", fetchFn);
  await c.events({ kinds: [1, 7], e: ["abc"], d: ["news:1"], limit: 20 });
  assert.match(seen, /\/events\?/);
  assert.match(seen, /kinds=1%2C7|kinds=1,7/);
  assert.match(seen, /e=abc/);
  assert.match(seen, /d=news%3A1|d=news:1/);
  assert.match(seen, /limit=20/);
});

test("a non-200 becomes RecordUnavailableError", async () => {
  const c = new RecordClient("https://index.example", fakeFetch({}, 503));
  await assert.rejects(c.events({ kinds: [1] }), RecordUnavailableError);
});

test("mediaUrl is content-addressed on the base", () => {
  const c = new RecordClient("https://index.example/");
  assert.equal(c.mediaUrl("ff".repeat(32)), `https://index.example/media/${"ff".repeat(32)}`);
});
```

- [ ] **Step 3: Verify failure**, **Step 4: Implement `client.ts` + `tags.ts`:**

```typescript
// client.ts
export class RecordUnavailableError extends Error {
  constructor(message: string) { super(message); this.name = "RecordUnavailableError"; }
}

export class RecordClient {
  private readonly base: string;
  private readonly fetchFn: typeof fetch;
  constructor(baseUrl: string, fetchFn: typeof fetch = fetch) {
    this.base = baseUrl.replace(/\/+$/, "");
    this.fetchFn = fetchFn;
  }
  async events(filters: EventFilters): Promise<RecordEvent[]> {
    const p = new URLSearchParams();
    const list = (k: string, v?: (string | number)[]) => { if (v?.length) p.set(k, v.join(",")); };
    list("kinds", filters.kinds); list("authors", filters.authors); list("ids", filters.ids);
    list("e", filters.e); list("p", filters.p); list("d", filters.d);
    if (filters.since !== undefined) p.set("since", String(filters.since));
    if (filters.until !== undefined) p.set("until", String(filters.until));
    if (filters.q) p.set("q", filters.q);
    if (filters.node) p.set("node", filters.node);
    p.set("limit", String(filters.limit ?? 100));
    const body = await this.get(`/events?${p}`);
    return (body as { events?: RecordEvent[] }).events ?? [];
  }
  async manifest(): Promise<Record<string, unknown>> {
    return (await this.get("/manifest")) as Record<string, unknown>;
  }
  mediaUrl(sha256: string): string { return `${this.base}/media/${sha256}`; }
  private async get(path: string): Promise<unknown> {
    let res: Response;
    try { res = await this.fetchFn(`${this.base}${path}`); }
    catch (err) { throw new RecordUnavailableError(`index unreachable: ${String(err)}`); }
    if (!res.ok) throw new RecordUnavailableError(`index answered ${res.status} for ${path}`);
    return res.json();
  }
}
```

Check the exact response envelope of `/events` in `packages/indexer/src/api.ts` (~line 180-200) — if it returns a bare array rather than `{events: [...]}`, match it and fix the Step 2 stub accordingly. `tags.ts` is four small pure functions per the interface block.

- [ ] **Step 5: Tests + typecheck** → PASS. Add the package to `pnpm-workspace.yaml` coverage (it's `packages/*` — verify, no change expected) and run `pnpm install` to link.

- [ ] **Step 6: Commit**

```bash
git add packages/record-client pnpm-lock.yaml
git commit -m "feat(record-client): the consumer contract as a package — typed index reads, no dependencies"
git push
```

---

### Task 8: record-client — calendar, cinema, articles, news, profiles (+ round-trip parity)

**Files:**
- Create: `packages/record-client/src/datasets.ts` (re-exported from `src/index.ts`)
- Test: `packages/record-client/test/parity.test.ts`

**Interfaces:**
- Consumes: `RecordClient`, `RecordEvent`, tag helpers (Task 7); publisher mappers as devDep fixtures.
- Produces (each takes `client: RecordClient`, returns app-shaped rows):

```typescript
export interface EventRow { id: string; title: string; description: string | null; date: string;      // "YYYY-MM-DD" Berlin
  time: string | null;   // "HH:MM" Berlin
  end_time: string | null; location: string | null; category: string | null; image_url: string | null;
  website_url: string | null; ticket_price: string | null; status: "approved"; account_id: string | null; }
export interface MovieRow { id: string; title: string; description: string | null; date: string; time: string | null;
  cover_image_url: string | null; trailer_youtube_url: string | null; fsk: string | null;
  status: "published"; created_at: string; updated_at: string; } // matches apps/web actions/movies.ts Movie
export interface ArticleRow { id: string; slug: string | null; title: string; excerpt: string | null;
  content_md: string; cover_image_url: string | null; category: string | null;
  published_at: string | null; ai_generated: boolean; }
export interface OrgRow { id: string; slug: string; name: string; bio: string | null; avatar_url: string | null;
  cover_url: string | null; category: string | null; opening_hours: string | null; is_business: boolean; pubkey: string; }

export async function listEvents(client: RecordClient, opts?: { limit?: number; until?: number }): Promise<EventRow[]>;
export async function getEventById(client: RecordClient, id: string): Promise<EventRow | null>;   // d = event:<id>
export async function listMovies(client: RecordClient, opts?: { limit?: number }): Promise<MovieRow[]>;
export async function listNews(client: RecordClient, opts?: { limit?: number }): Promise<ArticleRow[]>;   // d prefix news:
export async function getNewsBySlug(client: RecordClient, slug: string): Promise<ArticleRow | null>;
export async function listArticles(client: RecordClient, opts?: { limit?: number }): Promise<ArticleRow[]>; // d prefix article:
export async function listOrgs(client: RecordClient): Promise<OrgRow[]>;   // kind 0 with netizen_org tag
export async function getOrgBySlug(client: RecordClient, slug: string): Promise<OrgRow | null>;
export function unixToBerlin(unix: number): { date: string; time: string };  // exported for tests
```

Mapping rules (all from `CONSUMING_THE_RECORD.md`): events = kind 31923 where tag `t` ≠ `kino`; movies = kind 31923 with `t = kino`; `date`/`time` come from the `start` tag via `unixToBerlin` (Intl with `timeZone: "Europe/Berlin"` — the exact inverse of the publisher's `berlinToUnix`); article vs news split on the `d` prefix; org `id` = `d`-independent (kind 0 has no d) — derive from the `netizen_org` tag (`slug`) and keep `pubkey` as the join key; `is_business` = profile content `category === "business"`; events with `status: cancelled` tag are dropped; `getNewsBySlug` scans `listNews(limit 200)` for the `slug` tag (town news volume makes this fine).

- [ ] **Step 1: Write the parity test first** — this is the centerpiece:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { eventToSpec, movieToSpec, newsToSpec, orgToSpec } from "@netizen-labs/publisher";
import { RecordClient } from "../src/index";
import { listEvents, listMovies, listNews, listOrgs, unixToBerlin } from "../src/datasets";
import type { PublishSpec } from "@netizen-labs/publisher";

/** A PublishSpec becomes the IndexedEvent the index would serve (crypto stubbed — parity is about content+tags). */
function asRecordEvent(spec: PublishSpec, pubkey = "f".repeat(64)) {
  return {
    id: "0".repeat(64), pubkey, kind: spec.kind, created_at: spec.createdAt,
    content: spec.content, tags: [["d", spec.d], ...spec.tags.filter((t) => t[0] !== "d")].filter((t) => t[1] !== ""),
    sig: "0".repeat(128), node_id: "roebel", source: "test",
  };
}
const clientFor = (events: unknown[]) =>
  new RecordClient("https://i", (async () => new Response(JSON.stringify({ events }))) as unknown as typeof fetch);

test("round-trip parity: event row → publisher spec → record row", async () => {
  const row = {
    id: "e1", title: "Hafenfest", description: "Musik am See", date: "2026-08-14", time: "19:30",
    end_time: "23:00", location: "Stadthafen", category: "fest", image_url: "https://x/e.jpg",
    status: "approved", updated_at: "2026-07-02T10:00:00Z", created_at: "2026-07-01T10:00:00Z",
  };
  const spec = eventToSpec(row, new Set(), new Map());
  const [back] = await listEvents(clientFor([asRecordEvent(spec!)]));
  assert.equal(back.id, "e1");
  assert.equal(back.title, "Hafenfest");
  assert.equal(back.date, "2026-08-14");
  assert.equal(back.time, "19:30");
  assert.equal(back.location, "Stadthafen");
  assert.equal(back.image_url, "https://x/e.jpg");
});

test("round-trip parity: news", async () => {
  const spec = newsToSpec(
    { id: "n1", slug: "s1", title: "T", excerpt: "E", content: "<p>Body</p>",
      status: "published", updated_at: "2026-07-02T10:00:00Z" },
    (h) => h.replace(/<[^>]+>/g, ""),
  );
  const [back] = await listNews(clientFor([asRecordEvent(spec!)]));
  assert.equal(back.id, "n1");
  assert.equal(back.slug, "s1");
  assert.equal(back.content_md, "Body");
});
```

Add equivalent parity tests for `listMovies` (assert `t: kino` routes to movies, not events) and `listOrgs` (assert `pubkey` preserved and `is_business` false for an org).

- [ ] **Step 2: Verify failure**, **Step 3: Implement `datasets.ts`** — pure tag-reading against the interfaces above. `unixToBerlin`:

```typescript
export function unixToBerlin(unix: number): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(unix * 1000));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}
```

- [ ] **Step 4: Tests + typecheck** → PASS (also confirms the publisher exports `newsToSpec` etc. from its index — add exports there if missing, same commit).

- [ ] **Step 5: Commit**

```bash
git add packages/record-client/src packages/record-client/test packages/record-client/package.json packages/publisher/src/index.ts pnpm-lock.yaml
git commit -m "feat(record-client): calendar, cinema, articles, news, profiles — pinned to the publisher by round-trip parity"
git push
```

---

### Task 9: record-client — posts, threads, reactions, commerce, civic

**Files:**
- Create: `packages/record-client/src/social.ts`, `packages/record-client/src/civic.ts` (re-export both from `src/index.ts`)
- Test: `packages/record-client/test/social.test.ts`, `packages/record-client/test/civic.test.ts`

**Interfaces:**
- Produces:

```typescript
// social.ts
export interface RecordPost { id: string;              // Supabase post id when the event carries the d/publication mapping; else the event id
  event_id: string; author_pubkey: string; author_name: string | null; author_avatar: string | null;
  is_org: boolean; is_agent: boolean; content: string; media_urls: string[];
  created_at: string;      // ISO from event created_at
  likes_count: number; comments_count: number; parent_event_id: string | null; quoted_event_id: string | null; }
export async function listPosts(client: RecordClient, opts?: { limit?: number; until?: number }): Promise<RecordPost[]>;
export async function getThread(client: RecordClient, eventId: string): Promise<RecordPost[]>;  // kind 1 with e=eventId

// civic.ts
export interface ListingRow { id: string; title: string; description: string | null; price: string | null;
  category: string | null; condition: string | null; media_urls: string[]; location: string | null;
  status: "active"; seller_npub: string | null; }
export interface DealRow { id: string; business_id: string | null; business_name: string | null; title: string;
  description: string | null; deal_type: string | null; deal_value: string | null; image_url: string | null;
  start_date: string | null; end_date: string | null; }
export interface MenuData { restaurantId: string; name: string; slug: string | null; location: string | null;
  image: string | null; categories: { name: string; items: { name: string; description?: string; price?: string; currency: string }[] }[]; }
export interface ProposalMetaRow { proposal_id: string; title: string; summary: string; category: string | null;
  governor: string | null; onchain_id: string | null; irys_tx: string | null; status: string | null; published_at: string | null; }
export interface NoticeRow { id: string; kind: "service_alert" | "announcement"; title: string; message: string;
  severity: string | null; status: "active" | "resolved"; }
export async function listListings(client: RecordClient, opts?: { limit?: number }): Promise<ListingRow[]>;
export async function listDeals(client: RecordClient, opts?: { limit?: number }): Promise<DealRow[]>;
export async function getMenu(client: RecordClient, restaurantId: string): Promise<MenuData | null>;   // d = restaurant:<id>
export async function getMenuBySlug(client: RecordClient, slug: string): Promise<MenuData | null>;
export async function listProposals(client: RecordClient, opts?: { limit?: number }): Promise<ProposalMetaRow[]>;
export async function listNotices(client: RecordClient): Promise<NoticeRow[]>;
```

Rules: `listPosts` fetches kind 1 (excluding events whose tags contain `["e", …]` — those are replies), batches the distinct `pubkey`s into ONE kind-0 `authors` query for names/avatars, then ONE kind-7 query with `e = [post event ids]` for like counts and ONE kind-1 `e = [...]` query for comment counts; `is_agent` = author kind-0 content has `"bot": true` OR the post carries a `netizen_agent` tag — agent posts are RETURNED but labelled (the UI must render the label, never as a resident). Listings: hide `status != active` tombstones. Deals: `business_name` from the `business` tag. Menu content is `JSON.parse`d with a try/catch → `null` on malformed. Proposals: read the tags Task 6 writes. Notices: both `d` prefixes, newest per `d` already guaranteed by the index.

- [ ] **Step 1: Failing tests** — fixture events built by hand for social, and via `listingToSpec`/`dealToSpec`/`menuToSpec`/`proposalToSpec`/`noticeToSpec` parity fixtures for civic (same `asRecordEvent` helper — move it to `test/helpers.ts`). The social core:

```typescript
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

test("getThread returns the reply, labelled with its agent author", async () => { /* same stub */ });
test("withdrawn listings are absent", async () => { /* listingToSpec fixture with status sold → tombstone → filtered */ });
test("resolved notices keep their status", async () => { /* noticeToSpec is_active:false → status resolved */ });
```

(The three `/* … */` tests must be written out in full in the same style before implementation — they are one-stub variations of the first.)

- [ ] **Step 2: Verify failure**, **Step 3: Implement**, **Step 4: Tests + typecheck** → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/record-client/src packages/record-client/test
git commit -m "feat(record-client): the social and civic record — posts, threads, listings, menus, proposals, notices"
git push
```

---

### Task 10: apps/web — stop crashing without Supabase

**Files:**
- Modify: `apps/web/src/lib/supabase.ts:11-23` (the throw + singleton)
- Create: `apps/web/src/lib/record.ts`
- Modify: `apps/web/package.json` (dependency), `apps/web/next.config.mjs:27` (transpilePackages)

**Interfaces:**
- Produces (every seam task consumes these):

```typescript
// lib/record.ts
export const hasSupabase: boolean;          // both NEXT_PUBLIC_SUPABASE_URL and _ANON_KEY set
export const recordClient: RecordClient;    // base = NEXT_PUBLIC_NODE_INDEX_URL ?? "https://index.roebel.app"
```

- [ ] **Step 1: Rewrite the head of `lib/supabase.ts`:**

```typescript
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** True when this deployment has a Supabase backend. A keyless fork runs in
 * record mode: public reads come from the node index, everything else is
 * hidden or fails loudly at the point of use — never silently. */
export const hasSupabase = Boolean(supabaseUrl && supabaseAnonKey);

/** In record mode any ACCESS of the client throws with a clear message, so an
 * unported private-data path surfaces as a visible error, not an empty page. */
function keylessProxy(): SupabaseClient {
  return new Proxy({} as SupabaseClient, {
    get(_t, prop) {
      throw new Error(
        `Supabase ist nicht konfiguriert (record mode) — '${String(prop)}' ist ohne Backend nicht verfügbar.`,
      );
    },
  });
}

export const supabase: SupabaseClient = hasSupabase
  ? createClient(supabaseUrl!, supabaseAnonKey!)
  : keylessProxy();
```

(The rest of the file — proposal helpers etc. — is untouched in this task.)

- [ ] **Step 2: Create `lib/record.ts`:**

```typescript
import { RecordClient } from "@netizen-labs/record-client";
export { hasSupabase } from "@/lib/supabase";

/** The node's public index — the read path of record mode. Default is Röbel's
 * own node, so a bare fork shows exactly the town's public record. */
export const recordClient = new RecordClient(
  process.env.NEXT_PUBLIC_NODE_INDEX_URL ?? "https://index.roebel.app",
);
```

- [ ] **Step 3: Wire the workspace package.** `apps/web/package.json` dependencies: `"@netizen-labs/record-client": "workspace:*"`; `next.config.mjs:27`: `transpilePackages: ["@netizen-labs/miniapp-sdk", "@netizen-labs/workspace", "@netizen-labs/record-client"]`. Run `pnpm install`.

- [ ] **Step 4: Verify no regression WITH env** — `NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter web exec tsc --noEmit` (expect only the pre-existing error baseline; none new) and `pnpm --filter web build` with the normal `.env.local` → green. (The keyless build is verified in Task 14, after the seams exist — before that, prerendered pages would hit the Proxy.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/supabase.ts apps/web/src/lib/record.ts apps/web/package.json apps/web/next.config.mjs pnpm-lock.yaml
git commit -m "feat(web): keyless mode exists — hasSupabase flag, loud proxy, record client wiring"
git push
```

---

### Task 11: apps/web seam — home, events, news, cinema, karte

**Files:**
- Modify: `apps/web/src/app/page.tsx` (events ~line 19, news ~line 37, proposals ~line 48)
- Modify: `apps/web/src/app/news/page.tsx:12`, `apps/web/src/app/news/[slug]/page.tsx:21`
- Modify: `apps/web/src/app/events/[id]/page.tsx:38`
- Modify: `apps/web/src/app/actions/movies.ts` (the published-movies read)
- Modify: `apps/web/src/app/karte/page.tsx:14-27`

**Interfaces:**
- Consumes: `hasSupabase`, `recordClient` (Task 10); `listEvents`, `getEventById`, `listNews`, `getNewsBySlug`, `listMovies`, `listOrgs` (Tasks 8).

The pattern, identical at every site — branch FIRST, existing code untouched below:

```typescript
import { hasSupabase, recordClient } from "@/lib/record";
import { listEvents } from "@netizen-labs/record-client";

// inside the loader:
if (!hasSupabase) {
  const events = await listEvents(recordClient, { limit: 20 });
  // adapt to the local variable shape the page already renders, e.g.:
  return events.map((e) => ({ ...e, is_cancelled: false }));
}
// ...existing Supabase query unchanged...
```

- [ ] **Step 1:** For each file above: read the loader, note the exact local shape it renders, add the branch with an explicit field-by-field adaptation from `EventRow`/`ArticleRow`/`MovieRow` (no `as any` — if a rendered field has no record equivalent, set an explicit neutral: `view_count: 0`, `is_cancelled: false`, etc.).
- [ ] **Step 2:** Wrap every record call in `try { … } catch (e) { if (e instanceof RecordUnavailableError) return <empty shape>; throw e; }` — an unreachable index renders the page empty, never a 500.
- [ ] **Step 3:** Events/news detail pages: resolve by `getEventById` / `getNewsBySlug`; a miss renders the existing not-found state.
- [ ] **Step 4:** Verify — typecheck (heap flag) green with no NEW errors; `pnpm --filter web build` with env green.
- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/page.tsx apps/web/src/app/news apps/web/src/app/events apps/web/src/app/actions/movies.ts apps/web/src/app/karte/page.tsx
git commit -m "feat(web): home, events, news, cinema and map read the record when keyless"
git push
```

---

### Task 12: apps/web seam — app feed, orgs, StadtFeed, marketplace, deals, gastro, proposals

**Files:**
- Modify: `apps/web/src/app/actions/posts.ts:100` (`getPostsForFeed`)
- Modify: `apps/web/src/lib/supabase-org-content.ts:53,154,171`, `apps/web/src/app/app/orgs/[slug]/OrgDetailClient.tsx:35`
- Modify: `apps/web/src/components/app/StadtFeed.tsx`
- Modify: `apps/web/src/app/actions/marketplace.ts:34,113`, `apps/web/src/app/actions/businesses.ts:62,175`
- Modify: `apps/web/src/lib/supabase-gastro.ts:55-165`
- Modify: `apps/web/src/lib/supabase.ts` (`getProposals`, `getProposalStats`)

**Interfaces:**
- Consumes: `listPosts`, `getThread`, `listListings`, `listDeals`, `getMenu`, `getMenuBySlug`, `listProposals`, `listNotices`, `getOrgBySlug`, `listOrgs`, `listArticles` (Tasks 8–9).

- [ ] **Step 1: `getPostsForFeed` branch** at the top (before `createClient()`):

```typescript
if (!hasSupabase) {
  try {
    const posts = await listPosts(recordClient, { limit, until: undefined });
    const data: PostWithEngagement[] = posts.slice(offset, offset + limit).map((p) => ({
      id: p.id, wallet_address: "", account_id: null,
      content: p.content, media_urls: p.media_urls, category: null,
      post_type: "text" as PostType, feed_type: (feedType ?? "main") as FeedType,
      status: "published", created_at: p.created_at, updated_at: p.created_at,
      likes_count: p.likes_count, comments_count: p.comments_count,
      author_name: p.author_name ?? "Unbekannt", author_avatar: p.author_avatar,
      is_agent: p.is_agent,       // MUST render the agent label
      viewer_has_liked: false, poll: null, links: [], quoted_post: null,
    } as unknown as PostWithEngagement));
    return { success: true, data };
  } catch { return { success: true, data: [] }; }
}
```

Then open `apps/web/src/types/post.ts`, align every field name/type exactly (the block above is written against the select in this file — fix it to the real interface, adding required fields with explicit neutral values, and remove the `as unknown as` cast if it aligns fully; keep it only if `PostWithEngagement` has viewer-specific required fields with no record meaning).

- [ ] **Step 2: Org pages** — `getOrgBySlug` for the profile, `listArticles` filtered by the org's pubkey for its blog, `getThread`-style author-filtered `listPosts` for its feed; gastro tab via `getMenuBySlug`. StadtFeed: `listNotices()` mapped to its alert/announcement item shapes. Marketplace: `listListings` (detail: find by id in the list result). Deals/Gewerbe: `listDeals` + `listOrgs` businesses (`is_business === true`). Proposals: `getProposals` in `lib/supabase.ts` branches to `listProposals` → map to `Proposal` with `state: Number(status ?? 0)`, votes `"0"` (detail pages read chain + Irys as they already do); `getProposalStats` computes counts from the same list.
- [ ] **Step 3:** Same `RecordUnavailableError` → empty-state handling as Task 11 at every site.
- [ ] **Step 4:** Typecheck (heap flag) — no NEW errors; build with env green.
- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/actions/posts.ts apps/web/src/lib/supabase-org-content.ts apps/web/src/app/app/orgs/[slug]/OrgDetailClient.tsx apps/web/src/components/app/StadtFeed.tsx apps/web/src/app/actions/marketplace.ts apps/web/src/app/actions/businesses.ts apps/web/src/lib/supabase-gastro.ts apps/web/src/lib/supabase.ts
git commit -m "feat(web): feed, orgs, marketplace, menus and proposals read the record when keyless"
git push
```

---

### Task 13: apps/web — read-only gating and the notice

**Files:**
- Create: `apps/web/src/components/RecordModeNotice.tsx`
- Modify: the app shell/header component that hosts login (find via `grep -rn "ConnectButton\|anmelden" apps/web/src/components --include="*.tsx" -l`), `apps/web/src/components/app/PostComposer.tsx` mount sites, and the form pages: `/newsletter`, `/sommercamp`, `/roebel-card`, `/support`

**Interfaces:**
- Consumes: `hasSupabase` (Task 10).
- Produces: `RecordModeNotice` — a slim banner:

```tsx
import { hasSupabase } from "@/lib/record";

/** Shown once in the shell when running keyless. German first, per repo rule. */
export function RecordModeNotice() {
  if (hasSupabase) return null;
  return (
    <div className="w-full bg-[#00498B] px-4 py-2 text-center text-sm text-white">
      Öffentlicher Datensatz – nur Lesen. Diese Instanz läuft ohne Backend und
      zeigt das öffentliche Register der Stadt.
    </div>
  );
}
```

- [ ] **Step 1:** Mount `RecordModeNotice` in the root layout(s) (`apps/web/src/app/layout.tsx` and the `/app` shell layout).
- [ ] **Step 2:** Gate write affordances: login entry, PostComposer, like/comment/repost buttons' handlers, marketplace contact, order flow entry — each site: `if (!hasSupabase) return null;` (component) or disable with the tooltip text `"Nur Lesen — ohne Backend nicht verfügbar"`. Form pages render the notice text instead of the form when keyless.
- [ ] **Step 3:** Verify agent/AI labels render in record mode: a `RecordPost` with `is_agent: true` must show the existing agent/bot badge; `ArticleRow.ai_generated` must show the Art.-50 label. If the feed component keys the badge off something else, adapt the mapping in Task 12's branch, not the component.
- [ ] **Step 4:** Typecheck + build with env → green. **Step 5: Commit**

```bash
git add apps/web/src/components/RecordModeNotice.tsx apps/web/src/app/layout.tsx
# plus each gated component file, staged explicitly by path
git commit -m "feat(web): record mode is honestly read-only — notice, gated writes, labels preserved"
git push
```

---

### Task 14: Keyless smoke + docs + roadmap close-out

**Files:**
- Create: `apps/web/scripts/keyless-smoke.sh`
- Modify: `docs/FORKING_GUIDE.md`, `docs/ROADMAP_AND_DEFERRED.md` (§13a), `docs/STATE_OF_NOSTR.md` (§8/§9 note), `docs/PUBLIC_DATA_ON_NOSTR.md` (§1 "Not yet" column)
- Cross-repo: `netizen_labs/docs/CONSUMING_THE_RECORD.md` (new kinds 32100–32102 + `e`/`p`/`d` params + news `d` prefix + business kind-0 flavor) — separate commit in that repo

**Interfaces:** none new — this task proves the whole chain.

- [ ] **Step 1: The smoke script:**

```bash
#!/usr/bin/env bash
# Keyless smoke: build and boot apps/web with NO Supabase env, then assert the
# public routes render. This is the fork-with-fallback acceptance test.
set -euo pipefail
cd "$(dirname "$0")/.."
env -u NEXT_PUBLIC_SUPABASE_URL -u NEXT_PUBLIC_SUPABASE_ANON_KEY -u SUPABASE_SERVICE_ROLE_KEY \
  NODE_OPTIONS=--max-old-space-size=8192 pnpm build
env -u NEXT_PUBLIC_SUPABASE_URL -u NEXT_PUBLIC_SUPABASE_ANON_KEY -u SUPABASE_SERVICE_ROLE_KEY \
  pnpm start -p 3111 & SERVER=$!
trap 'kill $SERVER' EXIT
sleep 8
for route in / /news /app /app/marktplatz /proposals; do
  code=$(curl -s -o /tmp/keyless-body -w '%{http_code}' "http://localhost:3111$route")
  [ "$code" = "200" ] || { echo "FAIL $route -> $code"; exit 1; }
  grep -q "Öffentlicher Datensatz" /tmp/keyless-body || { echo "FAIL $route missing record-mode notice"; exit 1; }
  echo "OK $route"
done
```

(If `pnpm build` reads `.env.local` regardless of `env -u`, move `.env.local` aside for the run inside the script and restore via the trap.)

- [ ] **Step 2: Run it** — every route OK. Fix what it finds; that is the point.
- [ ] **Step 3: Docs.** FORKING_GUIDE gains a first section "Ohne Supabase starten (record mode)": clone → `pnpm install` → `pnpm --filter web dev` with no env → the app shows Röbel's public record; set `NEXT_PUBLIC_NODE_INDEX_URL` to point at another node. ROADMAP §13a struck through with date + commit. STATE_OF_NOSTR §9 adoption list updated (tag filters shipped). PUBLIC_DATA_ON_NOSTR "Not yet" column emptied of news/menus/proposals/notices/businesses.
- [ ] **Step 4: Cross-repo doc sync** — in `~/Documents/privat/side_projects/netizen_labs`: update `docs/CONSUMING_THE_RECORD.md` (kinds table + filter params), commit there with its own message (`docs: civic kinds 32100-32102 and e/p/d filters join the consumer contract`), push.
- [ ] **Step 5: Commit (this repo)**

```bash
git add apps/web/scripts/keyless-smoke.sh docs/FORKING_GUIDE.md docs/ROADMAP_AND_DEFERRED.md docs/STATE_OF_NOSTR.md docs/PUBLIC_DATA_ON_NOSTR.md
git commit -m "feat: fork-with-fallback lands — keyless smoke green, roadmap §13a closed"
git push
```

---

## Deployment notes (operator steps — NOT part of the coding tasks)

The code ships inert until the node picks it up. After Task 6 (or at the end):

1. Add the new datasets to the LIVE node manifest's `services.publisher.datasets` and `32100,32101,32102` to `services.indexer.kinds`, set `PROPOSAL_GOVERNOR=100:0x5F5e499Dc1872c2Ce19a4b50cd10f680e78E3Ba3` in the publisher env, then `netizen render` + redeploy publisher/indexer containers (same flow as the pending vanish-pipeline deploy).
2. First publisher pass after deploy: check accepted/rejected counts in its log; relay-sync must pick up the new `resto-*`/`biz-*` pubkeys via `EXTRA_KEYS_FILE` automatically — verify one menu event lands with `nak req -k 32101 wss://relay.roebel.app`.
3. Vercel: no new env needed for roebel.app (Supabase stays configured); the default index URL only matters for forks.
