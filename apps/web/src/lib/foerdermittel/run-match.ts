import type { MatchInput, FundingProgram, RankedMatch } from "@/types/foerdermittel";
import { filterEligiblePrograms } from "./eligibility";
import { rankMatches, type GenerateFit } from "./matching";

export interface MatchSources {
  loadMatchInput(accountId: string): Promise<MatchInput | null>;
  loadVerifiedPrograms(): Promise<FundingProgram[]>;
  saveMatches(accountId: string, matches: RankedMatch[]): Promise<void>;
}

export interface RunMatchResult {
  ok: boolean;
  reason?: "no_profile" | "incomplete_profile";
  matches: RankedMatch[];
}

export async function runFundingMatch(
  accountId: string,
  deps: MatchSources & { generateFit: GenerateFit; minCompleteness?: number },
): Promise<RunMatchResult> {
  const minCompleteness = deps.minCompleteness ?? 40;
  const input = await deps.loadMatchInput(accountId);
  if (!input) return { ok: false, reason: "no_profile", matches: [] };
  if (input.profile.profile_completeness < minCompleteness) {
    return { ok: false, reason: "incomplete_profile", matches: [] };
  }
  const programs = await deps.loadVerifiedPrograms();
  const eligible = filterEligiblePrograms(input, programs)
    .filter((r) => r.eligible)
    .map((r) => r.program);
  const matches = await rankMatches(input, eligible, { generateFit: deps.generateFit });
  await deps.saveMatches(accountId, matches);
  return { ok: true, matches };
}
