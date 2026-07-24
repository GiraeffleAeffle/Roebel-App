import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import type { MatchInput, FundingProgram, FitResult } from "@/types/foerdermittel";
import type { GenerateFit } from "./matching";
import { buildFitPrompt, FIT_SYSTEM_PROMPT } from "./fit-prompt";

// NOTE: no .min()/.max() on the number field — @ai-sdk/anthropic rejects integer minimum/maximum (400). Clamp below.
const FitSchema = z.object({
  probability_band: z.enum(["hoch", "mittel", "niedrig"]),
  score: z.number().describe("0 bis 100"),
  rationale: z.string(),
  requirements: z.string(),
  red_flags: z.string(),
});

export const generateFitWithClaude: GenerateFit = async (
  input: MatchInput,
  program: FundingProgram,
): Promise<FitResult> => {
  const { object } = await generateObject({
    model: anthropic("claude-opus-4-8"),
    schema: FitSchema,
    system: FIT_SYSTEM_PROMPT,
    prompt: buildFitPrompt(input, program),
  });
  const score = Math.max(0, Math.min(100, Math.round(object.score)));
  return { ...object, score };
};
