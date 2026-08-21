import type { PostComment } from "@/types/post";

const HEX64 = /^[0-9a-f]{64}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const APP_SOURCE_ID =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[0-9a-f]{64})$/;

function parseEvidenceRefs(
  value: unknown
): Array<{ digest: string; url: string }> | null {
  if (!Array.isArray(value) || value.length > 3) return null;
  const refs: Array<{ digest: string; url: string }> = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const record = entry as Record<string, unknown>;
    if (
      Object.keys(record).sort().join(",") !== "digest,url" ||
      typeof record.digest !== "string" ||
      !DIGEST.test(record.digest) ||
      typeof record.url !== "string"
    ) {
      return null;
    }
    let url: URL;
    try {
      url = new URL(record.url);
    } catch {
      return null;
    }
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    refs.push({ digest: record.digest, url: url.href });
  }
  if (new Set(refs.map((entry) => entry.digest)).size !== refs.length) {
    return null;
  }
  return refs;
}

function projectedComment(value: unknown, postId: string): PostComment | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.event_id !== "string" ||
    !HEX64.test(row.event_id) ||
    row.source_post_id !== postId ||
    typeof row.source_post_id !== "string" ||
    !APP_SOURCE_ID.test(row.source_post_id) ||
    !(
      row.source_comment_id === null ||
      (typeof row.source_comment_id === "string" &&
        APP_SOURCE_ID.test(row.source_comment_id))
    ) ||
    typeof row.agent_pubkey !== "string" ||
    !HEX64.test(row.agent_pubkey) ||
    typeof row.content !== "string" ||
    !row.content.trim() ||
    row.content.length > 2_000 ||
    typeof row.event_created_at !== "string" ||
    !Number.isFinite(Date.parse(row.event_created_at)) ||
    row.authority_binding !== "none"
  ) {
    return null;
  }
  const evidenceRefs = parseEvidenceRefs(row.evidence_refs);
  if (!evidenceRefs) return null;

  return {
    id: row.event_id,
    post_id: postId,
    wallet_address: "mecky_bot",
    account_id: null,
    content: row.content,
    media_urls: [],
    video_url: null,
    status: "published",
    created_at: new Date(row.event_created_at).toISOString(),
    author_username: "Mecky",
    author_profile_picture_url: null,
    agent: {
      kind: "public_mecky",
      pubkey: row.agent_pubkey,
      authorityBinding: "none",
      evidenceRefs,
    },
  };
}

/**
 * Merge ordinary comments and independently verified Public Mecky projections
 * before pagination. Invalid or cross-post rows disappear instead of becoming
 * machine speech in a citizen thread.
 */
export function mergePublicMeckyThread(input: {
  humanComments: readonly PostComment[];
  projectedRows: readonly unknown[];
  postId: string;
  limit: number;
  offset: number;
}): PostComment[] {
  const byId = new Map(input.humanComments.map((comment) => [comment.id, comment]));
  for (const row of input.projectedRows) {
    const comment = projectedComment(row, input.postId);
    if (comment && !byId.has(comment.id)) byId.set(comment.id, comment);
  }
  return [...byId.values()]
    .sort(
      (left, right) =>
        left.created_at.localeCompare(right.created_at) ||
        left.id.localeCompare(right.id)
    )
    .slice(input.offset, input.offset + input.limit);
}

/** Count only zero-authority rows bound to the requested feed page. */
export function publicMeckyReplyCounts(
  values: readonly unknown[],
  allowedPostIds: ReadonlySet<string>
): Map<string, number> {
  const counts = new Map<string, number>();
  const seen = new Set<string>();
  for (const value of values) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const row = value as Record<string, unknown>;
    if (
      typeof row.event_id !== "string" ||
      !HEX64.test(row.event_id) ||
      seen.has(row.event_id) ||
      typeof row.source_post_id !== "string" ||
      !allowedPostIds.has(row.source_post_id) ||
      row.authority_binding !== "none"
    ) {
      continue;
    }
    seen.add(row.event_id);
    counts.set(row.source_post_id, (counts.get(row.source_post_id) ?? 0) + 1);
  }
  return counts;
}
