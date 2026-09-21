import {
  communityDocumentSectionEvidenceId,
  sealReviewedPublicKnowledgeProjection,
  type CommunityDocumentEvidence,
} from "@roebel/stadtstack-federation-client/reviewed-public-knowledge";

export const DOCUMENT_NOW = "2026-09-20T12:00:00.000Z";

export function documentSection(
  overrides: Partial<Omit<CommunityDocumentEvidence, "evidenceId" | "recordUrl">> = {},
): CommunityDocumentEvidence {
  const draft: Omit<CommunityDocumentEvidence, "evidenceId" | "recordUrl"> = {
    municipalityId: "example-city", sourceKind: "community_document", authority: "community_statement",
    title: "Empfehlung 1: Begegnungsort", summary: "Der Bürgerrat empfiehlt einen Begegnungsort mit gemeinsamer Raumnutzung.",
    publishedAt: null, admissionState: "admitted", lifecycle: "current",
    attributedTo: "Bürgerrat", publisher: "Verein Bürgerbeteiligung", documentId: "buergerrat-2026",
    documentTitle: "Ergebnisse des Bürgerrats", documentSha256: `sha256:${"a".repeat(64)}`,
    documentUrl: null, pageCount: 17, sectionId: "empfehlung-1", pageStart: 11, pageEnd: 11,
    printedPageLabel: "20", topicIds: [], reviewedAt: "2026-09-19T12:00:00.000Z", ...overrides,
  };
  const evidenceId = communityDocumentSectionEvidenceId(draft);
  return { ...draft, evidenceId,
    recordUrl: `https://app.example/app/wissen/${draft.municipalityId}/${draft.documentId}/${draft.sectionId}?version=${evidenceId.slice(7)}` };
}

export function documentEdition(records = [documentSection()]) {
  return sealReviewedPublicKnowledgeProjection({
    schemaVersion: "reviewed_public_knowledge_projection_v1", municipalityId: "example-city",
    sourceKind: "community_document", generatedAt: DOCUMENT_NOW, records,
  });
}
