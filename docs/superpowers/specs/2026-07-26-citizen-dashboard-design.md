# Röbel Citizen Dashboard — v1 (Design)

**Date:** 2026-07-26
**Status:** Design (brainstorming output) — **approved to build** ("yes go build"). Kept deliberately lean ("other features will come later").
**Scope of THIS spec:** Slice 1 of the interoperable workspace — a **Citizen dashboard** in `apps/web`: the sovereign "home" a logged-in Citizen gets (identity + memberships + AI copilot + civic + workspace SSO tiles), matching what organisations already have. Workspace-app embedding, native office primitives, membership management, and the cross-node interop protocol are **later slices**.

**North star:** [MISSION_AND_GOALS.md](../../MISSION_AND_GOALS.md) G6 (sovereign workplace suite) + G2 (sovereign identity; individual is the root, memberships are held-and-exitable attestations). Builds on the live **Röbel ID** keystone ([2026-07-24-roebel-id-sso-keystone-design.md](2026-07-24-roebel-id-sso-keystone-design.md)) and the [sovereign-workplace-suite](2026-07-25-sovereign-workplace-suite-design.md) L1–L6 model.

---

## 1. Goal & decisions (locked in brainstorming)

A logged-in **Citizen** gets a sovereign dashboard inside the app: **their identity + held memberships, an AI copilot (Mecky), their civic activity, and tiles that SSO into workspace apps** (Nextcloud/Collabora via Röbel ID; Buzz/openDesk later). Parity with the org dashboard, built protocol-ready.

Locked decisions:
1. **v1 = "home + SSO into reused apps"** — reuse the mature stack (Mecky, messages, civic widgets, and Röbel ID SSO into openDesk components); **do not rebuild** notes/docs/tasks. (G6 reuse principle.)
2. **Placement = nested in the app** at `apps/web/src/app/app/dashboard/` — inside the existing `AppShell` (same header/nav/right-panel), NOT a separate shell. Fast, cohesive, maximal reuse.
3. **Keep v1 lean** — everything below marked "later" is explicitly out of scope.

**Success criteria:** a Citizen (tier `citizen` / holds CitizenNFT) sees a "Dashboard" entry, opens `/app/dashboard`, and finds: their identity + passport + memberships, a Mecky copilot entry, civic quick-access, and a workspace-tiles section (Nextcloud tile config-gated). A non-citizen (tourist/guest) does not see the entry and hitting the route shows a graceful "citizen-only" state.

---

## 2. Architecture (all reuse except the new route + wiring)

```
/app  (AppShell — existing)
 ├─ AppSidebar   → + citizen-only "Dashboard" nav item (existing `modes:['citizen']` filter)
 ├─ AppRightPanel→ + "Dashboard öffnen" CTA for isCitizenPersonal (mirrors the org CTA)
 └─ /app/dashboard  (NEW, citizen-gated page — nested, no new shell)
      ├─ Identity & Passport   (reuse IdentityCard/NFTStatusCard/VerificationStatusCard + Memberships view)
      ├─ AI copilot            (reuse Mecky surface)
      ├─ Civic                 (reuse VotingActivityCard/DAOContributionsCard + links)
      └─ Workspace apps        (NEW: config-driven SSO-tile grid; Nextcloud tile via Röbel ID)
```

