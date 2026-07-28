import { cookies } from "next/headers";
import {
  bearerAuth,
  createNextcloudClient,
  createProvisioner,
  orgFolderName,
  type NextcloudClient,
  type Provisioner,
  type WorkspaceScope,
} from "@netizen-labs/workspace";
import { workspaceConfig } from "./config";
import { refreshTokens } from "./oidc";
import { createSessionStore } from "./session-store";
import { hasOrgAccess, isExpired, orgGroupId, type WorkspaceSession } from "./session";
import type { Account } from "../../types/account";

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
 * Looks up the account `resolveScope` needs to trust an org folder name,
 * keyed by accountId. Production uses `defaultOrgAccountLookup` below; tests
 * inject a stub so the trust decision is exercised without Supabase.
 */
export type OrgAccountLookup = (
  accountId: string,
) => Promise<Pick<Account, "name" | "account_type"> | null>;

/**
 * The real, Supabase-backed lookup. Imported dynamically rather than at
 * module top level: `../supabase-accounts` pulls in `../supabase`, which
 * throws at *import time* when NEXT_PUBLIC_SUPABASE_URL/ANON_KEY are unset.
 * That never happens in the deployed app, but `pnpm test:web` loads every
 * test file's whole import graph in one process with no Supabase env at
 * all — a static import here would take the entire suite down. Every real
 * request uses this default (nobody overrides it in production); tests
 * always pass their own `lookupOrgAccount` stub, so this import is never
 * reached from `pnpm test:web`.
 */
const defaultOrgAccountLookup: OrgAccountLookup = async (accountId) => {
  const { fetchAccountById } = await import("../supabase-accounts");
  return fetchAccountById(accountId);
};

/**
 * Decide the trusted folder name for an org scope from the account record
 * alone. Pure and synchronous on purpose — this is the seam a "the client
 * cannot redirect the folder" test exercises directly, with a plain object,
 * no network and no async lookup to fake.
 */
export function resolveOrgFolderName(
  account: Pick<Account, "name" | "account_type"> | null,
): string {
  if (!account || account.account_type !== "organisation") {
    throw new WorkspaceAuthError(
      "forbidden",
      "account is not a provisionable organisation",
    );
  }
  return orgFolderName(account.name);
}

/**
 * Turn the request's query parameters into a scope, refusing anything the
 * session's `groups` claim does not authorise. The claim is the ACL — a citizen
 * must not reach another org by editing a query string.
 *
 * `orgName`, if present on `params`, is the CLIENT'S claim about the org's
 * display name and is deliberately never read below. Trusting it was a real,
 * exploitable bug: `ensureOrgFolder` binds a Nextcloud group to whatever
 * folder name it is handed, and group folders are matched by name with no
 * accountId dimension — a citizen legitimately in org A could send org B's
 * real name as `orgName` and have `ensureOrgFolder` durably bind org A's
 * group onto org B's already-provisioned folder, a standing grant, not a
 * leaked response. The folder name now always comes from
 * `lookupOrgAccount(accountId)` — the account registry, keyed by the id the
 * ACL check below already authorised — never from anything client-supplied.
 * `orgName` stays in the parameter shape only because callers still spread
 * `parseScopeRequest`'s output into this call; it carries no authority.
 */
export async function resolveScope(
  params: {
    session: WorkspaceSession;
    scopeKind: string | null;
    accountId: string | null;
    orgName?: string | null;
  },
  lookupOrgAccount: OrgAccountLookup = defaultOrgAccountLookup,
): Promise<WorkspaceScope> {
  if (params.scopeKind !== "org") {
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
  const account = await lookupOrgAccount(params.accountId);
  return {
    kind: "org",
    sub: params.session.sub,
    accountId: params.accountId,
    folderName: resolveOrgFolderName(account),
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
 */
const orgFoldersEnsured = new Set<string>();

/**
 * Ensure the org's shared folder exists and is bound to its group. Idempotent
 * and create-if-absent, so it is safe on the request path — this is what closes
 * the group-folder gap rather than leaving it to a runbook. Trusts
 * `scope.folderName` and `scope.accountId` as given — both already went
 * through `resolveScope`'s ACL + account-registry checks by the time a scope
 * reaches here, so this function does not re-validate them, only sequences
 * the (already idempotent) provisioner calls once per process per account.
 */
export async function ensureOrgFolder(
  ctx: WorkspaceContext,
  scope: WorkspaceScope,
): Promise<void> {
  if (scope.kind !== "org" || !scope.accountId || !scope.folderName) return;
  if (orgFoldersEnsured.has(scope.accountId)) return;
  const groupId = orgGroupId(scope.accountId);
  await ctx.provisioner.ensureGroup(groupId);
  await ctx.provisioner.ensureGroupFolder({ name: scope.folderName, groupId });
  orgFoldersEnsured.add(scope.accountId);
}
