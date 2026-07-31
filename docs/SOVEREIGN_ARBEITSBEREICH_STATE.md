# State of the Sovereign Arbeitsbereich

**Merged to `main` 2026-07-28.** Slice 1 of Goal G6
([MISSION_AND_GOALS](MISSION_AND_GOALS.md)) — citizens get the workspace shell
organisations already had, and files stop being a link-out.

**LIVE on the node as of 2026-07-29: a citizen lists their own files and opens a
document in Collabora.** Still behind the `NEXT_PUBLIC_WORKSPACE_NATIVE_FILES`
flag for everyone else — see [§3](#3-turning-it-on) and
[§5](#5-what-the-first-real-login-actually-broke-on).

**Shipped but NOT enabled.** The whole surface is behind a flag and nine env
vars, all currently unset, so production behaves exactly as before. Read
[§3 Turning it on](#3-turning-it-on) before flipping anything, and
[SECURITY_FINDINGS_2026-07-28.md](SECURITY_FINDINGS_2026-07-28.md) before
enabling the **org** half.

Design: [spec](superpowers/specs/2026-07-28-sovereign-arbeitsbereich-slice1-design.md) ·
Build: [17-task plan](superpowers/plans/2026-07-28-sovereign-arbeitsbereich-slice1.md) ·
Node setup: [WORKSPACE_SSO_SETUP.md](WORKSPACE_SSO_SETUP.md)

---

## 1. What shipped

| Layer | What it is |
|---|---|
| **Shell** | `/arbeitsbereich` — its own layout, sidebar and working area, mirroring the org `/dashboard` shell. `/app/dashboard` redirects here. |
| **Files** | A native browser over Nextcloud **WebDAV**, rendered by us. No Nextcloud chrome. |
| **Documents** | We implement the **WOPI host**; Collabora renders the editor inside our page. |
| **Identity** | Röbel ID (OIDC) as a third relying party, `roebel-web`. One hop on first entry, silent after. |
| **Session** | **Server-side** in `workspace_sessions`; the cookie carries only an opaque id. |
| **Provenance** | Every mutation recorded in `workspace_actions`, metadata-only. |
| **Org scope** | The same components, scoped to a per-org Nextcloud group folder. |
| **Installer** | Declared in the Netizen manifest, rendered by `netizen render/up`, checked by `netizen doctor`. |

**The package.** `@netizen-labs/workspace` — scope guard, PROPFIND parser,
WebDAV client, OCS provisioning, WOPI host, provenance seam. Node-agnostic: it
takes configuration, never Röbel constants, and is written to extract with the
other `@netizen-labs/*` packages.

**Why the session is server-side.** Collabora calls the WOPI endpoints
server-to-server, carrying no browser cookie. A cookie-only session is unreadable
exactly where a document load needs it. Two properties follow: no access token
ever reaches the browser, and an edit outliving the token's hour still saves.

## 2. Honest limits

- ~~A bearer `PROPFIND` returning 207 has never been observed.~~ **RESOLVED
  2026-07-29: 207, real files, authenticated with a citizen's own token.** See §5
  for the three settings that were wrong.
- **`ensureUser` is still never called — and no longer needs to be.**
  `--bearer-provisioning=1` makes `user_oidc` create the Nextcloud account on the
  first bearer request, which is where that responsibility belongs. The
  provisioner remains built and tested for the group-folder path.
- **No full `next build` completed locally.** Compilation of every route was
  verified (the build reached page-data collection), and `tsc --noEmit` is clean
  across all workspace files — which matters because `next.config` sets
  `typescript.ignoreBuildErrors: true`, so the build never type-checks anyway.
- ~~Mobile has no route to the native files page. The only link is in a
  `hidden md:block` sidebar.~~ **DONE:** a mobile bottom nav and a `Dateien`
  tile now route to `/arbeitsbereich` (`734ba695`, `4a019442`).
- ~~All three org roles get identical write access. `ensureOrgFolder` binds
  owner/admin/member the same and the editor mints `canWrite: true`
  unconditionally.~~ **DONE:** write access is now role-based — owner/admin
  write, member read-only — enforced in the editor/upload/folder/delete
  routes (`06de78c1`, `9b196341`), with matching Nextcloud per-role
  permission bitmasks 31/1 (`27bc8958`). Unrecognized roles fail **closed**
  (`1e4fe6a1` fixed a fail-open `canWrite` for roles the switch didn't
  recognise).
- **No React component or route handler is unit-tested.** This repo's harness
  (`tsx --test`) reaches pure modules only. All decisions were pushed into pure
  modules and tested there; the wiring is verified by reading, `tsc` and lint.

## 3. Turning it on

Order matters. Steps 1–3 are inert on their own; step 4 is the switch.

**1 · Migrations** (applied 2026-07-28)
- [`20260728_workspace_sessions.sql`](../supabase/migrations/20260728_workspace_sessions.sql) — RLS on, no policies, `revoke all from anon, authenticated`
- [`20260728_workspace_actions.sql`](../supabase/migrations/20260728_workspace_actions.sql)
- [`20260728_workspace_sessions_gc.sql`](../supabase/migrations/20260728_workspace_sessions_gc.sql) — swept nightly by `/api/cron/workspace-sessions-gc` at 03:00

**2 · Keystone (Fly).** Generate once, use the same value on both sides:

```bash
export WS_SECRET="$(openssl rand -hex 32)"
fly secrets set -a roebel-id \
  WEB_CLIENT_ID="roebel-web" \
  WEB_CLIENT_SECRET="$WS_SECRET" \
  WEB_REDIRECT_URIS="https://www.roebel.app/api/workspace/auth/callback,https://roebel.app/api/workspace/auth/callback"
cd apps/roebel-id && fly deploy -a roebel-id   # from apps/roebel-id/, never the repo root
```

Fly secrets are write-only — you cannot read `WEB_CLIENT_SECRET` back. Capture it
when you generate it.

**3 · Vercel — all nine or none.** `isWorkspaceEnabled()` requires every one; with
any missing, `/api/workspace/*` answers `503 {"reason":"unconfigured"}` and the
UI shows the old link-out card.

```
ROEBEL_ID_ISSUER=https://id.roebel.app
WORKSPACE_CLIENT_ID=roebel-web            # must equal WEB_CLIENT_ID
WORKSPACE_CLIENT_SECRET=<$WS_SECRET>
WOPI_TOKEN_SECRET=<openssl rand -base64 32>
NEXTCLOUD_BASE_URL=https://cloud.roebel.app
NEXTCLOUD_ADMIN_USER=RoebelAdmin
NEXTCLOUD_ADMIN_PASSWORD=<real password>
COLLABORA_BASE_URL=https://cloud.roebel.app
NEXT_PUBLIC_APP_ORIGIN=https://www.roebel.app
```

`NEXT_PUBLIC_APP_ORIGIN` must be the **exact host citizens browse**.
`roebel.app` 307-redirects to `www.roebel.app`, so `www` is canonical here. The
PKCE cookies are host-only; a mismatch makes login fail permanently, not
intermittently.

**4 · The flag**

```
NEXT_PUBLIC_WORKSPACE_NATIVE_FILES=1
```

Unset (or `0`/`no`) = the Nextcloud tile and link-out card stay, exactly as
before this work. Set = the native surface takes over and the tile disappears.

> **Findings §1/§2 are code-fixed, not policy-fixed yet — this gates ORG
> scopes only.** `hasOrgAccess` is the only gate on org files and the mount
> point is guessable, so the underlying risk was real. All membership and
> account writes now ride a signature-verified edge function
> (`org-membership`) instead of the open `WITH CHECK (true)` policies, but
> the policy drops themselves ship in
> `supabase/migrations/20260802_account_membership_lockdown.sql`, which is
> **gated on the next EAS build** (older installed Expo builds still write
> `account_owners`/`accounts` directly; dropping the policy before they
> upgrade breaks them). Don't flip the flag for **org** scopes until that
> migration is applied. The **personal** scope never depended on these
> findings and is unaffected. Session claims (finding §4) are separately
> fixed: `workspace_sessions` now re-reads group claims on token refresh
> (`ec2f19f4`, `6a2304c0`) instead of trusting the login-time snapshot, so an
> ex-member loses org access at the next refresh, not at the cookie's 14-day
> `maxAge`. See
> [SECURITY_FINDINGS_2026-07-28.md](SECURITY_FINDINGS_2026-07-28.md).

## 4. Where the code is

| | |
|---|---|
| `packages/workspace/` | the node-agnostic primitives |
| `apps/web/src/lib/workspace/` | session, context, config, request, client helpers |
| `apps/web/src/app/arbeitsbereich/` | the citizen shell and Dateien surface |
| `apps/web/src/app/dashboard/arbeitsbereich/` | the org surface |
| `apps/web/src/app/api/workspace/` | auth, files, editor and WOPI routes |
| `apps/roebel-id/src/config.ts` | the `web` relying party |
| `packages/protocol` + `packages/cli` | manifest fields, rendering, doctor checks |


## 5. What the first real login actually broke on

Every layer was individually correct and the whole chain still failed. Recorded
because none of it is guessable from the code, and all of it is node state.

**1 · The keystone did not put `groups` in the ID Token.** panva's
`oidc-provider` defaults `conformIdTokenClaims: true`, so once an access token is
issued — always, in the authorization-code flow — the ID Token carries only `sub`
and scoped claims are served from userinfo. `groups` is the ACL every relying
party gates on, so a verified citizen holding a CitizenNFTv2 was refused their own
files. Fixed with `conformIdTokenClaims: false` in
`apps/roebel-id/src/oidc/provider.ts`; the app also falls back to `/me`, so either
configuration works.

**2 · `--check-bearer` was `0`.** It is the documented default when a `user_oidc`
provider is created. Without it the provider is never consulted for bearer auth
at all: a demonstrably valid token — 200 at the keystone's own userinfo endpoint —
returned 401 from every WebDAV call. Now `1`, alongside
`--bearer-provisioning=1`.

**3 · The bearer settings were written to the wrong config store.** `user_oidc`
reads them through `getSystemValue('user_oidc', [])` — Nextcloud's **system**
config. They had been set with `occ config:app:set`, which succeeded, echoed the
value back, and displayed correctly in `occ config:list user_oidc`. The code path
that decides whether to accept a bearer token never reads app config. **A setting
that confirms itself and does nothing is the worst shape a misconfiguration can
take.** Fixed with `occ config:system:set … --type=boolean`.

**4 · Collabora rejected the app as a WOPI host.** `aliasgroup1` named only the
Nextcloud host, so opening a document returned "Unautorisierter WOPI-Host". The
app's own origin must be in that list. Now `aliasgroup1..3` = Nextcloud, `www`,
apex.

**5 · The OIDC round trip must follow the host the citizen is on.** The PKCE
cookies are host-only. Pinning one configured origin failed in **both**
directions — apex configured while browsing `www`, then `www` while browsing
apex. The origin is now derived from the request, allow-listed
(`WORKSPACE_ALLOWED_ORIGINS`), and pinned in a cookie so the callback exchanges
the code against the same `redirect_uri`.

All five are now rendered by the installer (`packages/cli/src/render.ts`) and
declared in the manifest, so node #2 inherits them instead of rediscovering them.
The one exception, still hand-applied on Röbel's node: the three `aliasgroup`
entries were added directly to `/opt/netizen/roebel/docker-compose.yml`; a
`netizen up` will render them from `services.workspace.wopiHosts`.
