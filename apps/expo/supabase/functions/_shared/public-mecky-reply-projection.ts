export interface SignedNostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

export interface PublicMeckyReplyProjection {
  event_id: string;
  request_event_id: string;
  source_post_id: string;
  source_comment_id: string | null;
  agent_pubkey: string;
  content: string;
  evidence_refs: Array<{ digest: string; url: string }>;
  event_created_at: string;
  authority_binding: "none";
  signed_event: SignedNostrEvent;
}

export interface PublicMeckyReplyProjectionOptions {
  expectedPubkey: string;
  verifyEvent: (event: SignedNostrEvent) => boolean;
  agentName?: string;
  nodeId?: string;
}

export class PublicMeckyReplyProjectionError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "PublicMeckyReplyProjectionError";
  }
}

const HEX64 = /^[0-9a-f]{64}$/;
const HEX128 = /^[0-9a-f]{128}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const APP_SOURCE_ID =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[0-9a-f]{64})$/;
const DECIMAL_ID = /^[0-9]{1,12}$/;
const ALLOWED_TAGS = new Set([
  "netizen_agent",
  "e",
  "p",
  "source-app-post",
  "source-app-comment",
  "evidence",
  "mecky-receipt",
  "municipality",
  "topic",
  "case",
  "stadtstack-case",
]);

function fail(code: string): never {
  throw new PublicMeckyReplyProjectionError(code);
}

function exactObject(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("public_mecky_projection_event_invalid");
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(",") !== [...keys].sort().join(",")) {
    fail("public_mecky_projection_event_invalid");
  }
  return record;
}

function oneTag(tags: string[][], name: string, optional = false): string[] | null {
  const matches = tags.filter((tag) => tag[0] === name);
  if ((optional && matches.length > 1) || (!optional && matches.length !== 1)) {
    fail(`public_mecky_projection_${name.replaceAll("-", "_")}_invalid`);
  }
  return matches[0] ?? null;
}

function exactQueryEntries(url: URL, expectedKeys: readonly string[]): boolean {
  const entries = [...url.searchParams.entries()];
  return entries.length === expectedKeys.length &&
    entries.map(([key]) => key).sort().join(",") === [...expectedKeys].sort().join(",");
}

function safeEvidenceDestination(url: URL): boolean {
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash
  ) {
    return false;
  }
  if (!url.search) return true;
  if (
    url.origin === "https://index.roebel.app" &&
    url.pathname === "/events" &&
    exactQueryEntries(url, ["ids"])
  ) {
    return HEX64.test(url.searchParams.get("ids") ?? "");
  }
  if (
    url.origin === "https://roebelmueritz.sitzung-mv.de" &&
    url.pathname === "/public/vo020" &&
    exactQueryEntries(url, ["TOLFDNR", "VOLFDNR", "refresh"])
  ) {
    return DECIMAL_ID.test(url.searchParams.get("TOLFDNR") ?? "") &&
      DECIMAL_ID.test(url.searchParams.get("VOLFDNR") ?? "") &&
      url.searchParams.get("refresh") === "false";
  }
  if (
    url.origin === "https://roebelmueritz.sitzung-mv.de" &&
    url.pathname === "/public/to020" &&
    exactQueryEntries(url, ["SILFDNR", "TOLFDNR"])
  ) {
    return DECIMAL_ID.test(url.searchParams.get("SILFDNR") ?? "") &&
      DECIMAL_ID.test(url.searchParams.get("TOLFDNR") ?? "");
  }
  return false;
}

function evidenceRef(tag: string[]): { digest: string; url: string } {
  if (tag.length !== 3 || !DIGEST.test(tag[1] ?? "")) {
    fail("public_mecky_projection_evidence_invalid");
  }
  let url: URL;
  try {
    url = new URL(tag[2]!);
  } catch {
    fail("public_mecky_projection_evidence_invalid");
  }
  if (!safeEvidenceDestination(url)) {
    fail("public_mecky_projection_evidence_invalid");
  }
  return { digest: tag[1]!, url: url.href };
}

/**
 * Validate one signed Public Mecky event and reduce it to the complete durable
 * Röbel read-model row. Callers learn one interface; signature verification and
 * persistence remain injected adapters at this seam.
 */
