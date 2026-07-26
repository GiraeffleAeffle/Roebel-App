# Org Collaborative Workspace Suite — v1 (Design)

**Date:** 2026-07-26
**Status:** Design (brainstorming + research output) — **approved to build** ("Yes — build org suite v1"). Lean, mirrors the citizen dashboard (Slice 1, merged).
**Scope:** Slice 2 of the interoperable workspace — an org **"Arbeitsbereich"** in the org `/dashboard`: org-group-gated **SSO tiles** to shared files/docs (Nextcloud group folder + Collabora) and **human chat** (Element/Matrix room per org). Config-gated so it ships without blocking on hosting.

**Grounded in:** the [chat-protocol decision](../../future-research/2026-07-26_CHAT_PROTOCOL_DECISION.md) (poly-protocol unified by identity), the [citizen dashboard](2026-07-26-citizen-dashboard-design.md) (mirror its `workspace-tiles` pattern), and the live [Röbel ID keystone](2026-07-24-roebel-id-sso-keystone-design.md) (emits `org:<accountId>:<role>` groups). MISSION G6.

---

## 1. Goal & decisions (locked)

Org members open their org's dashboard and find a **shared workspace**: SSO tiles that open the org's **Nextcloud group folder + Collabora** (files/collaborative docs) and its **Element/Matrix room** (human chat) — all authenticated by **Röbel ID** and scoped by the org membership group. Parity with the citizen dashboard's workspace section, org-flavored (shared instead of personal).

Locked (from research + brainstorming):
1. **Reuse, don't rebuild.** Files/docs = Nextcloud+Collabora via SSO; human chat = Element/Matrix via SSO. No native files/chat build. (G6.)
2. **Poly-protocol, unified by identity.** Matrix/Element = human chat (openDesk-native; Röbel ID logs in via MAS OIDC). **Agent/AI-human chat = XMTP** — a *separate track*, NOT this slice. **Nostr/Buzz = tracked R&D**, not this slice.
3. **Group-gated by the keystone.** `org:<accountId>:<role>` is the ACL: it maps to the org's Nextcloud group folder + Matrix room. Join the org → get the shared space; leave → lose it. No permission system to build.
4. **Config-gated tiles.** Each tile lights up only when its base URL is configured (Nextcloud / Matrix), so v1 ships without live hosting.
5. **Mirror Slice 1.** Reuse the `WorkspaceTile` shape + `filterAvailableTiles` from `apps/web/src/lib/dashboard/workspace-tiles.ts`; add an **org** tile builder.

**Success criteria:** an org owner/admin/member, viewing their org dashboard, sees an **"Arbeitsbereich"** section/nav item with tiles for the org's shared files/docs and chat (each lit only when configured), opening the correct app via Röbel ID. Personal accounts / non-org context never see it.

---

## 2. Architecture (mirror the citizen dashboard, org-scoped)

```
/dashboard  (org shell — existing; gates isOrgAccount)
 ├─ OrgSidebar  → + "Arbeitsbereich" nav item (gated by features.workspace)
 └─ /dashboard/arbeitsbereich  (NEW page)
      └─ org WorkspaceTilesCard: config-driven SSO tiles
           • Dateien & Dokumente → Nextcloud group folder + Collabora
           • Team-Chat          → Element/Matrix room
```

- **Capability flag:** add `workspace: boolean` to `SubTypeFeatures` + set it in `subTypeFeatures(sub_type)` (`apps/web/src/types/account.ts`) — the org analog of the citizen `dashboardFeatures`. Decide which org sub_types get it (default: all — every org type benefits from a shared workspace).
- **Gating:** the org shell already gates `isOrgAccount`; the section additionally checks `features.workspace`. Any role (owner/admin/member) that can enter `/dashboard` sees it (access to the *shared* space is enforced downstream by the group claim in Nextcloud/Matrix).
- **Org-scoping of tiles:** the tile `href` targets the org's shared space. v1: link to the configured base URL (the Röbel ID group claim scopes the user to their org's folder/room inside Nextcloud/Element); optionally include the org slug/id as a deep-link path when the target supports it. Keep it lean — SSO + group claim does the scoping.

---

## 3. Reuse vs build

| Reuse (exists) | Build (new, small) |
|---|---|
| `WorkspaceTile` type + `filterAvailableTiles` (`lib/dashboard/workspace-tiles.ts`, Slice 1); `OrgSidebar` nav pattern + `subTypeFeatures` gating; org shell (`dashboard/layout.tsx`); `AccountContext` (`activeAccount`) | `features.workspace` flag; an **org** tile builder (`buildOrgWorkspaceTiles({ workspaceBaseUrl, chatBaseUrl, org })`) + its unit tests; `/dashboard/arbeitsbereich/page.tsx`; an org `WorkspaceTilesCard` (or reuse the citizen card generalized); the "Arbeitsbereich" nav item; env docs |

---

## 4. Data, config, interop

- **No new tables.** Membership = `account_owners` (already loaded via `AccountContext`); the shared-space ACL is the keystone's `org:<accountId>:<role>` group claim, enforced in Nextcloud (group folder) + Matrix (room) — not in the app.
- **Config:** `NEXT_PUBLIC_WORKSPACE_BASE_URL` (Nextcloud, reused from Slice 1) + `NEXT_PUBLIC_CHAT_BASE_URL` (Element/Matrix). Tiles hidden when unset.
- **Interop:** identical to Slice 1 — Röbel ID (OIDC) is the unifier; Nextcloud + Matrix both authenticate via it (Matrix via MAS upstream OIDC). Agent chat (XMTP) + Nostr/Buzz are separate tracks documented in the decision doc, not wired here.

---

## 5. Explicit non-goals (later)

- **Agent / AI-human chat (XMTP)** — separate track (agents already have smart-account XMTP identity; wire `@xmtp/agent-sdk` later).
- **Nostr/Buzz** — tracked R&D bet, not this slice.
- Native files/docs/chat; deep per-org Nextcloud-group-folder / Matrix-room **provisioning automation** (ops/runbook, not app code — the group claim maps to them); membership management (exists at `/dashboard/members`); embedding (v1 links out).

---

## 6. Testing

- Unit: `buildOrgWorkspaceTiles` returns files + chat tiles; each `requiresConfig` and hidden when its base URL is unset; `filterAvailableTiles` behavior; org-scoped href correct. (`node:test` via `tsx`, like Slice 1.)
- Component/React (no infra): scoped typecheck (`pnpm --filter @roebel/web exec tsc`) + lint + a manual checklist.
- Manual: as an org owner/member, `/dashboard` shows "Arbeitsbereich"; tiles appear only when the base URLs are set; open a tile → correct app.
