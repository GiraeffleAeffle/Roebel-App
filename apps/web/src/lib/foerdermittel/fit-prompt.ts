import type { MatchInput, FundingProgram } from "@/types/foerdermittel";

export const FIT_SYSTEM_PROMPT = [
  "Du bist Meckys Fördermittel-Experte für Röbel/Müritz.",
  "Bewerte ehrlich, ob diese Organisation realistisch Chancen auf dieses Förderprogramm hat.",
  "Sei nüchtern: lieber 'niedrig' als falsche Hoffnung. Erfinde niemals Bedingungen, Fristen oder Summen.",
  "Stütze dich NUR auf die angegebenen Programmdaten und die Organisationsdaten.",
  "Antworte mit: probability_band (hoch|mittel|niedrig), score 0-100, rationale (warum es passt/nicht passt),",
  "requirements (was die Organisation für die Bewerbung braucht) und red_flags (Ausschlussrisiken).",
].join(" ");

export function buildFitPrompt(input: MatchInput, program: FundingProgram): string {
  const { profile, sub_type, current_year } = input;
  const e = program.eligibility;
  return [
    "## Organisation",
    `Art: ${sub_type}`,
    `Rechtsform: ${profile.legal_form}`,
    `Gemeinnützig: ${profile.is_gemeinnuetzig === null ? "unbekannt" : profile.is_gemeinnuetzig ? "ja" : "nein"}`,
    `Gegründet: ${profile.founded_year ?? "unbekannt"} (aktuelles Jahr: ${current_year})`,
    `Mitglieder: ${profile.member_count ?? "unbekannt"}`,
    `Jahresbudget: ${profile.budget_band}`,
    `Region: ${profile.region}`,
    `Themen: ${profile.sector_tags.join(", ") || "—"}`,
    `Vorhaben/Bedarf: ${profile.project_needs || "—"}`,
    `Ziele: ${profile.goals || "—"}`,
    "",
    "## Förderprogramm",
    `Name: ${program.name} (${program.provider})`,
    `Kurzbeschreibung: ${program.summary}`,
    `Zielgruppen: ${program.target_sub_types.join(", ") || "alle"}`,
    `Themen: ${program.sector_tags.join(", ") || "—"}`,
    `Rechtsformen zugelassen: ${e.legal_forms_allowed.join(", ") || "alle"}`,
    `Gemeinnützigkeit erforderlich: ${e.gemeinnuetzig_required ? "ja" : "nein"}`,
    `Region: ${e.region_scope.join(", ") || "—"}`,
    `Kofinanzierung nötig: ${e.cofinancing_required ? "ja" : "nein"}`,
    `Fördersumme: ${program.amount_min ?? "?"}–${program.amount_max ?? "?"} EUR`,
    `Frist: ${program.deadline ?? "unbekannt"} (${program.deadline_type})`,
    `Quelle: ${program.source_url}`,
    "",
    "Bewerte die Passung ehrlich (hoch/mittel/niedrig) und begründe kurz.",
  ].join("\n");
}
