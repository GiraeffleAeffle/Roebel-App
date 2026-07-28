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
import { hasOrgAccess, isExpired, type WorkspaceSession } from "./session";

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
 */
export function resolveScope(params: {
  session: WorkspaceSession;
  scopeKind: string | null;
  accountId: string | null;
  orgName: string | null;
}): WorkspaceScope {
  if (params.scopeKind !== "org") {
    return { kind: "personal", sub: params.session.sub };
  }
  if (!params.accountId) {
    throw new WorkspaceAuthError("forbidden", "an org scope needs an account id");
  }
  if (!params.orgName) {
    throw new WorkspaceAuthError("forbidden", "an org scope needs an org name");
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
    folderName: orgFolderName(params.orgName),
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
