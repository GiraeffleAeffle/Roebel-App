# Röbel Citizen Dashboard v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a logged-in Citizen a sovereign "home" at `/app/dashboard` — identity + passport + memberships, a Mecky copilot entry, civic quick-access, and a config-driven workspace-SSO-tile grid — nested inside the existing `AppShell`, with citizen-only entry points wired into the sidebar and right panel.

**Architecture:** Everything is reuse except one new route + two small components + three pure helper modules + two wiring edits. The page is citizen-gated with the app's existing advisory-flag-plus-chain pattern (`useVerificationStatus` ∪ `user.tier`/`is_verified_citizen`) and renders a graceful non-citizen state (no hard redirect, matching `AuthGuard`'s soft-guard convention). Which sections show is driven by a new `dashboardFeatures(tier)` capability map (the citizen analog of the existing `subTypeFeatures(sub_type)`). Memberships union on-chain citizenship with org memberships already loaded in `AccountContext` (`account_owners`). Workspace tiles are a typed constants list filtered by whether their required config (a workspace base URL) is present.

**Tech Stack:** Next.js 15 (App Router, React 19, client components), TypeScript, Tailwind CSS, thirdweb React hooks, Supabase (existing data layer, no new tables), lucide-react icons. Tests: Node's built-in test runner (`node:test`) executed via `tsx` — the repo's only test harness.

## Global Constraints

Every task's requirements implicitly include this section.

- **Package manager: pnpm only.** Never npm/yarn. Run web-scoped scripts with `pnpm --filter @roebel/web <script>`.
- **UI copy in German (primary).** All user-facing strings are German.
- **Primary color is navy `#00498B`.** Use the Tailwind `primary`/`primary-foreground` utilities (they already map to navy in the theme, as in `AppRightPanel`'s org CTA and `IdentityCard`'s `from-[#00498B]`). Only write the literal `#00498B` when a utility cannot express it.
- **NEVER render a raw wallet `0x…` in the UI.** Always resolve to a display name (`account.name`, `user.username`, or fixed label). Memberships and identity must never surface an address. (See `feedback_never_show_wallets`.)
- **Test harness = `node:test` via `tsx`.** Unit tests for pure functions live in `apps/web/tests/<name>.test.ts` and use `import assert from "node:assert/strict"; import { test } from "node:test";` (mirror `apps/web/tests/foerdermittel-eligibility.test.ts`). Run the whole web suite with `pnpm test:web` (from repo root); run one file with `npx tsx --test apps/web/tests/<name>.test.ts` (from repo root). The `@/` path alias resolves under `tsx` (proven by the passing foerdermittel tests).
- **NO component/integration test infra exists** in `apps/web` — there is no vitest, jest, @testing-library, or jsdom, and no `test` script in `apps/web/package.json`. Do **not** add one. For the page + React components, verification = lint + a narrowly-scoped typecheck + a documented manual checklist (see the verification steps in Tasks 3–5).
- **Typecheck is scoped narrowly.** The repo carries pre-existing type noise; a repo-wide `tsc` is not a clean gate. Gate only on errors whose file path contains your new files, e.g. `npx tsc --noEmit -p apps/web/tsconfig.json 2>&1 | grep -E "src/(lib|components|app/app)/dashboard" || echo "no new dashboard type errors"` (run from repo root). Do not run a full `pnpm build:web` for per-task verification — the web build runs near an 8 GB memory ceiling and is OOM-prone.
- **Frequent, scoped commits.** Stage only the files a task touched (`git add <file> …`, never `git add -A`). Conventional commit prefix `feat(web): …`.

---

## File Structure

New files:
- `apps/web/src/lib/dashboard/features.ts` — `dashboardFeatures(tier)` capability map (pure).
- `apps/web/src/lib/dashboard/workspace-tiles.ts` — workspace SSO-tile config + build/filter (pure).
- `apps/web/src/lib/dashboard/memberships.ts` — `buildMembershipList(...)` composer (pure).
- `apps/web/src/components/dashboard/MembershipsCard.tsx` — memberships view (client).
- `apps/web/src/components/dashboard/WorkspaceTilesCard.tsx` — SSO-tile grid (client).
- `apps/web/src/app/app/dashboard/page.tsx` — the citizen dashboard page (client, gated).
- `apps/web/tests/dashboard-features.test.ts` — unit tests for Task 1.
- `apps/web/tests/workspace-tiles.test.ts` — unit tests for Task 2.
- `apps/web/tests/dashboard-memberships.test.ts` — unit tests for Task 3.

Modified files:
- `apps/web/src/components/app/AppSidebar.tsx` — citizen-only "Dashboard" nav item + precise `modes` filter (Task 5).
- `apps/web/src/components/app/AppRightPanel.tsx` — citizen-personal "Dashboard öffnen" CTA (Task 5).
- `apps/web/.env.example` — document `NEXT_PUBLIC_WORKSPACE_BASE_URL` (Task 4).

> `apps/web/src/components/dashboard/` already exists (it holds only a `speisekarte/` subdir); adding files there is safe. The **org** dashboard lives under `src/components/org-dashboard/` and `src/app/dashboard/**` — do not touch it; this feature is `src/app/app/dashboard/**` (note the doubled `app`, nested inside `AppShell`).

---

### Task 1: `dashboardFeatures(tier)` capability map

The citizen analog of `subTypeFeatures(sub_type)` (`apps/web/src/types/account.ts:175`). One place that decides which dashboard sections a tier sees. Pure function → real unit tests.

**Files:**
- Create: `apps/web/src/lib/dashboard/features.ts`
- Test: `apps/web/tests/dashboard-features.test.ts`

