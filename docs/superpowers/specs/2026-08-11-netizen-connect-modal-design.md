# Netizen Connect — modal and bottom sheet design

> **Status:** approved 2026-08-11. Implementable from this document.
>
> **What this is:** the SDK-UI tranche of the Netizen Accounts programme —
> [`2026-07-31-netizen-accounts-service-design.md`](2026-07-31-netizen-accounts-service-design.md) §3.6
> already specifies "bottom sheet (React Native) + custom wallet modal (web/desktop)" as
> first-class components replacing `ConnectButton` / `ConnectEmbed`. This document designs the
> web half and lands it in Ortis. It builds on
> [`2026-08-11-sovereign-netizen-account-infrastructure-design.md`](2026-08-11-sovereign-netizen-account-infrastructure-design.md)
> (Phase A), whose branding endpoint exists for exactly this consumer.
>
> **Code homes.** The component is a NEW package in the netizen_labs monorepo
> (`~/Documents/privat/side_projects/netizen/netizen_labs`); the keystone change is
> `apps/roebel-id` in THIS repo. Both are touched.

## 1. Goal

A Netizen-branded Connect surface for signing into the Ortis dashboard: a button that opens a
method picker when signed out and an account menu when signed in — the shape thirdweb's
`ConnectButton` provides, with no vendor branding and no vendor dependency in the component.

It is built as a reusable package because three further consumers are already named: the future
Netizen Wallet (credentials, Kohaku privacy, EEZ), the Röbel web app, and Autar.

## 2. Decisions (Max, 2026-08-11)

| Question | Decision |
|---|---|
| Where does authentication happen? | **Launcher.** The modal picks a method and starts the OIDC flow with a hint; the keystone still authenticates. Auth logic stays in one place. |
| Where does the component live? | **New package `@netizen-labs/connect-react`**, consumed by `apps/ortis`. |
| Phase 1 surface | **Button + modal + connected account menu.** `/login` hosts the modal. |
| Ortis as a node | **Deferred to its own spec.** The modal is unchanged by it; the account panel is an additive seam. |
| Theming | **Default theme now, ready for Ortis.** A visual editor is a later product. |

## 3. Constraints

1. **The session shape does not change.** `Session` (`memberId`, `orgId`, `displayName`, `email`,
   `roles`) stays as-is. A parallel session's `components/operator/currentOperator.ts` reads
   `readSession()` and must keep compiling untouched. If it ever must change, the change is
   additive and coordinated first.
2. **Parallel-session territory, agreed 2026-08-11.** `apps/ortis/app/(operator)/**`,
   `apps/ortis/components/operator/**` and `packages/ortis-operator/**` belong to another
   session working in the worktree `netizen_labs-ortis-operator`. Do not touch them. A third
   session owns `packages/router` and `packages/agent-watcher` in `netizen_labs-autar-router`;
   never prune those worktrees or delete their branches.
3. **All new files and routes in English.** German is for text a person reads. Existing German
   routes (`/rechnungen`, `/einladung`, `/unterschreiben`) are NOT renamed here — that is a
   deliberate migration with redirects, owned separately.
4. **No browser-only hard dependencies** where a webview equivalent exists. Autar targets Tauri;
   a shared component must not foreclose that. This does not otherwise bind Ortis.
5. **No vendor branding, no vendor SDK in the component.** thirdweb remains an implementation
   detail *inside the keystone*, invisible to this package.

## 4. Architecture

```
packages/connect-react/                    NEW — @netizen-labs/connect-react
  ConnectButton      signed out -> opens modal;  signed in -> account menu
  ConnectModal       responsive: bottom sheet <640px, centered modal >=640px
  methods            declarative registry, rendered from tenant config
  theme              ConnectTheme tokens -> CSS custom properties
  branding           reads /.well-known/netizen-branding, falls back to default

apps/ortis
  /login             hosts the modal; keeps its route and error states
  /api/auth/login    gains optional `method`, passed through to authorize
  header             renders ConnectButton

apps/roebel-id                             NEW method hint
  authorize -> interaction -> login page pre-selects the named method
```

Flow: click a method in the modal → `/api/auth/login?method=<id>` → authorize carrying the hint
→ keystone login page shows that one method → callback → session → menu.

### 4.1 Why launcher, not embedded

The keystone is the auth root for everything below it (accounts spec §1). Embedding auth in the
modal would require new non-redirect endpoints on the keystone (OTP issue/verify, social
start/complete) plus CORS and anti-abuse, and would duplicate logic that currently lives in one
place. The launcher gets the UX now and leaves the embedded path open: a method whose `kind`
becomes `inline` renders in-modal without changing the modal's structure.

