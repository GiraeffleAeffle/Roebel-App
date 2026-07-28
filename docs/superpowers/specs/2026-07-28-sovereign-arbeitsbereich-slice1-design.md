# Sovereign Arbeitsbereich — Slice 1: the workspace shell + Dateien & Dokumente (Design)

**Date:** 2026-07-28 · **Status:** approved to build ("yes build")
**Goal:** [MISSION_AND_GOALS](../../MISSION_AND_GOALS.md) **G6** — a sovereign workplace suite
where every user, not only orgs, gets a workspace, and openDesk components are *extended*
rather than competed with.

**Supersedes for the citizen surface:** [citizen-dashboard v1](2026-07-26-citizen-dashboard-design.md)
§6, which listed "workspace-app embedding" and "a dedicated dashboard shell" as later slices.
This is that later slice. **Companion:** [sovereign-workplace-suite](2026-07-25-sovereign-workplace-suite-design.md)
(L3 workplace apps + L4 agent runtime), [chat-protocol decision](../../future-research/2026-07-26_CHAT_PROTOCOL_DECISION.md)
(poly-protocol unified by identity), [org-workspace-suite](2026-07-26-org-workspace-suite-design.md)
(the tiles this replaces).

---

## 1. What we are building, and why this shape

Today a Citizen's dashboard is one page inside the social app shell that ends in seven tiles
which **link out** to Nextcloud, Element and five unbuilt services. Orgs get a real shell —
their own layout, sidebar and working area. This slice gives Citizens that same shell, and
replaces the first tile with a **native surface**: a file browser we render, and documents that
open **inside our page**.

The decision that shapes everything else: **hybrid, not full-native.** We build the Röbel
workspace UI against the openDesk components' own APIs (Nextcloud WebDAV/OCS, Collabora WOPI)
instead of rebuilding storage and editing. That keeps the G6 reuse principle intact and makes
us an **extension of openDesk rather than a competitor** — swap a base URL and the same
workspace UI runs against a town's existing openDesk deployment.

Full-native was rejected for exactly that reason: it would have made us a competitor to a stack
that is reaching mass adoption in the German public sector, and it contradicts
[sovereign-workplace-suite §6](2026-07-25-sovereign-workplace-suite-design.md)
("reuse documents/sheets/mail; build identity, agents, money, coordination").

### The Buzz question, answered