export function parsePublicMeckyReplyProjection(
  input: unknown,
  options: PublicMeckyReplyProjectionOptions,
): PublicMeckyReplyProjection {
  const record = exactObject(input, [
    "id",
    "pubkey",
    "created_at",
    "kind",
    "tags",
    "content",
    "sig",
  ]);
  const expectedPubkey = options.expectedPubkey.trim().toLowerCase();
  if (!HEX64.test(expectedPubkey)) fail("public_mecky_projection_config_invalid");
  if (
    typeof record.id !== "string" ||
    !HEX64.test(record.id) ||
    typeof record.pubkey !== "string" ||
    !HEX64.test(record.pubkey) ||
    record.pubkey !== expectedPubkey ||
    typeof record.sig !== "string" ||
    !HEX128.test(record.sig) ||
    record.kind !== 1 ||
    !Number.isSafeInteger(record.created_at) ||
    (record.created_at as number) <= 0 ||
    typeof record.content !== "string" ||
    !record.content.trim() ||
    record.content.length > 2_000 ||
    !Array.isArray(record.tags) ||
    record.tags.length < 4 ||
    record.tags.length > 32
  ) {
    fail("public_mecky_projection_event_invalid");
  }

  const tags = record.tags.map((value) => {
    if (
      !Array.isArray(value) ||
      value.length < 2 ||
      value.length > 4 ||
      value.some((part) => typeof part !== "string" || part.length > 2_048) ||
      !ALLOWED_TAGS.has(value[0] as string)
    ) {
      fail("public_mecky_projection_tag_invalid");
    }
    return [...value] as string[];
  });
  const event: SignedNostrEvent = {
    id: record.id as string,
    pubkey: record.pubkey as string,
    created_at: record.created_at as number,
    kind: 1,
    tags,
    content: record.content as string,
    sig: record.sig as string,
  };
  if (!options.verifyEvent(event)) fail("public_mecky_projection_signature_invalid");

  const agentTag = oneTag(tags, "netizen_agent")!;
  if (
    agentTag.length !== 3 ||
    agentTag[1] !== (options.agentName ?? "mecky") ||
    agentTag[2] !== (options.nodeId ?? "roebel")
  ) {
    fail("public_mecky_projection_agent_invalid");
  }

  const postTag = oneTag(tags, "source-app-post")!;
  if (postTag.length !== 2 || !APP_SOURCE_ID.test(postTag[1] ?? "")) {
    fail("public_mecky_projection_source_app_post_invalid");
  }
  const commentTag = oneTag(tags, "source-app-comment", true);
  if (
    commentTag &&
    (commentTag.length !== 2 || !APP_SOURCE_ID.test(commentTag[1] ?? ""))
  ) {
    fail("public_mecky_projection_source_app_comment_invalid");
  }

  const replyTag = oneTag(tags, "e")!;
  if (
    replyTag.length !== 4 ||
    !HEX64.test(replyTag[1] ?? "") ||
    replyTag[2] !== "" ||
    replyTag[3] !== "reply"
  ) {
    fail("public_mecky_projection_e_invalid");
  }
  const recipientTag = oneTag(tags, "p")!;
  if (recipientTag.length < 2 || !HEX64.test(recipientTag[1] ?? "")) {
    fail("public_mecky_projection_p_invalid");
  }

  const evidence = tags
    .filter((tag) => tag[0] === "evidence")
    .map(evidenceRef);
  if (
    evidence.length > 3 ||
    new Set(evidence.map((entry) => entry.digest)).size !== evidence.length
  ) {
    fail("public_mecky_projection_evidence_invalid");
  }

  let eventCreatedAt: string;
  try {
    eventCreatedAt = new Date(event.created_at * 1_000).toISOString();
  } catch {
    fail("public_mecky_projection_event_invalid");
  }

  return {
    event_id: event.id,
    request_event_id: replyTag[1]!,
    source_post_id: postTag[1]!,
    source_comment_id: commentTag?.[1] ?? null,
    agent_pubkey: event.pubkey,
    content: event.content,
    evidence_refs: evidence,
    event_created_at: eventCreatedAt,
    authority_binding: "none",
    signed_event: event,
  };
}
