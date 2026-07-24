import type { FundingProgram, MatchInput } from "@/types/foerdermittel";

export interface EligibilityResult {
  program: FundingProgram;
  eligible: boolean;
  failed_rules: string[];
}

// Region tokens that count as always-eligible regardless of the org's location.
const NATIONAL_TOKENS = ["bundesweit", "deutschlandweit", "eu", "europaweit"];
// Tokens that describe Röbel's location; a program's region_scope must intersect these.
const LOCAL_TOKENS = [
  "mv", "mecklenburg-vorpommern", "mecklenburg vorpommern",
  "landkreis mse", "mecklenburgische seenplatte", "müritz", "muritz", "röbel", "roebel",
];

function regionEligible(scope: string[]): boolean {
  if (scope.length === 0) return true;
  const lower = scope.map((s) => s.toLowerCase().trim());
  if (lower.some((s) => NATIONAL_TOKENS.includes(s))) return true;
  return lower.some((s) => LOCAL_TOKENS.some((loc) => s.includes(loc) || loc.includes(s)));
}

export function filterEligiblePrograms(input: MatchInput, programs: FundingProgram[]): EligibilityResult[] {
  const { profile, sub_type, current_year } = input;
  return programs.map((program) => {
    const e = program.eligibility;
    const failed: string[] = [];

    if (program.target_sub_types.length > 0 && !program.target_sub_types.includes(sub_type)) {
      failed.push(`Organisationsart ${sub_type} nicht förderfähig`);
    }
    if (e.legal_forms_allowed.length > 0 && profile.legal_form !== "unbekannt"
        && !e.legal_forms_allowed.includes(profile.legal_form)) {
      failed.push(`Rechtsform ${profile.legal_form} nicht zugelassen`);
    }
    if (e.gemeinnuetzig_required && profile.is_gemeinnuetzig === false) {
      failed.push("Gemeinnützigkeit erforderlich");
    }
    if (!regionEligible(e.region_scope)) {
      failed.push("Region nicht im Fördergebiet");
    }
    if (e.min_members !== null && profile.member_count !== null && profile.member_count < e.min_members) {
      failed.push(`Mindestens ${e.min_members} Mitglieder erforderlich`);
    }
    if (e.max_members !== null && profile.member_count !== null && profile.member_count > e.max_members) {
      failed.push(`Höchstens ${e.max_members} Mitglieder zulässig`);
    }
    if (e.min_years_established !== null && profile.founded_year !== null
        && current_year - profile.founded_year < e.min_years_established) {
      failed.push(`Organisation muss mindestens ${e.min_years_established} Jahre bestehen`);
    }

    return { program, eligible: failed.length === 0, failed_rules: failed };
  });
}