**Interfaces:**
- Consumes: `UserTier` (`"guest" | "tourist" | "citizen"`) from `@/types/account` (`apps/web/src/types/account.ts:10`).
- Produces:
  - `interface DashboardFeatures { identity: boolean; memberships: boolean; copilot: boolean; civic: boolean; workspace: boolean; }`
  - `function dashboardFeatures(tier: UserTier): DashboardFeatures` — citizen ⇒ all `true`; tourist/guest ⇒ all `false`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/tests/dashboard-features.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { dashboardFeatures } from "../src/lib/dashboard/features";

test("citizen sees every section", () => {
  assert.deepEqual(dashboardFeatures("citizen"), {
    identity: true,
    memberships: true,
    copilot: true,
    civic: true,
    workspace: true,
  });
});

test("tourist sees no sections", () => {
  const f = dashboardFeatures("tourist");
  assert.equal(Object.values(f).some(Boolean), false);
});

test("guest sees no sections", () => {
  const f = dashboardFeatures("guest");
  assert.equal(Object.values(f).some(Boolean), false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from repo root): `npx tsx --test apps/web/tests/dashboard-features.test.ts`
Expected: FAIL — cannot find module `../src/lib/dashboard/features`.

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/lib/dashboard/features.ts`:

```ts
import type { UserTier } from "@/types/account";

/** Which dashboard sections a given tier is allowed to see. */
export interface DashboardFeatures {
  identity: boolean;
  memberships: boolean;
  copilot: boolean;
  civic: boolean;
  workspace: boolean;
}

/**
 * Single source of truth for which citizen-dashboard sections each tier sees.
 * Citizen analog of `subTypeFeatures(sub_type)` in `@/types/account`.
 * Citizens see everything; tourists and guests see nothing (the page shows
 * them a graceful "citizen-only" prompt instead).
 */
export function dashboardFeatures(tier: UserTier): DashboardFeatures {
  switch (tier) {
    case "citizen":
      return {
        identity: true,
        memberships: true,
        copilot: true,
        civic: true,
        workspace: true,
      };
    case "tourist":
    case "guest":
    default:
      return {
        identity: false,
        memberships: false,
        copilot: false,
        civic: false,
        workspace: false,
      };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run (from repo root): `npx tsx --test apps/web/tests/dashboard-features.test.ts`
Expected: PASS — 3 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/dashboard/features.ts apps/web/tests/dashboard-features.test.ts
git commit -m "feat(web): add dashboardFeatures(tier) capability map"
```

---

### Task 2: Workspace SSO-tile config + filter

A typed constants list of workspace apps, each `{ id, label, icon, href, requiresConfig }`, plus a builder that resolves hrefs from a workspace base URL and a filter that hides `requiresConfig` tiles when unconfigured. v1 ships exactly one tile — Nextcloud/Collabora (config-gated) — the framework for adding Buzz/openDesk/Netizen tiles later by config. Pure module (React-free, so the unit test runs under `node:test` without importing React/lucide) → real unit tests.

**Files:**
- Create: `apps/web/src/lib/dashboard/workspace-tiles.ts`
- Test: `apps/web/tests/workspace-tiles.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks. The base URL is passed in (the UI layer reads `process.env.NEXT_PUBLIC_WORKSPACE_BASE_URL` in Task 4 and forwards it) — the module never reads `process.env`, so it stays pure and testable.
- Produces:
  - `interface WorkspaceTileConfig { workspaceBaseUrl?: string | null }`
  - `interface WorkspaceTile { id: string; label: string; icon: string; href: string; requiresConfig: boolean; configured: boolean }` — `icon` is a string key resolved to a lucide component in the UI layer; `href` is `""` when `requiresConfig && !configured`.
  - `function buildWorkspaceTiles(config: WorkspaceTileConfig): WorkspaceTile[]`
  - `function filterAvailableTiles(tiles: WorkspaceTile[]): WorkspaceTile[]` — keeps a tile iff `!requiresConfig || configured`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/tests/workspace-tiles.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildWorkspaceTiles,
  filterAvailableTiles,
  type WorkspaceTile,
} from "../src/lib/dashboard/workspace-tiles";

test("nextcloud tile is unconfigured when no base url", () => {
  const nc = buildWorkspaceTiles({}).find((t) => t.id === "nextcloud");
  assert.ok(nc);
  assert.equal(nc.requiresConfig, true);
  assert.equal(nc.configured, false);
  assert.equal(nc.href, "");
});

test("nextcloud tile lights up with a base url (trailing slash trimmed)", () => {
  const nc = buildWorkspaceTiles({
    workspaceBaseUrl: "https://cloud.roebel.app/",
  }).find((t) => t.id === "nextcloud");
  assert.ok(nc);
  assert.equal(nc.configured, true);
  assert.equal(nc.href, "https://cloud.roebel.app");
});

test("filter hides requiresConfig tiles that are unconfigured", () => {
  const tiles: WorkspaceTile[] = [
    { id: "a", label: "A", icon: "cloud", href: "", requiresConfig: true, configured: false },
    { id: "b", label: "B", icon: "cloud", href: "https://b", requiresConfig: true, configured: true },
    { id: "c", label: "C", icon: "cloud", href: "/c", requiresConfig: false, configured: true },
  ];
  assert.deepEqual(filterAvailableTiles(tiles).map((t) => t.id), ["b", "c"]);
});

test("unconfigured workspace yields no visible tiles", () => {
  assert.equal(filterAvailableTiles(buildWorkspaceTiles({})).length, 0);
});

test("configured workspace yields the nextcloud tile", () => {
  const visible = filterAvailableTiles(
    buildWorkspaceTiles({ workspaceBaseUrl: "https://cloud.roebel.app" })
  );
  assert.equal(visible.length, 1);
  assert.equal(visible[0].id, "nextcloud");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from repo root): `npx tsx --test apps/web/tests/workspace-tiles.test.ts`
Expected: FAIL — cannot find module `../src/lib/dashboard/workspace-tiles`.

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/lib/dashboard/workspace-tiles.ts`:

```ts
/**
 * Workspace SSO tiles. Each tile links out to an office app that authenticates
 * the citizen via Röbel ID (OIDC against roebel-id.fly.dev) — the tile itself
 * only carries the link; SSO is handled by the target app. v1 ships one tile,
 * Nextcloud/Collabora, gated on a configured workspace base URL. Add Buzz /
 * openDesk / Netizen tiles here later by extending `buildWorkspaceTiles`.
 *
 * Pure + React-free on purpose so it is unit-testable under node:test. The UI
 * layer maps the string `icon` key to a lucide component and reads the base URL
 * from `process.env.NEXT_PUBLIC_WORKSPACE_BASE_URL`.
 */

export interface WorkspaceTileConfig {
  /** Base URL of the self-hosted workspace. Empty/undefined = not configured. */
  workspaceBaseUrl?: string | null;
}

export interface WorkspaceTile {
  id: string;
  label: string;
  /** Icon key, resolved to a lucide component in the UI layer. */
  icon: string;
  /** Fully-resolved link target. `""` when requiresConfig && !configured. */
  href: string;
  /** Whether this tile needs external config (a base URL) to work. */
  requiresConfig: boolean;
  /** Whether the required config is present. Always true for tiles that need none. */
  configured: boolean;
}

/** Build the v1 tile list, resolving hrefs from the supplied config. */
export function buildWorkspaceTiles(config: WorkspaceTileConfig): WorkspaceTile[] {
  const base = (config.workspaceBaseUrl ?? "").trim().replace(/\/+$/, "");
  const workspaceConfigured = base.length > 0;

  return [
    {
      id: "nextcloud",
      label: "Dokumente & Dateien",
      icon: "cloud",
      href: workspaceConfigured ? base : "",
      requiresConfig: true,
      configured: workspaceConfigured,
    },
  ];
}

/** Keep only tiles that are usable: no config needed, or config present. */
export function filterAvailableTiles(tiles: WorkspaceTile[]): WorkspaceTile[] {
  return tiles.filter((tile) => !tile.requiresConfig || tile.configured);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run (from repo root): `npx tsx --test apps/web/tests/workspace-tiles.test.ts`
Expected: PASS — 5 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/dashboard/workspace-tiles.ts apps/web/tests/workspace-tiles.test.ts
git commit -m "feat(web): add config-driven workspace SSO tiles"
```

---

### Task 3: Memberships composer + view component

`buildMembershipList(...)` unions the citizen's on-chain citizenship with their org memberships (already loaded in `AccountContext.ownedAccounts`, which comes from `account_owners` via `fetchOwnedAccounts`). Names come from `account.name` / a fixed citizenship label — **never** a wallet address. The composer is pure (unit-tested); the thin `MembershipsCard` renders it and is verified via typecheck/lint/manual.

**Files:**
- Create: `apps/web/src/lib/dashboard/memberships.ts`
- Create: `apps/web/src/components/dashboard/MembershipsCard.tsx`
- Test: `apps/web/tests/dashboard-memberships.test.ts`

**Interfaces:**
- Consumes:
  - `Account` type + `isOrgAccount`, `SUB_TYPE_LABELS`, `SUB_TYPE_EMOJI` from `@/types/account` (`apps/web/src/types/account.ts`).
  - `useAccount()` from `@/lib/context/AccountContext` → `{ ownedAccounts: Account[] }` (`apps/web/src/lib/context/AccountContext.tsx:230`). `AccountProvider` is mounted at the root layout (`apps/web/src/app/layout.tsx:43`), so `useAccount()` is valid inside `/app/dashboard`.
- Produces:
  - `type MembershipKind = "citizenship" | "organisation"`
  - `interface Membership { id: string; kind: MembershipKind; name: string; subtitle: string; emoji: string; avatarUrl: string | null; verified: boolean; href: string | null }`
  - `interface BuildMembershipListInput { isCitizen: boolean; ownedAccounts: Account[] }`
  - `function buildMembershipList(input: BuildMembershipListInput): Membership[]`
  - `function MembershipsCard({ isCitizen }: { isCitizen: boolean }): JSX.Element`

- [ ] **Step 1: Write the failing test**

Create `apps/web/tests/dashboard-memberships.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMembershipList } from "../src/lib/dashboard/memberships";
import type { Account } from "../src/types/account";

function account(over: Partial<Account> = {}): Account {
  return {
    id: "acc-1",
    account_type: "organisation",
    sub_type: "verein",
    name: "TSV Röbel",
    bio: null,
    avatar_url: null,
    cover_url: null,
    is_verified: true,
    slug: null,
    is_extern: false,
    extern_status: null,
    extern_reason: null,
    extern_reviewed_by: null,
    extern_reviewed_at: null,
    contact_email: null,
    opening_hours: null,
    created_at: "",
    updated_at: "",
    ...over,
  };
}

test("citizen with no orgs has a single verified citizenship membership", () => {
  const list = buildMembershipList({ isCitizen: true, ownedAccounts: [] });
  assert.equal(list.length, 1);
  assert.equal(list[0].kind, "citizenship");
  assert.equal(list[0].verified, true);
});

test("non-citizen with no orgs has no memberships", () => {
  assert.deepEqual(buildMembershipList({ isCitizen: false, ownedAccounts: [] }), []);
});

test("org accounts become organisation memberships with sub-type label", () => {
  const list = buildMembershipList({
    isCitizen: true,
    ownedAccounts: [account({ id: "o1", name: "TSV Röbel", sub_type: "verein" })],
  });
  const org = list.find((m) => m.id === "o1");
  assert.ok(org);
  assert.equal(org.kind, "organisation");
  assert.equal(org.name, "TSV Röbel");
  assert.equal(org.subtitle, "Verein");
});

test("personal accounts are excluded", () => {
  const list = buildMembershipList({
    isCitizen: false,
    ownedAccounts: [
      account({ id: "p1", account_type: "personal", sub_type: null, name: "Max" }),
    ],
  });
  assert.equal(list.length, 0);
});

test("membership names are display names, never raw wallet addresses", () => {
  const list = buildMembershipList({
    isCitizen: true,
    ownedAccounts: [account({ id: "o1", name: "Stadt Röbel", sub_type: "stadt" })],
  });
  for (const m of list) {
    assert.ok(
      !/^0x[0-9a-fA-F]{6,}/.test(m.name),
      `name must not be a raw wallet: ${m.name}`
    );
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from repo root): `npx tsx --test apps/web/tests/dashboard-memberships.test.ts`
Expected: FAIL — cannot find module `../src/lib/dashboard/memberships`.

- [ ] **Step 3: Write the composer**

Create `apps/web/src/lib/dashboard/memberships.ts`:

```ts
import type { Account } from "@/types/account";
import { isOrgAccount, SUB_TYPE_LABELS, SUB_TYPE_EMOJI } from "@/types/account";

export type MembershipKind = "citizenship" | "organisation";

/**
 * A single membership row — the SSI portfolio, shaped for many, populated with
 * what exists today (Röbel citizenship + org memberships). `name` is ALWAYS a
 * display name, never a raw wallet address.
 */
export interface Membership {
  id: string;
  kind: MembershipKind;
  name: string;
  subtitle: string;
  emoji: string;
  avatarUrl: string | null;
  verified: boolean;
  href: string | null;
}

export interface BuildMembershipListInput {
  /** True when the user holds a CitizenNFT / has tier citizen. */
  isCitizen: boolean;
  /** Accounts the wallet owns (from AccountContext / account_owners). */
  ownedAccounts: Account[];
}

/**
 * Union of on-chain citizenship + org memberships. Personal accounts are
 * skipped (they are not a "membership"). Pure — no I/O, no wallet strings.
 */
export function buildMembershipList(
  input: BuildMembershipListInput
): Membership[] {
  const memberships: Membership[] = [];

  if (input.isCitizen) {
    memberships.push({
      id: "roebel-citizenship",
      kind: "citizenship",
      name: "Röbel/Müritz",
      subtitle: "Verifizierte Bürgerschaft",
      emoji: "🏛️",
      avatarUrl: null,
      verified: true,
      href: "/app/proposals",
    });
  }

  for (const account of input.ownedAccounts) {
    if (!isOrgAccount(account)) continue;
    memberships.push({
      id: account.id,
      kind: "organisation",
      name: account.name,
      subtitle: account.sub_type
        ? SUB_TYPE_LABELS[account.sub_type]
        : "Organisation",
      emoji: account.sub_type ? SUB_TYPE_EMOJI[account.sub_type] : "🏢",
      avatarUrl: account.avatar_url,
      verified: account.is_verified,
      href: "/dashboard",
    });
  }

  return memberships;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run (from repo root): `npx tsx --test apps/web/tests/dashboard-memberships.test.ts`
Expected: PASS — 5 tests, 0 failures.

- [ ] **Step 5: Write the view component**

Create `apps/web/src/components/dashboard/MembershipsCard.tsx`:

```tsx
"use client";

import Link from "next/link";
import Image from "next/image";
import { CheckCircle } from "lucide-react";
import { useAccount } from "@/lib/context/AccountContext";
import { buildMembershipList } from "@/lib/dashboard/memberships";

export function MembershipsCard({ isCitizen }: { isCitizen: boolean }) {
  const { ownedAccounts } = useAccount();
  const memberships = buildMembershipList({ isCitizen, ownedAccounts });

  return (
    <div className="bg-card border border-border rounded-xl shadow-sm p-6">
      <h3 className="text-xl font-medium text-foreground mb-4">Mitgliedschaften</h3>

      {memberships.length === 0 ? (
        <p className="text-sm text-muted-foreground">Noch keine Mitgliedschaften.</p>
      ) : (
        <ul className="space-y-2">
          {memberships.map((m) => {
            const row = (
              <div className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-accent transition-colors">
                <div className="h-10 w-10 rounded-full bg-muted overflow-hidden flex items-center justify-center flex-shrink-0 text-lg">
                  {m.avatarUrl ? (
                    <Image
                      src={m.avatarUrl}
                      alt={m.name}
                      width={40}
                      height={40}
                      className="object-cover w-full h-full"
                    />
                  ) : (
                    <span>{m.emoji}</span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground truncate">{m.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{m.subtitle}</p>
                </div>
                {m.verified && (
                  <CheckCircle className="h-4 w-4 text-green-600 flex-shrink-0" />
                )}
              </div>
            );
            return <li key={m.id}>{m.href ? <Link href={m.href}>{row}</Link> : row}</li>;
          })}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Verify types + lint (no component runner)**

Run (from repo root):
- `npx tsc --noEmit -p apps/web/tsconfig.json 2>&1 | grep -E "src/(lib|components)/dashboard" || echo "no new dashboard type errors"`
  Expected: `no new dashboard type errors`.
- `pnpm --filter @roebel/web lint`
  Expected: no errors for the new files.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/dashboard/memberships.ts apps/web/src/components/dashboard/MembershipsCard.tsx apps/web/tests/dashboard-memberships.test.ts
git commit -m "feat(web): add memberships composer + card"
```

---

### Task 4: The `/app/dashboard` page + workspace-tiles card

The citizen-gated page, nested inside `AppShell` (no new shell — the `/app` layout already wraps children in `AuthGuard > AppModeProvider > MessagingProvider > AppShell`). Gating uses the app's advisory-flag-plus-chain pattern; a non-citizen gets a graceful state (no redirect). Sections are driven by `dashboardFeatures(tier)`. Also creates `WorkspaceTilesCard` (the grid) and documents the env var. Verified via typecheck + lint + manual checklist.

**Files:**
- Create: `apps/web/src/app/app/dashboard/page.tsx`
- Create: `apps/web/src/components/dashboard/WorkspaceTilesCard.tsx`
- Modify: `apps/web/.env.example`

**Interfaces:**
- Consumes:
  - `dashboardFeatures`, `DashboardFeatures` (Task 1).
  - `buildWorkspaceTiles`, `filterAvailableTiles` (Task 2).
  - `MembershipsCard` (Task 3).
  - `useUserProfile()` → `{ user: User | null; isLoading; isConnected }` (`apps/web/src/hooks/useUserProfile.ts:158`).
  - `useVerificationStatus()` → `{ isAttester, isCitizen, votingPower, isLoading }` (`apps/web/src/hooks/useVerificationStatus.ts:42`).
  - `useAccount()` → `{ activeAccount }` (`apps/web/src/lib/context/AccountContext.tsx`).
  - `useAppMode()` → `{ activeMode }` (`apps/web/src/lib/context/AppModeContext.tsx:111`).
  - Reused cards with these exact props:
    - `IdentityCard` (`apps/web/src/components/profile/IdentityCard.tsx:48`) — `{ user, activeMode, activeAccount?, isAttester?, votingPower?, onShowQR? }`. The full `User` object is structurally assignable to its `user` prop.
    - `VerificationStatusCard` (`apps/web/src/components/profile/VerificationStatusCard.tsx:6`) — **no props** (reads `useVerificationStatus` itself).
    - `NFTStatusCard` (`apps/web/src/components/profile/NFTStatusCard.tsx:17`) — `{ user: User; isLoading? }`.
    - `VotingActivityCard` (`apps/web/src/components/profile/VotingActivityCard.tsx:26`) — `{ user: { total_votes_cast: bigint; voting_streak: bigint; last_vote_date: string | null; gamification_points: bigint } }`; full `User` satisfies this.
    - `DAOContributionsCard` (`apps/web/src/components/profile/DAOContributionsCard.tsx:26`) — `{ user: { created_at: string } }`.
- Produces:
  - Route `/app/dashboard` (default export `CitizenDashboardPage`).
  - `function WorkspaceTilesCard(): JSX.Element` in `@/components/dashboard/WorkspaceTilesCard`.
  - Env var `NEXT_PUBLIC_WORKSPACE_BASE_URL` (client-readable).

- [ ] **Step 1: Write the workspace-tiles card**

Create `apps/web/src/components/dashboard/WorkspaceTilesCard.tsx`:

```tsx
"use client";

import { Cloud, LayoutGrid, type LucideIcon } from "lucide-react";
import {
  buildWorkspaceTiles,
  filterAvailableTiles,
} from "@/lib/dashboard/workspace-tiles";

const ICONS: Record<string, LucideIcon> = {
  cloud: Cloud,
};

export function WorkspaceTilesCard() {
  const tiles = filterAvailableTiles(
    buildWorkspaceTiles({
      workspaceBaseUrl: process.env.NEXT_PUBLIC_WORKSPACE_BASE_URL,
    })
  );

  if (tiles.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl shadow-sm p-6 text-center">
        <LayoutGrid className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">
          Arbeitsbereich-Apps werden bald verfügbar sein.
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
            <span className="text-sm font-medium text-foreground">{tile.label}</span>
          </a>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Write the page**

Create `apps/web/src/app/app/dashboard/page.tsx`:

```tsx
"use client";

export const dynamic = "force-dynamic";

import Link from "next/link";
import { Bot, ShieldCheck, ArrowRight } from "lucide-react";
import { useUserProfile } from "@/hooks/useUserProfile";
import { useVerificationStatus } from "@/hooks/useVerificationStatus";
import { useAccount } from "@/lib/context/AccountContext";
import { useAppMode } from "@/lib/context/AppModeContext";
import { dashboardFeatures } from "@/lib/dashboard/features";
import type { UserTier } from "@/types/account";
import { IdentityCard } from "@/components/profile/IdentityCard";
import { NFTStatusCard } from "@/components/profile/NFTStatusCard";
import { VerificationStatusCard } from "@/components/profile/VerificationStatusCard";
import { VotingActivityCard } from "@/components/profile/VotingActivityCard";
import { DAOContributionsCard } from "@/components/profile/DAOContributionsCard";
import { MembershipsCard } from "@/components/dashboard/MembershipsCard";
import { WorkspaceTilesCard } from "@/components/dashboard/WorkspaceTilesCard";

export default function CitizenDashboardPage() {
  const { user, isLoading, isConnected } = useUserProfile();
  const {
    isAttester,
    isCitizen: isCitizenChain,
    votingPower,
    isLoading: verifyLoading,
  } = useVerificationStatus();
  const { activeAccount } = useAccount();
  const { activeMode } = useAppMode();

  // Advisory flag ∪ chain truth — same derivation as AppSidebar/AppRightPanel.
  const isCitizen =
    isCitizenChain ||
    user?.tier === "citizen" ||
    Boolean(user?.is_verified_citizen);

  // Loading — wallet reconnect / profile / chain read still in flight.
  if (isLoading || verifyLoading) {
    return (
      <div className="max-w-2xl mx-auto animate-pulse space-y-4">
        <div className="h-7 bg-muted rounded w-1/3" />
        <div className="h-44 bg-card border border-border rounded-xl" />
        <div className="h-32 bg-card border border-border rounded-xl" />
        <div className="h-32 bg-card border border-border rounded-xl" />
      </div>
    );
  }

  // Not logged in — soft state (AuthGuard renders the shell for guests too).
  if (!isConnected || !user) {
    return (
      <div className="max-w-2xl mx-auto text-center">
        <div className="bg-card border border-border rounded-lg p-8">
          <h1 className="text-xl font-semibold text-foreground mb-3">
            Anmeldung erforderlich
          </h1>
          <p className="text-sm text-muted-foreground mb-6">
            Melde dich an, um dein Bürger-Dashboard zu sehen.
          </p>
          <Link
            href="/app"
            className="inline-block bg-primary hover:bg-primary/90 text-primary-foreground px-5 py-2 rounded-md font-medium text-sm transition-colors"
          >
            Zur Startseite
          </Link>
        </div>
      </div>
    );
  }

  // Logged in but not a citizen — graceful gate, NO redirect.
  if (!isCitizen) {
    return (
      <div className="max-w-2xl mx-auto text-center">
        <div className="bg-card border border-border rounded-lg p-8">
          <ShieldCheck className="h-10 w-10 text-primary mx-auto mb-4" />
          <h1 className="text-xl font-semibold text-foreground mb-3">
            Nur für verifizierte Bürger
          </h1>
          <p className="text-sm text-muted-foreground mb-6">
            Das Bürger-Dashboard steht verifizierten Bürgern von Röbel/Müritz
            offen. Verifiziere dich, um deine Identität, Mitgliedschaften und
            Arbeitsbereich-Apps an einem Ort zu verwalten.
          </p>
          <Link
            href="/app/verifizierung"
            className="inline-flex items-center gap-1.5 bg-primary hover:bg-primary/90 text-primary-foreground px-5 py-2 rounded-md font-medium text-sm transition-colors"
          >
            Bürger werden <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    );
  }

  const tier = (user.tier as UserTier) ?? "citizen";
  const features = dashboardFeatures(tier);

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <header>
        <h1 className="text-2xl font-semibold text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Willkommen zurück{user.username ? `, ${user.username}` : ""}.
        </p>
      </header>

      {/* Identität & Pass */}
      {features.identity && (
        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Identität & Pass
          </h2>
          <IdentityCard
            user={user}
            activeMode={activeMode}
            activeAccount={activeAccount}
            isAttester={isAttester}
            votingPower={votingPower}
          />
          <VerificationStatusCard />
          <NFTStatusCard user={user} />
          {features.memberships && <MembershipsCard isCitizen={isCitizen} />}
        </section>
      )}

      {/* KI-Copilot */}
      {features.copilot && (
        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            KI-Copilot
          </h2>
          <Link
            href="/app/mecky"
            className="flex items-center gap-4 bg-card border border-border rounded-xl p-5 hover:bg-accent transition-colors"
          >
            <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Bot className="h-6 w-6 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold text-foreground">Mecky fragen</h3>
              <p className="text-sm text-muted-foreground">
                Dein Bürgerassistent für Abstimmungen, Community-Themen und mehr.
              </p>
            </div>
            <ArrowRight className="h-5 w-5 text-muted-foreground flex-shrink-0" />
          </Link>
        </section>
      )}

      {/* Bürgerbeteiligung */}
      {features.civic && (
        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Bürgerbeteiligung
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <Link
              href="/app/proposals"
              className="bg-card border border-border rounded-xl p-4 hover:bg-accent transition-colors"
            >
              <p className="font-medium text-foreground text-sm">Abstimmungen</p>
              <p className="text-xs text-muted-foreground mt-0.5">Vorschläge & Voting</p>
            </Link>
            <Link
              href="/app/roebel-card"
              className="bg-card border border-border rounded-xl p-4 hover:bg-accent transition-colors"
            >
              <p className="font-medium text-foreground text-sm">Röbel Card</p>
              <p className="text-xs text-muted-foreground mt-0.5">Punkte & Münzen</p>
            </Link>
          </div>
          <VotingActivityCard user={user} />
          <DAOContributionsCard user={user} />
        </section>
      )}

      {/* Arbeitsbereich */}
      {features.workspace && (
        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Arbeitsbereich
          </h2>
          <WorkspaceTilesCard />
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Document the env var**

Add to `apps/web/.env.example` (after the existing `NEXT_PUBLIC_` block):

```bash
# Base URL of the self-hosted workspace (Nextcloud/Collabora), reached via Röbel ID SSO.
# Leave unset to hide the workspace tile on the citizen dashboard. Client-readable.
NEXT_PUBLIC_WORKSPACE_BASE_URL=https://cloud.example.org
```

- [ ] **Step 4: Verify types + lint (no component runner)**

Run (from repo root):
- `npx tsc --noEmit -p apps/web/tsconfig.json 2>&1 | grep -E "src/(components/dashboard|app/app/dashboard)" || echo "no new dashboard type errors"`
  Expected: `no new dashboard type errors`.
- `pnpm --filter @roebel/web lint`
  Expected: no errors for the new files.

- [ ] **Step 5: Manual verification checklist**

Start the app once (`pnpm --filter @roebel/web dev`) and confirm:
- [ ] As a **citizen** (tier `citizen` or holds CitizenNFT), navigating to `/app/dashboard` renders (inside the normal `AppShell` header/sidebar/right-panel): header "Dashboard"; Identität & Pass (IdentityCard + Verifizierungsstatus + Citizen Membership Status + Mitgliedschaften); KI-Copilot card linking to `/app/mecky`; Bürgerbeteiligung (Abstimmungen + Röbel Card quick links + VotingActivity + DAO Beiträge); Arbeitsbereich (empty-state text when `NEXT_PUBLIC_WORKSPACE_BASE_URL` is unset).
- [ ] With `NEXT_PUBLIC_WORKSPACE_BASE_URL` set (restart dev), the Arbeitsbereich shows a "Dokumente & Dateien" tile linking to that URL in a new tab.
- [ ] As a **tourist/guest** (not verified), `/app/dashboard` shows the "Nur für verifizierte Bürger" state with a "Bürger werden" link — **no redirect**, page stays at `/app/dashboard`.
- [ ] Logged out, `/app/dashboard` shows "Anmeldung erforderlich".
- [ ] No raw `0x…` address appears anywhere on the page (memberships show names/emoji only).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/app/dashboard/page.tsx apps/web/src/components/dashboard/WorkspaceTilesCard.tsx apps/web/.env.example
git commit -m "feat(web): add citizen dashboard page at /app/dashboard"
```

---

### Task 5: Entry-point wiring (sidebar nav + right-panel CTA)

Surface the dashboard only to citizens: a citizen-only "Dashboard" nav item in `AppSidebar` (using the existing `modes` filter, which we tighten so `modes:["citizen"]` truly means citizen-only), and a "Dashboard öffnen" CTA in `AppRightPanel` for the citizen-personal case (mirroring the existing org CTA). Verified via typecheck + lint + manual.

**Files:**
- Modify: `apps/web/src/components/app/AppSidebar.tsx`
- Modify: `apps/web/src/components/app/AppRightPanel.tsx`

**Interfaces:**
- Consumes: route `/app/dashboard` (Task 4); existing `isCitizen` (AppSidebar:74), `isCitizenPersonal` (AppRightPanel:37), `AppMode` type, and the `NavItem.modes` filter.
- Produces: no new exported symbols — behavioral wiring only.

> Note on the `modes` filter: the current `isVisible` (AppSidebar:82-91) collapses any citizen/org-tagged item to `isCitizen || isOrg` and has a dead-code branch, so it cannot express "citizen-only". Step 2 replaces it with a precise version. This is safe: **no existing `mainNavItems` (or their children) set `modes`**, so no current item's visibility changes.

- [ ] **Step 1: Add the `LayoutDashboard` icon import to AppSidebar**

In `apps/web/src/components/app/AppSidebar.tsx`, extend the lucide import (currently ends `Bot, ChevronDown,`). Change:

```tsx
  Bot,
  ChevronDown,
} from "lucide-react";
```

to:

```tsx
  Bot,
  ChevronDown,
  LayoutDashboard,
} from "lucide-react";
```

- [ ] **Step 2: Add the citizen-only nav item + tighten `isVisible`**

In `apps/web/src/components/app/AppSidebar.tsx`, add the Dashboard item to `mainNavItems` immediately after the Feed entry. Change:

```tsx
const mainNavItems: NavItem[] = [
  { href: "/app", label: "Feed", icon: Home, exact: true },
  { href: "/app/proposals", label: "Stadt", icon: Landmark },
```

to:

```tsx
const mainNavItems: NavItem[] = [
  { href: "/app", label: "Feed", icon: Home, exact: true },
  { href: "/app/dashboard", label: "Dashboard", icon: LayoutDashboard, modes: ["citizen"] },
  { href: "/app/proposals", label: "Stadt", icon: Landmark },
```

Then replace the `isVisible` function. Change:

```tsx
  const isVisible = (item: NavItem) => {
    if (!item.modes) return true;
    if (item.modes.includes("citizen") || item.modes.includes("org")) {
      return isCitizen || isOrg;
    }
    if (item.modes.includes("org") && !item.modes.includes("citizen")) {
      return isOrg;
    }
    return item.modes.includes(activeMode);
  };
```

to:

```tsx
  const isVisible = (item: NavItem) => {
    if (!item.modes) return true;
    if (item.modes.includes("citizen") && isCitizen) return true;
    if (item.modes.includes("org") && isOrg) return true;
    if (item.modes.includes("tourist") && activeMode === "tourist") return true;
    return false;
  };
```

- [ ] **Step 3: Add the `LayoutDashboard` icon import to AppRightPanel**

In `apps/web/src/components/app/AppRightPanel.tsx`, extend the lucide import (currently `import { Calendar, ShieldCheck, Tag, ArrowRight, Landmark, Vote, TrendingUp } from "lucide-react";`) to include `LayoutDashboard`:

```tsx
import { Calendar, ShieldCheck, Tag, ArrowRight, Landmark, Vote, TrendingUp, LayoutDashboard } from "lucide-react";
```

- [ ] **Step 4: Add the citizen "Dashboard öffnen" CTA**

In `apps/web/src/components/app/AppRightPanel.tsx`, insert a new block immediately after the citizen event-creation CTA block (the second `{isCitizenPersonal && ( … )}`, which ends at the line `      )}` just before `{/* Org account: Business stats teaser */}`). Insert:

```tsx
      {/* Citizen personal: Bürger-Dashboard CTA */}
      {isCitizenPersonal && (
        <div className="bg-card rounded-lg border border-border p-4">
          <div className="flex items-center gap-2 mb-3">
            <LayoutDashboard className="h-5 w-5 text-primary" />
            <h3 className="font-semibold text-sm text-foreground">Bürger-Dashboard</h3>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            Deine Identität, Mitgliedschaften und Arbeitsbereich an einem Ort.
          </p>
          <Link
            href="/app/dashboard"
            className="flex items-center justify-center gap-2 w-full py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg text-sm font-medium transition-colors"
          >
            Dashboard öffnen
          </Link>
        </div>
      )}
```

(`isCitizenPersonal` and `Link` are already in scope in this file.)

- [ ] **Step 5: Verify types + lint**

Run (from repo root):
- `npx tsc --noEmit -p apps/web/tsconfig.json 2>&1 | grep -E "src/components/app/(AppSidebar|AppRightPanel)" || echo "no new type errors in wiring"`
  Expected: `no new type errors in wiring`.
- `pnpm --filter @roebel/web lint`
  Expected: no errors for the touched files.

- [ ] **Step 6: Manual verification checklist**

With `pnpm --filter @roebel/web dev`:
- [ ] As a **citizen**, the sidebar shows a "Dashboard" item (below Feed) that routes to `/app/dashboard` and highlights when active.
- [ ] As a **citizen on the personal account**, the right panel shows a "Bürger-Dashboard → Dashboard öffnen" card.
- [ ] As a **tourist/guest**, neither the sidebar item nor the right-panel CTA appears.
- [ ] Switching to an **org account** (still the same citizen person) keeps the sidebar "Dashboard" item (person is a citizen) but hides the right-panel citizen CTA (that CTA is `isCitizenPersonal`, i.e. personal account only) — the org "Gewerbe-Dashboard" CTA shows instead.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/app/AppSidebar.tsx apps/web/src/components/app/AppRightPanel.tsx
git commit -m "feat(web): wire citizen dashboard entry points (sidebar + right panel)"
```

- [ ] **Step 8: Run the full web unit suite + push**

Run (from repo root): `pnpm test:web`
Expected: PASS — all existing tests plus the 3 new dashboard test files (dashboard-features, workspace-tiles, dashboard-memberships), 0 failures.

Then push the branch: `git push -u origin feat/citizen-dashboard`.

---

## Self-Review

**1. Spec coverage** (spec `2026-07-26-citizen-dashboard-design.md`):
- §2 capability map `dashboardFeatures(tier)` → **Task 1.** ✅
- §2/§3.4/§5 config-driven workspace SSO tiles + `requiresConfig` filter + Nextcloud base-URL config → **Task 2** (logic) + **Task 4** (grid UI + env). ✅
- §2 placement nested in `AppShell` at `apps/web/src/app/app/dashboard/` → **Task 4** (the `/app` layout already provides `AuthGuard > AppModeProvider > AppShell`). ✅
- §2/§3.1 gating = `useVerificationStatus` ∪ tier, graceful non-citizen state (no redirect, matches `AuthGuard`) → **Task 4** (loading / not-connected / non-citizen branches). ✅
- §3.1 Identity & Passport reusing `IdentityCard`/`NFTStatusCard`/`VerificationStatusCard` + Memberships → **Task 3** (composer + card) + **Task 4** (section). ✅
- §3.1/§5 Memberships = citizenship (on-chain/tier) ∪ org memberships from `account_owners`, display names only → **Task 3.** ✅
- §3.2 AI copilot = Mecky entry/link → **Task 4** (KI-Copilot section → `/app/mecky`). ✅
- §3.3 Civic reusing `VotingActivityCard`/`DAOContributionsCard` + links to proposals/Röbel-Card/Münzen → **Task 4** (Bürgerbeteiligung section). ✅
- §2/§3 entry points: citizen-only sidebar nav item (`modes`) + citizen right-panel CTA mirroring org → **Task 5.** ✅
- §7 tests: unit for capability map + tile filter → Tasks 1 & 2 (real `node:test` code); component/integration → **no infra exists**, replaced by scoped typecheck + lint + documented manual checklist (Tasks 3–5), plus a bonus pure unit test for the memberships composer (Task 3). ✅
- §6 non-goals (native notes/docs/tasks, embedding, membership management, interop protocol, dedicated shell) → **not planned.** ✅

**2. Placeholder scan:** No `TBD`/`TODO`/"handle edge cases"/"similar to Task N"/"write tests for the above". Every code step contains complete code; every test step contains full assertions. ✅

**3. Type consistency:**
- `DashboardFeatures` keys `{identity, memberships, copilot, civic, workspace}` are identical in Task 1's definition, its test, and Task 4's `features.identity`/`.memberships`/`.copilot`/`.civic`/`.workspace` usage. ✅
- `WorkspaceTile` shape `{id,label,icon,href,requiresConfig,configured}` is identical across Task 2's definition, its test literals, and Task 4's `WorkspaceTilesCard` (`tile.icon`, `tile.href`, `tile.label`, `tile.id`). `buildWorkspaceTiles`/`filterAvailableTiles` names match everywhere. ✅
- `Membership` shape `{id,kind,name,subtitle,emoji,avatarUrl,verified,href}` and `buildMembershipList({isCitizen, ownedAccounts})` are identical across Task 3's definition, its test, and `MembershipsCard`. ✅
- Reused-card props verified against the real files: `IdentityCard` (`user, activeMode, activeAccount, isAttester, votingPower`), `NFTStatusCard` (`user: User`), `VerificationStatusCard` (no props), `VotingActivityCard`/`DAOContributionsCard` (user subsets satisfied by full `User`). ✅
- Hooks return shapes verified: `useUserProfile` → `{user, isLoading, isConnected}`; `useVerificationStatus` → `{isAttester, isCitizen, votingPower, isLoading}`; `useAppMode` → `{activeMode}`; `useAccount` → `{activeAccount, ownedAccounts}`. ✅

No issues found requiring inline fixes.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-26-citizen-dashboard.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
