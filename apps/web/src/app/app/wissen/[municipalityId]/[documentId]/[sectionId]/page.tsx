import { DocumentKnowledgeView } from "../../../../../../components/mecky/DocumentKnowledgeView";
import { readDocumentKnowledge } from "../../../../../../lib/mecky/document-knowledge";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function DocumentSectionPage({ params, searchParams }: {
  params: Promise<{ municipalityId: string; documentId: string; sectionId: string }>;
  searchParams: Promise<{ version?: string | string[] }>;
}) {
  const { municipalityId, documentId, sectionId } = await params;
  const { version } = await searchParams;
  const result = Array.isArray(version) ? { status: "not_found" as const }
    : await readDocumentKnowledge(municipalityId, documentId, sectionId, version);
  return <DocumentKnowledgeView result={result} />;
}
