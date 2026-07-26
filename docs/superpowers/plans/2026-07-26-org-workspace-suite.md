# Org Collaborative Workspace Suite v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an org "Arbeitsbereich" section to the org `/dashboard` — config-gated SSO tiles that open the org's shared Nextcloud group folder + Collabora (files/docs) and its Element/Matrix room (team chat), mirroring the citizen dashboard's Slice-1 workspace-tiles pattern, org-scoped.

**Architecture:** Reuse the Slice-1 `WorkspaceTile` type + `filterAvailableTiles` (`apps/web/src/lib/dashboard/workspace-tiles.ts`) unchanged; add a pure org tile builder (`buildOrgWorkspaceTiles`) that returns a "Dateien & Dokumente" tile (Nextcloud) and a "Team-Chat" tile (Matrix/Element), each lit only when its base URL is configured and only inside an org context. A capability flag `SubTypeFeatures.workspace` gates a new `/dashboard/arbeitsbereich` page (a client card that reads the active org from `AccountContext` and the two base URLs from env) plus a new sidebar nav item. Scoping of the *shared* space is enforced downstream by the Röbel ID `org:<accountId>:<role>` group claim in Nextcloud/Matrix — not in the app.

**Tech Stack:** Next.js 15 (App Router, client components), TypeScript, Tailwind CSS, lucide-react icons, `node:test` via `tsx` for unit tests. pnpm workspaces (`@roebel/web`).

## Global Constraints