## 5. The keystone method hint — and its honest limit

`apps/roebel-id` declares a custom authorize parameter via oidc-provider's `extraParams`, reads
it in the interaction router, and passes it to `renderLoginPage`.

**What it does and does not achieve.** It reduces the keystone's method picker to a
single-method confirm. It does NOT achieve zero clicks, and the spec should not imply otherwise:
auto-triggering a social login on page load requires opening a popup without a user gesture,
which browsers block. The redirect severs the gesture chain that began with the click in the
modal.

| Hint | Keystone page renders |
|---|---|
| `email` | Email form shown and focused; social options collapsed |
| `google` / `apple` / `facebook` | One prominent button for that provider; no picker |
| absent | Today's behaviour, all methods — unchanged |

So the flow is: one click in the modal, one confirm on the keystone, back. Better than two full
pickers; not the zero-navigation experience the embedded architecture would give.

The hint is a **display preference, never an authorization input.** It must not influence which
methods are permitted, and an unrecognized value must fall back to showing all methods rather
than failing the login.

## 6. Components

| File | Responsibility |
|---|---|
| `src/ConnectButton.tsx` | Signed out → opens modal. Signed in → account menu: display name, org, roles, sign out. |
| `src/ConnectModal.tsx` | Responsive shell. Focus trap, Escape, backdrop dismiss, scroll lock. |
| `src/methods.ts` | `ConnectMethod = { id, label, kind: 'redirect' \| 'qr' \| 'inline', hint?: string }` and the built-in registry — see §6.1. |
| `src/theme.ts` | `ConnectTheme`, the default theme, and token → CSS-custom-property application. |
| `src/branding.ts` | Fetches the branding document; falls back to the supplied default on any failure. |
| `src/index.ts` | Public surface. |

The package takes props and calls back. It contains no router, no session logic, no Ortis
knowledge, and no data fetching beyond the branding document.

### 6.1 Two vocabularies, one mapping

Ortis and the keystone name login methods differently, and the registry is where they reconcile.
This is not cosmetic — getting it wrong produces buttons that redirect to the wrong thing.

- **Ortis tenant config** (`OrgSettings.identity.loginMethods`, `packages/ortis-core/src/domain.ts`)
  is today a **closed union of exactly two values**: `"email-otp" | "qr-app-connect"`. There is no
  social entry.
- **Keystone strategies** (`apps/roebel-id/src/interaction/login-page.ts`) are `email`, `google`,
  `apple`, `facebook`, `phone`.

The registry maps tenant method → keystone hint:

| Tenant `loginMethod` | `kind` | Keystone hint |
|---|---|---|
| `email-otp` | `redirect` | `email` |
| `qr-app-connect` | `qr` | none — handled in-modal, never a redirect |
| `social-google` | `redirect` | `google` |
| `social-apple` | `redirect` | `apple` |
| `social-facebook` | `redirect` | `facebook` |

Enabling social therefore requires **additively widening the `loginMethods` union** in
`domain.ts` with the three `social-*` values. This is a type-only change; existing stored
settings remain valid, and a tenant that lists neither gets exactly what it lists today.

`phone` is deliberately absent: the keystone supports it, but no tenant vocabulary entry exists
and no one has asked for it in Ortis. Adding it later is one registry row plus one union member.

## 7. Theme — the editor seam

A visual editor for the modal and bottom sheet is a stated future product. That is only cheap if
**every visual value is a token the component reads**, never a hardcoded class or colour. Adding
an editor later to a component with baked-in styling is a rewrite; this seam is the whole reason
to define the contract now.

```ts
interface ConnectTheme {
  version: 1;
  tokens: {
    surface: string; onSurface: string;   // background / text on it
    accent: string;  onAccent: string;    // primary action / text on it
    muted: string; line: string;
    radius: string; font: string;
  };
  logo?: string;                          // URL or data URI
  copy: { title: string; subtitle?: string };   // German
  layout: 'sheet' | 'modal' | 'auto';
}
```

**Semantic tokens, not per-element colours.** Arbitrary per-element theming reliably produces
unreadable modals; pairing each surface with its own foreground (`surface`/`onSurface`,
`accent`/`onAccent`) keeps "brand it however you like" true while making an unreadable result
hard to express, and gives a future editor a contrast rule to validate against.

