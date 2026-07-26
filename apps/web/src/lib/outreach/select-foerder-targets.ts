// Pure selection for proactive Fördermittel outreach: which org accounts get a
// one-time "there might be funding for you" invite. Eligibility + opt-out +
// dedupe, no I/O. Parallel to select-targets.ts (story outreach) but keyed on
// the funding opt-in flag — kept separate so the shipped story path is untouched.

export type FoerderSubType = "verein" | "unternehmen" | "restaurant" | "stadt";
const ELIGIBLE_SUB_TYPES: FoerderSubType[] = ["verein", "unternehmen", "restaurant", "stadt"];

export interface FoerderCandidate {
  id: string;
  account_type: string; // 'organisation' | 'personal'
  sub_type: string | null;
  foerder_outreach_opt_in: boolean | null; // default-on: null/true → eligible
}

/**
 * Targets = organisation accounts with a funding-eligible sub_type, not opted
 * out (opt_in !== false), and not already invited for funding.
 */
export function selectFoerderTargets(
  candidates: FoerderCandidate[],
  alreadyInvited: Set<string>,
): string[] {
  return candidates
    .filter((c) => c.account_type === "organisation")
    .filter((c) => c.sub_type != null && (ELIGIBLE_SUB_TYPES as string[]).includes(c.sub_type))
    .filter((c) => c.foerder_outreach_opt_in !== false)
    .filter((c) => !alreadyInvited.has(c.id))
    .map((c) => c.id);
}