The target is a Buzz-style workspace where humans and AI agents are peers. Hybrid supports that,
on a stronger primitive than [block/buzz](https://github.com/block/buzz) itself has:

- **Agents as members.** Buzz's core move is that an agent holds its own keypair rather than a
  shared bot token. Our Agent Runtime v0 already specifies that: an agent gets its own Gnosis
  smart account, `actor_type='agent'`, and an RFC-8693 `act` claim. That single account yields
  **three memberships at once** — a Matrix account (Röbel ID → MAS), an npub (the same
  derivation Citizens use in `packages/nostr`), and an XMTP inbox. Buzz has no EVM identity and
  **no payments at all**, which is the moat, not a gap.
- **The signed audit log, and its one honest constraint.** In Buzz every action is signed *by the
  actor* into one append-only log. Matrix events are signed by the homeserver, not the member, so
  we do not get that for free. Our relay has **no NIP-42 and no NIP-29**
  ([State of Nostr](../../STATE_OF_NOSTR.md) §1), so anything published there is world-readable
  forever. The resolution is a two-tier split: **private collaboration content stays on
  Nextcloud/Matrix** where it is private and erasable, and the **provenance log** — "agent A,
  acting for citizen B, wrote document D at T" — publishes to Nostr signed by the actor's own
  key. World-readable is the correct property for an audit trail.
- **Not reachable today, stated plainly:** private, relay-gated group chat on Nostr. That needs
  NIP-29 plus NIP-42 on the relay binary and is a separate project. Buzz at v0.4.x has the same
  limitation. The workspace must not pretend otherwise.

Slice 1 builds **no agents**. It builds the two seams (§6) that make slice 2 additive.

## 2. Scope

**In:** the workspace shell and its layout; the Übersicht page (the current citizen dashboard
content, moved); a native Dateien & Dokumente surface for both personal and org scope; the web
app's Röbel ID session; the Nextcloud access layer; the WOPI host; per-org group folder
provisioning; the manifest + installer declarations that make all of it reproducible on a fork.

**Out:** agents (slice 2), native chat (slice 3), wiki/projects/video/mail — those keep their
existing link-out tiles; Nostr publishing from the workspace (the seam only); the Expo app; file
search (needs the indexer that [State of Nostr §6](../../STATE_OF_NOSTR.md) lists as unbuilt).

**Success:** a Citizen opens `/arbeitsbereich`, is authenticated without pressing a login button,
sees their files, opens a `.odt`, edits it inside the Röbel page, and the change is in Nextcloud.
An org member switches to their org and sees the org's shared folder; a non-member does not.
Neither ever sees Nextcloud or Collabora chrome, and neither leaves the Röbel domain.

## 3. Netizen extraction — the hard thing now

The user constraint on this build: *do the hard thing now so others set it up easily later.*
Concretely, the workspace must arrive on node #2 through `netizen up`, not through a runbook.

**A new node-agnostic package, `@netizen-labs/workspace` (`packages/workspace`).** It imports no
Röbel constants and holds no React — it takes configuration and explicit arguments, exactly like
`packages/nostr`, `packages/relay-sync` and `packages/protocol` already do
([State of the Netizen Stack §3](../../STATE_OF_THE_NETIZEN_STACK.md)). It is written to be
extracted with them when the packages move to the Netizen repo.

| Module | Responsibility |
|---|---|
| `nextcloud.ts` | WebDAV + OCS client; constructed with `{ baseUrl, fetch, auth }` |
| `scope.ts` | scope → path root; the traversal guard |
| `wopi.ts` | WOPI host protocol as pure handlers over a storage interface |
| `provisioning.ts` | ensure-user and ensure-group-folder, both idempotent |
| `provenance.ts` | the `WorkspaceAction` type and its sink interface |
| `types.ts` | the `Actor` union |

Röbel-specific code stays in `apps/web`: route handlers, the session cookie, the UI, and the
Postgres provenance sink.

**Manifest and installer.** The schema already carries `identity.relyingParties`,
`services.workspace.nextcloud`, `.collabora` and `.groupFolders`, and `render.ts` already emits a
`nextcloud-oidc` setup step. Three additive changes complete it:

1. `services.workspace.wopiHosts?: string[]` — origins permitted to act as WOPI host. Today
   `render.ts` derives Collabora's `aliasgroup1` from the Nextcloud host alone; the web app's
   origin has to join it or Collabora refuses to load our documents.
2. `services.workspace.bearerValidation?: boolean` — makes the rendered `nextcloud/setup.sh`
   enable `user_oidc`'s bearer-token validation, which §5 depends on.
3. A `web` entry in the manifest instance's `relyingParties`, and `render.ts` emitting
   `WEB_CLIENT_ID` / `WEB_CLIENT_SECRET` / `WEB_REDIRECT_URIS` alongside the Nextcloud and Matrix
   pairs it already emits.

**`netizen doctor` gains three checks**, so a fork learns about a misconfiguration from the tool
rather than from a blank file list: bearer validation is on, the declared WOPI host is in
Collabora's alias group, and `groupfolders` is installed.

**Sequencing.** `packages/protocol/src/manifest.ts`, `packages/cli/test/federation.test.ts` and
`roebel.netizen.json` are being edited concurrently by the Nostr agent. These three changes are
additive and land **last** in the slice, committed with pathspecs. This slice touches neither
`packages/nostr`, nor `packages/relay-sync`, nor the relay policies.

## 4. Shell and routes

```
apps/web/src/app/arbeitsbereich/
  layout.tsx     top bar + WorkspaceSidebar + main  (mirrors app/dashboard/layout.tsx)
  page.tsx       Übersicht — identity · memberships · civic · Mecky entry
  dateien/       Dateien & Dokumente                ← the native surface
```

**Gating is unchanged from the citizen dashboard it replaces:** citizen = `tier === 'citizen'` OR
holds a CitizenNFTv2 on chain, the advisory-flag-plus-chain-truth union the app already uses. A
non-citizen reaching `/arbeitsbereich` gets the same graceful "Nur für verifizierte Bürger" state
the current page renders, never a hard redirect.

**The Übersicht keeps the tiles that are still tiles.** It carries the moved dashboard sections
plus the remaining link-out tiles (chat, mail, wiki, video, project) — so the page honestly shows
which surfaces are native and which are not, and each later slice removes one more tile.

**Scope follows the host; there is no scope switcher.** `/arbeitsbereich` is always personal. The
org's existing `/dashboard/arbeitsbereich` mounts the *same components* with an org scope, inside
the org sidebar where org work already lives. The app's account switcher governs which context
you are in, so no second switching concept is introduced and no shell is duplicated.

`/app/dashboard` becomes a redirect to `/arbeitsbereich`; the `AppSidebar` item and the
`AppRightPanel` CTA retarget. One home, not two.

The org page keeps its link-out tiles for the surfaces that are still unbuilt (mail, wiki, video,
project, chat) and replaces only the files tile. `lib/dashboard/workspace-tiles.ts` and its org
twin therefore lose their `nextcloud` entry and keep the rest.

## 5. Session and identity

The keystone gains a **third relying party, `web`**, registered exactly like the optional `matrix`
client in [`apps/roebel-id/src/config.ts`](../../../apps/roebel-id/src/config.ts) — absent unless
`WEB_CLIENT_ID` is set, so the keystone boots unchanged before this ships.

In `apps/web`: `/api/workspace/auth/{login,callback,logout}`, authorization code + PKCE, and an
encrypted httpOnly session cookie built with `jose` (already a dependency). The session holds
`sub`, `groups[]`, the access and refresh tokens, and expiry. **Tokens are never sent to the
browser** — every Nextcloud call is proxied by a route handler.

Entering a workspace route without a session triggers the redirect automatically, so the user
sees a hop rather than a login button. First entry costs one wallet signature at
`id.roebel.app`; later entries are silent, carried by the IdP's SSO cookie.

**The session is keyed to `sub`.** If the connected wallet stops matching the session's `sub`, the
session is discarded and re-established. Without that rule, switching wallets in the app would
leave the previous Citizen's files on screen — an identity bug, not a caching bug.

## 6. Nextcloud access

`@netizen-labs/workspace`'s client covers `listDirectory · download · upload · createFolder ·
move · delete` over WebDAV, authenticated with `Authorization: Bearer <access_token>`.

This works through `user_oidc`'s bearer-token validation, and it needed **user_oidc ≥ 7.4.0**
before WebDAV and REST requests passed correctly. **The installed version must be verified on the
box before any UI is built** — the whole surface rests on it. If it cannot be made to work, the
fallback is per-user Nextcloud app passwords provisioned through the OCS provisioning API and
stored encrypted; the client interface is unchanged, only the `auth` strategy differs, which is
why `auth` is a constructor argument rather than a hardcoded header.

**Scope resolves to a path root** — personal to the Citizen's own home, org to the group folder
ACL'd to `org:<accountId>:member`. Every requested path is validated against its root, so no
request can traverse out of its scope. This is a security boundary, and it gets a direct unit test
rather than being trusted to the UI never asking.

**Provisioning is idempotent and create-if-absent.** First entry ensures the Nextcloud user
exists; first org-scope entry ensures the group folder exists and is bound to the org group. That
closes the open `§4.4` gap in [WORKSPACE_STATE_AND_NEXT](../../WORKSPACE_STATE_AND_NEXT.md)
instead of leaving it for later, and because it is declared in the manifest (§3) a fork gets it
without knowing it existed.

## 7. The editor — we are the WOPI host

Iframing Nextcloud's `richdocuments` would drag Nextcloud's entire chrome into the page and fight
its `X-Frame-Options: SAMEORIGIN`. Instead **we implement the WOPI host ourselves** —
`CheckFileInfo`, `GetFile`, `PutFile`, backed by the WebDAV client — and point the iframe straight
at Collabora, which is built to be embedded exactly this way. Nothing has to be defeated.

The document then opens inside our page, under our sidebar, showing only Collabora's editing
surface. WOPI access tokens are minted per file per session, short-lived, and scoped to one path,
so a leaked token opens one document for minutes rather than a filesystem.

**This is the largest single item in the slice**, so it carries a written fallback: iframe
`richdocuments` and scope `frame-ancestors` to the Röbel origin at Caddy, which we control. The
fallback is worse UX and is not the default.

## 8. The AI seam — reserved now, built in slice 2

Two decisions cost almost nothing today and make slice 2 additive instead of a rewrite.

1. **Every call takes an actor**: `{kind:'human', sub}` or `{kind:'agent', sub, actingFor}`. Slice
   1 only ever constructs `human`. The agent path is the same code — and an agent will carry its
   own client-credentials token from the keystone, never borrow the human's session. Attribution
   is therefore structural rather than a convention someone has to remember.
2. **Every mutating operation goes through one `recordWorkspaceAction()`** with an injected sink.
   Slice 1's sink writes Postgres. Slice 2 adds a second sink that publishes the signed Nostr
   provenance event under the actor's own npub. One call site means the audit log is complete
   from the first day rather than reconstructed afterwards.

## 9. Testing

**Unit** (in `packages/workspace`, React-free, `node:test` like the sibling packages): PROPFIND
XML parsed into typed entries, including the empty-directory and non-ASCII-filename cases; the
scope traversal guard, asserted against `..`, absolute paths, and encoded separators; WOPI token
mint/verify including expiry and path binding; session cookie round-trip and expiry.

**Integration** (`apps/web`, mocked Nextcloud): route handlers return typed entries; a 401
triggers exactly one refresh and one retry; and an explicit assertion that no access token,
refresh token or WOPI secret appears in any client-bound payload.

**Manual, on the live node:** Citizen → hop → file list → open `.odt` → edit → confirm the change
in Nextcloud. Org member sees the group folder; a non-member gets an empty scope, not an error
that leaks the folder's existence. `netizen doctor` reports the three new checks green.

## 10. Risks

1. **Bearer auth is load-bearing.** Verify on the box before building UI. Fallback in §6.
2. **The WOPI host is the biggest build item.** Fallback in §7.
3. **The keystone needs a Fly deploy** for the third client — `fly deploy` from `apps/roebel-id/`,
   never the repo root, or the build context is 30 GB.
4. **Concurrent edits.** The Nostr agent is active in `packages/protocol`, `packages/cli` and the
   manifest instance. Mitigated by §3's sequencing, additive diffs and pathspec-only commits.
5. **GDPR.** Workspace content stays on Nextcloud, which is erasable. Only provenance metadata is
   destined for Nostr in slice 2, where deletion is advisory — so that record must carry actor,
   action, target and time, and never document content or personal data.
