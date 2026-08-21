/**
 * A deliberately narrow build-time mode for the public Stadtstack preview.
 *
 * It is not enabled by the existing walkthrough flag alone: normal Röbel
 * Mini App builds may still use that flag to show the demo card alongside the
 * real Town/Economy/Governance experience. A public deployment must opt in
 * here as well, so it cannot accidentally acquire wallet, reward, treasury or
 * proposal surfaces through a configuration copy/paste.
 */
export const PUBLIC_DEMO_MODE_ENV =
  "NEXT_PUBLIC_STADTSTACK_PUBLIC_DEMO_MODE" as const;

export const MINIAPP_BASE_PATH_ENV =
  "NEXT_PUBLIC_MINIAPP_BASE_PATH" as const;

export type PublicDemoMode = "marienfelder";

export function resolvePublicDemoMode(
  value: string | null | undefined,
): PublicDemoMode | null {
  return value?.trim() === "marienfelder" ? "marienfelder" : null;
}

export function isMarienfelderPublicDemo(
  value: string | null | undefined,
): boolean {
  return resolvePublicDemoMode(value) === "marienfelder";
}

/**
 * Next's basePath must be a URL pathname. Invalid values fall back to the
 * normal root deployment rather than creating a partially reachable build.
 */
export function normalizeMiniAppBasePath(
  value: string | null | undefined,
): string | undefined {
  const trimmed = value?.trim() ?? "";
  if (!trimmed || trimmed === "/") return undefined;
  if (
    !trimmed.startsWith("/") ||
    trimmed.startsWith("//") ||
    trimmed.includes("?") ||
    trimmed.includes("#")
  ) {
    return undefined;
  }

  const normalized = trimmed.replace(/\/+$/, "");
  return normalized || undefined;
}

/** Build public-file URLs that remain valid when Next is deployed under a path. */
export function withMiniAppBasePath(
  path: string,
  basePath = normalizeMiniAppBasePath(
    process.env.NEXT_PUBLIC_MINIAPP_BASE_PATH,
  ),
): string {
  const pathname = path.startsWith("/") ? path : `/${path}`;
  return `${basePath ?? ""}${pathname}`;
}
