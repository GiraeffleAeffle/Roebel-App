import { z } from "zod";

const text = z.string().min(1).max(65_536);
const id = z.string().regex(/^[A-Za-z0-9:._/-]{1,512}$/);
const sha = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const eventId = z.string().regex(/^[0-9a-f]{64}$/);
const department = z.string().regex(/^[a-z0-9-]{1,64}$/);
const response = z.object({ departmentId: department, publicSummary: text,
  publicCitations: z.array(z.string().min(1).max(2048)).max(64) }).strict();
const briefSchema = z.object({
  schemaVersion: z.literal("citizen_brief_projection_v1"), id, title: text, summary: text,
  responses: z.array(response).length(8),
  provenance: z.object({
    sourceDiscussionRef: z.object({ type: z.literal("nostr_event"), id: eventId, ref: text }).strict(),
    suggestionId: id,
    packageBindings: z.array(z.object({ departmentId: department, packageId: id, packageChecksum: sha,
      draftArtifactChecksum: sha, reviewAttestationChecksum: sha,
      reviewedAt: z.string().datetime({ precision: 3 }) }).strict()).length(8),
  }).strict(),
  briefChecksum: sha, policyVersion: id, correctionState: z.literal("current"), authorityBinding: z.literal("none"),
}).strict();
const returnSchema = z.object({
  schemaVersion: z.literal("synthetic_citizen_brief_return_v1"), environment: z.literal("staging"),
  testOnly: z.literal(true), authorityBinding: z.literal("none"),
  caseId: z.string().regex(/^urn:stadtstack:synthetic-case:municipality:[a-z0-9-]+:[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/),
  municipalityId: department, discussionId: eventId, topicId: id, caseVersion: z.number().int().min(3), policyVersion: id,
  status: z.enum(["not_ready", "current", "withdrawn"]), brief: briefSchema.nullable(), returnChecksum: sha,
}).strict();

export type SyntheticCitizenBriefReturn = z.infer<typeof returnSchema>;
export type SyntheticCitizenBriefBinding = Pick<SyntheticCitizenBriefReturn, "caseId" | "discussionId" | "topicId">;
export const SYNTHETIC_BRIEF_MAX_BYTES = 131_072;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, item]) => [key, canonical(item)]));
}
async function checksum(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(canonical(value)));
  const hash = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes));
  return `sha256:${Array.from(hash, byte => byte.toString(16).padStart(2, "0")).join("")}`;
}

/** One closed contract for the browser, public gateway and Mecky. Verifies the
 * whole return and original coordinator Brief; cannot parse municipal data. */
export async function verifySyntheticCitizenBrief(value: unknown, expected: SyntheticCitizenBriefBinding): Promise<SyntheticCitizenBriefReturn> {
  const result = returnSchema.parse(value);
  if (result.caseId !== expected.caseId || result.discussionId !== expected.discussionId || result.topicId !== expected.topicId ||
    !result.caseId.startsWith(`urn:stadtstack:synthetic-case:municipality:${result.municipalityId}:`) ||
    !result.topicId.startsWith(`urn:stadtstack:topic:municipality:${result.municipalityId}:`) ||
    (result.status === "current") !== (result.brief !== null)) throw Error("synthetic_brief_binding_invalid");
  const { returnChecksum, ...base } = result;
  if (await checksum(base) !== returnChecksum) throw Error("synthetic_brief_checksum_invalid");
  if (result.brief) {
    const { briefChecksum, ...brief } = result.brief;
    const responses = brief.responses.map(p => p.departmentId).sort();
    const bindings = brief.provenance.packageBindings.map(p => p.departmentId).sort();
    if (await checksum(brief) !== briefChecksum || new Set(responses).size !== 8 ||
      new Set(brief.provenance.packageBindings.map(p => p.packageId)).size !== 8 ||
      responses.some((d, i) => d !== bindings[i]) || brief.policyVersion !== result.policyVersion ||
      brief.provenance.sourceDiscussionRef.id !== expected.discussionId) throw Error("synthetic_brief_invalid");
  }
  return result;
}

export async function readSyntheticBriefResponse(response: Response, expected: SyntheticCitizenBriefBinding): Promise<SyntheticCitizenBriefReturn> {
  if (!response.ok || response.redirected || !response.headers.get("content-type")?.startsWith("application/json") || !response.body) {
    await response.body?.cancel(); throw Error("synthetic_brief_unavailable");
  }
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      length += part.value.byteLength;
      if (length > SYNTHETIC_BRIEF_MAX_BYTES) throw Error("synthetic_brief_too_large");
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return await verifySyntheticCitizenBrief(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), expected);
  } finally { await reader.cancel(); reader.releaseLock(); }
}

export function syntheticBriefPath(discussionId: string): string {
  if (!eventId.safeParse(discussionId).success) throw Error("synthetic_brief_discussion_invalid");
  return `/api/stadtstack/synthetic-citizen-brief/by-discussion/${discussionId}`;
}
