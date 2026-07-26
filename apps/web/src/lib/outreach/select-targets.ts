// Pure selection for proactive story-outreach: which org accounts get a one-time
// "tell your story" invite. Eligibility + opt-out + dedupe, no I/O.

export type OutreachSubType = "verein" | "unternehmen" | "restaurant" | "stadt";
const ELIGIBLE_SUB_TYPES: OutreachSubType[] = ["verein", "unternehmen", "restaurant", "stadt"];

export interface OutreachCandidate {
  id: string;
  account_type: string; // 'organisation' | 'personal'
  sub_type: string | null;
  story_outreach_opt_in: boolean | null; // default-on: null/true → eligible
}

/**
 * Targets = organisation accounts with an eligible sub_type, not opted out
 * (opt_in !== false), and not already invited.
 */
export function selectOutreachTargets(
  candidates: OutreachCandidate[],
  alreadyInvited: Set<string>,
): string[] {
  return candidates
    .filter((c) => c.account_type === "organisation")
    .filter((c) => c.sub_type != null && (ELIGIBLE_SUB_TYPES as string[]).includes(c.sub_type))
    .filter((c) => c.story_outreach_opt_in !== false)
    .filter((c) => !alreadyInvited.has(c.id))
    .map((c) => c.id);
}
