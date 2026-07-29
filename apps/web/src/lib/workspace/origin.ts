/**
 * Which origin the OIDC round trip must use.
 *
 * The PKCE cookies are host-only: they are set on whatever host served
 * /api/workspace/auth/login, and they are only sent back to that same host. So
 * if the redirect_uri names a DIFFERENT host, the callback runs somewhere the
 * cookies are invisible, the state check fails, and the citizen gets
 * ?fehler=anmeldung forever — with no signal that the cause is a hostname.
 *
 * This bit us in both directions on the same deployment: apex configured while
 * the citizen browsed www, then www configured while the citizen browsed apex.
 * Pinning a single configured origin cannot fix that, because which host the
 * citizen is on is not ours to decide — `roebel.app` and `www.roebel.app` both
 * resolve, and a link, a bookmark or a typed URL can land on either.
 *
 * So: derive the origin from the REQUEST, and keep the configured origin as the
 * fallback. The request's host is attacker-influenced (it is just a header), so
 * it is honoured only when it appears in an explicit allow-list — otherwise an
 * attacker could point the callback at a host they control and harvest an
 * authorization code. Anything unrecognised falls back to the configured
 * origin, which is always safe because it is the one the operator set.
 */

/** Build the allow-list: the configured origin, plus any explicit extras. */
export function allowedOrigins(
  appOrigin: string,
  extra: string | undefined | null,
): string[] {
  const list = [normaliseOrigin(appOrigin)];
  for (const raw of (extra ?? "").split(",")) {
    const origin = normaliseOrigin(raw);
    if (origin && !list.includes(origin)) list.push(origin);
  }
  return list.filter(Boolean);
}

/** Scheme + host only, no trailing slash, no path. */
function normaliseOrigin(raw: string): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "";
  try {
    return new URL(trimmed).origin;
  } catch {
    return "";
  }
}

/**
 * The origin to use for this request's redirect_uri and cookies.
 *
 * Returns the request's own origin when it is allow-listed, so the cookies and
 * the callback always land on the same host. Falls back to the configured
 * origin for anything else.
 */
export function resolveRequestOrigin(
  requestUrl: string,
  allowed: string[],
  fallback: string,
): string {
  let origin: string;
  try {
    origin = new URL(requestUrl).origin;
  } catch {
    return fallback;
  }
  return allowed.includes(origin) ? origin : fallback;
}
