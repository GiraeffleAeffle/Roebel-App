import type { PublicCivicPostLink } from "./civic-topic-detail";

const MAX_LOOKUP_ATTEMPTS = 2;

export type CivicPostJourneyState =
  | Readonly<{ kind: "linked"; link: PublicCivicPostLink }>
  | Readonly<{ kind: "unlinked" }>
  | Readonly<{ kind: "unavailable" }>;

export type CivicPostJourneyPresentation =
  | Readonly<{ kind: "hidden" }>
  | Readonly<{ kind: "journey"; link: PublicCivicPostLink }>
  | Readonly<{ kind: "promotion" }>
  | Readonly<{
      kind: "unavailable";
      message: "Bürgerprozess gerade nicht erreichbar";
      retryLabel: "Erneut versuchen";
    }>;

export async function resolveCivicPostJourney(input: Readonly<{
  sourceAppPostId: string;
  loadPostLink(sourceAppPostId: string): Promise<PublicCivicPostLink | null>;
}>): Promise<CivicPostJourneyState> {
  for (let attempt = 0; attempt < MAX_LOOKUP_ATTEMPTS; attempt += 1) {
    try {
      const link = await input.loadPostLink(input.sourceAppPostId);
      return link === null ? { kind: "unlinked" } : { kind: "linked", link };
    } catch {
      // An unavailable projection is still distinct from a confirmed 404.
    }
  }
  return { kind: "unavailable" };
}

export function presentCivicPostJourney(
  state: CivicPostJourneyState,
  canPromote: boolean,
): CivicPostJourneyPresentation {
  if (state.kind === "unavailable") {
    return {
      kind: "unavailable",
      message: "Bürgerprozess gerade nicht erreichbar",
      retryLabel: "Erneut versuchen",
    };
  }
  if (state.kind === "unlinked" && canPromote) return { kind: "promotion" };
  if (state.kind === "linked") return { kind: "journey", link: state.link };
  return { kind: "hidden" };
}
