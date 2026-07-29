import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { workspaceConfig } from "@/lib/workspace/config";
import { buildAuthorizationUrl, createPkcePair } from "@/lib/workspace/oidc";
import { safeReturnTo } from "@/lib/workspace/return-to";
import { withWorkspaceRoute } from "@/lib/workspace/request";
import { resolveRequestOrigin } from "@/lib/workspace/origin";

export const dynamic = "force-dynamic";

/**
 * Start the OIDC hop. The verifier and the return target ride in short cookies.
 *
 * `withWorkspaceRoute` is doing real work here, not just consistency: this
 * route calls `workspaceConfig()` on its very first line, which THROWS when
 * the deployment has no workspace env vars. Uncaught in a Next route handler
 * that is a 500 — and it was reachable on merge day, because a 401 from any
 * files call sent the browser straight here. The gate turns that into a 503,
 * and `FileBrowser` now recognises 503 and never starts the hop at all.
 */
export const GET = withWorkspaceRoute(async (request: Request) => {
  const cfg = workspaceConfig();
  const returnTo = safeReturnTo(new URL(request.url).searchParams.get("returnTo"));
  const { verifier, challenge } = await createPkcePair();
  const state = crypto.randomUUID();

  // Follow the host the citizen is actually on. The PKCE cookies below are
  // host-only, so a redirect_uri naming a different host sends the callback
  // somewhere they are invisible — which is exactly how this failed in
  // production, in both directions (apex configured while browsing www, then
  // www configured while browsing apex).
  const origin = resolveRequestOrigin(request.url, cfg.allowedOrigins, cfg.appOrigin);

  const jar = await cookies();
  const options = {
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 600,
  };
  jar.set("roebel_ws_verifier", verifier, options);
  jar.set("roebel_ws_state", state, options);
  jar.set("roebel_ws_return", returnTo, options);
  // Pin the choice, so the callback exchanges the code against the SAME
  // redirect_uri the authorize request used. Matching is exact at the IdP.
  jar.set("roebel_ws_origin", origin, options);

  return NextResponse.redirect(
    buildAuthorizationUrl({
      issuer: cfg.issuer,
      clientId: cfg.clientId,
      redirectUri: `${origin}/api/workspace/auth/callback`,
      state,
      codeChallenge: challenge,
    }),
  );
});
