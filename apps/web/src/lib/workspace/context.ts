import { cookies } from "next/headers";
import {
  bearerAuth,
  createNextcloudClient,
  createProvisioner,
  orgFolderMount,
  type NextcloudClient,
  type Provisioner,
  type WorkspaceScope,
} from "@netizen-labs/workspace";
import { workspaceConfig } from "./config";
import { refreshTokens } from "./oidc";
import { createSessionStore } from "./session-store";
import {
  ORG_ROLES,
  hasOrgAccess,
  isCitizenSession,
  isExpired,
  orgGroupId,
  type WorkspaceSession,
} from "./session";

export const SESSION_COOKIE = "roebel_ws";

export class WorkspaceAuthError extends Error {
  readonly reason: "no-session" | "expired" | "forbidden";
  constructor(reason: "no-session" | "expired" | "forbidden", message: string) {
    super(message);
    this.name = "WorkspaceAuthError";
    this.reason = reason;
  }
}

/**
 * Turn the request's query parameters into a scope, refusing anything the
 * session's `groups` claim does not authorise. The claim is the ACL — a citizen
 * must not reach another org by editing a query string.
 *
 * The org folder's identity — its Nextcloud group-folder mount point — is
 * `orgFolderMount(accountId)`, derived from accountId alone. Two rounds of
 * review found the SAME takeover reachable through two different trust
 * anchors that both turned out to be attacker-controllable:
 *   Round 1: `orgName`, a raw client query parameter. Fixed by looking the
 *   name up from the account registry instead of trusting the request —
 *   which turned out not to be enough.
 *   Round 2: `accounts.name` itself, the thing round 1 substituted in.
 *   `accounts.name` has no uniqueness constraint, and any logged-in citizen
 *   can create — or rename — an org to another org's exact display name
 *   through the product's own UI and becomes its real, honestly-claimed
 *   owner, so the keystone mints them a genuine `org:<theirAccountId>:owner`
 *   claim. `resolveScope` would then look up their own real account, get
 *   their own real name back, and hand `ensureOrgFolder` a folder name that
 *   collides with the target org's already-provisioned folder — no crafted
 *   parameter required anywhere in the request.
 * `accountId` is the one thing in this whole chain the ACL check below
 * already authorises and that a citizen cannot forge, rename, or collide:
 * it is `accounts.id`, the table's own primary key, unique by construction.
 * `orgFolderMount` needs no lookup and no I/O — see its own doc comment in
 * `@netizen-labs/workspace` for the full incident writeup.
 *
 * `orgName`, if present on `params`, carries no authority and is never
 * read. It is NOT here because a production caller still sends one —
 * `parseScopeRequest` was changed to stop parsing or returning it at all,
 * so nothing reaching this function through the `...parsed` spread in any
 * route can carry it any more. It stays on this type only so
 * `workspace-context.test.ts`'s regression suite can keep calling this
 * function directly with a crafted `orgName` and assert, at both the type
 * level and the runtime level, that it has zero effect (see its "ignores
 * orgName entirely" case). Deleting the field would only break that test's
 * ability to compile — it would not close any remaining exposure, since
 * none exists.
 *
 * Still `async` with no `await` left in its body: this function is now a
 * pure ACL check plus `orgFolderMount(accountId)` — no lookup, no I/O, by
 * design. The keyword stays anyway because several forbidden-path tests
 * above assert via `assert.rejects(() => resolveScope(...), ...)`, which
 * requires a genuinely rejected Promise; a synchronous throw fails that
 * assertion instead of satisfying it (verified — Node's `assert.rejects`
 * does not catch a thunk that throws synchronously the way it catches a
 * rejected Promise). Every production call site already does
 * `await resolveScope(...)` too. Do not drop `async` here without also
 * converting those `assert.rejects` calls, and do not add a real `await`
 * back in either — reintroducing any lookup on this path is exactly the
 * bug round 2 above fixed.
 */
export async function resolveScope(params: {
  session: WorkspaceSession;
  scopeKind: string | null;
  accountId: string | null;
  orgName?: string | null;
}): Promise<WorkspaceScope> {
  if (params.scopeKind !== "org") {
    // THE CITIZEN GATE, and the only place it is enforced for real storage.
    // The Dateien surface replaced a dashboard that was gated on "verifizierte
    // Bürger", but the gate only ever existed in the page's own JSX — a
    // client-side card that hid a link. `requireWorkspace` and this function
    // both accepted any authenticated session, so the personal Nextcloud home
    // was reachable by anyone with a workspace session and a fetch.
    //
    // Enforced HERE rather than in `requireWorkspace` on purpose: the org
    // surface (/dashboard/arbeitsbereich) is gated by the
    // `org:<accountId>:<role>` claim instead, and an org's staff are not all
    // verified citizens. Gating `requireWorkspace` would have locked those
    // people out of their own org's shared folder — a different, equally real
    // bug. Every route reaches storage through `resolveScope`, and a WOPI
    // token can only be minted by /api/workspace/editor, which calls this
    // first, so the gate holds transitively for Collabora's own callbacks too.
    //
    // "forbidden" (403), not "no-session" (401): this citizen IS signed in,
    // and 401 is the signal `FileBrowser` answers with an OIDC hop. Sending
    // them round the login loop would never make them a citizen.
    if (!isCitizenSession(params.session)) {
      throw new WorkspaceAuthError(
        "forbidden",
        "the personal workspace is for verified citizens",
      );
    }
    return { kind: "personal", sub: params.session.sub };
  }
  if (!params.accountId) {
    throw new WorkspaceAuthError("forbidden", "an org scope needs an account id");
  }
  if (!hasOrgAccess(params.session, params.accountId)) {
    throw new WorkspaceAuthError(
      "forbidden",
      `no group claim for org ${params.accountId}`,
    );
  }
  return {
    kind: "org",
    sub: params.session.sub,
    accountId: params.accountId,
    folderName: orgFolderMount(params.accountId),
  };
}

