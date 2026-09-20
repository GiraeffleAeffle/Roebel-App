import type { CommunityDocumentEvidence } from "@roebel/stadtstack-federation-client/reviewed-public-knowledge";
import { roebelReviewedPublicKnowledge } from "./reviewed-public-knowledge";

export type DocumentKnowledgeResult =
  | { status: "unavailable" | "not_found" }
  | { status: "withdrawn" | "outdated" | "changed"; title: string; currentUrl: string | null }
  | { status: "current"; record: CommunityDocumentEvidence; sections: readonly CommunityDocumentEvidence[] };

/** Read the current edition again; an old citation cannot silently claim revised text. */
export async function readDocumentKnowledge(
  municipalityId: string,
  documentId: string,
  sectionId: string,
  version?: string,
): Promise<DocumentKnowledgeResult> {
  const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
  if ([municipalityId, documentId, sectionId].some((part) => part.length > 80 || !slug.test(part)) ||
    (version !== undefined && !/^[0-9a-f]{64}$/u.test(version))) return { status: "not_found" };
  try {
    const projection = await roebelReviewedPublicKnowledge(municipalityId, "community-documents");
    if (!projection) return { status: "not_found" };
    const records = projection.records.filter((record): record is CommunityDocumentEvidence =>
      record.sourceKind === "community_document" && record.documentId === documentId);
    const record = records.find((entry) => entry.sectionId === sectionId);
    if (!record) return { status: "not_found" };
    if (record.lifecycle !== "current") return {
      status: record.lifecycle === "withdrawn" ? "withdrawn" : "outdated", title: record.title, currentUrl: null,
    };
    if (version !== undefined && record.evidenceId !== `sha256:${version}`) {
      return { status: "changed", title: record.title, currentUrl: record.recordUrl };
    }
    return { status: "current", record,
      sections: records.filter((entry) => entry.lifecycle === "current")
        .sort((a, b) => a.pageStart - b.pageStart || a.sectionId.localeCompare(b.sectionId, "de", { numeric: true })) };
  } catch {
    return { status: "unavailable" };
  }
}
