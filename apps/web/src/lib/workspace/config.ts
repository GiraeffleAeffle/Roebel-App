/**
 * Workspace configuration, read from the deployment environment.
 *
 * Identity supports Case review independently of the optional document tools.
 */
import { allowedOrigins } from "./origin";

export interface WorkspaceIdentityConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  appOrigin: string;
  /**
   * Extra origins the OIDC round trip may use, comma-separated. The citizen
   * decides which host they are on (apex vs www both resolve), and the PKCE
   * cookies are host-only — so the redirect_uri must follow the request rather
   * than a fixed value. Anything not listed here falls back to appOrigin.
   */
  allowedOrigins: string[];
}

export interface WorkspaceConfig extends WorkspaceIdentityConfig {
  wopiSecret: Uint8Array;
  nextcloudBaseUrl: string;
  nextcloudAdminUser: string;
  nextcloudAdminPassword: string;
  collaboraBaseUrl: string;
}

const IDENTITY_REQUIRED = [
  "ROEBEL_ID_ISSUER",
  "WORKSPACE_CLIENT_ID",
  "WORKSPACE_CLIENT_SECRET",
] as const;

const REQUIRED = [
  ...IDENTITY_REQUIRED,
  "WOPI_TOKEN_SECRET",
  "NEXTCLOUD_BASE_URL",
  "NEXTCLOUD_ADMIN_USER",
  "NEXTCLOUD_ADMIN_PASSWORD",
  "COLLABORA_BASE_URL",
] as const;

function identityAppOrigin(): string {
  return process.env.WORKSPACE_APP_ORIGIN || process.env.NEXT_PUBLIC_APP_ORIGIN || "";
}

export function isWorkspaceIdentityEnabled(): boolean {
  return IDENTITY_REQUIRED.every((name) => (process.env[name] ?? "").length > 0) &&
    identityAppOrigin().length > 0;
}

export function isWorkspaceEnabled(): boolean {
  return isWorkspaceIdentityEnabled() &&
    REQUIRED.every((name) => (process.env[name] ?? "").length > 0);
}

function requireVariables(names: readonly string[]): void {
  const missing = names.filter((name) => !(process.env[name] ?? "").length);
  if (missing.length) {
    throw new Error(`workspace is not configured: missing ${missing.join(", ")}`);
  }
}

/** Login and Case review need identity configuration, independently of Office. */
export function workspaceIdentityConfig(): WorkspaceIdentityConfig {
  requireVariables(IDENTITY_REQUIRED);
  const appOrigin = identityAppOrigin();
  if (!appOrigin) throw new Error("workspace is not configured: missing WORKSPACE_APP_ORIGIN");
  return {
    issuer: process.env.ROEBEL_ID_ISSUER!,
    clientId: process.env.WORKSPACE_CLIENT_ID!,
    clientSecret: process.env.WORKSPACE_CLIENT_SECRET!,
    appOrigin,
    allowedOrigins: allowedOrigins(
      appOrigin,
      process.env.WORKSPACE_ALLOWED_ORIGINS,
    ),
  };
}

export function workspaceConfig(): WorkspaceConfig {
  requireVariables(REQUIRED);
  return {
    ...workspaceIdentityConfig(),
    wopiSecret: new Uint8Array(Buffer.from(process.env.WOPI_TOKEN_SECRET!, "base64")),
    nextcloudBaseUrl: process.env.NEXTCLOUD_BASE_URL!,
    nextcloudAdminUser: process.env.NEXTCLOUD_ADMIN_USER!,
    nextcloudAdminPassword: process.env.NEXTCLOUD_ADMIN_PASSWORD!,
    collaboraBaseUrl: process.env.COLLABORA_BASE_URL!,
  };
}
