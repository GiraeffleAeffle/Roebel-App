import type { SyntheticCitizenBriefBinding, SyntheticCitizenBriefReturn } from "@roebel/stadtstack-federation-client";
import type { CivicJourney, CivicJourneyStageId } from "./civic-journey";

/** The verified test lane is visible without relabelling it as civic eligibility. */
export function projectSyntheticJourney(journey: CivicJourney, binding: SyntheticCitizenBriefBinding,
  returned: SyntheticCitizenBriefReturn | null): CivicJourney {
  const currentReturn = returned?.caseId === binding.caseId && returned.discussionId === binding.discussionId && returned.topicId === binding.topicId ? returned : null;
  const briefCurrent = currentReturn?.status === "current" && !!currentReturn.brief;
  const currentStageId: CivicJourneyStageId = briefCurrent ? "participation" : "administration";
  return { ...journey, displayScope: "synthetic_demo", currentStageId,
    stages: journey.stages.map(stage => {
      if (stage.id === "adoption") return { ...stage, state: "complete", label: "Testübernahme", authority: "Staging-Prüfung",
        detail: "Die Testübernahme ist im öffentlichen Aufnahmebeleg gebunden." };
      if (stage.id === "case") return { ...stage, state: "complete", label: "Testfall aufgenommen", authority: "Case Steward im Test",
        detail: "Der Vorschlag ist mit dem isolierten Testfall verbunden." };
      if (stage.id === "administration") return { ...stage, state: briefCurrent ? "complete" : "current", label: "Fachprüfung & Rücklauf",
        detail: briefCurrent ? `${currentReturn.brief!.responses.length} geprüfte Testantworten sind als bestätigte Kurzfassung zurückgekehrt.`
          : currentReturn?.status === "withdrawn" ? "Die Kurzfassung wurde zurückgezogen. Eine neue Fassung muss geprüft werden."
          : currentReturn?.status === "not_ready" ? "Die Fachbereiche bearbeiten den Testfall. Noch keine bestätigte Kurzfassung."
          : "Die Testaufnahme ist bestätigt. Der aktuelle Rücklauf wird geprüft; frühere Antworten gelten hier nicht als aktuell." };
      if (stage.id === "participation") return { ...stage, state: briefCurrent ? "current" : "gated", label: "Rücklauf diskutieren", authority: "Teilnehmende",
        detail: "Antworten vergleichen, Rückfragen stellen und den Vorschlag weiterentwickeln. Eine Beteiligungsrunde oder Abstimmung ist noch nicht geöffnet." };
      return { ...stage, state: stage.state === "current" ? "gated" : stage.state };
    }) };
}
