import { createAdminClient } from "@/lib/supabase/admin";
import type { MatchInput, FundingProgram, RankedMatch, OrgFundingProfile, FundingOrgSubType, ProgramEligibility } from "@/types/foerdermittel";
import type { MatchSources } from "./run-match";

const FUNDING_SUB_TYPES: FundingOrgSubType[] = ["verein", "unternehmen", "restaurant", "stadt"];

function normalizeEligibility(raw: unknown): ProgramEligibility {
  const e = (raw ?? {}) as Partial<ProgramEligibility>;
  return {
    legal_forms_allowed: e.legal_forms_allowed ?? [],
    gemeinnuetzig_required: e.gemeinnuetzig_required ?? false,
    min_members: e.min_members ?? null,
    max_members: e.max_members ?? null,
    region_scope: e.region_scope ?? [],
    project_types: e.project_types ?? [],
    cofinancing_required: e.cofinancing_required ?? false,
    min_years_established: e.min_years_established ?? null,
  };
}

export function createMatchSources(): MatchSources {
  const supabase = createAdminClient();
  return {
    async loadMatchInput(accountId: string): Promise<MatchInput | null> {
      const { data: profile } = await supabase
        .from("org_funding_profiles").select("*").eq("account_id", accountId).maybeSingle();
      if (!profile) return null;
      const { data: account } = await supabase
        .from("accounts").select("sub_type").eq("id", accountId).maybeSingle();
      const sub = (account?.sub_type ?? "verein") as string;
      const sub_type = (FUNDING_SUB_TYPES as string[]).includes(sub) ? (sub as FundingOrgSubType) : "verein";
      return {
        profile: profile as OrgFundingProfile,
        sub_type,
        current_year: new Date().getUTCFullYear(),
      };
    },
    async loadVerifiedPrograms(): Promise<FundingProgram[]> {
      const { data } = await supabase.from("funding_programs").select("*").eq("status", "verified");
      return ((data ?? []) as FundingProgram[]).map((p) => ({ ...p, eligibility: normalizeEligibility((p as { eligibility?: unknown }).eligibility) }));
    },
    async saveMatches(accountId: string, matches: RankedMatch[]): Promise<void> {
      // Refresh: drop prior auto-generated 'new' matches, keep user-touched states (saved/dismissed/applying).
      await supabase.from("org_funding_matches").delete().eq("account_id", accountId).eq("status", "new");
      if (matches.length === 0) return;
      const rows = matches.map((m) => ({
        account_id: accountId, program_id: m.program_id, score: m.score,
        probability_band: m.probability_band, rationale: m.rationale, requirements: m.requirements,
        red_flags: m.red_flags, collapsed: m.collapsed, status: "new",
      }));
      await supabase.from("org_funding_matches")
        .upsert(rows, { onConflict: "account_id,program_id", ignoreDuplicates: true });
    },
  };
}
