export const IN_CLUSTER_TRACER_POSTGREST_ORIGIN =
  "http://roebel-tracer-postgrest.stadtstack-roebel-staging-lab.svc.cluster.local:3000";

export type RestrictedPostgrestOrigin = Readonly<{
  base: URL;
  directPostgrest: boolean;
}>;

/**
 * Managed Supabase remains HTTPS. The sole HTTP exception is the exact
 * namespace-local, NetworkPolicy-bound tracer service; it never crosses the
 * cluster ingress or carries browser traffic.
 */
export function parseRestrictedPostgrestOrigin(
  value: string
): RestrictedPostgrestOrigin | null {
  let base: URL;
  try {
    base = new URL(value);
  } catch {
    return null;
  }
  if (
    base.username !== "" ||
    base.password !== "" ||
    base.pathname !== "/" ||
    base.search !== "" ||
    base.hash !== ""
  ) {
    return null;
  }
  if (base.origin === IN_CLUSTER_TRACER_POSTGREST_ORIGIN) {
    return { base, directPostgrest: true };
  }
  return base.protocol === "https:" ? { base, directPostgrest: false } : null;
}
