import type { FundingProgram, MatchInput, FitResult, RankedMatch, ProbabilityBand } from "@/types/foerdermittel";

export type GenerateFit = (input: MatchInput, program: FundingProgram) => Promise<FitResult>;

const BAND_RANK: Record<ProbabilityBand, number> = { hoch: 3, mittel: 2, niedrig: 1 };

export async function rankMatches(
  input: MatchInput,
  eligible: FundingProgram[],
  deps: { generateFit: GenerateFit },
): Promise<RankedMatch[]> {
  const matches: RankedMatch[] = [];
  for (const program of eligible) {
    const fit = await deps.generateFit(input, program);
    matches.push({
      ...fit,
      program_id: program.id,
      program_name: program.name,
      source_url: program.source_url,
      deadline: program.deadline,
      amount_min: program.amount_min,
      amount_max: program.amount_max,
      collapsed: fit.probability_band === "niedrig",
    });
  }
  matches.sort((a, b) => {
    const byBand = BAND_RANK[b.probability_band] - BAND_RANK[a.probability_band];
    return byBand !== 0 ? byBand : b.score - a.score;
  });
  return matches;
}
