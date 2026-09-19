import { writeFile } from "node:fs/promises";
import {
  parseReviewedPublicKnowledgeProjection,
  sealReviewedPublicKnowledgeProjection,
  type ReviewedPublicKnowledgeProjectionDraft,
} from "@roebel/stadtstack-federation-client/reviewed-public-knowledge";
import { PUBLIC_KNOWLEDGE_FILE_MAX_BYTES, readPublicKnowledgeJson } from "../src/lib/mecky/public-knowledge-file";

async function main() {
  const [input, output, ...extra] = process.argv.slice(2);
  if (!input || !output || extra.length) {
    throw new Error("Usage: prepare-public-knowledge <reviewed-draft.json> <new-output.json>");
  }
  // Runtime validation happens inside seal; casting does not admit unknown data.
  const draft = await readPublicKnowledgeJson(input) as ReviewedPublicKnowledgeProjectionDraft;
  const sealed = sealReviewedPublicKnowledgeProjection(draft);
  const projection = parseReviewedPublicKnowledgeProjection(
    sealed, sealed.municipalityId, sealed.sourceKind, new Date().toISOString(),
  );
  const content = `${JSON.stringify(projection, null, 2)}\n`;
  if (Buffer.byteLength(content, "utf8") > PUBLIC_KNOWLEDGE_FILE_MAX_BYTES) {
    throw new Error("Prepared projection exceeds the reader's size limit.");
  }
  // Preparation never replaces the active catalogue or grants source admission.
  await writeFile(output, content, { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({
    municipalityId: projection.municipalityId,
    sourceKind: projection.sourceKind,
    records: projection.records.length,
    contentSha256: projection.contentSha256,
  }));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Knowledge preparation failed.");
  process.exitCode = 1;
});
