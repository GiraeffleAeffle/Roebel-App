export type CivicJourneyStageId =
  | "topic"
  | "discussion"
  | "mecky"
  | "proposal"
  | "adoption"
  | "case"
  | "administration"
  | "participation"
  | "decision"
  | "execution";

export type CivicJourneyStageState =
  | "complete"
  | "current"
  | "available"
  | "gated";

export type CivicJourneyStage = Readonly<{
  id: CivicJourneyStageId;
  label: string;
  state: CivicJourneyStageState;
  detail: string;
  authority: string;
}>;

export type CivicJourneyInput = Readonly<{
  sourcePostCount: number;
  discussionCount: number;
  meckyMentioned: boolean;
  meckyAnswered: boolean;
  proposalSigned: boolean;
  citizenAdoptionVerified: boolean;
  caseAdmitted: boolean;
  administrationStatus?:
    | "not_available"
    | "in_review"
    | "brief_current"
    | "brief_withdrawn";
  participationStatus?: "not_available" | "brief_ready" | "result_current";
}>;

export type CivicJourney = Readonly<{
  stages: readonly CivicJourneyStage[];
  currentStageId: CivicJourneyStageId | null;
  authorityBinding: "none";
}>;

function count(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

/**
 * Project one public navigation line without collapsing its records or
 * authority owners. Missing earlier receipts remain visible gaps; a later
 * public record never fabricates an earlier transition.
 */
export function projectCivicJourney(
  input: CivicJourneyInput
): CivicJourney | null {
  if (!count(input.sourcePostCount) || !count(input.discussionCount))
    return null;

  const administrationStatus = input.administrationStatus ?? "not_available";
  const participationStatus = input.participationStatus ?? "not_available";
  const administrationComplete = administrationStatus === "brief_current";
  const participationComplete = participationStatus === "result_current";

  let currentStageId: CivicJourneyStageId | null;
  if (input.discussionCount === 0) currentStageId = "discussion";
  else if (!input.meckyAnswered) currentStageId = "mecky";
  else if (!input.proposalSigned && !input.caseAdmitted)
    currentStageId = "proposal";
  else if (!input.citizenAdoptionVerified && !input.caseAdmitted)
    currentStageId = "adoption";
  else if (!input.caseAdmitted) currentStageId = "case";
  else if (!administrationComplete) currentStageId = "administration";
  else if (!participationComplete) currentStageId = "participation";
  else currentStageId = null;

  const state = (
    id: CivicJourneyStageId,
    complete: boolean,
    available: boolean
  ): CivicJourneyStageState => {
    if (complete) return "complete";
    if (currentStageId === id) return "current";
    return available ? "available" : "gated";
  };

  const stages: CivicJourneyStage[] = [
    {
      id: "topic",
      label: "Thema",
      state: "complete",
      detail:
        input.sourcePostCount > 0
          ? `${input.sourcePostCount} Quellbeitrag${input.sourcePostCount === 1 ? "" : "e"} bleibt eigenständig verknüpft.`
          : "Das Thema ist öffentlich; ein Quellbeitrag ist nicht projiziert.",
      authority: "öffentliche Projektion",
    },
    {
      id: "discussion",
      label: "Diskussion",
      state: state("discussion", input.discussionCount > 0, true),
      detail:
        input.discussionCount > 0
          ? `${input.discussionCount} signierte Diskussion${input.discussionCount === 1 ? "" : "en"}.`
          : "Eine Person startet die strukturierte Diskussion.",
      authority: "Bürger:innen",
    },
    {
      id: "mecky",
      label: "Mecky",
      state: state("mecky", input.meckyAnswered, input.discussionCount > 0),
      detail: input.meckyAnswered
        ? "Eine signierte, zitierte Antwort liegt vor."
        : input.meckyMentioned
          ? "Die Erwähnung wartet auf eine geprüfte Antwort."
          : "Mecky kann gezielt um Quellen und Einordnung gebeten werden.",
      authority: "Assistenz ohne Wirkung",
    },
    {
      id: "proposal",
      label: "Vorschlag",
      state: state(
        "proposal",
        input.proposalSigned,
        input.meckyAnswered && !input.caseAdmitted
      ),
      detail: input.proposalSigned
        ? "Ein Mensch hat den topic-gebundenen Entwurf signiert."
        : input.caseAdmitted
          ? "Der Fall ist gebunden; eine getrennte Vorschlagssignatur ist hier nicht öffentlich projiziert."
          : "Titel und Zusammenfassung brauchen eine eigene Signatur.",
      authority: "Vorschlagssignatur",
    },
    {
      id: "adoption",
      label: "Bürgerübernahme",
      state: state(
        "adoption",
        input.citizenAdoptionVerified,
        input.proposalSigned && !input.caseAdmitted
      ),
      detail: input.citizenAdoptionVerified
        ? "Bürger-Signatur, zum Übernahmezeitpunkt geprüfte Berechtigung und Ledger-Annahme sind öffentlich gebunden. Vor einer Case-Aufnahme wird die Berechtigung erneut aktuell geprüft."
        : input.caseAdmitted
          ? "Der Fall ist gebunden; ein eigener ADR-0023-Bürgernachweis ist hier nicht öffentlich projiziert."
          : "Eine berechtigte Bürgerperson muss den unveränderten Entwurf ausdrücklich übernehmen.",
      authority: "Bürger:in / Berechtigungsprüfer",
    },
    {
      id: "case",
      label: "CivicCase",
      state: state("case", input.caseAdmitted, input.citizenAdoptionVerified),
      detail: input.caseAdmitted
        ? "Die getrennte menschliche Aufnahme ist öffentlich gebunden."
        : "Nur ein autorisierter Mensch darf den append-only Fall aufnehmen.",
      authority: "Case Steward",
    },
    {
      id: "administration",
      label: "Verwaltung & Brief",
      state: state(
        "administration",
        administrationComplete,
        input.caseAdmitted
      ),
      detail:
        administrationStatus === "brief_current"
          ? "Geprüfte Fachantworten und ein aktueller Citizen Brief sind öffentlich."
          : administrationStatus === "brief_withdrawn"
            ? "Der bisherige Citizen Brief wurde sichtbar zurückgezogen; ein neuer Brief braucht erneut eine geprüfte Projektion."
            : administrationStatus === "in_review"
              ? "Öffentlich geprüfte Fachantworten werden zusammengeführt."
              : "Private openDesk-Arbeit wird erst nach öffentlicher Prüfung sichtbar.",
      authority: "Verwaltung / Review",
    },
    {
      id: "participation",
      label: "Mitmachen",
      state: state(
        "participation",
        participationComplete,
        administrationComplete
      ),
      detail:
        participationStatus === "result_current"
          ? "Ein geprüftes beratendes Meinungsbild ist veröffentlicht."
          : participationStatus === "brief_ready"
            ? "Der Citizen Brief ist sichtbar; die Beteiligung ist noch nicht geöffnet."
            : "Bereitschaft oder Ergebnis brauchen eine eigene geprüfte Projektion.",
      authority: "beratend, nicht bindend",
    },
    {
      id: "decision",
      label: "Beschluss",
      state: "gated",
      detail:
        "Ein formaler Beschluss braucht einen eigenen akzeptierten Vertrag.",
      authority: "Rat / Governance",
    },
    {
      id: "execution",
      label: "Budget & Umsetzung",
      state: "gated",
      detail: "Darstellung löst weder Auszahlung noch Ausführung aus.",
      authority: "Treasury / Ausführung",
    },
  ];

  return { stages, currentStageId, authorityBinding: "none" };
}