- **Package manager: pnpm only.** Never `npm`/`yarn`. Test runs use `npx tsx` (the prompt's sanctioned harness).
- **UI copy in German** (primary language of the app).
- **Navy primary via `primary` utility classes** (`text-primary`, `bg-primary/10`, etc.) — the design token resolves to `#00498B`. Never hardcode hex in components.
- **NEVER render a raw `0x…` wallet address** in any UI. This feature renders org names/labels and external app links only — no wallet strings.
- **Config-gated tiles:** each tile is hidden unless its base URL env var is set. v1 must ship (build + typecheck clean) with both URLs unset.
- **Reuse, don't rebuild:** import the Slice-1 `WorkspaceTile` interface and `filterAvailableTiles` from `@/lib/dashboard/workspace-tiles`. Do not redefine the tile shape or the filter.
- **No new tables, no XMTP, no Nostr/Buzz, no native files/docs/chat** (spec §5 non-goals). This slice is SSO tiles + a page + a nav item + one flag only.
- **Do NOT run `pnpm build:web`** — the web build runs at the memory ceiling and OOMs. Verify with scoped `tsc` + `tsx` tests + lint instead.
- **Scoped typecheck:** `pnpm --filter @roebel/web exec tsc --noEmit -p tsconfig.json`. The repo carries ~431 pre-existing `tsc` errors (untyped Supabase client). **Gate only on errors whose path contains a file you created or modified in the task.**
- **Scoped commits** with message prefix `feat(web): …`. Stage only the files each task touches (`git add <files>`), never `git add -A`.

---

### Task 1: `SubTypeFeatures.workspace` capability flag

Adds the org-side capability flag that gates the Arbeitsbereich section/nav. Org analog of the citizen `dashboardFeatures(...).workspace` flag that already exists (`apps/web/src/lib/dashboard/features.ts`). Default: every org sub_type gets it (a shared workspace benefits every org type); the `null` (non-org) branch does not.

**Files:**
- Modify: `apps/web/src/types/account.ts` (interface `SubTypeFeatures` ~L159-172; function `subTypeFeatures` ~L175-285)
- Test: `apps/web/tests/sub-type-features.test.ts` (create)

**Interfaces:**
- Consumes: existing `subTypeFeatures(subType: OrgSubType | null): SubTypeFeatures` and `type OrgSubType` (`@/types/account`).
- Produces: `SubTypeFeatures` gains `workspace: boolean`. `subTypeFeatures(sub)` returns `workspace: true` for all six org sub_types (`restaurant`, `unternehmen`, `verein`, `stadt`, `fraktion`, `journalist`) and `workspace: false` for the `default` (null) branch. Consumed by Task 3 (page gate is upstream via the shell) and Task 4 (sidebar `visible`).

- [ ] **Step 1: Write the failing test**

Create `apps/web/tests/sub-type-features.test.ts` (mirrors `apps/web/tests/dashboard-features.test.ts` style):

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { subTypeFeatures, type OrgSubType } from "../src/types/account";

const ORG_SUB_TYPES: OrgSubType[] = [
  "restaurant",
  "unternehmen",
  "verein",
  "stadt",
  "fraktion",
  "journalist",
];

test("every org sub_type gets the workspace section", () => {
  for (const sub of ORG_SUB_TYPES) {
    assert.equal(
      subTypeFeatures(sub).workspace,
      true,
      `${sub} should expose the workspace`
    );
  }
});

test("null sub_type (no org) does not get the workspace section", () => {
  assert.equal(subTypeFeatures(null).workspace, false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/web && npx tsx --test tests/sub-type-features.test.ts`
Expected: FAIL — `workspace` is `undefined` on the returned objects, so `subTypeFeatures(sub).workspace === true` is false. (TypeScript may also error that `workspace` is not on `SubTypeFeatures`; either way the run is red.)

- [ ] **Step 3: Add `workspace` to the `SubTypeFeatures` interface**

In `apps/web/src/types/account.ts`, add the field to the interface (after `flyer: boolean;`):

```ts
export interface SubTypeFeatures {
  blog: boolean;
  members: boolean;
  openingHours: boolean;
  products: boolean;
  ads: boolean;
  events: boolean;
  partner: boolean;
  speisekarte: boolean;
  storyCollections: boolean;
  proposals: boolean;
  foerdermittel: boolean;
  flyer: boolean;
  workspace: boolean;
}
```

- [ ] **Step 4: Set `workspace` in every branch of `subTypeFeatures`**

In the same file, add one line to each returned object. For each of the **six org branches** (`case "restaurant"`, `"unternehmen"`, `"verein"`, `"stadt"`, `"fraktion"`, `"journalist"`), add `workspace: true,` immediately after that branch's `flyer: true,` line. In the **`default:` branch**, add `workspace: false,` immediately after its `flyer: false,` line. Example — the `restaurant` branch becomes:

```ts
    case "restaurant":
      return {
        blog: true,
        members: true,
        openingHours: true,
        products: true,
        ads: true,
        events: true,
        partner: true,
        speisekarte: true,
        storyCollections: false,
        proposals: false,
        foerdermittel: true,
        flyer: true,
        workspace: true,
      };
```

and the `default` branch becomes:

```ts
    default:
      return {
        blog: false,
        members: false,
        openingHours: false,
        products: false,
        ads: false,
        events: false,
        partner: false,
        speisekarte: false,
        storyCollections: false,
        proposals: false,
        foerdermittel: false,
        flyer: false,
        workspace: false,
      };
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/web && npx tsx --test tests/sub-type-features.test.ts`
Expected: PASS — `tests 2`, `pass 2`, `fail 0`.

- [ ] **Step 6: Scoped typecheck**

Run: `pnpm --filter @roebel/web exec tsc --noEmit -p tsconfig.json 2>&1 | grep -E "types/account\.ts|sub-type-features" || echo "OK: no type errors in touched files"`
Expected: `OK: no type errors in touched files`. (Adding a required field to `SubTypeFeatures` cannot break other call sites: every existing `subTypeFeatures(...)` consumer reads named fields; none constructs the object.)

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/types/account.ts apps/web/tests/sub-type-features.test.ts
git commit -m "feat(web): add workspace capability flag to org SubTypeFeatures"
```

---

### Task 2: `buildOrgWorkspaceTiles` pure builder + unit tests

The org analog of Slice-1's `buildWorkspaceTiles`. Pure and React-free so it is unit-testable under `node:test`. Returns two config-gated tiles — Nextcloud files/docs + Matrix/Element chat — for an org context; returns `[]` when there is no active org (a shared org workspace only exists inside an org; scoping is via the group claim downstream). **Reuses** the Slice-1 `WorkspaceTile` type and `filterAvailableTiles`; does not redefine them.

**Files:**
- Create: `apps/web/src/lib/dashboard/org-workspace-tiles.ts`
- Test: `apps/web/tests/org-workspace-tiles.test.ts`

**Interfaces:**
- Consumes: `WorkspaceTile` (interface) and `filterAvailableTiles(tiles: WorkspaceTile[]): WorkspaceTile[]` from `@/lib/dashboard/workspace-tiles`; `Account` from `@/types/account` (fields `id: string`, `slug: string | null`).
- Produces:
  - `interface OrgWorkspaceTileConfig { workspaceBaseUrl?: string | null; chatBaseUrl?: string | null; org: Pick<Account, "id" | "slug"> | null; }`
  - `function buildOrgWorkspaceTiles(config: OrgWorkspaceTileConfig): WorkspaceTile[]` — returns `[]` when `config.org` is null; otherwise returns exactly two tiles with ids `"org-nextcloud"` (icon `"cloud"`, label `"Dateien & Dokumente"`) and `"org-chat"` (icon `"messages"`, label `"Team-Chat"`). Each has `requiresConfig: true`; `configured`/`href` derive from the trimmed base URL (trailing slashes stripped, `href: ""` when unconfigured). Consumed by Task 3's card.

- [ ] **Step 1: Write the failing test**

Create `apps/web/tests/org-workspace-tiles.test.ts` (mirrors `apps/web/tests/workspace-tiles.test.ts`):

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildOrgWorkspaceTiles } from "../src/lib/dashboard/org-workspace-tiles";
import { filterAvailableTiles } from "../src/lib/dashboard/workspace-tiles";

const ORG = { id: "org-1", slug: "roebel-ev" };

test("no org context yields no tiles", () => {
  assert.deepEqual(buildOrgWorkspaceTiles({ org: null }), []);
});

test("builds files + chat tiles for an org, in order", () => {
  const tiles = buildOrgWorkspaceTiles({
    workspaceBaseUrl: "https://cloud.roebel.app",
    chatBaseUrl: "https://chat.roebel.app",
    org: ORG,
  });
  assert.deepEqual(
    tiles.map((t) => t.id),
    ["org-nextcloud", "org-chat"]
  );
  assert.equal(tiles[0].label, "Dateien & Dokumente");
  assert.equal(tiles[1].label, "Team-Chat");
  assert.equal(tiles[1].icon, "messages");
});

test("files tile is unconfigured without a workspace base url", () => {
  const files = buildOrgWorkspaceTiles({
    chatBaseUrl: "https://chat.roebel.app",
    org: ORG,
  }).find((t) => t.id === "org-nextcloud");
  assert.ok(files);
  assert.equal(files.requiresConfig, true);
  assert.equal(files.configured, false);
  assert.equal(files.href, "");
});

test("chat tile is unconfigured without a chat base url", () => {
  const chat = buildOrgWorkspaceTiles({
    workspaceBaseUrl: "https://cloud.roebel.app",
    org: ORG,
  }).find((t) => t.id === "org-chat");
  assert.ok(chat);
  assert.equal(chat.requiresConfig, true);
  assert.equal(chat.configured, false);
  assert.equal(chat.href, "");
});

test("configured tiles carry trimmed base-url hrefs", () => {
  const tiles = buildOrgWorkspaceTiles({
    workspaceBaseUrl: "https://cloud.roebel.app/",
    chatBaseUrl: "https://chat.roebel.app/",
    org: ORG,
  });
  const files = tiles.find((t) => t.id === "org-nextcloud");
  const chat = tiles.find((t) => t.id === "org-chat");
  assert.equal(files?.href, "https://cloud.roebel.app");
  assert.equal(chat?.href, "https://chat.roebel.app");
  assert.equal(files?.configured, true);
  assert.equal(chat?.configured, true);
});

test("filterAvailableTiles hides the tile whose base url is unset", () => {
  const visible = filterAvailableTiles(
    buildOrgWorkspaceTiles({
      workspaceBaseUrl: "https://cloud.roebel.app",
      org: ORG,
    })
  );
  assert.deepEqual(
    visible.map((t) => t.id),
    ["org-nextcloud"]
  );
});

test("nothing configured yields no visible tiles", () => {
  assert.equal(
    filterAvailableTiles(buildOrgWorkspaceTiles({ org: ORG })).length,
    0
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/web && npx tsx --test tests/org-workspace-tiles.test.ts`
Expected: FAIL — `Cannot find module '../src/lib/dashboard/org-workspace-tiles'` (the builder does not exist yet).

- [ ] **Step 3: Write the builder**

Create `apps/web/src/lib/dashboard/org-workspace-tiles.ts`:

```ts
/**
 * Org workspace SSO tiles. The org analog of `buildWorkspaceTiles`
 * (@/lib/dashboard/workspace-tiles): tiles link out to the org's SHARED
 * office apps, each authenticating the user via Röbel ID (OIDC). Scoping to
 * the org's own group folder / chat room is enforced downstream by the
 * `org:<accountId>:<role>` group claim in Nextcloud/Matrix — not here — so v1
 * simply links to the configured base URL.
 *
 * Pure + React-free so it is unit-testable under node:test. The UI layer maps
 * the string `icon` key to a lucide component and reads the two base URLs from
 * `process.env.NEXT_PUBLIC_WORKSPACE_BASE_URL` /
 * `process.env.NEXT_PUBLIC_CHAT_BASE_URL`. Reuses the Slice-1 `WorkspaceTile`
 * shape + `filterAvailableTiles`.
 */

import type { WorkspaceTile } from "@/lib/dashboard/workspace-tiles";
import type { Account } from "@/types/account";

export interface OrgWorkspaceTileConfig {
  /** Base URL of the shared Nextcloud/Collabora workspace. Empty/undefined = not configured. */
  workspaceBaseUrl?: string | null;
  /** Base URL of the org Element/Matrix chat. Empty/undefined = not configured. */
  chatBaseUrl?: string | null;
  /** The active org whose shared space these tiles target. Null = no org context. */
  org: Pick<Account, "id" | "slug"> | null;
}

/** Build the org tile list (files + chat), resolving hrefs from the supplied config. */
export function buildOrgWorkspaceTiles(
  config: OrgWorkspaceTileConfig
): WorkspaceTile[] {
  // A shared org workspace only exists inside an org context; without one there
  // is nothing to link to (the group claim, not a URL path, does the scoping).
  if (!config.org) return [];

  const filesBase = (config.workspaceBaseUrl ?? "").trim().replace(/\/+$/, "");
  const chatBase = (config.chatBaseUrl ?? "").trim().replace(/\/+$/, "");
  const filesConfigured = filesBase.length > 0;
  const chatConfigured = chatBase.length > 0;

  return [
    {
      id: "org-nextcloud",
      label: "Dateien & Dokumente",
      icon: "cloud",
      href: filesConfigured ? filesBase : "",
      requiresConfig: true,
      configured: filesConfigured,
    },
    {
      id: "org-chat",
      label: "Team-Chat",
      icon: "messages",
      href: chatConfigured ? chatBase : "",
      requiresConfig: true,
      configured: chatConfigured,
    },
  ];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/web && npx tsx --test tests/org-workspace-tiles.test.ts`
Expected: PASS — `tests 7`, `pass 7`, `fail 0`.

- [ ] **Step 5: Scoped typecheck**

Run: `pnpm --filter @roebel/web exec tsc --noEmit -p tsconfig.json 2>&1 | grep -E "org-workspace-tiles" || echo "OK: no type errors in touched files"`
Expected: `OK: no type errors in touched files`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/dashboard/org-workspace-tiles.ts apps/web/tests/org-workspace-tiles.test.ts
git commit -m "feat(web): add org workspace-tiles builder (files + chat)"
```

---

### Task 3: `/dashboard/arbeitsbereich` page + `OrgWorkspaceTilesCard` + env doc

The visible surface: a client card that reads the active org from `AccountContext` and the two base URLs from env, renders the config-gated tiles, and a dashboard page that hosts it. Mirrors the citizen `WorkspaceTilesCard` (`apps/web/src/components/dashboard/WorkspaceTilesCard.tsx`) and the org page conventions (`apps/web/src/app/dashboard/foerdermittel/page.tsx`). The org shell (`apps/web/src/app/dashboard/layout.tsx`) already gates `isOrgAccount` and only renders children for a valid org, so the page needs no extra account guard. No component-test infra exists (`apps/web/package.json` has no test runner or React-testing deps), so this task is verified by scoped typecheck + lint + a manual checklist.

**Files:**
- Create: `apps/web/src/components/org-dashboard/OrgWorkspaceTilesCard.tsx`
- Create: `apps/web/src/app/dashboard/arbeitsbereich/page.tsx`
- Modify: `apps/web/.env.example` (add `NEXT_PUBLIC_CHAT_BASE_URL` after the existing `NEXT_PUBLIC_WORKSPACE_BASE_URL` block ~L23-25)

**Interfaces:**
- Consumes: `buildOrgWorkspaceTiles(config): WorkspaceTile[]` + `OrgWorkspaceTileConfig` (Task 2); `filterAvailableTiles` (`@/lib/dashboard/workspace-tiles`); `useAccount(): { activeAccount: Account | null; … }` (`@/lib/context/AccountContext`); `Account` fields `id`, `slug`; env `NEXT_PUBLIC_WORKSPACE_BASE_URL`, `NEXT_PUBLIC_CHAT_BASE_URL`; lucide `Cloud`, `MessagesSquare`, `Briefcase`, `LayoutGrid`, `type LucideIcon`.
- Produces: React component `OrgWorkspaceTilesCard()` (no props) and the route `/dashboard/arbeitsbereich` (default-exported `ArbeitsbereichPage()`). The route path is consumed by Task 4's nav item.

- [ ] **Step 1: Create the org card component**

Create `apps/web/src/components/org-dashboard/OrgWorkspaceTilesCard.tsx`:

```tsx
"use client";

import { Cloud, MessagesSquare, LayoutGrid, type LucideIcon } from "lucide-react";
import { useAccount } from "@/lib/context/AccountContext";
import { buildOrgWorkspaceTiles } from "@/lib/dashboard/org-workspace-tiles";
import { filterAvailableTiles } from "@/lib/dashboard/workspace-tiles";

const ICONS: Record<string, LucideIcon> = {
  cloud: Cloud,
  messages: MessagesSquare,
};

export function OrgWorkspaceTilesCard() {
  const { activeAccount } = useAccount();

  const tiles = filterAvailableTiles(
    buildOrgWorkspaceTiles({
      workspaceBaseUrl: process.env.NEXT_PUBLIC_WORKSPACE_BASE_URL,
      chatBaseUrl: process.env.NEXT_PUBLIC_CHAT_BASE_URL,
      org: activeAccount
        ? { id: activeAccount.id, slug: activeAccount.slug }
        : null,
    })
  );

  if (tiles.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl shadow-sm p-6 text-center">
        <LayoutGrid className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">
          Der gemeinsame Arbeitsbereich wird bald verfügbar sein.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {tiles.map((tile) => {
        const Icon = ICONS[tile.icon] ?? LayoutGrid;
        return (
          <a
            key={tile.id}
            href={tile.href}
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-col items-center gap-2 bg-card border border-border rounded-xl p-5 hover:bg-accent transition-colors text-center"
          >
            <div className="h-11 w-11 rounded-lg bg-primary/10 flex items-center justify-center">
              <Icon className="h-6 w-6 text-primary" />
            </div>
            <span className="text-sm font-medium text-foreground">
              {tile.label}
            </span>
          </a>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Create the page**

Create `apps/web/src/app/dashboard/arbeitsbereich/page.tsx`:

```tsx
"use client";

import { Briefcase } from "lucide-react";
import { OrgWorkspaceTilesCard } from "@/components/org-dashboard/OrgWorkspaceTilesCard";

export default function ArbeitsbereichPage() {
  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-medium flex items-center gap-2">
          <Briefcase className="h-5 w-5 text-primary" />
          Arbeitsbereich
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Der gemeinsame Arbeitsbereich eurer Organisation: geteilte Dateien &
          Dokumente sowie der Team-Chat — angemeldet über Röbel ID.
        </p>
      </div>
      <OrgWorkspaceTilesCard />
    </div>
  );
}
```

- [ ] **Step 3: Document the new env var**

In `apps/web/.env.example`, immediately after the existing `NEXT_PUBLIC_WORKSPACE_BASE_URL=https://cloud.example.org` line (currently ~L25), add:

```bash

# Base URL of the org team chat (Element/Matrix), reached via Röbel ID SSO.
# Leave unset to hide the "Team-Chat" tile in the org Arbeitsbereich. Client-readable.
NEXT_PUBLIC_CHAT_BASE_URL=https://chat.example.org
```

- [ ] **Step 4: Scoped typecheck**

Run: `pnpm --filter @roebel/web exec tsc --noEmit -p tsconfig.json 2>&1 | grep -E "arbeitsbereich|OrgWorkspaceTilesCard" || echo "OK: no type errors in touched files"`
Expected: `OK: no type errors in touched files`.

- [ ] **Step 5: Lint the new files**

Run: `cd apps/web && npx next lint --file src/components/org-dashboard/OrgWorkspaceTilesCard.tsx --file src/app/dashboard/arbeitsbereich/page.tsx`
Expected: no errors for these files (warnings pre-existing elsewhere are out of scope).

- [ ] **Step 6: Manual checklist** (record results in the commit body or PR)

  - `NEXT_PUBLIC_WORKSPACE_BASE_URL` + `NEXT_PUBLIC_CHAT_BASE_URL` both **unset** → visiting `/dashboard/arbeitsbereich` as an org shows the "wird bald verfügbar sein" empty state, no tiles.
  - Set only `NEXT_PUBLIC_WORKSPACE_BASE_URL` → only the "Dateien & Dokumente" tile appears; its link opens the workspace base URL in a new tab.
  - Set both URLs → both "Dateien & Dokumente" and "Team-Chat" tiles appear; each opens the correct app in a new tab (`target="_blank"`, `rel="noopener noreferrer"`).
  - Tile icons render (Cloud, MessagesSquare) in navy (`text-primary` on `bg-primary/10`).
  - No raw `0x…` wallet address appears anywhere on the page.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/org-dashboard/OrgWorkspaceTilesCard.tsx apps/web/src/app/dashboard/arbeitsbereich/page.tsx apps/web/.env.example
git commit -m "feat(web): add org Arbeitsbereich page with workspace SSO tiles"
```

---

### Task 4: Org sidebar "Arbeitsbereich" nav item

Adds the nav entry that links to the new page, gated by the `features.workspace` flag from Task 1. Follows the existing item pattern in `apps/web/src/components/org-dashboard/org-sidebar.tsx` (each item is `{ name, href, icon, visible }`, filtered by `visible` at render). Verified by scoped typecheck + lint + a manual check (no nav component-test infra).

**Files:**
- Modify: `apps/web/src/components/org-dashboard/org-sidebar.tsx` (lucide import ~L5-24; `items` array ~L47-150)

**Interfaces:**
- Consumes: `features.workspace` (from `subTypeFeatures(account.sub_type)`, already computed at `org-sidebar.tsx:38`); the route `/dashboard/arbeitsbereich` (Task 3); lucide `Briefcase`.
- Produces: a nav item — no exported API change.

- [ ] **Step 1: Add the `Briefcase` icon to the lucide import**

In `apps/web/src/components/org-dashboard/org-sidebar.tsx`, add `Briefcase,` to the existing `lucide-react` import block (e.g. after `Landmark,`):

```tsx
  Landmark,
  Briefcase,
  Image as ImageIcon,
```

- [ ] **Step 2: Add the nav item**

In the `items: Item[]` array, insert the Arbeitsbereich item immediately after the "Mini-Apps" item and before "Einstellungen":

```tsx
    {
      name: "Mini-Apps",
      href: "/dashboard/mini-apps",
      icon: <LayoutGrid className="h-4 w-4" />,
      visible: true,
    },
    {
      name: "Arbeitsbereich",
      href: "/dashboard/arbeitsbereich",
      icon: <Briefcase className="h-4 w-4" />,
      visible: features.workspace,
    },
    {
      name: "Einstellungen",
      href: "/dashboard/settings",
      icon: <Settings className="h-4 w-4" />,
      visible: true,
    },
```

- [ ] **Step 3: Scoped typecheck**

Run: `pnpm --filter @roebel/web exec tsc --noEmit -p tsconfig.json 2>&1 | grep -E "org-sidebar" || echo "OK: no type errors in touched files"`
Expected: `OK: no type errors in touched files`. (`features.workspace` now exists on `SubTypeFeatures` from Task 1.)

- [ ] **Step 4: Lint the file**

Run: `cd apps/web && npx next lint --file src/components/org-dashboard/org-sidebar.tsx`
Expected: no errors for this file.

- [ ] **Step 5: Manual check**

  - As an org account, the sidebar shows an "Arbeitsbereich" item (Briefcase icon) between "Mini-Apps" and "Einstellungen"; clicking it navigates to `/dashboard/arbeitsbereich` and the item shows the active state.
  - A personal account never reaches `/dashboard` (the shell blocks non-orgs), so the item is never shown outside an org.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/org-dashboard/org-sidebar.tsx
git commit -m "feat(web): add Arbeitsbereich item to org dashboard sidebar"
```

---

## Self-Review

**1. Spec coverage**

| Spec item | Task |
|---|---|
| §1/§2 "Arbeitsbereich" section in org `/dashboard` with files/docs + chat tiles | Task 3 (page + card) |
| §2 capability flag `SubTypeFeatures.workspace` set for org sub_types | Task 1 |
| §2 sidebar "Arbeitsbereich" nav item gated by `features.workspace` | Task 4 |
| §2/§4 org-scoping via group claim; href = configured base URL | Task 2 (builder: `org` gates existence, href = trimmed base) |
| §3/§5.5 reuse `WorkspaceTile` + `filterAvailableTiles`; add org builder | Task 2 (imports both, adds `buildOrgWorkspaceTiles`) |
| §4 config: `NEXT_PUBLIC_WORKSPACE_BASE_URL` (reused) + `NEXT_PUBLIC_CHAT_BASE_URL` (new); tiles hidden when unset | Task 2 (gating) + Task 3 (env doc, reads both) |
| §4 no new tables | No table work in any task ✓ |
| §5 non-goals: no XMTP / Nostr / native files-chat / provisioning | Nothing in any task touches these ✓ |
| §6 unit tests for builder (files+chat, requiresConfig, hidden-when-unset, filter, org-scoped) | Task 2 tests |
| §6 React = scoped typecheck + lint + manual checklist | Tasks 3 & 4 |

No gaps.

**2. Placeholder scan**

No `TBD`/`TODO`/"handle edge cases"/"similar to Task N". Every code step contains full, real code. The six repetitive `subTypeFeatures` branch edits are each specified exactly (add `workspace: true,` after `flyer: true,`; `workspace: false,` after `flyer: false,` in default) with two concrete rendered examples. All lucide icon names (`Cloud`, `MessagesSquare`, `Briefcase`, `LayoutGrid`) were verified present in the installed `lucide-react@0.546.0`. The `tsx --test` harness and the `NEXT_PUBLIC_WORKSPACE_BASE_URL` env line were verified against the real repo.

**3. Type consistency**

- `WorkspaceTile` (fields `id, label, icon, href, requiresConfig, configured`) is imported from `@/lib/dashboard/workspace-tiles` in Task 2 and used unchanged in Tasks 2/3 — same shape everywhere.
- `filterAvailableTiles(tiles: WorkspaceTile[])` — same signature in Task 2 tests and Task 3 card.
- `buildOrgWorkspaceTiles(config: OrgWorkspaceTileConfig): WorkspaceTile[]` and `OrgWorkspaceTileConfig` (`workspaceBaseUrl?`, `chatBaseUrl?`, `org`) — defined in Task 2, consumed identically in Task 3.
- Tile ids `"org-nextcloud"`/`"org-chat"` and icon keys `"cloud"`/`"messages"` produced in Task 2 match the `ICONS` map keys in Task 3's card.
- `SubTypeFeatures.workspace: boolean` added in Task 1 is the exact field read as `features.workspace` in Task 4.
- `useAccount()` returns `{ activeAccount: Account | null }` per `AccountContext.tsx`; Task 3 reads `activeAccount.id` / `activeAccount.slug`, both real `Account` fields (`slug: string | null`, matching `Pick<Account, "id" | "slug">`).

No inconsistencies found.
