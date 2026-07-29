import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { workspaceConfig, type WorkspaceConfig } from "@/lib/workspace/config";
import { exchangeCode, verifyIdToken } from "@/lib/workspace/oidc";
import { newSessionId } from "@/lib/workspace/session";
import { createSessionStore } from "@/lib/workspace/session-store";
import { safeReturnTo } from "@/lib/workspace/return-to";
import { SESSION_COOKIE } from "@/lib/workspace/context";
import { withWorkspaceRoute } from "@/lib/workspace/request";
import { resolveRequestOrigin } from "@/lib/workspace/origin";

export const dynamic = "force-dynamic";

const PKCE_COOKIES = [
  "roebel_ws_verifier",
  "roebel_ws_state",
  "roebel_ws_return",
  "roebel_ws_origin",
];

/**
 * The one failure response for this route. A missing/mismatched state, a
 * rejected code exchange (e.g. a replayed code — the citizen hit back or
 * refreshed), a JWKS/signature/issuer/audience failure, or a session-store
 * write failure all land here rather than a bare framework 500. It always
 * clears the three short-lived PKCE cookies too, so a failed attempt does
 * not leave them sitting around for their full 10-minute TTL after the flow
 * that needed them has already ended.
 */
function loginFailed(cfg: WorkspaceConfig, origin?: string): NextResponse {
  const response = NextResponse.redirect(
    `${origin ?? cfg.appOrigin}/arbeitsbereich?fehler=anmeldung`,
  );
  for (const name of PKCE_COOKIES) {
    response.cookies.delete(name);
  }
  return response;
}

export const GET = withWorkspaceRoute(async (request: Request) => {
  const cfg = workspaceConfig();
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const jar = await cookies();
  const verifier = jar.get("roebel_ws_verifier")?.value;
  const expectedState = jar.get("roebel_ws_state")?.value;
  const returnTo = safeReturnTo(jar.get("roebel_ws_return")?.value ?? null);
  // The origin login pinned. Falling back to this request's own origin keeps a
  // half-expired flow on the host the citizen is on rather than throwing them
  // across hosts mid-login.
  const origin =
    jar.get("roebel_ws_origin")?.value ||
    resolveRequestOrigin(request.url, cfg.allowedOrigins, cfg.appOrigin);

  if (!code || !verifier || !state || state !== expectedState) {
    return loginFailed(cfg, origin);
  }

  try {
    // Claims come from verifyIdToken, which checks the signature against the
    // keystone's JWKS plus issuer and audience — never from an unverified
    // parse of the token.
    const tokens = await exchangeCode({
      issuer: cfg.issuer,
      clientId: cfg.clientId,
      clientSecret: cfg.clientSecret,
      code,
      redirectUri: `${origin}/api/workspace/auth/callback`,
      codeVerifier: verifier,
    });
    const { sub, groups } = await verifyIdToken(
      tokens.id_token,
      cfg.issuer,
      cfg.clientId,
    );

    // The tokens go to Postgres; the cookie gets only this id.
    const sessionId = newSessionId();
    await createSessionStore().create(sessionId, {
      sub,
      groups,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? null,
      expiresAt: Date.now() + tokens.expires_in * 1000,
    });

    // Same origin the session cookie is about to be set on. Sending the
    // citizen to a different host here would hand them a page with no session
    // — the cookie is host-only — and bounce them straight back to a 401.
    const response = NextResponse.redirect(`${origin}${returnTo}`);
    response.cookies.set(SESSION_COOKIE, sessionId, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 14,
    });
    for (const name of PKCE_COOKIES) {
      response.cookies.delete(name);
    }
    return response;
  } catch (err) {
    // exchangeCode throws on any non-2xx from the keystone's /token (e.g. a
    // replayed or expired code); verifyIdToken throws on a JWKS fetch
    // failure or a signature/issuer/audience/clock-skew rejection;
    // createSessionStore().create() can throw on a Postgres write failure.
    // None of that is safe to put in a redirect — it goes to the server log
    // instead, and the citizen gets the same friendly retry as any other
    // failed login.
    console.error("workspace auth callback failed", err);
    return loginFailed(cfg, origin);
  }
});
