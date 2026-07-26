// Org funding-profile helpers: the editable form shape, a pure completeness
// computer (drives whether the matching engine will run — minCompleteness=40),
// and German option/label maps shared by the dashboard panel.
//
// Kept free of Date/Supabase so `computeCompleteness` is unit-testable in
// isolation (node:test, no mocking — the repo convention).

import type {
  LegalForm,
  BudgetBand,
  OrgFundingProfile,
} from "@/types/foerdermittel";

/** The subset of `org_funding_profiles` an owner edits in the dashboard form. */
export interface ProfileFormInput {
  legal_form: LegalForm;
  is_gemeinnuetzig: boolean | null;
  founded_year: number | null;
  member_count: number | null;
  budget_band: BudgetBand;
  sector_tags: string[];
  project_needs: string;
  goals: string;
  region: string;
}

export const DEFAULT_REGION = "Röbel / Landkreis Mecklenburgische Seenplatte";

/** A blank form for a brand-new profile. */
export function emptyProfileForm(): ProfileFormInput {
  return {
    legal_form: "unbekannt",
    is_gemeinnuetzig: null,
    founded_year: null,
    member_count: null,
    budget_band: "unbekannt",
    sector_tags: [],
    project_needs: "",
    goals: "",
    region: DEFAULT_REGION,
  };
}

/**
 * 0–100 completeness. Weighted toward the fields the deep-fit reasoning (Opus)
 * actually needs — the project narrative dominates. Filling `project_needs` +
 * a real `legal_form` already clears the 40-point matching threshold, so an org
 * that describes its need and picks its legal form can match immediately.
 */
export function computeCompleteness(input: Partial<ProfileFormInput>): number {
  let score = 0;
  const needs = (input.project_needs ?? "").trim();
  if (needs.length >= 20) score += 30;
  else if (needs.length > 0) score += 15;

  if (input.legal_form && input.legal_form !== "unbekannt") score += 15;
  if (input.sector_tags && input.sector_tags.length > 0) score += 15;
  if (input.is_gemeinnuetzig !== null && input.is_gemeinnuetzig !== undefined) score += 10;
  if (input.budget_band && input.budget_band !== "unbekannt") score += 10;
  if ((input.goals ?? "").trim().length > 0) score += 10;
  if (input.founded_year != null) score += 5;
  if (input.member_count != null) score += 5;

  return Math.min(100, score);
}

/** German labels for the form selects. */
export const LEGAL_FORM_LABELS: Record<LegalForm, string> = {
  ev: "Eingetragener Verein (e.V.)",
  ggmbh: "Gemeinnützige GmbH (gGmbH)",
  gmbh: "GmbH",
  ug: "Unternehmergesellschaft (UG)",
  gbr: "GbR",
  einzelunternehmen: "Einzelunternehmen",
  sonstiges: "Sonstige Rechtsform",
  unbekannt: "Noch unbekannt",
};

export const BUDGET_BAND_LABELS: Record<BudgetBand, string> = {
  unter_5k: "unter 5.000 €",
  "5k_25k": "5.000 – 25.000 €",
  "25k_100k": "25.000 – 100.000 €",
  ueber_100k: "über 100.000 €",
  unbekannt: "Noch unbekannt",
};

export const LEGAL_FORM_OPTIONS: LegalForm[] = [
  "ev",
  "ggmbh",
  "gmbh",
  "ug",
  "gbr",
  "einzelunternehmen",
  "sonstiges",
  "unbekannt",
];

export const BUDGET_BAND_OPTIONS: BudgetBand[] = [
  "unter_5k",
  "5k_25k",
  "25k_100k",
  "ueber_100k",
  "unbekannt",
];

/** Curated sector tags (value = stored tag, label = German display). */
export const SECTOR_TAG_OPTIONS: { value: string; label: string }[] = [
  { value: "kultur", label: "Kultur" },
  { value: "sport", label: "Sport" },
  { value: "soziales", label: "Soziales" },
  { value: "umwelt", label: "Umwelt & Natur" },
  { value: "jugend", label: "Kinder & Jugend" },
  { value: "senioren", label: "Senior:innen" },
  { value: "bildung", label: "Bildung" },
  { value: "digitalisierung", label: "Digitalisierung" },
  { value: "integration", label: "Integration" },
  { value: "ehrenamt", label: "Ehrenamt" },
  { value: "gesundheit", label: "Gesundheit" },
  { value: "wirtschaft", label: "Wirtschaft & Gründung" },
  { value: "tourismus", label: "Tourismus" },
  { value: "brauchtum", label: "Brauchtum & Heimat" },
];

export function sectorTagLabel(value: string): string {
  return SECTOR_TAG_OPTIONS.find((t) => t.value === value)?.label ?? value;
}

/** Map a stored DB profile row into the editable form shape (fills gaps). */
export function profileToForm(profile: OrgFundingProfile | null): ProfileFormInput {
  if (!profile) return emptyProfileForm();
  return {
    legal_form: profile.legal_form ?? "unbekannt",
    is_gemeinnuetzig: profile.is_gemeinnuetzig ?? null,
    founded_year: profile.founded_year ?? null,
    member_count: profile.member_count ?? null,
    budget_band: profile.budget_band ?? "unbekannt",
    sector_tags: profile.sector_tags ?? [],
    project_needs: profile.project_needs ?? "",
    goals: profile.goals ?? "",
    region: profile.region || DEFAULT_REGION,
  };
}
