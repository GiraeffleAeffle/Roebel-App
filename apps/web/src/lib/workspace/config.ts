/**
 * Workspace configuration, read from the environment once.
 *
 * The whole surface is optional: a deployment without these vars simply has no
 * Arbeitsbereich, and the app ships unchanged. That is the same config-gating
 * the workspace tiles already use.
 */
export interface WorkspaceConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  wopiSecret: Uint8Array;
  nextcloudBaseUrl: string;
  nextcloudAdminUser: string;
  nextcloudAdminPassword: string;
  collaboraBaseUrl: string;
  appOrigin: string;
}

const REQUIRED = [
  "ROEBEL_ID_ISSUER",
  "WORKSPACE_CLIENT_ID",
  "WORKSPACE_CLIENT_SECRET",
  "WOPI_TOKEN_SECRET",
  "NEXTCLOUD_BASE_URL",
  "NEXTCLOUD_ADMIN_USER",
  "NEXTCLOUD_ADMIN_PASSWORD",
  "COLLABORA_BASE_URL",
  "NEXT_PUBLIC_APP_ORIGIN",
] as const;

export function isWorkspaceEnabled(): boolean {
  return REQUIRED.every((name) => (process.env[name] ?? "").length > 0);
}

export function workspaceConfig(): WorkspaceConfig {
  const missing = REQUIRED.filter((name) => !(process.env[name] ?? "").length);
  if (missing.length) {
    throw new Error(`workspace is not configured: missing ${missing.join(", ")}`);
  }
  return {
    issuer: process.env.ROEBEL_ID_ISSUER!,
    clientId: process.env.WORKSPACE_CLIENT_ID!,
    clientSecret: process.env.WORKSPACE_CLIENT_SECRET!,
    wopiSecret: new Uint8Array(Buffer.from(process.env.WOPI_TOKEN_SECRET!, "base64")),
    nextcloudBaseUrl: process.env.NEXTCLOUD_BASE_URL!,
    nextcloudAdminUser: process.env.NEXTCLOUD_ADMIN_USER!,
    nextcloudAdminPassword: process.env.NEXTCLOUD_ADMIN_PASSWORD!,
    collaboraBaseUrl: process.env.COLLABORA_BASE_URL!,
    appOrigin: process.env.NEXT_PUBLIC_APP_ORIGIN!,
  };
}
