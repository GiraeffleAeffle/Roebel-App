import type { UserTier } from "@/types/account";

/** Which dashboard sections a given tier is allowed to see. */
export interface DashboardFeatures {
  identity: boolean;
  memberships: boolean;
  copilot: boolean;
  civic: boolean;
  workspace: boolean;
}

/**
 * Single source of truth for which citizen-dashboard sections each tier sees.
 * Citizen analog of `subTypeFeatures(sub_type)` in `@/types/account`.
 * Citizens see everything; tourists and guests see nothing (the page shows
 * them a graceful "citizen-only" prompt instead).
 */
export function dashboardFeatures(tier: UserTier): DashboardFeatures {
  switch (tier) {
    case "citizen":
      return {
        identity: true,
        memberships: true,
        copilot: true,
        civic: true,
        workspace: true,
      };
    case "tourist":
    case "guest":
    default:
      return {
        identity: false,
        memberships: false,
        copilot: false,
        civic: false,
        workspace: false,
      };
  }
}