- **Gating:** citizen = `tier === 'citizen'` or holds CitizenNFT — via the existing `useVerificationStatus` hook + `lib/citizen-registry` (chain truth), the same advisory-flag-plus-chain pattern the app already uses. Route renders a graceful non-citizen state (not a hard redirect — matches `AuthGuard`'s soft-guard convention).
- **Capability map:** a new `dashboardFeatures(tier)` helper — the citizen analog of `subTypeFeatures(sub_type)` — returns which sections show, so tiers (guest/tourist/citizen) and future features are flag-gated in one place.
- **Entry points** already have hooks: `AppSidebar` nav supports a `modes` filter; `AppRightPanel` is already mode-aware and shows an org-only "Dashboard öffnen" card — add the citizen equivalent.

---

## 3. Sections (v1)

1. **Identity & Passport.** Smart-account identity shown as **display name, never a raw `0x`** ([[feedback_never_show_wallets]]). CitizenNFT rendered as the **passport** + citizen/attester status. A **Memberships** list = Röbel citizenship (on-chain) + org memberships (from `account_owners`) — the SSI portfolio, **shaped for many, populated with what exists**. (Exit/management UI = later.) Reuse `IdentityCard`, `NFTStatusCard`, `VerificationStatusCard`.
2. **AI copilot.** The existing **Mecky** chat surfaced as the dashboard copilot (entry/link or embedded panel). Pure reuse of `app/mecky` + `lib/mecky`.
3. **Civic.** Quick access to votes/proposals, Röbel Card, Münzen balance. Reuse `VotingActivityCard`/`DAOContributionsCard` + links to existing `/app/proposals`, `/app/roebel-card`, Münzen.
4. **Workspace apps (SSO tiles).** A **config-driven tile grid** opening office apps **via Röbel ID SSO**. v1 ships the framework + a **Nextcloud/Collabora tile** that lights up when a workspace base URL is configured (so it does not block on Nextcloud hosting); other tiles (Buzz, openDesk, future Netizen apps) are added by config later. Each tile is `{ id, label, icon, href, requiresConfig }`.

---

## 4. Reuse vs build

| Reuse (exists) | Build (new, small) |
|---|---|
| `AppShell`, `AppSidebar` (+`modes`), `AppRightPanel`; profile cards (`IdentityCard`, `NFTStatusCard`, `VerificationStatusCard`, `VotingActivityCard`, `DAOContributionsCard`); Mecky surface; `useVerificationStatus`, `useUserProfile`, `lib/citizen-registry`; `AccountContext`/`account_owners` | `/app/dashboard` route + page; citizen-only nav item + right-panel CTA wiring; `dashboardFeatures(tier)` capability map; Memberships view (composes existing reads); config-driven SSO-tile grid + the workspace-tiles config |

---

## 5. Data & interop

- **No new tables.** Memberships come from `account_owners` (org roles) + on-chain NFTs (citizenship/attester); workspace tiles are **config** (a typed constants list, with the Nextcloud base URL from an env/`app_settings` value). Reuse the existing Supabase data-layer conventions; reads scope by `wallet_address`, RLS as usual.
- **Interop shaping (protocol-ready, not built now).** Identity + passport are read from wallet + chain + `account_owners`; the workspace tiles route through **Röbel ID (OIDC)** — so the *same* identity + passport that openDesk / Buzz / Netizen apps consume later is the one the dashboard uses now. This spec documents that seam; the cross-client protocol is a later slice.

---

## 6. Explicit non-goals (later slices)

- Native notes / docs / tasks / calendar (reuse via SSO instead).
- Buzz + openDesk **embedding** (v1 links out via SSO; embedding later).
- Membership **exit/management** UI (v1 displays the portfolio; management later).
- The **cross-node interop protocol** (NSP-4 Node API + A2A).
- A dedicated dashboard shell (v1 nests in `AppShell`).

---

## 7. Testing

- Unit: `dashboardFeatures(tier)` returns correct sections per tier (guest/tourist/citizen); the SSO-tile config filters `requiresConfig` tiles when unconfigured.
- Component/integration (with the app's existing test setup): the dashboard page renders the citizen sections for a citizen and the graceful non-citizen state otherwise; the nav item + right-panel CTA appear only for citizens.
- Manual: log in as a citizen → "Dashboard" appears → open it → sections render; Nextcloud tile appears only when the workspace URL is configured.

---

## 8. Open questions (non-blocking; sensible defaults chosen)

- **Nextcloud hosting** — the SSO tile is config-gated, so v1 ships without a live Nextcloud; it lights up when hosted. (Deploying Nextcloud is separate ops.)
- **Copilot embed vs link** — default: a prominent Mecky entry/link in v1 (embed later if wanted).
- **Memberships source of truth** — v1 unions `account_owners` + on-chain NFTs; a general attestation registry (EAS) is a later slice.