**Storage needs no migration — the seam was already built for this.**
`OrgSettings.identity.branding` in `packages/ortis-core/src/domain.ts` carries an open index
signature (`[reserved: string]: unknown`) with a comment stating it exists precisely so a
per-community login (`Anzeigename, Logo, Farben`) is "later CONFIG, not a migration." The theme
lands at `identity.branding.theme` inside that reserved space. Nothing about the existing
`showOrgContext` key changes.

The keystone's `/.well-known/netizen-branding` remains the cross-tenant source for consumers that
have no Ortis database — the future Wallet among them. Where both are available, tenant config
wins, because it is the surface an operator edits.

The editor, when built, writes this same JSON — the component does not care where it came from.

`version: 1` is present so a later editor can migrate stored themes rather than guess.

## 8. Ortis wiring

- `/login` keeps its route, its error messages and its dev-mode member list, and hosts the modal.
  Deep links and every existing `?fehler=` state keep working.
- `/api/auth/login` gains an optional `method` query param, validated against the known registry
  and passed through to authorize. An unknown value is dropped, not echoed.
- The signed-in header renders `ConnectButton`.
- Methods rendered come from the tenant's `settings.identity.loginMethods`, which already exists
  and already drives the current page, mapped through the registry in §6.1. A tenant configured
  with only `email-otp` shows exactly one method.
- `loginMethods` is widened additively with the three `social-*` values (§6.1). The seeded pilot
  tenant keeps `["email-otp", "qr-app-connect"]` — enabling social for a tenant is a settings
  change, not a deploy.

## 9. Testing and definition of done

1. The modal renders methods from tenant config — a tenant with only `email-otp` shows one
   method and no dead buttons.
2. **No hardcoded colour literal appears in the component source.** This is asserted by a test,
   not left to review, because it is the property that keeps the editor cheap.
3. `method` survives the round trip: modal → `/api/auth/login?method=email` → authorize →
   interaction receives it. Extends the existing `apps/roebel-id` e2e harness, which already
   drives real authorize flows.
4. An unknown `method` value falls back to all methods and does not fail the login.
4a. A tenant method maps to the correct keystone hint per §6.1 — asserted as a table test, since
   the two vocabularies differ and a silent mis-mapping sends a user to the wrong provider.
5. A failed branding fetch falls back to the default theme rather than rendering unstyled.
6. The connected menu shows display name, org and roles from the existing session; sign out ends
   the session.
7. Bottom sheet below 640px, centered modal at or above it. Escape and backdrop both dismiss;
   focus is trapped while open; background scroll is locked.
8. The keystone's existing 83 tests still pass — the hint is additive.
9. `apps/ortis`'s existing suite still passes, including the `netizen` scope assertion.

## 10. Out of scope, with the reason

| Item | Why not here |
|---|---|
| The visual editor | A later product. §7 makes it additive; building it now has no consumer. |
| Netizen Account panel (address, npub, balances, export) | Ortis cannot reach a signer — a signer trusts exactly one issuer and Ortis authenticates at `id.ortis.app`. An empty panel is dead UI. Additive once Ortis is a node. |
| WalletConnect, phone, "Netizen Login" | New entries in the method registry once each exists. No structural change. |
| Operator console wiring | That surface is mid-flight in another session's worktree. Its DEMO_MODE fixture fallback is the seam; take it by agreement, later. |
| React Native bottom sheet | Accounts spec §3.6 covers it; no RN consumer of this package exists yet. The responsive web sheet is not a substitute and does not pretend to be. |
| Renaming existing German routes | A deliberate migration with redirects, owned separately. |

## 11. Open questions for later specs

- **Ortis as a node** (next spec). Ortis is multi-tenant, but the accounts spec's rule is one
  community = one node = one issuer = one signer = one vault, master keys never pooled. Three
  shapes: (A) a node per Amt, matching the spec literally but requiring N nodes for N customers;
  (B) one Ortis node with **per-tenant master keys inside one signer**, preserving key isolation
  cryptographically while revising the one-vault rule; (C) staying keystone-only. B is the one
  worth exploring — it is what makes Ortis sellable to fifty Ämter without operating fifty
  nodes — but it changes a custody rule and must not be settled inside a UI spec.
- **Cross-surface account linking.** "A Netizen Wallet account and a Röbel app account become
  one identity, possibly sharing keys." Deep identity work touching custody, and it collides
  with the soulbound-NFT constraint recorded in the Phase A spec §2.
- **Zero-navigation sign-in.** Requires the embedded architecture and new keystone endpoints.
  §4.1 keeps the path open via `kind: 'inline'`.
