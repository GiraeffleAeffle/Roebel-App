// Hand-written domain types for the Fördermittel Agent (no generated DB types in this repo).

export type FundingLevel = "eu" | "bund" | "land" | "landkreis" | "lag" | "stiftung" | "kommune" | "sonstiges";
export type LegalForm = "ev" | "gmbh" | "ggmbh" | "gbr" | "ug" | "einzelunternehmen" | "sonstiges" | "unbekannt";
export type BudgetBand = "unter_5k" | "5k_25k" | "25k_100k" | "ueber_100k" | "unbekannt";
export type ProbabilityBand = "hoch" | "mittel" | "niedrig";
export type ProgramStatus = "curated" | "proposed" | "verified" | "archived";
export type ProgramOrigin = "curated" | "research_agent";
export type Confidence = "high" | "medium" | "low";
export type FundingOrgSubType = "verein" | "unternehmen" | "restaurant" | "stadt";
export type DeadlineType = "fixed" | "rolling" | "annual" | "unknown";
export type MatchStatus = "new" | "seen" | "saved" | "dismissed" | "applying";

export interface ProgramEligibility {
  legal_forms_allowed: LegalForm[]; // empty = any legal form
  gemeinnuetzig_required: boolean;
  min_members: number | null;
  max_members: number | null;
  region_scope: string[]; // e.g. ["bundesweit"] or ["MV", "Landkreis MSE"]
  project_types: string[];
  cofinancing_required: boolean;
  min_years_established: number | null;
}

export interface FundingProgram {
  id: string;
  name: string;
  provider: string;
  level: FundingLevel;
  summary: string;
  description: string;
  target_sub_types: FundingOrgSubType[];
  sector_tags: string[];
  eligibility: ProgramEligibility;
  amount_min: number | null;
  amount_max: number | null;
  funding_rate: string | null;
  deadline: string | null;
  deadline_type: DeadlineType;
  source_url: string;
  source_checked_at: string | null;
  status: ProgramStatus;
  confidence: Confidence;
  origin: ProgramOrigin;
  created_at: string;
  updated_at: string;
}

export interface OrgFundingProfile {
  account_id: string;
  legal_form: LegalForm;
  is_gemeinnuetzig: boolean | null;
  founded_year: number | null;
  member_count: number | null;
  budget_band: BudgetBand;
  sector_tags: string[];
  project_needs: string;
  goals: string;
  region: string;
  profile_completeness: number;
  last_interviewed_at: string | null;
}

/** What the matching engine consumes: the DB profile + the org's sub_type (from accounts) + an injected current year (keeps pure fns free of Date.now). */
export interface MatchInput {
  profile: OrgFundingProfile;
  sub_type: FundingOrgSubType;
  current_year: number;
}

export interface FitResult {
  probability_band: ProbabilityBand;
  score: number; // 0..100 (clamped in code, not schema)
  rationale: string;
  requirements: string;
  red_flags: string;
}

export interface RankedMatch extends FitResult {
  program_id: string;
  program_name: string;
  source_url: string;
  deadline: string | null;
  amount_min: number | null;
  amount_max: number | null;
  collapsed: boolean; // true for niedrig — surfaced collapsed, never hidden
}
