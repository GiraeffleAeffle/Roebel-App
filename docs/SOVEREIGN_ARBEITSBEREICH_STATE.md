# State of the Sovereign Arbeitsbereich

**Merged to `main` 2026-07-28.** Slice 1 of Goal G6
([MISSION_AND_GOALS](MISSION_AND_GOALS.md)) — citizens get the workspace shell
organisations already had, and files stop being a link-out.

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

- **A bearer `PROPFIND` returning 207 has never been observed** against the real
  Nextcloud. It needs a real access token, which needs the wallet round-trip that
  only exists now. Config is correct by inspection; the first citizen login is
  the moment of truth. Fallback is per-user app passwords — a strategy swap, not
  a rewrite, because `auth` is a constructor argument.
- **`ensureUser` is built, tested, exported and never called.** Nothing on our
  side creates the Nextcloud user or the group membership; it rests entirely on
  `user_oidc` provisioning on a bearer request. This is the most likely
  first-login failure.
- **No full `next build` completed locally.** Compilation of every route was
  verified (the build reached page-data collection), and `tsc --noEmit` is clean
  across all workspace files — which matters because `next.config` sets
  `typescript.ignoreBuildErrors: true`, so the build never type-checks anyway.
- **Mobile has no route to the native files page.** The only link is in a
  `hidden md:block` sidebar. Fix before flipping the flag.
- **All three org roles get identical write access.** `ensureOrgFolder` binds
  owner/admin/member the same and the editor mints `canWrite: true`
  unconditionally.
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

> **Do not flip this until `account_owners_insert WITH CHECK (true)` is fixed.**
> `hasOrgAccess` is the only gate on org files and the mount point is guessable.
> See [SECURITY_FINDINGS_2026-07-28.md](SECURITY_FINDINGS_2026-07-28.md) §1.

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
