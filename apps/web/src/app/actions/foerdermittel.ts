"use server";

import { createClient } from "@/lib/supabase/server";
import { createMatchSources } from "@/lib/foerdermittel/sources";
import { runFundingMatch } from "@/lib/foerdermittel/run-match";
import { generateFitWithClaude } from "@/lib/foerdermittel/fit-generator";
import type { RankedMatch } from "@/types/foerdermittel";

export async function runFundingMatchAction(
  accountId: string,
  walletAddress: string,
): Promise<{ success: boolean; error?: string; matches?: RankedMatch[] }> {
  try {
    const supabase = await createClient();
    const { data: owner } = await supabase
      .from("account_owners").select("role")
      .eq("account_id", accountId).eq("wallet_address", walletAddress.toLowerCase()).maybeSingle();
    if (!owner) return { success: false, error: "Keine Berechtigung für diese Organisation" };

    const result = await runFundingMatch(accountId, {
      ...createMatchSources(),
      generateFit: generateFitWithClaude,
    });
    if (!result.ok) {
      const error = result.reason === "no_profile"
        ? "Bitte zuerst das Förderprofil ausfüllen."
        : "Das Förderprofil ist noch zu unvollständig für einen Abgleich.";
      return { success: false, error };
    }
    return { success: true, matches: result.matches };
  } catch (error) {
    console.error("runFundingMatchAction failed", error);
    return { success: false, error: "Der Förderabgleich ist fehlgeschlagen." };
  }
}
