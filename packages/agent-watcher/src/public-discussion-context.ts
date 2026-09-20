import { verifyEvent, type NostrEvent } from "@netizen-labs/nostr";
import { createDirectMentionEvidence } from "./conversation-evidence";
import type { NostrPostEvidence } from "./public-evidence";

export interface PublicDiscussionContextOptions {
  /** Deployment-owned transport; never taken from a note or question. */
  readonly baseUrl: string;
  readonly publicOrigin: string;
  readonly municipalityId: string;
  readonly agentPubkey: string;
  readonly fetch?: typeof fetch;
}

export interface PublicDiscussionContext {
  readonly rootEvent: NostrEvent;
  readonly evidence: NostrPostEvidence;
  readonly currentAnswer: NostrEvent | null;
  readonly hasSuggestionOrCase: boolean;
}

/** Only a verified root can select document sections linked to its exact topic. */
export function publicDiscussionTopic(context: PublicDiscussionContext, discussionId: string, municipalityId: string): string {
  const root = context.rootEvent;
  const topic = singleTag(root, "topic");
  if (!verifyEvent(root) || root.id !== discussionId || root.kind !== 1 ||
    singleTag(root, "municipality") !== municipalityId ||
    singleTag(root, "t") !== "stadtstack-civic-discussion" || singleTag(root, "stance") !== "root" ||
    !topic?.startsWith(`urn:stadtstack:topic:municipality:${municipalityId}:`) || topic.split(":").length !== 6 ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(topic.split(":").at(-1)!)) {
    throw Error("public_discussion_topic_invalid");
  }
  return topic;
}

/** A signed feed follow-up selects a public root, never a caller-owned fetch URL. */
export async function readPublicFollowUpContext(
  event: NostrEvent,
  publicOrigin: string,
  readContext: (discussionId: string) => Promise<PublicDiscussionContext>,
): Promise<PublicDiscussionContext | null> {
  const footer = /\n\nDiskussion: (\S+)\s*$/u.exec(event.content);
  if (!footer) return null;
  const url = new URL(footer[1]!);
  const rootId = /^\/app\/diskussion\/([0-9a-f]{64})$/u.exec(url.pathname)?.[1];
  if (!verifyEvent(event) || !rootId || url.origin !== origin(publicOrigin, false) ||
    url.username || url.password || url.search || (url.hash && url.hash !== "#citizen-brief")) {
    throw Error("public_follow_up_reference_invalid");
  }
  const context = await readContext(rootId);
  const postId = singleTag(event, "source-app-post");
  if (context.rootEvent.id !== rootId || !postId || singleTag(context.rootEvent, "source-app-post") !== postId) {
    throw Error("public_follow_up_post_mismatch");
  }
  return context;
}

const HEX64 = /^[0-9a-f]{64}$/u;
const MAX_RESPONSE_BYTES = 512_000;

function origin(value: string, internal: boolean): string {
  const url = new URL(value);
  const clusterService = internal && url.protocol === "http:" &&
    /^[a-z0-9-]+\.[a-z0-9-]+\.svc\.cluster\.local$/u.test(url.hostname);
  if (url.origin !== value || (url.protocol !== "https:" && !clusterService) ||
    url.username || url.password) throw Error("public_discussion_origin_invalid");
  return url.origin;
}

export function publicDiscussionContextConfig(env: Record<string, string | undefined>):
  Pick<PublicDiscussionContextOptions, "baseUrl" | "publicOrigin"> | undefined {
  const baseUrl = env.MECKY_PUBLIC_APP_BASE_URL, publicOrigin = env.MECKY_PUBLIC_APP_ORIGIN;
  if (baseUrl === undefined && publicOrigin === undefined) return undefined;
  if (!baseUrl || !publicOrigin) throw Error("public_discussion_configuration_incomplete");
  return { baseUrl: origin(baseUrl, true), publicOrigin: origin(publicOrigin, false) };
}

function singleTag(event: NostrEvent, name: string): string | null {
  const tags = event.tags.filter(tag => tag[0] === name);
  return tags.length === 1 && tags[0]!.length === 2 ? tags[0]![1]! : null;
}

async function boundedJson(response: Response): Promise<unknown> {
  if (!response.ok || response.redirected || !response.headers.get("content-type")?.toLowerCase().startsWith("application/json") || !response.body) {
    throw Error("public_discussion_response_invalid");
  }
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)) {
    await response.body.cancel();
    throw Error("public_discussion_response_too_large");
  }
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw Error("public_discussion_response_too_large");
      }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
}

/** Read back the exact public signed question before citing it. Other people's
 * arguments and model replies in this projection are not silently admitted as
 * source material. A citizen statement retains its community authority. */
export function createPublicDiscussionContextReader(options: PublicDiscussionContextOptions) {
  const baseUrl = origin(options.baseUrl, true), publicOrigin = origin(options.publicOrigin, false);
  const fetcher = options.fetch ?? fetch;
  return async (discussionId: string): Promise<PublicDiscussionContext> => {
    if (!HEX64.test(discussionId)) throw Error("public_discussion_id_invalid");
    const response = await fetcher(`${baseUrl}/api/civic/v1/discussions/${discussionId}`, {
      method: "GET", credentials: "omit", redirect: "error", cache: "no-store",
      headers: { accept: "application/json" }, signal: AbortSignal.timeout(5_000),
    });
    const value = await boundedJson(response) as Record<string, unknown> | null;
    if (!value || value.schemaVersion !== "roebel_staging_argument_thread_v1" || value.authorityBinding !== "none") {
      throw Error("public_discussion_projection_invalid");
    }
    const root = value.rootEvent as NostrEvent | null;
    if (!root || !verifyEvent(root) || root.id !== discussionId ||
      singleTag(root, "t") !== "stadtstack-civic-discussion" ||
      singleTag(root, "municipality") !== options.municipalityId ||
      singleTag(root, "stance") !== "root") throw Error("public_discussion_root_invalid");
    const evidence = createDirectMentionEvidence(root, {
      municipalityId: options.municipalityId, agentPubkey: options.agentPubkey,
      verifiedPublicEventUrl: `${publicOrigin}/app/diskussion/${root.id}`,
    });
    const answer = (value.mecky as { event?: NostrEvent } | null)?.event ?? null;
    if (answer && (!verifyEvent(answer) || answer.pubkey !== options.agentPubkey ||
      !answer.tags.some(tag => tag.length === 4 && tag[0] === "e" && tag[1] === root.id && tag[2] === "" && tag[3] === "reply") ||
      singleTag(answer, "municipality") !== options.municipalityId || singleTag(answer, "topic") !== singleTag(root, "topic"))) {
      throw Error("public_discussion_answer_invalid");
    }
    return { rootEvent: root, evidence, currentAnswer: answer,
      hasSuggestionOrCase: value.suggestion !== null || value.caseBinding !== null };
  };
}
