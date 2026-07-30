import { createRemoteJWKSet, jwtVerify } from "jose";

/** Scopes the keystone declares; `roebel` is what carries the groups claim. */
export const WORKSPACE_SCOPES = "openid profile email roebel";

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  id_token: string;
}

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

/** PKCE S256 pair. The verifier stays in a short-lived cookie, never in a URL. */
export async function createPkcePair(): Promise<{
  verifier: string;
  challenge: string;
}> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return { verifier, challenge: base64url(new Uint8Array(digest)) };
}

export function buildAuthorizationUrl(params: {
  issuer: string;
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const url = new URL("/auth", params.issuer);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("scope", WORKSPACE_SCOPES);
  url.searchParams.set("state", params.state);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

async function postToken(
  issuer: string,
  clientId: string,
  clientSecret: string,
  form: Record<string, string>,
): Promise<TokenResponse> {
  const res = await fetch(new URL("/token", issuer), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    },
    body: new URLSearchParams(form).toString(),
  });
  if (!res.ok) {
    throw new Error(`token endpoint returned ${res.status}`);
  }
  return (await res.json()) as TokenResponse;
}

export async function exchangeCode(params: {
  issuer: string;
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<TokenResponse> {
  return postToken(params.issuer, params.clientId, params.clientSecret, {
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: params.redirectUri,
    code_verifier: params.codeVerifier,
  });
}

export async function refreshTokens(params: {
  issuer: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<TokenResponse> {
  return postToken(params.issuer, params.clientId, params.clientSecret, {
    grant_type: "refresh_token",
    refresh_token: params.refreshToken,
  });
}

// Cached across requests: the keystone's key set changes on rotation, not per
// login, and createRemoteJWKSet handles the refresh itself.
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

/**
 * Verify the id_token against the keystone's published keys and read its
 * claims.
 *
 * This token arrives from the token endpoint over TLS under client
 * authentication, so the signature check is belt-and-braces. It is here anyway
 * because the alternative is an unverified-JWT parser sitting in the codebase
 * for someone to reuse somewhere the reasoning does not hold.
 *
 * The path is `/jwks` — confirmed against this repo's own keystone
 * (apps/roebel-id): its oidc-provider Configuration sets no `routes`
 * override, so the library default (`oidc-provider/lib/helpers/defaults.js`
 * -> routes.jwks = '/jwks') applies, and the provider is mounted at the
 * issuer root (apps/roebel-id/src/app.ts), giving `<issuer>/jwks`.
 */
export async function verifyIdToken(
  idToken: string,
  issuer: string,
  clientId: string,
): Promise<{ sub: string; groups: string[] }> {
  if (!jwks) jwks = createRemoteJWKSet(new URL("/jwks", issuer));
  const { payload } = await jwtVerify(idToken, jwks, {
    issuer,
    audience: clientId,
  });

  const sub = payload.sub;
  if (typeof sub !== "string" || sub.length === 0) {
    throw new Error("id_token has no sub");
  }

  return { sub, groups: groupsFrom(payload as Record<string, unknown>) };
}

/**
 * Read the `groups` claim, which the keystone may emit as an array or as a
 * space-delimited string.
 */
export function groupsFrom(payload: Record<string, unknown>): string[] {
  const raw = payload.groups;
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === "string") return raw.split(" ").filter(Boolean);
  return [];
}

/**
 * Fetch the claims the ID Token does not carry.
 *
 * The keystone declares `groups` under the `roebel` SCOPE, and panva's
 * `oidc-provider` defaults `conformIdTokenClaims: true` — so whenever an access
 * token is issued (which the authorization-code flow always does), the ID Token
 * carries only `sub` and the scoped claims are served from userinfo instead.
 *
 * `groups` is the entire ACL for this workspace: without it every citizen looks
 * like a non-citizen and the personal surface 403s. That is exactly what
 * happened in production, and the symptom — a successful login followed by "no
 * access" — points at the gate rather than at the token, which is why it is
 * worth the comment.
 *
 * Kept as a fallback rather than the primary source: if the keystone is ever
 * configured with `conformIdTokenClaims: false`, the ID Token carries the
 * claims and this request never happens.
 */
export async function fetchUserinfo(
  issuer: string,
  accessToken: string,
): Promise<Record<string, unknown>> {
  const res = await fetch(new URL("/me", issuer), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`userinfo returned ${res.status}`);
  }
  return (await res.json()) as Record<string, unknown>;
}