/**
 * Load a session by id, refreshing the access token when it is close to expiry
 * and writing the refreshed tokens back to the store.
 *
 * Takes the id rather than reading the cookie, because the WOPI endpoints have
 * no cookie to read — Collabora calls them itself. That is the whole reason the
 * session lives in Postgres.
 */
export async function loadSession(
  sessionId: string,
): Promise<WorkspaceSession | null> {
  const cfg = workspaceConfig();
  const store = createSessionStore();

  const session = await store.get(sessionId);
  if (!session) return null;
  if (!isExpired(session, Date.now())) return session;
  if (!session.refreshToken) return null;

  try {
    const tokens = await refreshTokens({
      issuer: cfg.issuer,
      clientId: cfg.clientId,
      clientSecret: cfg.clientSecret,
      refreshToken: session.refreshToken,
    });
    const refreshed: WorkspaceSession = {
      ...session,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? session.refreshToken,
      expiresAt: Date.now() + tokens.expires_in * 1000,
    };
    await store.update(sessionId, refreshed);
    return refreshed;
  } catch {
    // A refusal to refresh means the session is over. Re-authenticating is the
    // correct answer, not an error page.
    //
    // Delete the row on the way out. It holds a refresh token the IdP has just
    // told us it will not honour, so keeping it buys nothing and costs a live
    // credential sitting in Postgres indefinitely — `workspace_sessions` has
    // no TTL of its own beyond the reaper in
    // supabase/migrations/20260728_workspace_sessions_gc.sql, and the caller
    // is about to mint a NEW row for the same citizen anyway. Best-effort: a
    // failed delete must still report "not signed in" rather than turning a
    // dead session into a 500.
    await store.destroy(sessionId).catch((err) => {
        console.error(
          "[workspace] could not delete a session whose refresh failed",
          err,
        );
      });
    return null;
  }
}

/** The browser's session: the cookie carries the id, nothing else. */
export async function readSession(): Promise<WorkspaceSession | null> {
  const jar = await cookies();
  const sessionId = jar.get(SESSION_COOKIE)?.value;
  return sessionId ? loadSession(sessionId) : null;
}

/** The session id itself, for minting a WOPI token that outlives the request. */
export async function readSessionId(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(SESSION_COOKIE)?.value ?? null;
}

/** The session plus everything a handler needs to act on it. */
export interface WorkspaceContext {
  session: WorkspaceSession;
  client: NextcloudClient;
  provisioner: Provisioner;
}

export async function requireWorkspace(): Promise<WorkspaceContext> {
  const session = await readSession();
  if (!session) {
    throw new WorkspaceAuthError("no-session", "not signed in to the workspace");
  }
  const cfg = workspaceConfig();
  return {
    session,
    client: createNextcloudClient({
      baseUrl: cfg.nextcloudBaseUrl,
      auth: bearerAuth(async () => session.accessToken),
    }),
    provisioner: createProvisioner({
      baseUrl: cfg.nextcloudBaseUrl,
      adminUser: cfg.nextcloudAdminUser,
      adminPassword: cfg.nextcloudAdminPassword,
    }),
  };
}

/**
 * Accounts whose group folder this process has already confirmed provisioned.
 * Lives for the lifetime of the Node.js process (a warm serverless instance,
 * or the dev server) — there is no eviction, and a cold start starts empty.
 * That is deliberately a soft cache, not a correctness mechanism: entries are
 * only added after `ensureOrgFolder` fully succeeds, so a miss (fresh
 * instance, or a provisioning attempt that failed) just costs one more
 * idempotent round trip through the provisioner, never a stale skip. Its job
 * is to stop `FileBrowser`'s per-subfolder-click `GET` from re-hitting the
 * OCS admin API on every listing, which `provisioning.ts` itself documents as
 * a one-time bootstrap cost, not a per-request one.
 *
 * Keying this by `accountId` alone used to be a latent split-brain risk: if
 * the folder's identity had depended on the org's (renameable) name, a warm
 * instance could skip provisioning after a rename while a cold instance
 * created a second, differently-named folder for the same org. It no longer
 * can — `orgFolderMount(accountId)` does not read the org's name at all, so
 * a rename cannot change which folder this cache (or reality) points at.
 */
const orgFoldersEnsured = new Set<string>();

/**
 * Ensure the org's shared folder exists and is bound to every group role
 * `account_owners.role` can hold (`ORG_ROLES` — owner, admin, member; see its
 * doc comment in `./session`). Idempotent and create-if-absent, so it is
 * safe on the request path — this is what closes the group-folder gap
 * rather than leaving it to a runbook. Trusts `scope.folderName` and
 * `scope.accountId` as given — both already went through `resolveScope`'s
 * ACL check and accountId-only derivation by the time a scope reaches here,
 * so this function does not re-validate them, only sequences the (already
 * idempotent) provisioner calls once per process per account.
 */
export async function ensureOrgFolder(
  ctx: WorkspaceContext,
  scope: WorkspaceScope,
): Promise<void> {
  if (scope.kind !== "org" || !scope.accountId || !scope.folderName) return;
  if (orgFoldersEnsured.has(scope.accountId)) return;
  for (const role of ORG_ROLES) {
    const groupId = orgGroupId(scope.accountId, role);
    await ctx.provisioner.ensureGroup(groupId);
    await ctx.provisioner.ensureGroupFolder({ name: scope.folderName, groupId });
  }
  orgFoldersEnsured.add(scope.accountId);
}
