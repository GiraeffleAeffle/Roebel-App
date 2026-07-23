import {
  StadtstackFederationError,
  type CivicActivityJournalEventV1,
} from "@roebel/stadtstack-federation-client";

export type MunicipalDecisionCaseFailureStatus =
  | "not_found"
  | "unavailable"
  | "invalid"
  | "withdrawn";

export function classifyMunicipalDecisionCaseFailure(
  error: unknown,
): MunicipalDecisionCaseFailureStatus {
  if (!(error instanceof StadtstackFederationError)) return "invalid";
  if (error.code === "not_found") return "not_found";
  if (error.code === "withdrawn") return "withdrawn";
  if (["network", "timeout", "http"].includes(error.code)) return "unavailable";
  return "invalid";
}

const activityDescriptionLabels: Record<
  CivicActivityJournalEventV1["descriptionCode"],
  string
> = {
  synthetic_case_registered: "Demo-Fall wurde im Stadtstack erfasst",
  synthetic_department_package_prepared:
    "Arbeitspaket für den Fachbereich wurde vorbereitet",
  synthetic_department_handoff_observed:
    "Synthetische Übergabe an den Fachbereich wurde protokolliert",
  synthetic_companion_run_started:
    "Öffentlicher Mecky-Lauf wurde gestartet",
  synthetic_companion_run_completed:
    "Mecky-Entwurf wurde zur menschlichen Prüfung bereitgestellt",
  synthetic_department_response_submitted:
    "Synthetische Fachantwort wurde eingereicht",
  synthetic_response_review_approved:
    "Öffentliche Kurzantwort wurde unabhängig geprüft",
  synthetic_public_return_recorded:
    "Geprüfter Demo-Status wurde für die Röbel-App bereitgestellt",
};

const activityStatusLabels: Record<
  CivicActivityJournalEventV1["status"],
  string
> = {
  proposed: "vorgeschlagen",
  approved: "geprüft",
  running: "gestartet",
  succeeded: "abgeschlossen",
  observed: "protokolliert",
};

const activityActorLabels: Record<
  CivicActivityJournalEventV1["actor"]["roleCode"],
  string
> = {
  case_steward: "Fallkoordination",
  workspace_coordinator: "Verwaltungskoordination",
  department_receiver: "Fachbereich",
  evidence_reviewer: "Evidenzprüfung",
  publication_reviewer: "Veröffentlichungsprüfung",
  public_city_companion: "Mecky",
  journal_service: "Stadtstack-Journal",
};

export function presentActivityJournalEvent(
  event: Pick<
    CivicActivityJournalEventV1,
    "descriptionCode" | "status" | "actor"
  >,
) {
  return {
    description: activityDescriptionLabels[event.descriptionCode],
    status: activityStatusLabels[event.status],
    actor: activityActorLabels[event.actor.roleCode],
  };
}
