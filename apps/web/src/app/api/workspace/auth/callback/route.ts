import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { workspaceConfig } from "@/lib/workspace/config";
import { exchangeCode, verifyIdToken } from "@/lib/workspace/oidc";
import { newSessionId } from "@/lib/workspace/session";
import { createSessionStore } from "@/lib/workspace/session-store";
import { safeReturnTo } from "@/lib/workspace/return-to";
import { SESSION_COOKIE } from "@/lib/workspace/context";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const cfg = workspaceConfig();
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const jar = await cookies();
  const verifier = jar.get("roebel_ws_verifier")?.value;
  const expectedState = jar.get("roebel_ws_state")?.value;
  const returnTo = safeReturnTo(jar.get("roebel_ws_return")?.value ?? null);

  if (!code || !verifier || !state || state !== expectedState) {
    return NextResponse.redirect(`${cfg.appOrigin}/arbeitsbereich?fehler=anmeldung`);
  }

  // Claims come from verifyIdToken, which checks the signature against the
  // keystone's JWKS plus issuer and audience — never from an unverified
  // parse of the token.
  const tokens = await exchangeCode({
    issuer: cfg.issuer,
    clientId: cfg.clientId,
    clientSecret: cfg.clientSecret,
    code,
    redirectUri: `${cfg.appOrigin}/api/workspace/auth/callback`,
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

  const response = NextResponse.redirect(`${cfg.appOrigin}${returnTo}`);
  response.cookies.set(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 14,
  });
  for (const name of ["roebel_ws_verifier", "roebel_ws_state", "roebel_ws_return"]) {
    response.cookies.delete(name);
  }
  return response;
}
