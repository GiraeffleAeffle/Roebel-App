import { constants } from "node:fs";
import { open } from "node:fs/promises";
import {
  parseReviewedPublicKnowledgeProjection,
  type ReviewedPublicKnowledgeSourceKind,
} from "@roebel/stadtstack-federation-client/reviewed-public-knowledge";

// Match the Mecky reader's default response limit. Read the same open inode
// throughout; an atomic publisher replacement is picked up by the next request.
export const PUBLIC_KNOWLEDGE_FILE_MAX_BYTES = 512_000;

export async function readPublicKnowledgeJson(path: string): Promise<unknown> {
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > PUBLIC_KNOWLEDGE_FILE_MAX_BYTES) {
      throw new Error("Invalid public knowledge file.");
    }
    const bytes = Buffer.alloc(PUBLIC_KNOWLEDGE_FILE_MAX_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await file.read(bytes, length, bytes.length - length, null);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > PUBLIC_KNOWLEDGE_FILE_MAX_BYTES) {
      throw new Error("Public knowledge file exceeds its size limit.");
    }
    const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length));
    return JSON.parse(content) as unknown;
  } finally {
    await file.close();
  }
}

export async function readPublicKnowledgeFile(
  path: string,
  municipalityId: string,
  sourceKind: ReviewedPublicKnowledgeSourceKind,
  now: string,
) {
  return parseReviewedPublicKnowledgeProjection(
    await readPublicKnowledgeJson(path), municipalityId, sourceKind, now,
  );
}
