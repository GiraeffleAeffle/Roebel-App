import { isExplicitStaging } from "./profile-write-boundary.mjs";

export const STADTSTACK_STAGING_LAB_PATH = "/stadtstack-test/" as const;

export type StadtstackStagingLab = {
  href: typeof STADTSTACK_STAGING_LAB_PATH;
  label: "Synthetischer Test";
};

/**
 * The workflow lab is intentionally opt-in at build time. Production builds
 * without the exact flag have no route or invitation into synthetic data.
 */
export function resolveStadtstackStagingLab(
  raw: string | undefined,
): StadtstackStagingLab | null {
  if (!isExplicitStaging(raw)) return null;
  return {
    href: STADTSTACK_STAGING_LAB_PATH,
    label: "Synthetischer Test",
  };
}
