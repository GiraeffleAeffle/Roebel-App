import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import {
  APP_CONVERSATION_TOPIC,
  bindingStatement,
  buildCitizenSignedSuggestion,
  buildCivicDiscussionEvent,
  buildCivicPromotionEvent,
  buildNoteEvent,
  buildProfileEvent,
  getPublicKeyHex,
  isAgentEvent,
  isAppConversationMentionEvent,
  RelayClient,
  verifyCitizenSignedTopicSuggestion,
  verifyCivicTopicPromotionEvent,
  verifyBindingEvent,
  verifyAppConversationExchange,
  verifyParticipantTopicSuggestion,
  verifyEvent,
  type CitizenSignedTopicSuggestionV1,
  type NostrEvent,
  type ParticipantTopicSuggestionV1,
} from "@netizen-labs/nostr";
import { createGnosisWalletVerifier } from "@netizen-labs/relay-sync";
import WebSocket from "ws";

const HEX64 = /^[0-9a-f]{64}$/;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ADDRESS = /^0x[0-9a-f]{40}$/;
const WALLET_SIGNATURE = /^0x[0-9a-f]+$/;
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const CASE_ID =
  "urn:stadtstack:case:municipality:roebel-mueritz:018f0000-0000-7000-8000-000000000001";
const MARIENFELDER_TOPIC_ID =
  "urn:stadtstack:topic:municipality:roebel-mueritz:marienfelder-strasse";
const MARIENFELDER_TOPIC_TITLE = "Marienfelder Straße";
const MAX_BODY = 256 * 1024;
const STAGING_PREFIX = "/stadtstack-test";
const INTERNAL_TOPIC_TRACER_PATHS = new Set([
  "/api/staging-participant/topic-tracer/promotion-source",
  "/api/staging-participant/topic-tracer/promotions",
  "/api/staging-participant/topic-tracer/suggestion-source",
  "/api/staging-participant/topic-tracer/suggestions",
]);
const SERVICE_NAMESPACES = new Set([
  "stadtstack-roebel-e2e",
  "stadtstack-roebel-staging-lab",
  "stadtstack-roebel-web-preview",
]);
const PUBLIC_CASE_PROJECTION_KEYS = new Set([
  "schemaVersion",
  "caseId",
  "jurisdiction",
  "municipalityId",
  "sourceScope",
  "authorityBinding",
  "formalDecision",
  "discussion",
  "discussions",
  "suggestion",
  "suggestions",
  "provenance",
  "departmentPackage",
  "departmentPackages",
  "reviewedCitizenBrief",
  "participationResult",
  "reviewedOutcome",
  "councilDryRunBrief",
]);
const PUBLIC_DEPARTMENT_PACKAGE_KEYS = [
  "schemaVersion",
  "id",
  "departmentId",
  "suggestionId",
  "request",
  "packageChecksum",
  "reviewState",
  "correctionState",
  "artifactChecksum",
  "reviewedAt",
  "policyVersion",
  "publicSummary",
  "publicCitations",
  "authorityBinding",
];
const PUBLIC_BRIEF_KEYS = [
  "schemaVersion",
  "id",
  "title",
  "summary",
  "responses",
  "provenance",
  "briefChecksum",
  "policyVersion",
  "correctionState",
  "authorityBinding",
];
const PUBLIC_SIGNED_FORBIDDEN_INPUTS = [
  "CASE_STEWARD_TOKEN",
  "STADTSTACK_CONTROL_BASE_URL",
  "STADTSTACK_PUBLIC_BASE_URL",
  "SYNTHETIC_CITIZENS_JSON",
] as const;

type Persona = {
  id: string;
  name: string;
  secretKeyHex: string;
  publicKey: string;
};

type PublicAuthor = {
  name: string;
  kind: "citizen" | "mecky";
  pubkey: string;
  synthetic: boolean;
};
type PublicArgument = {
  id: string;
  parentId: string | null;
  rootId: string;
  stance: "root" | "pro" | "con";
  author: PublicAuthor;
  content: string;
  createdAt: string;
};

export interface WorkbenchConfig {
  agentRelayUrl: string;
  bindHost: "127.0.0.1" | "0.0.0.0";
  citizenRelayAdmissionToken: string;
  citizenRelayUrl: string;
  gnosisRpcUrl: string;
  legacySyntheticPubkeys: string[];
  meckyPubkey: string;
  mode: "isolated-fixture" | "public-signed-only";
  personas: Persona[];
  port: number;
  /** Present only in the fixture lane. Never mounted in public-signed mode. */
  caseStewardToken?: string;
  /** Present only in the fixture lane. Never mounted in public-signed mode. */
  controlBaseUrl?: string;
}

type RelayPort = Pick<RelayClient, "publish" | "query" | "close">;
export interface WorkbenchDependencies {
  admitPubkey?: (pubkey: string) => Promise<void>;
  agentRelay?: RelayPort;
  citizenRelay?: RelayPort;
  fetch?: typeof globalThis.fetch;
  verifyWalletSignature?: (args: {
    address: string;
    message: string;
    signature: string;
  }) => Promise<boolean>;
}

export interface RunningWorkbench {
  close(): Promise<void>;
  port: number;
}

function exactRecord(
  value: unknown,
  keys: readonly string[]
): value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    return false;
  const actual = Reflect.ownKeys(value);
  return (
    actual.length === keys.length &&
    actual.every((key) => typeof key === "string" && keys.includes(key))
  );
}

function exactServiceUrl(
  value: string,
  protocol: "http" | "ws",
  service:
    | "citizen-relay"
    | "agent-relay"
    | "stadtstack-control"
    | "stadtstack-public",
  port: 18080 | 18081
): string {
  const match = value.match(
    new RegExp(
      `^${protocol}:\\/\\/${service}\\.([a-z0-9-]+)\\.svc\\.cluster\\.local:${port}$`
    )
  );
  if (!match || !SERVICE_NAMESPACES.has(match[1] ?? ""))
    throw new Error(`workbench_${service}_url_invalid`);
  return value;
}

function relayUrl(
  value: string,
  service: "citizen-relay" | "agent-relay"
): string {
  return exactServiceUrl(value, "ws", service, 18081);
}

function serviceUrl(
  value: string,
  service: "stadtstack-control" | "stadtstack-public",
  port: 18081 | 18080
): string {
  return exactServiceUrl(value, "http", service, port);
}

function externalHttpsUrl(value: string, name: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`workbench_${name}_invalid`);
  }
  if (
    parsed.protocol !== "https:" ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    value.length > 2_048
  )
    throw new Error(`workbench_${name}_invalid`);
  return parsed.toString().replace(/\/$/, "");
}

export function parseWorkbenchConfig(
  environment: Record<string, string | undefined>
): WorkbenchConfig {
  const mode = environment.WORKBENCH_MODE ?? "isolated-fixture";
  if (mode !== "isolated-fixture" && mode !== "public-signed-only")
    throw new Error("workbench_mode_invalid");
  if (
    mode === "public-signed-only" &&
    PUBLIC_SIGNED_FORBIDDEN_INPUTS.some((name) =>
      Object.prototype.hasOwnProperty.call(environment, name)
    )
  ) {
    throw new Error("workbench_public_signed_forbidden_input");
  }
  const rawPersonas = environment.SYNTHETIC_CITIZENS_JSON;
  let parsed: unknown;
  try {
    parsed = rawPersonas === undefined ? [] : JSON.parse(rawPersonas);
  } catch {
    throw new Error("workbench_personas_invalid");
  }
  if (
    !Array.isArray(parsed) ||
    (mode === "isolated-fixture" && parsed.length !== 2) ||
    (mode === "public-signed-only" && parsed.length !== 0)
  )
    throw new Error("workbench_personas_invalid");
  const ids = new Set<string>();
  const publicKeys = new Set<string>();
  const personas = parsed.map((entry): Persona => {
    if (!exactRecord(entry, ["id", "name", "secretKeyHex"]))
      throw new Error("workbench_personas_invalid");
    const id = entry.id;
    const name = entry.name;
    const secretKeyHex = entry.secretKeyHex;
    if (
      typeof id !== "string" ||
      !/^citizen-[a-z]+$/.test(id) ||
      typeof name !== "string" ||
      !name.trim() ||
      typeof secretKeyHex !== "string" ||
      !HEX64.test(secretKeyHex)
    ) {
      throw new Error("workbench_personas_invalid");
    }
    const publicKey = getPublicKeyHex(
      Uint8Array.from(Buffer.from(secretKeyHex, "hex"))
    );
    if (ids.has(id) || publicKeys.has(publicKey))
      throw new Error("workbench_personas_invalid");
    ids.add(id);
    publicKeys.add(publicKey);
    return { id, name, secretKeyHex, publicKey };
  });
  const rawLegacySyntheticPubkeys =
    environment.LEGACY_SYNTHETIC_PUBKEYS_JSON;
  let parsedLegacySyntheticPubkeys: unknown;
  try {
    parsedLegacySyntheticPubkeys =
      rawLegacySyntheticPubkeys === undefined
        ? undefined
        : JSON.parse(rawLegacySyntheticPubkeys);
  } catch {
    throw new Error("workbench_legacy_synthetic_pubkeys_invalid");
  }
  if (
    (mode === "public-signed-only" &&
      (!Array.isArray(parsedLegacySyntheticPubkeys) ||
        parsedLegacySyntheticPubkeys.length > 100)) ||
    (mode === "isolated-fixture" &&
      parsedLegacySyntheticPubkeys !== undefined)
  ) {
    throw new Error("workbench_legacy_synthetic_pubkeys_invalid");
  }
  const legacySyntheticPubkeys =
    mode === "public-signed-only"
      ? (parsedLegacySyntheticPubkeys as unknown[])
      : [];
  if (
    !legacySyntheticPubkeys.every(
      (entry): entry is string => typeof entry === "string" && HEX64.test(entry)
    ) ||
    new Set(legacySyntheticPubkeys).size !== legacySyntheticPubkeys.length ||
    JSON.stringify([...legacySyntheticPubkeys].sort()) !==
      JSON.stringify(legacySyntheticPubkeys)
  ) {
    throw new Error("workbench_legacy_synthetic_pubkeys_invalid");
  }
  const meckyPubkey = environment.MECKY_PUBKEY ?? "";
  const caseStewardToken = environment.CASE_STEWARD_TOKEN ?? "";
  const citizenRelayAdmissionToken =
    environment.CITIZEN_RELAY_ADMISSION_TOKEN ?? "";
  const port = Number(environment.WORKBENCH_PORT ?? "18083");
  const bindHost = environment.WORKBENCH_BIND_HOST ?? "0.0.0.0";
  if (
    !HEX64.test(meckyPubkey) ||
    publicKeys.has(meckyPubkey) ||
    legacySyntheticPubkeys.includes(meckyPubkey) ||
    citizenRelayAdmissionToken.length < 32 ||
    /\s/.test(citizenRelayAdmissionToken)
  )
    throw new Error("workbench_identity_invalid");
  if (
    mode === "isolated-fixture" &&
    (caseStewardToken.length < 32 || /\s/.test(caseStewardToken))
  ) {
    throw new Error("workbench_identity_invalid");
  }
  if (
    (bindHost !== "0.0.0.0" && bindHost !== "127.0.0.1") ||
    !Number.isSafeInteger(port) ||
    port < 0 ||
    port > 65_535
  )
    throw new Error("workbench_listener_invalid");
  return {
    agentRelayUrl: relayUrl(environment.AGENT_RELAY_URL ?? "", "agent-relay"),
    bindHost,
    citizenRelayAdmissionToken,
    citizenRelayUrl: relayUrl(
      environment.CITIZEN_RELAY_URL ?? "",
      "citizen-relay"
    ),
    ...(mode === "isolated-fixture"
      ? {
          caseStewardToken,
          controlBaseUrl: serviceUrl(
            environment.STADTSTACK_CONTROL_BASE_URL ?? "",
            "stadtstack-control",
            18081
          ),
        }
      : {}),
    gnosisRpcUrl: externalHttpsUrl(
      environment.GNOSIS_RPC_URL ?? "",
      "gnosis_rpc_url"
    ),
    legacySyntheticPubkeys,
    meckyPubkey,
    mode,
    personas,
    port,
  };
}

function nodeRelay(url: string): RelayPort {
  return new RelayClient(url, {
    timeoutMs: 8_000,
    webSocketFactory: (target) => new WebSocket(target) as never,
  });
}

function json(
  response: ServerResponse,
  status: number,
  value: unknown,
  omitBody = false
): void {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
    "x-content-type-options": "nosniff",
  });
  response.end(omitBody ? undefined : body);
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > MAX_BODY) throw new Error("body_too_large");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function persona(config: WorkbenchConfig, id: unknown): Persona {
  const value = config.personas.find((candidate) => candidate.id === id);
  if (!value) throw new Error("persona_invalid");
  return value;
}

function event(value: unknown): NostrEvent {
  if (
    !exactRecord(value, [
      "id",
      "pubkey",
      "created_at",
      "kind",
      "tags",
      "content",
      "sig",
    ]) ||
    !verifyEvent(value as unknown as NostrEvent)
  )
    throw new Error("event_invalid");
  return value as unknown as NostrEvent;
}

function uniqueEvents(...groups: readonly (readonly NostrEvent[])[]): NostrEvent[] {
  return [
    ...new Map(
      groups.flatMap((group) => group).map((entry) => [entry.id, entry])
    ).values(),
  ];
}

function secret(persona: Persona): Uint8Array {
  return Uint8Array.from(Buffer.from(persona.secretKeyHex, "hex"));
}

function tagValue(event: NostrEvent, name: string): string | null {
  return (
    event.tags.find(
      (tag) => tag[0] === name && typeof tag[1] === "string"
    )?.[1] ?? null
  );
}

function sourceAppPostIdFor(event: NostrEvent): string | null {
  const matches = event.tags.filter((tag) => tag[0] === "source-app-post");
  return matches.length === 1 &&
    matches[0]!.length === 2 &&
    UUID.test(matches[0]![1] ?? "")
    ? matches[0]![1]!
    : null;
}

function sourceAppCommentIdFor(event: NostrEvent): string | null {
  const matches = event.tags.filter((tag) => tag[0] === "source-app-comment");
  return matches.length === 1 &&
    matches[0]!.length === 2 &&
    UUID.test(matches[0]![1] ?? "")
    ? matches[0]![1]!
    : null;
}

type SelectedConversationSource = {
  sourceAppPostId: string;
  sourceAppCommentId: string | null;
  mentionEventId: string;
  replyEventId: string;
  receiptId: string | null;
};

type SelectedConversationProjection = {
  sourceAppPostId: string;
  sourceAppCommentId: string | null;
  mentionId: string;
  replyId: string;
  receiptId: string | null;
  mentionAuthor: PublicAuthor;
  evidenceRefs: Array<{ digest: string; url: string }>;
};

const SELECTED_CONVERSATION_TAGS = new Set([
  "source-app-post",
  "source-app-comment",
  "source-conversation-mention",
  "source-mecky-reply",
  "source-mecky-receipt",
]);

function selectedConversationSourceFor(
  candidate: NostrEvent,
  strict = false
): SelectedConversationSource | null {
  try {
    const selectedTags = candidate.tags.filter((tag) =>
      SELECTED_CONVERSATION_TAGS.has(tag[0] ?? "")
    );
    if (selectedTags.length === 0) return null;
    const exact = (name: string, pattern: RegExp, optional = false) => {
      const matches = selectedTags.filter((tag) => tag[0] === name);
      if (optional && matches.length === 0) return null;
      if (
        matches.length !== 1 ||
        matches[0]!.length !== 2 ||
        !pattern.test(matches[0]![1] ?? "")
      ) {
        throw new Error("signed_promotion_conversation_invalid");
      }
      return matches[0]![1]!;
    };
    return {
      sourceAppPostId: exact("source-app-post", UUID)!,
      sourceAppCommentId: exact("source-app-comment", UUID, true),
      mentionEventId: exact("source-conversation-mention", HEX64)!,
      replyEventId: exact("source-mecky-reply", HEX64)!,
      receiptId: exact(
        "source-mecky-receipt",
        /^urn:stadtstack:mecky-answer:[0-9a-f]{64}$/,
        true
      ),
    };
  } catch (error) {
    if (strict) throw error;
    return null;
  }
}

type VerifiedAppConversationReply = {
  receiptId: string | null;
  evidenceRefs: Array<{ digest: string; url: string }>;
};

type VerifiedCivicRootAnswer = {
  receiptId: string;
  evidenceRefs: Array<{ digest: string; url: string }>;
};

/**
 * The public feed and thread deliberately share the same closed answer
 * boundary as a participant suggestion. A Mecky signature alone is not an
 * answer: it must bind the exact civic root, app-post source, topic, receipt,
 * and public evidence in one canonical tag sequence.
 */
function verifiedCivicRootAnswerFor(
  config: WorkbenchConfig,
  root: NostrEvent,
  reply: NostrEvent
): VerifiedCivicRootAnswer | null {
  const conversation = selectedConversationSourceFor(root);
  const topic = topicFor(root);
  const municipalityId = tagValue(root, "municipality");
  if (!conversation || !topic || !municipalityId) return null;

  const baseTags = [
    ["e", root.id, "", "reply"],
    ["p", root.pubkey],
    ["source-app-post", conversation.sourceAppPostId],
    ...(conversation.sourceAppCommentId === null
      ? []
      : [["source-app-comment", conversation.sourceAppCommentId]]),
  ];
  const firstEvidenceIndex = 1 + baseTags.length + 3;
  const agent = reply.tags[0];
  const receipt = reply.tags[1 + baseTags.length];
  const municipality = reply.tags[2 + baseTags.length];
  const eventTopic = reply.tags[3 + baseTags.length];
  const evidence = reply.tags.slice(firstEvidenceIndex);
  if (
    !verifyEvent(reply) ||
    reply.kind !== 1 ||
    reply.pubkey !== config.meckyPubkey ||
    !Number.isSafeInteger(reply.created_at) ||
    reply.created_at < root.created_at ||
    reply.content !== reply.content.trim() ||
    reply.content.length < 1 ||
    reply.content.length > 2_000 ||
    !agent ||
    agent.length !== 3 ||
    agent[0] !== "netizen_agent" ||
    !agent[1] ||
    agent[1] !== agent[1].trim() ||
    agent[1].length > 120 ||
    !agent[2] ||
    agent[2] !== agent[2].trim() ||
    agent[2].length > 120 ||
    baseTags.some(
      (tag, index) =>
        JSON.stringify(reply.tags[index + 1]) !== JSON.stringify(tag)
    ) ||
    !receipt ||
    receipt.length !== 2 ||
    receipt[0] !== "mecky-receipt" ||
    !/^urn:stadtstack:mecky-answer:[0-9a-f]{64}$/.test(receipt[1] ?? "") ||
    JSON.stringify(municipality) !==
      JSON.stringify(["municipality", municipalityId]) ||
    JSON.stringify(eventTopic) !== JSON.stringify(["topic", topic.id]) ||
    evidence.length < 1 ||
    evidence.length > 3 ||
    evidence.some(
      (tag) =>
        tag.length !== 3 ||
        tag[0] !== "evidence" ||
        !SHA256.test(tag[1] ?? "") ||
        (tag[2] ?? "").length > 2_048 ||
        (() => {
          try {
            const url = new URL(tag[2] ?? "");
            return url.protocol !== "https:" || !!url.username || !!url.password;
          } catch {
            return true;
          }
        })()
    ) ||
    new Set(evidence.map((tag) => tag[1])).size !== evidence.length
  ) {
    return null;
  }
  return {
    receiptId: receipt[1]!,
    evidenceRefs: evidence.map((tag) => ({ digest: tag[1]!, url: tag[2]! })),
  };
}

function verifiedAppConversationReplyFor(
  config: WorkbenchConfig,
  mention: NostrEvent,
  reply: NostrEvent
): VerifiedAppConversationReply | null {
  const replyParentTags = reply.tags.filter((tag) => tag[0] === "e");
  const replyAuthorTags = reply.tags.filter((tag) => tag[0] === "p");
  const replyAgentTags = reply.tags.filter(
    (tag) => tag[0] === "netizen_agent"
  );
  const replySourcePostTags = reply.tags.filter(
    (tag) => tag[0] === "source-app-post"
  );
  const replySourceCommentTags = reply.tags.filter(
    (tag) => tag[0] === "source-app-comment"
  );
  const evidenceTags = reply.tags.filter((tag) => tag[0] === "evidence");
  const evidenceRefs = evidenceTags.flatMap((tag) => {
    if (
      tag.length !== 3 ||
      !SHA256.test(tag[1] ?? "") ||
      !/^https:\/\//.test(tag[2] ?? "") ||
      (tag[2] ?? "").length > 2_048
    ) {
      return [];
    }
    try {
      const url = new URL(tag[2]!);
      if (url.protocol !== "https:" || url.username || url.password) return [];
    } catch {
      return [];
    }
    return [{ digest: tag[1]!, url: tag[2]! }];
  });
  const replyReceiptTags = reply.tags.filter(
    (tag) => tag[0] === "mecky-receipt"
  );
  const receiptId =
    replyReceiptTags.length === 0
      ? null
      : replyReceiptTags.length === 1 &&
          replyReceiptTags[0]!.length === 2 &&
          /^urn:stadtstack:mecky-answer:[0-9a-f]{64}$/.test(
            replyReceiptTags[0]![1] ?? ""
          )
        ? replyReceiptTags[0]![1]!
        : undefined;
  const sourceAppPostId = sourceAppPostIdFor(mention);
  const sourceAppCommentId = sourceAppCommentIdFor(mention);
  if (
    !isAppConversationMention(config, mention) ||
    reply.kind !== 1 ||
    !verifyEvent(reply) ||
    reply.pubkey !== config.meckyPubkey ||
    !isAgentEvent(reply) ||
    replyParentTags.length !== 1 ||
    replyParentTags[0]!.length !== 4 ||
    replyParentTags[0]![1] !== mention.id ||
    replyParentTags[0]![2] !== "" ||
    replyParentTags[0]![3] !== "reply" ||
    replyAuthorTags.length !== 1 ||
    replyAuthorTags[0]!.length !== 2 ||
    replyAuthorTags[0]![1] !== mention.pubkey ||
    replyAgentTags.length !== 1 ||
    replyAgentTags[0]!.length !== 3 ||
    !(replyAgentTags[0]![1] ?? "") ||
    !(replyAgentTags[0]![2] ?? "") ||
    (replyAgentTags[0]![1] ?? "").length > 120 ||
    (replyAgentTags[0]![2] ?? "").length > 120 ||
    replySourcePostTags.length !== 1 ||
    replySourcePostTags[0]!.length !== 2 ||
    replySourceCommentTags.length !== (sourceAppCommentId === null ? 0 : 1) ||
    (replySourceCommentTags[0] !== undefined &&
      (replySourceCommentTags[0]!.length !== 2 ||
        replySourceCommentTags[0]![1] !== sourceAppCommentId)) ||
    sourceAppPostId === null ||
    sourceAppPostIdFor(reply) !== sourceAppPostId ||
    sourceAppCommentIdFor(reply) !== sourceAppCommentId ||
    mention.created_at > reply.created_at ||
    evidenceRefs.length < 1 ||
    evidenceRefs.length > 3 ||
    evidenceRefs.length !== evidenceTags.length ||
    new Set(evidenceRefs.map((entry) => entry.digest)).size !==
      evidenceRefs.length ||
    receiptId === undefined
  ) {
    return null;
  }
  return { receiptId, evidenceRefs };
}

function selectedConversationProjectionFor(
  config: WorkbenchConfig,
  promotion: NostrEvent,
  citizenEvents: readonly NostrEvent[],
  agentEvents: readonly NostrEvent[]
): SelectedConversationProjection | null {
  const selected = selectedConversationSourceFor(promotion);
  if (!selected) return null;
  const sourcePostId = tagValue(promotion, "source-post");
  const sourcePost = citizenEvents.find(
    (candidate) => candidate.id === sourcePostId && verifyEvent(candidate)
  );
  const mention = citizenEvents.find(
    (candidate) => candidate.id === selected.mentionEventId && verifyEvent(candidate)
  );
  const reply = agentEvents.find(
    (candidate) => candidate.id === selected.replyEventId && verifyEvent(candidate)
  );
  const verifiedReply =
    mention && reply
      ? verifiedAppConversationReplyFor(config, mention, reply)
      : null;
  if (
    !sourcePost ||
    sourcePost.pubkey !== promotion.pubkey ||
    sourceAppPostIdFor(sourcePost) !== selected.sourceAppPostId ||
    !mention ||
    !isAppConversationMention(config, mention) ||
    sourceAppPostIdFor(mention) !== selected.sourceAppPostId ||
    sourceAppCommentIdFor(mention) !== selected.sourceAppCommentId ||
    !reply ||
    verifiedReply === null ||
    sourcePost.created_at > mention.created_at ||
    reply.created_at > promotion.created_at ||
    selected.receiptId !== verifiedReply.receiptId
  ) {
    return null;
  }
  return {
    sourceAppPostId: selected.sourceAppPostId,
    sourceAppCommentId: selected.sourceAppCommentId,
    mentionId: selected.mentionEventId,
    replyId: selected.replyEventId,
    receiptId: selected.receiptId,
    mentionAuthor: authorFor(config, mention),
    evidenceRefs: verifiedReply.evidenceRefs,
  };
}

function selectedConversationWitnessesFor(
  config: WorkbenchConfig,
  promotion: NostrEvent,
  citizenEvents: readonly NostrEvent[],
  agentEvents: readonly NostrEvent[]
): {
  conversationTopic: typeof APP_CONVERSATION_TOPIC;
  mentionEvent: NostrEvent;
  replyEvent: NostrEvent;
} | null {
  const projection = selectedConversationProjectionFor(
    config,
    promotion,
    citizenEvents,
    agentEvents
  );
  if (!projection) return null;
  const mentionEvent = citizenEvents.find(
    (candidate) => candidate.id === projection.mentionId
  );
  const replyEvent = agentEvents.find(
    (candidate) => candidate.id === projection.replyId
  );
  if (!mentionEvent || !replyEvent) return null;
  return {
    conversationTopic: APP_CONVERSATION_TOPIC,
    mentionEvent,
    replyEvent,
  };
}

function isAppConversationMention(
  config: WorkbenchConfig,
  candidate: NostrEvent
): boolean {
  const postId = sourceAppPostIdFor(candidate);
  const commentId = sourceAppCommentIdFor(candidate);
  return (
    postId !== null &&
    isAppConversationMentionEvent(candidate, {
      agentPubkey: config.meckyPubkey,
      sourceAppPostId: postId,
      sourceAppCommentId: commentId,
    })
  );
}

function topicFor(event: NostrEvent): { id: string; title: string } | null {
  const explicit = tagValue(event, "topic");
  const municipality = tagValue(event, "municipality");
  const sourceCase = tagValue(event, "case");
  const topicParts = explicit?.split(":") ?? [];
  const topicTitles = event.tags.filter(
    (tag) => tag[0] === "topic-title" && typeof tag[1] === "string"
  );
  if (
    topicParts.length === 6 &&
    topicParts.slice(0, 4).join(":") === "urn:stadtstack:topic:municipality" &&
    topicParts[4] === municipality &&
    SLUG.test(municipality ?? "") &&
    SLUG.test(topicParts[5] ?? "") &&
    topicTitles.length === 1 &&
    topicTitles[0]!.length === 2 &&
    topicTitles[0]![1] === topicTitles[0]![1]!.trim() &&
    topicTitles[0]![1]!.length >= 3 &&
    topicTitles[0]![1]!.length <= 120 &&
    !/[\u0000-\u001f\u007f]/.test(topicTitles[0]![1]!)
  ) {
    return { id: explicit!, title: topicTitles[0]![1]! };
  }
  if (
    (explicit === MARIENFELDER_TOPIC_ID || explicit === null) &&
    municipality === "roebel-mueritz" &&
    sourceCase === "marienfelder-strasse"
  )
    return { id: MARIENFELDER_TOPIC_ID, title: MARIENFELDER_TOPIC_TITLE };
  return null;
}

function caseBindingFor(event: NostrEvent): {
  municipalityId: string;
  sourceCaseId: string;
  canonicalCaseId: string;
} | null {
  const municipalityId = tagValue(event, "municipality");
  const sourceCaseId = tagValue(event, "case");
  const canonicalCaseId = tagValue(event, "stadtstack-case");
  return municipalityId && sourceCaseId && canonicalCaseId
    ? { municipalityId, sourceCaseId, canonicalCaseId }
    : null;
}

function isExactLegacyMarienfelderPromotion(
  config: WorkbenchConfig,
  candidate: NostrEvent,
  sourcePost: NostrEvent
): boolean {
  return (
    candidate.kind === 1 &&
    verifyEvent(candidate) &&
    isSyntheticCitizen(config, candidate.pubkey) &&
    candidate.pubkey === sourcePost.pubkey &&
    candidate.created_at > sourcePost.created_at &&
    candidate.content === candidate.content.trim() &&
    candidate.content.length > 0 &&
    candidate.content.length <= 2_000 &&
    /@mecky\b/i.test(candidate.content) &&
    JSON.stringify(candidate.tags) ===
      JSON.stringify([
        ["p", config.meckyPubkey],
        ["q", sourcePost.id, "", sourcePost.pubkey],
        ["source-post", sourcePost.id],
        ["t", "stadtstack-civic-discussion"],
        ["municipality", "roebel-mueritz"],
        ["case", "marienfelder-strasse"],
        ["topic", MARIENFELDER_TOPIC_ID],
        ["stadtstack-case", CASE_ID],
        ["stance", "root"],
        ["argument-root", "self"],
      ])
  );
}

function isExactInteractiveMarienfelderRoot(
  config: WorkbenchConfig,
  candidate: NostrEvent
): boolean {
  return (
    candidate.kind === 1 &&
    verifyEvent(candidate) &&
    isSyntheticCitizen(config, candidate.pubkey) &&
    candidate.content === candidate.content.trim() &&
    candidate.content.length > 0 &&
    candidate.content.length <= 2_000 &&
    /@mecky\b/i.test(candidate.content) &&
    JSON.stringify(candidate.tags) ===
      JSON.stringify([
        ["p", config.meckyPubkey],
        ["t", "stadtstack-civic-discussion"],
        ["municipality", "roebel-mueritz"],
        ["case", "marienfelder-strasse"],
        ["stadtstack-case", CASE_ID],
      ])
  );
}

function isExactSeededMarienfelderGraphRoot(
  config: WorkbenchConfig,
  candidate: NostrEvent
): boolean {
  return (
    candidate.kind === 1 &&
    verifyEvent(candidate) &&
    isSyntheticCitizen(config, candidate.pubkey) &&
    candidate.content === candidate.content.trim() &&
    candidate.content.length > 0 &&
    candidate.content.length <= 2_000 &&
    /@mecky\b/i.test(candidate.content) &&
    JSON.stringify(candidate.tags) ===
      JSON.stringify([
        ["p", config.meckyPubkey],
        ["t", "stadtstack-civic-discussion"],
        ["municipality", "roebel-mueritz"],
        ["case", "marienfelder-strasse"],
        ["topic", MARIENFELDER_TOPIC_ID],
        ["stadtstack-case", CASE_ID],
        ["stance", "root"],
        ["argument-root", "self"],
      ])
  );
}

function hasValidDiscussionRootEnvelope(
  config: WorkbenchConfig,
  candidate: NostrEvent,
  citizenEvents: readonly NostrEvent[]
): boolean {
  const sourcePostId = tagValue(candidate, "source-post");
  if (sourcePostId === null) {
    return (
      isExactInteractiveMarienfelderRoot(config, candidate) ||
      isExactSeededMarienfelderGraphRoot(config, candidate)
    );
  }
  const sourcePost = citizenEvents.find(
    (entry) => entry.id === sourcePostId && verifyEvent(entry)
  );
  return (
    sourcePost !== undefined &&
    (verifyCivicTopicPromotionEvent({
      event: candidate,
      sourcePost,
      municipalityId: "roebel-mueritz",
      agentPubkey: config.meckyPubkey,
    }) !== null ||
      isExactLegacyMarienfelderPromotion(config, candidate, sourcePost))
  );
}

function verifiedTopicSuggestionFor(
  config: WorkbenchConfig,
  citizenEvents: readonly NostrEvent[],
  agentEvents: readonly NostrEvent[],
  rootEvent: NostrEvent
): CitizenSignedTopicSuggestionV1 | ParticipantTopicSuggestionV1 | null {
  const topic = topicFor(rootEvent);
  if (!topic || caseBindingFor(rootEvent) !== null) return null;
  const sourcePostId = tagValue(rootEvent, "source-post");
  const sourcePost = sourcePostId
    ? citizenEvents.find(
        (candidate) => candidate.id === sourcePostId && verifyEvent(candidate)
      )
    : undefined;
  const selectedConversation = selectedConversationSourceFor(rootEvent);
  const conversationWitnesses = selectedConversation
    ? selectedConversationWitnessesFor(
        config,
        rootEvent,
        citizenEvents,
        agentEvents
      )
    : undefined;
  const suggestions = citizenEvents
    .filter(verifyEvent)
    .filter((candidate) => {
      const schema = tagValue(candidate, "schema");
      return (
        (schema === "citizen_signed_topic_suggestion_v1" ||
          schema === "staging_participant_signed_topic_suggestion_v1") &&
        candidate.tags.some(
          (tag) =>
            tag[0] === "e" &&
            tag[1] === rootEvent.id &&
            tag[3] === "root"
        )
      );
    })
    .sort(
      (a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id)
    )
    .flatMap(
      (
        candidate
      ): Array<CitizenSignedTopicSuggestionV1 | ParticipantTopicSuggestionV1> => {
        const receiptId = tagValue(candidate, "mecky-receipt");
        const sourceAnswer = agentEvents
          .filter(
            (answer) =>
              verifyEvent(answer) && answer.pubkey === config.meckyPubkey
          )
          .find((answer) => tagValue(answer, "mecky-receipt") === receiptId);
        if (!sourceAnswer) return [];
        try {
          if (
            tagValue(candidate, "schema") ===
            "staging_participant_signed_topic_suggestion_v1"
          ) {
            if (!sourcePost || (selectedConversation && !conversationWitnesses))
              return [];
            return [
              verifyParticipantTopicSuggestion({
                binding: {
                  municipalityId: "roebel-mueritz",
                  topicId: topic.id,
                },
                sourcePost,
                sourceDiscussion: rootEvent,
                sourceAnswer,
                ...(conversationWitnesses ? { conversationWitnesses } : {}),
                agentPubkey: config.meckyPubkey,
                event: candidate,
              }),
            ];
          }
          return [
            verifyCitizenSignedTopicSuggestion({
              binding: {
                municipalityId: "roebel-mueritz",
                topicId: topic.id,
              },
              sourceDiscussion: rootEvent,
              sourceAnswer,
              agentPubkey: config.meckyPubkey,
              event: candidate,
            }),
          ];
        } catch {
          return [];
        }
      }
    );
  return suggestions[0] ?? null;
}

function authorFor(config: WorkbenchConfig, event: NostrEvent): PublicAuthor {
  const citizen = config.personas.find(
    (candidate) => candidate.publicKey === event.pubkey
  );
  if (citizen)
    return {
      name: citizen.name,
      kind: "citizen",
      pubkey: citizen.publicKey,
      synthetic: true,
    };
  if (event.pubkey === config.meckyPubkey)
    return {
      name: "Mecky",
      kind: "mecky",
      pubkey: event.pubkey,
      synthetic: false,
    };
  return {
    name: `Bürger:in ${event.pubkey.slice(0, 8)}`,
    kind: "citizen",
    pubkey: event.pubkey,
    synthetic: false,
  };
}

function isSyntheticCitizen(config: WorkbenchConfig, pubkey: string): boolean {
  return (
    config.personas.some((candidate) => candidate.publicKey === pubkey) ||
    config.legacySyntheticPubkeys.includes(pubkey)
  );
}

function asArgument(
  config: WorkbenchConfig,
  event: NostrEvent
): PublicArgument | null {
  if (event.kind !== 1 || !verifyEvent(event)) return null;
  const rootId = tagValue(event, "argument-root");
  const stance = tagValue(event, "stance");
  const parentId =
    event.tags.find((tag) => tag[0] === "e" && tag[3] === "reply")?.[1] ?? null;
  const interactiveCivicRoot =
    JSON.stringify(event.tags) ===
      JSON.stringify([
        ["p", config.meckyPubkey],
        ["t", "stadtstack-civic-discussion"],
        ["municipality", "roebel-mueritz"],
        ["case", "marienfelder-strasse"],
        ["stadtstack-case", CASE_ID],
      ]) && /@mecky\b/i.test(event.content);
  if (interactiveCivicRoot && parentId === null) {
    return {
      id: event.id,
      parentId: null,
      rootId: event.id,
      stance: "root",
      author: authorFor(config, event),
      content: event.content,
      createdAt: new Date(event.created_at * 1_000).toISOString(),
    };
  }
  if (rootId === "self" && stance === "root" && parentId === null) {
    return {
      id: event.id,
      parentId: null,
      rootId: event.id,
      stance: "root",
      author: authorFor(config, event),
      content: event.content,
      createdAt: new Date(event.created_at * 1_000).toISOString(),
    };
  }
  if (!rootId || (stance !== "pro" && stance !== "con") || !parentId)
    return null;
  return {
    id: event.id,
    parentId,
    rootId,
    stance,
    author: authorFor(config, event),
    content: event.content,
    createdAt: new Date(event.created_at * 1_000).toISOString(),
  };
}

function connectedArgumentsFor(
  rootIds: ReadonlySet<string>,
  candidates: readonly PublicArgument[]
): PublicArgument[] {
  const connectedRootById = new Map(
    [...rootIds].map((rootId) => [rootId, rootId] as const)
  );
  let changed = true;
  while (changed) {
    changed = false;
    for (const candidate of candidates) {
      if (
        candidate.stance === "root" ||
        connectedRootById.has(candidate.id) ||
        !rootIds.has(candidate.rootId) ||
        candidate.parentId === null ||
        connectedRootById.get(candidate.parentId) !== candidate.rootId
      ) {
        continue;
      }
      connectedRootById.set(candidate.id, candidate.rootId);
      changed = true;
    }
  }
  return candidates.filter((candidate) =>
    candidate.stance === "root"
      ? rootIds.has(candidate.id)
      : connectedRootById.get(candidate.id) === candidate.rootId
  );
}

async function publishSeed(
  config: WorkbenchConfig,
  relay: RelayPort
): Promise<void> {
  const anna = config.personas[0]!;
  const omar = config.personas[1]!;
  // Keep the deterministic seed stable across every same-day restart. The
  // watcher recovers unanswered signed mentions across the same reviewed day.
  const base = Math.floor(Date.now() / 86_400_000) * 86_400 - 60;
  const profiles = [
    buildProfileEvent(
      secret(anna),
      { name: anna.name, about: "Synthetisches Röbel-Testprofil" },
      { createdAt: base }
    ),
    buildProfileEvent(
      secret(omar),
      { name: omar.name, about: "Synthetisches Röbel-Testprofil" },
      { createdAt: base + 1 }
    ),
  ];
  const standalonePost = buildNoteEvent(
    secret(omar),
    "Am Hafen war heute viel los. Danke an alle, die beim Aufraeumen geholfen haben.",
    { createdAt: base + 5 }
  );
  const root = buildNoteEvent(
    secret(anna),
    "Soll die Querung der Marienfelder Straße sicherer und nachvollziehbarer geplant werden? @Mecky, welche geprüften Informationen liegen dazu vor?",
    {
      createdAt: base + 10,
      tags: [
        ["p", config.meckyPubkey],
        ["t", "stadtstack-civic-discussion"],
        ["municipality", "roebel-mueritz"],
        ["case", "marienfelder-strasse"],
        ["topic", MARIENFELDER_TOPIC_ID],
        ["stadtstack-case", CASE_ID],
        ["stance", "root"],
        ["argument-root", "self"],
      ],
    }
  );
  const graphRootId = root.id;
  const pro = buildNoteEvent(
    secret(omar),
    "Pro: Eine klar markierte und gut einsehbare Querung kann die Sichtbarkeit für alle Verkehrsteilnehmenden verbessern.",
    {
      createdAt: base + 20,
      tags: [
        ["e", graphRootId, "", "root"],
        ["e", graphRootId, "", "reply"],
        ["argument-root", graphRootId],
        ["stance", "pro"],
        ["t", "stadtstack-argument"],
      ],
    }
  );
  const con = buildNoteEvent(
    secret(anna),
    "Contra: Eine Einzelmaßnahme könnte falsche Sicherheit erzeugen; Geschwindigkeit, Beleuchtung und Wegeführung müssen gemeinsam geprüft werden.",
    {
      createdAt: base + 30,
      tags: [
        ["e", graphRootId, "", "root"],
        ["e", graphRootId, "", "reply"],
        ["argument-root", graphRootId],
        ["stance", "con"],
        ["t", "stadtstack-argument"],
      ],
    }
  );
  const sourcePost = buildNoteEvent(
    secret(omar),
    "Mir ist aufgefallen, dass viele Hinweise zur Marienfelder Straße im Feed verstreut bleiben.",
    { createdAt: base + 35 }
  );
  const secondRoot = buildCivicPromotionEvent(secret(omar), {
    sourcePost,
    municipalityId: "roebel-mueritz",
    sourceCaseId: "marienfelder-strasse",
    canonicalCaseId: CASE_ID,
    topicId: MARIENFELDER_TOPIC_ID,
    agentPubkey: config.meckyPubkey,
    content:
      "@Mecky, welche geprueften Informationen helfen, die verstreuten Hinweise gemeinsam abzuwägen?",
    createdAt: base + 40,
  });
  for (const seeded of [
    ...profiles,
    standalonePost,
    root,
    pro,
    con,
    sourcePost,
    secondRoot,
  ]) {
    const result = await relay.publish(seeded);
    if (!result.ok) throw new Error(`citizen_relay_${result.message}`);
  }
}

async function control(
  config: WorkbenchConfig,
  fetcher: typeof globalThis.fetch,
  path: string,
  value: unknown
): Promise<unknown> {
  if (!config.controlBaseUrl || !config.caseStewardToken)
    throw new Error("administration_disabled");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetcher(`${config.controlBaseUrl}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.caseStewardToken}`,
        "content-type": "application/json",
        "x-stadtstack-actor-id": "roebel:case-steward",
      },
      body: JSON.stringify(value),
      signal: controller.signal,
    });
    const responseValue = (await response.json()) as unknown;
    if (!response.ok) throw new Error(`control_${response.status}`);
    return responseValue;
  } finally {
    clearTimeout(timer);
  }
}

function publicStrings(value: unknown, limit: number): string[] {
  if (
    !Array.isArray(value) ||
    value.length > limit ||
    value.some((entry) => typeof entry !== "string")
  ) {
    throw new Error("public_administration_projection_invalid");
  }
  return [...value];
}

function checkedPublicDepartmentPackage(value: unknown): Record<string, unknown> {
  if (!exactRecord(value, PUBLIC_DEPARTMENT_PACKAGE_KEYS)) {
    throw new Error("public_administration_projection_invalid");
  }
  for (const key of PUBLIC_DEPARTMENT_PACKAGE_KEYS) {
    if (key !== "publicCitations" && typeof value[key] !== "string") {
      throw new Error("public_administration_projection_invalid");
    }
  }
  return {
    ...value,
    publicCitations: publicStrings(value.publicCitations, 32),
  };
}

function checkedPublicBrief(value: unknown): Record<string, unknown> {
  if (!exactRecord(value, PUBLIC_BRIEF_KEYS)) {
    throw new Error("public_administration_projection_invalid");
  }
  const responses = Array.isArray(value.responses)
    ? value.responses.map((entry) => {
        if (
          !exactRecord(entry, [
            "departmentId",
            "publicSummary",
            "publicCitations",
          ]) ||
          typeof entry.departmentId !== "string" ||
          typeof entry.publicSummary !== "string"
        ) {
          throw new Error("public_administration_projection_invalid");
        }
        return {
          departmentId: entry.departmentId,
          publicSummary: entry.publicSummary,
          publicCitations: publicStrings(entry.publicCitations, 32),
        };
      })
    : null;
  if (!responses || responses.length > 8) {
    throw new Error("public_administration_projection_invalid");
  }
  const provenance = value.provenance;
  if (
    !exactRecord(provenance, [
      "sourceDiscussionRef",
      "suggestionId",
      "packageBindings",
    ]) ||
    !exactRecord(provenance.sourceDiscussionRef, ["type", "id", "ref"]) ||
    typeof provenance.sourceDiscussionRef.type !== "string" ||
    typeof provenance.sourceDiscussionRef.id !== "string" ||
    typeof provenance.sourceDiscussionRef.ref !== "string" ||
    typeof provenance.suggestionId !== "string" ||
    !Array.isArray(provenance.packageBindings) ||
    provenance.packageBindings.length > 8
  ) {
    throw new Error("public_administration_projection_invalid");
  }
  const packageBindings = provenance.packageBindings.map((entry) => {
    const keys = [
      "packageId",
      "packageChecksum",
      "draftArtifactChecksum",
      "reviewAttestationChecksum",
      "departmentId",
      "reviewedAt",
    ];
    if (
      !exactRecord(entry, keys) ||
      keys.some((key) => typeof entry[key] !== "string")
    ) {
      throw new Error("public_administration_projection_invalid");
    }
    return { ...entry };
  });
  for (const key of PUBLIC_BRIEF_KEYS) {
    if (
      key !== "responses" &&
      key !== "provenance" &&
      typeof value[key] !== "string"
    ) {
      throw new Error("public_administration_projection_invalid");
    }
  }
  return {
    ...value,
    responses,
    provenance: {
      sourceDiscussionRef: { ...provenance.sourceDiscussionRef },
      suggestionId: provenance.suggestionId,
      packageBindings,
    },
  };
}

function checkedPublicCaseProjection(
  value: unknown,
  expectedCaseId: string
): Record<string, unknown> {
  if (
    !exactRecord(value, [
      "schemaVersion",
      "caseId",
      "caseVersion",
      "journalHeadChecksum",
      "projectionChecksum",
      "visibility",
      "policyVersion",
      "projection",
    ]) ||
    value.schemaVersion !== "projection_envelope_v1" ||
    value.caseId !== expectedCaseId ||
    value.visibility !== "public" ||
    !Number.isSafeInteger(value.caseVersion) ||
    Number(value.caseVersion) < 1 ||
    typeof value.journalHeadChecksum !== "string" ||
    !SHA256.test(value.journalHeadChecksum) ||
    typeof value.projectionChecksum !== "string" ||
    !SHA256.test(value.projectionChecksum) ||
    typeof value.policyVersion !== "string" ||
    !value.policyVersion ||
    !value.projection ||
    typeof value.projection !== "object" ||
    Array.isArray(value.projection)
  ) {
    throw new Error("public_administration_projection_invalid");
  }
  const projection = value.projection as Record<string, unknown>;
  const suggestion = projection.suggestion;
  if (
    Object.keys(projection).some(
      (key) => !PUBLIC_CASE_PROJECTION_KEYS.has(key)
    ) ||
    projection.schemaVersion !== "case_projection_v1" ||
    projection.caseId !== expectedCaseId ||
    projection.municipalityId !== "roebel-mueritz" ||
    projection.authorityBinding !== "none" ||
    projection.formalDecision !== null ||
    !suggestion ||
    typeof suggestion !== "object" ||
    Array.isArray(suggestion) ||
    (suggestion as Record<string, unknown>).status !== "admitted"
  ) {
    throw new Error("public_administration_projection_invalid");
  }
  const rawDepartmentPackages = projection.departmentPackages ?? [];
  if (!Array.isArray(rawDepartmentPackages) || rawDepartmentPackages.length > 8) {
    throw new Error("public_administration_projection_invalid");
  }
  const departmentPackages = rawDepartmentPackages.map(
    checkedPublicDepartmentPackage
  );
  const departmentPackage =
    projection.departmentPackage === undefined
      ? undefined
      : checkedPublicDepartmentPackage(projection.departmentPackage);
  const reviewedCitizenBrief =
    projection.reviewedCitizenBrief === undefined
      ? undefined
      : checkedPublicBrief(projection.reviewedCitizenBrief);
  return {
    schemaVersion: value.schemaVersion,
    caseId: value.caseId,
    caseVersion: value.caseVersion,
    journalHeadChecksum: value.journalHeadChecksum,
    projectionChecksum: value.projectionChecksum,
    visibility: value.visibility,
    policyVersion: value.policyVersion,
    projection: {
      schemaVersion: projection.schemaVersion,
      caseId: projection.caseId,
      municipalityId: projection.municipalityId,
      authorityBinding: projection.authorityBinding,
      formalDecision: null,
      suggestion: { status: "admitted" },
      departmentPackages,
      ...(departmentPackage === undefined ? {} : { departmentPackage }),
      ...(reviewedCitizenBrief === undefined
        ? {}
        : { reviewedCitizenBrief }),
    },
  };
}

async function admitToCitizenRelay(
  config: WorkbenchConfig,
  fetcher: typeof globalThis.fetch,
  pubkey: string
): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetcher(
      `${config.citizenRelayUrl.replace(/^ws:/, "http:")}/internal/admissions`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.citizenRelayAdmissionToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          schemaVersion: "roebel_staging_relay_admission_v1",
          pubkey,
        }),
        signal: controller.signal,
      }
    );
    if (!response.ok)
      throw new Error(`citizen_relay_admission_${response.status}`);
  } finally {
    clearTimeout(timer);
  }
}

const HTML = `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="icon" href="data:,"><title>Röbel × Stadtstack E2E</title>
<style>
:root{font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#102a27;background:#f3f7f4}*{box-sizing:border-box}body{margin:0}header{background:#0d5146;color:white;padding:1.2rem 5vw}header p{margin:.4rem 0 0;max-width:70ch}.warning{background:#ffefb0;color:#503d00;padding:.7rem 5vw;font-weight:700}main{max-width:1100px;margin:auto;padding:2rem 5vw 4rem}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:1rem}.card{background:white;border:1px solid #cddbd5;border-radius:16px;padding:1rem;box-shadow:0 4px 18px #16372f12}.card h2{font-size:1.05rem;margin:.2rem 0 .8rem}.step{color:#0d6b5c;font-weight:800}.row{display:flex;gap:.6rem;flex-wrap:wrap}label{display:block;font-weight:700;margin:.6rem 0 .3rem}textarea,select,input{width:100%;padding:.75rem;border:1px solid #9eb5ad;border-radius:10px;font:inherit}button{border:0;border-radius:999px;padding:.7rem 1rem;background:#0d6b5c;color:white;font-weight:800;cursor:pointer}button.secondary{background:#ddeae5;color:#143d35}button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible{outline:3px solid #ffba2f;outline-offset:2px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#eef5f2;padding:.75rem;border-radius:10px;min-height:3rem}.ok{color:#08733f}.error{color:#a32323}@media(max-width:640px){main{padding:1rem}.grid{grid-template-columns:1fr}}
</style></head><body>
<header><h1>Röbel × Stadtstack: kompletter Testfluss</h1><p>Diskussion → Mecky → signierter Vorschlag → Verwaltung → Citizen Brief → beratendes Mitmachen → Council-Dry-Run.</p></header>
<div class="warning">Synthetische Testumgebung · keine Produktion · keine amtliche Entscheidung · keine echte Abstimmung</div>
<main><section class="grid">
<article class="card"><div class="step">1 · Bürgerdiskussion</div><h2>Synthetische Person</h2><label for="persona">Person</label><select id="persona"></select><label for="question">Frage an Mecky</label><textarea id="question" rows="4">Wie kann die Querung der Marienfelder Straße sicherer werden?</textarea><button id="publish">Signiert diskutieren</button><pre id="discussion">Noch nicht gestartet.</pre></article>
<article class="card"><div class="step">2 · Public Mecky (Pi 0.84.1)</div><h2>Geprüfte Antwort</h2><p>Mecky darf nur aus dem checksum-gebundenen Testnachweis antworten.</p><button id="poll">Antwort abrufen</button><pre id="answer">Noch keine Antwort.</pre></article>
<article class="card"><div class="step">3 · Bürger-Signatur</div><h2>Vorschlag bearbeiten</h2><label for="title">Titel</label><input id="title" value="Sichere Querung prüfen"><label for="summary">Zusammenfassung</label><textarea id="summary" rows="4">Geprüfte Varianten sollen öffentlich und nachvollziehbar abgewogen werden.</textarea><button id="sign">Vorschlag signieren</button><pre id="suggestion">Noch nicht signiert.</pre></article>
<article class="card"><div class="step">4 · Warten auf menschliche Aufnahme</div><h2>Rollengetrennter Case Steward</h2><p>Der signierte Vorschlag wartet auf eine getrennte, berechtigte Case-Steward-Aufnahme. Diese öffentliche Testoberfläche besitzt keine Verwaltungsbefehle; Mecky darf den Vorschlag nicht einreichen.</p><pre>Awaiting role-isolated Case Steward admission.</pre></article>
<article class="card"><div class="step">5 · Verwaltung und Mitmachen</div><h2>Öffentlicher Fortschritt nach Aufnahme</h2><p>Nach einer getrennten menschlichen Aufnahme können geprüfte Verwaltungsinformationen, Citizen Brief und beratendes Mitmachen über die öffentliche, nur lesbare Fallprojektion erscheinen.</p><pre>Keine Verwaltungs-, Beteiligungs-, Governance- oder Treasury-Aktion in dieser Oberfläche.</pre></article>
</section></main>
<script>
const base='/stadtstack-test';const state={discussion:null,answer:null,suggestion:null};const $=id=>document.getElementById(id);async function api(path,body){const response=await fetch(path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'content-type':'application/json','x-stadtstack-e2e':'1'},body:body===undefined?undefined:JSON.stringify(body)});const value=await response.json();if(!response.ok)throw new Error(value.error||('HTTP '+response.status));return value}function show(id,value){$(id).textContent=typeof value==='string'?value:JSON.stringify(value,null,2)}
api(base+'/api/config').then(config=>{for(const person of config.personas){const option=document.createElement('option');option.value=person.id;option.textContent=person.name+' · '+person.publicKey.slice(0,12)+'…';$('persona').append(option)}}).catch(error=>show('discussion',error.message));
$('publish').onclick=async()=>{try{state.discussion=await api(base+'/api/discussion',{personaId:$('persona').value,question:$('question').value});show('discussion',state.discussion)}catch(error){show('discussion',error.message)}};
$('poll').onclick=async()=>{try{if(!state.discussion)throw new Error('Zuerst Diskussion starten.');state.answer=await api(base+'/api/reply?parent='+encodeURIComponent(state.discussion.event.id));show('answer',state.answer||'Mecky hat noch nicht geantwortet.')}catch(error){show('answer',error.message)}};
$('sign').onclick=async()=>{try{if(!state.discussion||!state.answer)throw new Error('Diskussion und Mecky-Antwort fehlen.');state.suggestion=await api(base+'/api/suggestion',{personaId:$('persona').value,discussion:state.discussion.event,answer:state.answer.event,title:$('title').value,summary:$('summary').value});show('suggestion',state.suggestion)}catch(error){show('suggestion',error.message)}};
</script></body></html>`;

const PUBLIC_SIGNED_HTML = `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Röbel × Stadtstack</title></head><body><main><h1>Röbel × Stadtstack</h1>
<p>Öffentliche, signierte Staging-Diskussion. Diese Laufzeit nimmt ausschließlich browser-signierte Nostr-Ereignisse entgegen.</p>
<p>Keine synthetischen Profile, keine Verwaltungszugänge, keine Abstimmung und keine Treasury-Aktion.</p>
</main></body></html>`;

export async function startWorkbench(
  config: WorkbenchConfig,
  dependencies: WorkbenchDependencies = {}
): Promise<RunningWorkbench> {
  const citizenRelay =
    dependencies.citizenRelay ?? nodeRelay(config.citizenRelayUrl);
  const agentRelay = dependencies.agentRelay ?? nodeRelay(config.agentRelayUrl);
  const fetcher = dependencies.fetch ?? globalThis.fetch;
  const verifyWalletSignature =
    dependencies.verifyWalletSignature ??
    createGnosisWalletVerifier({ rpcUrl: config.gnosisRpcUrl })
      .verifyWalletSignature;
  const admitPubkey =
    dependencies.admitPubkey ??
    ((pubkey: string) => admitToCitizenRelay(config, fetcher, pubkey));
  const signedEventForWrite = (value: unknown): NostrEvent => {
    const signed = event(value);
    if (
      config.mode === "public-signed-only" &&
      isSyntheticCitizen(config, signed.pubkey)
    )
      throw new Error("signed_event_legacy_identity");
    return signed;
  };
  const signedPromotionWrites = new Map<string, Promise<NostrEvent>>();
  const signedSuggestionWrites = new Map<string, Promise<NostrEvent>>();
  const publishSignedPromotionOnce = async (
    signed: NostrEvent,
    sourcePost: NostrEvent
  ): Promise<{ event: NostrEvent; alreadyPromoted: boolean }> => {
    const sourcePostId = sourcePost.id;
    const claimKey = `${signed.pubkey}:${sourcePostId}`;
    const activeWrite = signedPromotionWrites.get(claimKey);
    if (activeWrite) {
      return {
        event: await activeWrite,
        alreadyPromoted: true,
      };
    }
    let restoredExisting = false;
    const write = (async () => {
      const candidates = (
        await citizenRelay.query([
          {
            kinds: [1],
            authors: [signed.pubkey],
            "#q": [sourcePostId],
            limit: 20,
          },
        ])
      )
        .filter(verifyEvent)
        .filter(
          (candidate) =>
            candidate.pubkey === signed.pubkey &&
            tagValue(candidate, "source-post") === sourcePostId &&
            verifyCivicTopicPromotionEvent({
              event: candidate,
              sourcePost,
              municipalityId: "roebel-mueritz",
              agentPubkey: config.meckyPubkey,
            }) !== null
        )
        .sort(
          (left, right) =>
            left.created_at - right.created_at || left.id.localeCompare(right.id)
        );
      let existing: NostrEvent | undefined;
      for (const candidate of candidates) {
        const selected = selectedConversationSourceFor(candidate);
        if (selected !== null) {
          const [mentions, replies] = await Promise.all([
            citizenRelay.query([
              { ids: [selected.mentionEventId], kinds: [1], limit: 1 },
            ]),
            agentRelay.query([
              {
                ids: [selected.replyEventId],
                authors: [config.meckyPubkey],
                kinds: [1],
                limit: 1,
              },
            ]),
          ]);
          if (
            selectedConversationProjectionFor(
              config,
              candidate,
              [
                sourcePost,
                ...mentions
                  .filter(verifyEvent)
                  .filter(
                    (mention) =>
                      config.mode !== "public-signed-only" ||
                      !isSyntheticCitizen(config, mention.pubkey)
                  ),
              ],
              replies.filter(verifyEvent)
            ) === null
          ) {
            continue;
          }
        }
        existing = candidate;
        break;
      }
      if (existing) {
        restoredExisting = true;
        return existing;
      }
      const published = await citizenRelay.publish(signed);
      if (!published.ok)
        throw new Error(`citizen_relay_${published.message}`);
      return signed;
    })();
    signedPromotionWrites.set(claimKey, write);
    try {
      return {
        event: await write,
        alreadyPromoted: restoredExisting,
      };
    } finally {
      if (signedPromotionWrites.get(claimKey) === write)
        signedPromotionWrites.delete(claimKey);
    }
  };
  const exactSourceNote = async (input: { sourceNoteEventId: string; sourceAuthorPubkey: string; sourceAppPostId: string }) => {
    if (!HEX64.test(input.sourceNoteEventId) || !HEX64.test(input.sourceAuthorPubkey) || !UUID.test(input.sourceAppPostId)) return null;
    if (
      config.mode === "public-signed-only" &&
      isSyntheticCitizen(config, input.sourceAuthorPubkey)
    )
      return null;
    const notes = await citizenRelay.query([{ ids: [input.sourceNoteEventId], authors: [input.sourceAuthorPubkey], kinds: [1], limit: 1 }]);
    const note = notes.find((candidate) => candidate.id === input.sourceNoteEventId && candidate.pubkey === input.sourceAuthorPubkey &&
      isAppConversationMentionEvent(candidate, { agentPubkey: config.meckyPubkey, sourceAppPostId: input.sourceAppPostId,
        sourceAppCommentId: sourceAppCommentIdFor(candidate) }));
    return note ?? null;
  };
  const exactExchangeForSource = async (sourceNote: NostrEvent, sourceAppPostId: string) => {
    const replies = await agentRelay.query([{ kinds: [1], authors: [config.meckyPubkey], "#e": [sourceNote.id], limit: 20 }]);
    const valid = replies.filter((candidate) => verifyAppConversationExchange(sourceNote, candidate, {
      agentPubkey: config.meckyPubkey, sourceAppPostId, sourceAppCommentId: sourceAppCommentIdFor(sourceNote), conversationTopic: APP_CONVERSATION_TOPIC,
    }) !== null).sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id));
    if (valid.length !== 1) return null;
    const projection = verifyAppConversationExchange(sourceNote, valid[0]!, {
      agentPubkey: config.meckyPubkey, sourceAppPostId, sourceAppCommentId: sourceAppCommentIdFor(sourceNote), conversationTopic: APP_CONVERSATION_TOPIC,
    });
    return projection ? { reply: valid[0]!, projection } : null;
  };
  const visibleDiscussionContextFor = async (
    rootEvent: NostrEvent,
    relatedCitizenEvents: readonly NostrEvent[] = []
  ): Promise<{
    rootEvent: NostrEvent;
    citizenEvents: NostrEvent[];
    agentEvents: NostrEvent[];
  } | null> => {
    const selectedConversation = selectedConversationSourceFor(rootEvent);
    const linkedCitizenIds = [
      tagValue(rootEvent, "source-post"),
      selectedConversation?.mentionEventId ?? null,
    ].filter(
      (value): value is string => value !== null && HEX64.test(value)
    );
    const [threadEvents, linkedCitizenEvents, linkedAgentEvents] =
      await Promise.all([
        citizenRelay.query([
          { kinds: [1], "#e": [rootEvent.id], limit: 200 },
        ]),
        linkedCitizenIds.length === 0
          ? Promise.resolve([])
          : citizenRelay.query([
              {
                ids: [...new Set(linkedCitizenIds)],
                kinds: [1],
                limit: linkedCitizenIds.length,
              },
            ]),
        selectedConversation === null
          ? Promise.resolve([])
          : agentRelay.query([
              {
                ids: [selectedConversation.replyEventId],
                authors: [config.meckyPubkey],
                kinds: [1],
                limit: 1,
              },
            ]),
      ]);
    const citizenEvents = uniqueEvents(
      [rootEvent],
      relatedCitizenEvents.filter(verifyEvent),
      threadEvents.filter(verifyEvent),
      linkedCitizenEvents.filter(verifyEvent)
    ).filter(
      (candidate) =>
        config.mode !== "public-signed-only" ||
        !isSyntheticCitizen(config, candidate.pubkey)
    );
    const visibleRoot = citizenEvents.find(
      (candidate) => candidate.id === rootEvent.id
    );
    const agentEvents = linkedAgentEvents.filter(verifyEvent);
    if (
      visibleRoot === undefined ||
      !hasValidDiscussionRootEnvelope(config, visibleRoot, citizenEvents) ||
      (selectedConversation !== null &&
        selectedConversationProjectionFor(
          config,
          visibleRoot,
          citizenEvents,
          agentEvents
        ) === null)
    ) {
      return null;
    }
    return { rootEvent: visibleRoot, citizenEvents, agentEvents };
  };
  const publishParticipantSuggestionOnce = async (signed: NostrEvent, claimKey: string) => {
    const active = signedSuggestionWrites.get(claimKey);
    if (active) return { event: await active, alreadyPublished: true };
    let restored = false;
    const write = (async () => {
      const existing = (await citizenRelay.query([{ ids: [signed.id], kinds: [1], limit: 1 }])).find((candidate) => candidate.id === signed.id && verifyEvent(candidate));
      if (existing) { restored = true; return existing; }
      const published = await citizenRelay.publish(signed);
      if (!published.ok) throw new Error(`citizen_relay_${published.message}`);
      return signed;
    })();
    signedSuggestionWrites.set(claimKey, write);
    try { return { event: await write, alreadyPublished: restored }; }
    finally { if (signedSuggestionWrites.get(claimKey) === write) signedSuggestionWrites.delete(claimKey); }
  };
  if (config.mode === "isolated-fixture")
    await publishSeed(config, citizenRelay);
  const server: Server = createServer((request, response) => {
    void (async () => {
      const requestedPath = request.url ?? "";
      const prefixed =
        requestedPath === STAGING_PREFIX ||
        requestedPath.startsWith(`${STAGING_PREFIX}/`);
      const path = prefixed
        ? requestedPath.slice(STAGING_PREFIX.length) || "/"
        : requestedPath;
      const publicReadHead =
        config.mode === "public-signed-only" && request.method === "HEAD";
      const publicReadMethod = request.method === "GET" || publicReadHead;
      if (prefixed && INTERNAL_TOPIC_TRACER_PATHS.has(path))
        return json(response, 404, { error: "not_found" });
      if (request.method === "GET" && (path === "/" || path === "")) {
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "content-security-policy":
            "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'",
        });
        response.end(
          config.mode === "public-signed-only" ? PUBLIC_SIGNED_HTML : HTML
        );
        return;
      }
      if (publicReadMethod && path === "/healthz")
        return json(response, 200, {
          status: "ok",
          mode: "isolated-staging-e2e",
        }, publicReadHead);
      if (publicReadMethod && path === "/api/config")
        return json(response, 200, {
          schemaVersion: "roebel_e2e_workbench_config_v1",
          personas: config.personas.map(({ id, name, publicKey }) => ({
            id,
            name,
            publicKey,
          })),
          meckyPubkey: config.meckyPubkey,
          mode: config.mode,
          authorityBinding: "none",
        }, publicReadHead);
      if (config.mode === "public-signed-only" && path.startsWith("/api/")) {
        const publicRead =
          publicReadMethod &&
          (path.startsWith("/api/feed") ||
            path.startsWith("/api/thread?") ||
            path.startsWith("/api/conversation?"));
        const publicWrite =
          request.method === "POST" &&
          request.headers["x-stadtstack-e2e"] === "1" &&
          (path === "/api/session/admit" ||
            path === "/api/signed-event" ||
            (!prefixed && INTERNAL_TOPIC_TRACER_PATHS.has(path)));
        if (!publicRead && !publicWrite)
          return json(response, 404, { error: "not_found" });
      }
      const feedUrl = new URL(path, "http://workbench");
      if (publicReadMethod && feedUrl.pathname === "/api/feed") {
        const profileValues = feedUrl.searchParams.getAll("profile");
        if (
          [...feedUrl.searchParams.keys()].some((key) => key !== "profile") ||
          profileValues.length > 1 ||
          (profileValues.length === 1 && profileValues[0] !== "public")
        )
          return json(
            response,
            400,
            { error: "feed_profile_invalid" },
            publicReadHead
          );
        const publicProfile = profileValues[0] === "public";
        const [events, recentAgentEvents] = await Promise.all([
          citizenRelay
            .query([{ kinds: [1], limit: 100 }])
            .then((entries) => entries.filter(verifyEvent)),
          agentRelay
            .query([{ kinds: [1], authors: [config.meckyPubkey], limit: 100 }])
            .then((entries) => entries.filter(verifyEvent)),
        ]);
        const visibleEvents =
          publicProfile || config.mode === "public-signed-only"
            ? events.filter(
                (entry) => !isSyntheticCitizen(config, entry.pubkey)
              )
            : events;
        const discoveredRoots = visibleEvents.filter(
          (entry) => asArgument(config, entry)?.stance === "root"
        );
        const selectedSources = discoveredRoots.flatMap((entry) => {
          const selected = selectedConversationSourceFor(entry);
          return selected === null ? [] : [selected];
        });
        const linkedCitizenIds = [
          ...discoveredRoots.map((entry) => tagValue(entry, "source-post")),
          ...selectedSources.map((entry) => entry.mentionEventId),
        ].filter((value): value is string => value !== null && HEX64.test(value));
        const linkedAgentIds = selectedSources.map((entry) => entry.replyEventId);
        const [linkedCitizenEvents, linkedAgentEvents, rootAgentEvents] =
          await Promise.all([
            linkedCitizenIds.length === 0
              ? Promise.resolve([])
              : citizenRelay.query([
                  {
                    ids: [...new Set(linkedCitizenIds)],
                    kinds: [1],
                    limit: linkedCitizenIds.length,
                  },
                ]),
            linkedAgentIds.length === 0
              ? Promise.resolve([])
              : agentRelay.query([
                  {
                    ids: [...new Set(linkedAgentIds)],
                    authors: [config.meckyPubkey],
                    kinds: [1],
                    limit: linkedAgentIds.length,
                  },
                ]),
            discoveredRoots.length === 0
              ? Promise.resolve([])
              : agentRelay.query([
                  {
                    authors: [config.meckyPubkey],
                    kinds: [1],
                    "#e": discoveredRoots.map((entry) => entry.id),
                    limit: Math.min(300, discoveredRoots.length * 20),
                  },
                ]),
          ]);
        const projectionCitizenEvents = uniqueEvents(
          visibleEvents,
          linkedCitizenEvents.filter(verifyEvent)
        ).filter(
          (entry) =>
            config.mode !== "public-signed-only" ||
            !isSyntheticCitizen(config, entry.pubkey)
        );
        const agentEvents = uniqueEvents(
          recentAgentEvents,
          linkedAgentEvents.filter(verifyEvent),
          rootAgentEvents.filter(verifyEvent)
        );
        const validatedRoots = discoveredRoots.filter((candidate) => {
          if (
            !hasValidDiscussionRootEnvelope(
              config,
              candidate,
              projectionCitizenEvents
            )
          )
            return false;
          const selected = selectedConversationSourceFor(candidate);
          return (
            selected === null ||
            selectedConversationProjectionFor(
              config,
              candidate,
              projectionCitizenEvents,
              agentEvents
            ) !== null
          );
        });
        const visibleRoots: NostrEvent[] = [];
        const canonicalPromotions = new Set<string>();
        for (const candidate of [...validatedRoots].sort(
          (left, right) =>
            left.created_at - right.created_at || left.id.localeCompare(right.id)
        )) {
          const sourcePostId = tagValue(candidate, "source-post");
          if (sourcePostId === null) {
            visibleRoots.push(candidate);
            continue;
          }
          const claimKey = `${candidate.pubkey}:${sourcePostId}`;
          if (canonicalPromotions.has(claimKey)) continue;
          canonicalPromotions.add(claimKey);
          visibleRoots.push(candidate);
        }
        const visibleRootIds = new Set(visibleRoots.map((entry) => entry.id));
        const argumentsList = connectedArgumentsFor(
          visibleRootIds,
          visibleEvents
            .map((entry) => asArgument(config, entry))
            .filter(
              (entry): entry is PublicArgument =>
                entry !== null && visibleRootIds.has(entry.rootId)
            )
        );
        const promotionBySourcePost = new Map<
          string,
          { discussionId: string; topicId: string }
        >();
        for (const entry of visibleRoots) {
          const sourcePostId = tagValue(entry, "source-post");
          const topic = topicFor(entry);
          if (sourcePostId && topic)
            promotionBySourcePost.set(sourcePostId, {
              discussionId: entry.id,
              topicId: topic.id,
            });
        }
        const ordinaryPosts = visibleEvents
          .filter(
            (entry) =>
              entry.kind === 1 &&
              verifyEvent(entry) &&
              !entry.tags.some((tag) => tag[0] === "e") &&
              asArgument(config, entry) === null
          )
          .map((entry) => ({
            id: entry.id,
            entryType: "post" as const,
            event: entry,
            author: authorFor(config, entry),
            content: entry.content,
            createdAt: new Date(entry.created_at * 1_000).toISOString(),
            replyCount: 0,
            meckyMentioned: entry.tags.some(
              (tag) => tag[0] === "p" && tag[1] === config.meckyPubkey
            ),
            meckyAnswered: false,
            promotedDiscussionId:
              promotionBySourcePost.get(entry.id)?.discussionId ?? null,
            promotedTopicId:
              promotionBySourcePost.get(entry.id)?.topicId ?? null,
            sourceAppPostId: sourceAppPostIdFor(entry),
            synthetic: isSyntheticCitizen(config, entry.pubkey),
          }));
        const roots = argumentsList
          .filter((entry) => entry.stance === "root")
          .flatMap((entry) => {
            const source = visibleEvents.find(
              (candidate) => candidate.id === entry.id
            );
            if (!source) return [];
            const topic = topicFor(source);
            if (!topic) return [];
            const suggestion = verifiedTopicSuggestionFor(
              config,
              projectionCitizenEvents,
              agentEvents,
              source
            );
            return [
              {
                id: entry.id,
                author: entry.author,
                content: entry.content,
                createdAt: entry.createdAt,
                replyCount: argumentsList.filter(
                  (candidate) =>
                    candidate.rootId === entry.id && candidate.id !== entry.id
                ).length,
                meckyMentioned: source.tags.some(
                  (tag) => tag[0] === "p" && tag[1] === config.meckyPubkey
                ),
                meckyAnswered: agentEvents.some(
                  (candidate) =>
                    verifiedCivicRootAnswerFor(config, source, candidate) !==
                    null
                ),
                suggestionSigned: suggestion !== null,
                caseBinding: caseBindingFor(source),
                sourceConversation: selectedConversationProjectionFor(
                  config,
                  source,
                  projectionCitizenEvents,
                  agentEvents
                ),
                topicId: topic.id,
                topicTitle: topic.title,
                synthetic: isSyntheticCitizen(config, entry.author.pubkey),
              },
            ];
          });
        const grouped = new Map<string, typeof roots>();
        for (const entry of roots)
          grouped.set(entry.topicId, [
            ...(grouped.get(entry.topicId) ?? []),
            entry,
          ]);
        const topics = [...grouped.values()].map((discussions) => {
          const ordered = [...discussions].sort(
            (a, b) =>
              Number(b.meckyAnswered) - Number(a.meckyAnswered) ||
              b.replyCount - a.replyCount ||
              Number(b.meckyMentioned) - Number(a.meckyMentioned) ||
              a.createdAt.localeCompare(b.createdAt) ||
              a.id.localeCompare(b.id)
          );
          const primary = ordered[0]!;
          const meckyAnswerCount = agentEvents.filter((candidate) =>
            discussions.some((discussion) => {
              const root = visibleEvents.find(
                (event) => event.id === discussion.id
              );
              return (
                root !== undefined &&
                verifiedCivicRootAnswerFor(config, root, candidate) !== null
              );
            })
          ).length;
          return {
            ...primary,
            entryType: "topic" as const,
            lastActivityAt: discussions
              .map((entry) => entry.createdAt)
              .sort()
              .at(-1)!,
            replyCount: discussions.reduce(
              (sum, entry) => sum + entry.replyCount,
              0
            ),
            meckyMentioned: discussions.some((entry) => entry.meckyMentioned),
            meckyAnswered: discussions.some((entry) => entry.meckyAnswered),
            discussionCount: discussions.length,
            discussionIds: discussions.map((entry) => entry.id).sort(),
            discussions: [...discussions]
              .sort(
                (a, b) =>
                  b.createdAt.localeCompare(a.createdAt) ||
                  a.id.localeCompare(b.id)
              )
              .map(
                ({
                  id,
                  author,
                  content,
                  createdAt,
                  replyCount,
                  meckyMentioned,
                  meckyAnswered,
                  suggestionSigned,
                  caseBinding,
                  sourceConversation,
                  synthetic,
                }) => ({
                  id,
                  author,
                  content,
                  createdAt,
                  replyCount,
                  meckyMentioned,
                  meckyAnswered,
                  suggestionSigned,
                  caseBinding,
                  sourceConversation,
                  synthetic,
                })
              ),
            sourcePostIds: discussions
              .flatMap((discussion) => {
                const source = visibleEvents.find(
                  (candidate) => candidate.id === discussion.id
                );
                return source
                  ? source.tags
                      .filter((tag) => tag[0] === "source-post")
                      .map((tag) => tag[1]!)
                  : [];
              })
              .filter((id, index, all) => all.indexOf(id) === index)
              .sort(),
            activityCount:
              discussions.length +
              discussions.reduce((sum, entry) => sum + entry.replyCount, 0) +
              meckyAnswerCount,
          };
        });
        return json(response, 200, {
          schemaVersion: "roebel_staging_mixed_feed_v1",
          posts: [...ordinaryPosts, ...topics].sort((a, b) =>
            ("lastActivityAt" in b
              ? b.lastActivityAt
              : b.createdAt
            ).localeCompare(
              "lastActivityAt" in a ? a.lastActivityAt : a.createdAt
            )
          ),
          authorityBinding: "none",
        }, publicReadHead);
      }
      if (
        publicReadMethod &&
        path.startsWith("/api/conversation?post=")
      ) {
        const postId =
          new URL(path, "http://workbench").searchParams.get("post") ?? "";
        if (!UUID.test(postId))
          return json(
            response,
            400,
            { error: "conversation_post_invalid" },
            publicReadHead
          );
        const [citizenEvents, agentEvents] = await Promise.all([
          citizenRelay.query([{ kinds: [1], limit: 300 }]),
          agentRelay.query([
            {
              kinds: [1],
              authors: [config.meckyPubkey],
              limit: 300,
            },
          ]),
        ]);
        const mentionsBySource = new Map<string, NostrEvent>();
        for (const mention of citizenEvents
          .filter(verifyEvent)
          .filter(
            (entry) =>
              config.mode !== "public-signed-only" ||
              !isSyntheticCitizen(config, entry.pubkey)
          )
          .filter((entry) => isAppConversationMention(config, entry))
          .filter((entry) => sourceAppPostIdFor(entry) === postId)
          .sort(
            (a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id)
          )) {
          const sourceKey = sourceAppCommentIdFor(mention) ?? postId;
          if (!mentionsBySource.has(sourceKey))
            mentionsBySource.set(sourceKey, mention);
        }
        const verifiedAgentEvents = agentEvents.filter(
          (entry) =>
            verifyEvent(entry) &&
            entry.pubkey === config.meckyPubkey &&
            isAgentEvent(entry)
        );
        const requests = [...mentionsBySource.values()].map((mention) => {
          const reply = verifiedAgentEvents
            .flatMap((candidate) => {
              const projection = verifiedAppConversationReplyFor(
                config,
                mention,
                candidate
              );
              return projection === null
                ? []
                : [{ event: candidate, projection }];
            })
            .sort(
              (a, b) =>
                a.event.created_at - b.event.created_at ||
                a.event.id.localeCompare(b.event.id)
            )[0];
          return { mention, reply };
        });
        const replies = requests.flatMap(({ mention, reply }) =>
          reply
            ? [
                {
                  id: reply.event.id,
                  mentionId: mention.id,
                  mentionEvent: mention,
                  replyEvent: reply.event,
                  mentionAuthor: authorFor(config, mention),
                  sourceAppCommentId: sourceAppCommentIdFor(mention),
                  receiptId: reply.projection.receiptId,
                  content: reply.event.content,
                  createdAt: new Date(
                    reply.event.created_at * 1_000
                  ).toISOString(),
                  evidenceRefs: reply.projection.evidenceRefs,
                },
              ]
            : []
        );
        return json(response, 200, {
          schemaVersion: "roebel_app_mecky_conversation_v1",
          postId,
          requestCount: requests.length,
          mentionIds: requests.map(({ mention }) => mention.id),
          pendingCount: requests.filter(({ reply }) => !reply).length,
          requests: requests.map(({ mention, reply }) => ({
            mentionId: mention.id,
            sourceAppCommentId: sourceAppCommentIdFor(mention),
            state: reply ? "answered" : "pending",
            replyId: reply?.event.id ?? null,
          })),
          replies: replies.sort(
            (a, b) =>
              a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
          ),
          authorityBinding: "none",
        }, publicReadHead);
      }
      if (publicReadMethod && path.startsWith("/api/thread?root=")) {
        const rootId =
          new URL(path, "http://workbench").searchParams.get("root") ?? "";
        if (!HEX64.test(rootId))
          return json(response, 400, { error: "root_invalid" }, publicReadHead);
        const rootCandidate = (
          await citizenRelay.query([{ ids: [rootId], kinds: [1], limit: 1 }])
        )
          .filter(verifyEvent)
          .find(
            (entry) =>
              entry.id === rootId &&
              asArgument(config, entry)?.stance === "root" &&
              (config.mode !== "public-signed-only" ||
                !isSyntheticCitizen(config, entry.pubkey))
          );
        const selectedSource = rootCandidate
          ? selectedConversationSourceFor(rootCandidate)
          : null;
        const linkedCitizenIds = rootCandidate
          ? [
              tagValue(rootCandidate, "source-post"),
              selectedSource?.mentionEventId ?? null,
            ].filter(
              (value): value is string => value !== null && HEX64.test(value)
            )
          : [];
        const [
          threadCitizenEvents,
          linkedCitizenEvents,
          rootMeckyEvents,
          linkedMeckyEvents,
        ] = await Promise.all([
          rootCandidate
            ? citizenRelay.query([{ kinds: [1], "#e": [rootId], limit: 200 }])
            : Promise.resolve([]),
          linkedCitizenIds.length === 0
            ? Promise.resolve([])
            : citizenRelay.query([
                {
                  ids: [...new Set(linkedCitizenIds)],
                  kinds: [1],
                  limit: linkedCitizenIds.length,
                },
              ]),
          rootCandidate
            ? agentRelay.query([
                {
                  authors: [config.meckyPubkey],
                  kinds: [1],
                  "#e": [rootId],
                  limit: 20,
                },
              ])
            : Promise.resolve([]),
          selectedSource === null
            ? Promise.resolve([])
            : agentRelay.query([
                {
                  ids: [selectedSource.replyEventId],
                  kinds: [1],
                  authors: [config.meckyPubkey],
                  limit: 1,
                },
              ]),
        ]);
        const citizenEvents = uniqueEvents(
          rootCandidate ? [rootCandidate] : [],
          threadCitizenEvents.filter(verifyEvent),
          linkedCitizenEvents.filter(verifyEvent)
        ).filter(
          (entry) =>
            config.mode !== "public-signed-only" ||
            !isSyntheticCitizen(config, entry.pubkey)
        );
        const meckyEvents = uniqueEvents(
          rootMeckyEvents.filter(verifyEvent),
          linkedMeckyEvents.filter(verifyEvent)
        );
        const sourceEvent = rootCandidate
          ? (citizenEvents.find(
              (entry) => entry.id === tagValue(rootCandidate, "source-post")
            ) ?? null)
          : null;
        const rootEnvelopeValid =
          rootCandidate !== undefined &&
          hasValidDiscussionRootEnvelope(
            config,
            rootCandidate,
            citizenEvents
          );
        const rootConversationValid =
          rootCandidate !== undefined &&
          (selectedSource === null ||
            selectedConversationProjectionFor(
              config,
              rootCandidate,
              citizenEvents,
              meckyEvents
            ) !== null);
        const rootEvent =
          rootCandidate && rootEnvelopeValid && rootConversationValid
            ? rootCandidate
            : null;
        const argumentsList = connectedArgumentsFor(
          new Set(rootEvent === null ? [] : [rootId]),
          citizenEvents
            .map((entry) => asArgument(config, entry))
            .filter(
              (entry): entry is PublicArgument =>
                rootEvent !== null && entry !== null && entry.rootId === rootId
            )
        );
        const meckyReply = rootEvent
          ? meckyEvents
              .flatMap((entry) => {
                const projection = verifiedCivicRootAnswerFor(
                  config,
                  rootEvent,
                  entry
                );
                return projection === null ? [] : [{ event: entry, projection }];
              })
              .sort(
                (a, b) =>
                  b.event.created_at - a.event.created_at ||
                  b.event.id.localeCompare(a.event.id)
              )[0] ?? null
          : null;
        const topic = rootEvent ? topicFor(rootEvent) : null;
        const suggestion = rootEvent
          ? verifiedTopicSuggestionFor(
              config,
              citizenEvents,
              meckyEvents,
              rootEvent
            )
          : null;
        const sourceConversation = rootEvent
          ? selectedConversationProjectionFor(
              config,
              rootEvent,
              citizenEvents,
              meckyEvents
            )
          : null;
        const sourceConversationWitnesses = rootEvent
          ? selectedConversationWitnessesFor(
              config,
              rootEvent,
              citizenEvents,
              meckyEvents
            )
          : null;
        return json(response, 200, {
          schemaVersion: "roebel_staging_argument_thread_v1",
          arguments: argumentsList.sort(
            (a, b) =>
              a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
          ),
          events: Object.fromEntries(
            citizenEvents
              .filter(verifyEvent)
              .filter((entry) =>
                argumentsList.some((argument) => argument.id === entry.id)
              )
              .map((entry) => [entry.id, entry])
          ),
          rootEvent,
          sourceAppPostId:
            rootEvent && sourceEvent ? sourceAppPostIdFor(sourceEvent) : null,
          sourceConversation,
          sourceConversationWitnesses,
          topic,
          caseBinding: rootEvent ? caseBindingFor(rootEvent) : null,
          mecky: meckyReply
            ? {
                event: meckyReply.event,
                author: authorFor(config, meckyReply.event),
                evidenceRefs: meckyReply.projection.evidenceRefs,
              }
            : null,
          suggestion,
          authorityBinding: "none",
        }, publicReadHead);
      }
      if (request.method === "GET" && path.startsWith("/api/reply?parent=")) {
        const parent =
          new URL(path, "http://workbench").searchParams.get("parent") ?? "";
        if (!HEX64.test(parent))
          return json(response, 400, { error: "parent_invalid" });
        const events = await agentRelay.query([
          {
            kinds: [1],
            authors: [config.meckyPubkey],
            "#e": [parent],
            limit: 5,
          },
        ]);
        const answer =
          events
            .filter(verifyEvent)
            .sort((a, b) => b.created_at - a.created_at)[0] ?? null;
        return json(
          response,
          200,
          answer ? { status: "answered", event: answer } : null
        );
      }
      const administrationUrl = new URL(path, "http://workbench");
      if (
        request.method === "GET" &&
        administrationUrl.pathname === "/api/administration"
      ) {
        if (config.mode === "public-signed-only")
          return json(response, 404, { error: "not_found" });
        const caseValues = administrationUrl.searchParams.getAll("case");
        if (
          [...administrationUrl.searchParams.keys()].some(
            (key) => key !== "case"
          ) ||
          caseValues.length !== 1 ||
          caseValues[0] !== CASE_ID
        ) {
          return json(response, 400, {
            error: "administration_case_invalid",
          });
        }
        const publicView = await control(config, fetcher, "/v1/e2e/view", {
          profile: "public",
        });
        return json(
          response,
          200,
          checkedPublicCaseProjection(publicView, caseValues[0])
        );
      }
      if (
        request.method !== "POST" ||
        request.headers["x-stadtstack-e2e"] !== "1"
      )
        return json(response, 404, { error: "not_found" });
      const body = await readBody(request);
      if (path === "/api/staging-participant/topic-tracer/promotion-source") {
        if (!exactRecord(body, ["sourceNoteEventId", "sourceAuthorPubkey", "sourceAppPostId"]) ||
          typeof body.sourceNoteEventId !== "string" || typeof body.sourceAuthorPubkey !== "string" || typeof body.sourceAppPostId !== "string")
          throw new Error("topic_tracer_source_invalid");
        const sourceNoteInput: Parameters<typeof exactSourceNote>[0] = {
          sourceNoteEventId: body.sourceNoteEventId as string,
          sourceAuthorPubkey: body.sourceAuthorPubkey as string,
          sourceAppPostId: body.sourceAppPostId as string,
        };
        const sourceNote = await exactSourceNote(sourceNoteInput);
        if (!sourceNote) return json(response, 200, null);
        const exchange = await exactExchangeForSource(
          sourceNote,
          sourceNoteInput.sourceAppPostId
        );
        if (!exchange) return json(response, 200, null);
        return json(response, 200, {
          status: "resolved", sourceNote, meckyReplyEvent: exchange.reply,
          ...(exchange.projection.receiptId === undefined ? {} : { meckyReceiptId: exchange.projection.receiptId }),
        });
      }
      if (path === "/api/staging-participant/topic-tracer/promotions") {
        if (!exactRecord(body, ["event"])) throw new Error("topic_tracer_promotion_invalid");
        const signed = signedEventForWrite(body.event);
        const sourceId = tagValue(signed, "source-post");
        if (!sourceId || !HEX64.test(sourceId)) throw new Error("topic_tracer_promotion_invalid");
        const sourceNotes = await citizenRelay.query([{ ids: [sourceId], authors: [signed.pubkey], kinds: [1], limit: 1 }]);
        const sourceNote = sourceNotes.find((candidate) => candidate.id === sourceId && candidate.pubkey === signed.pubkey && verifyEvent(candidate));
        const promotion = sourceNote && verifyCivicTopicPromotionEvent({ event: signed, sourcePost: sourceNote, municipalityId: "roebel-mueritz", agentPubkey: config.meckyPubkey });
        const selected = promotion?.conversationSource;
        if (!sourceNote || !promotion || !selected || selected.mentionEventId !== sourceNote.id) throw new Error("topic_tracer_promotion_invalid");
        const exchange = await exactExchangeForSource(sourceNote, selected.sourceAppPostId);
        if (!exchange || exchange.reply.id !== selected.replyEventId || (exchange.projection.receiptId ?? null) !== selected.receiptId)
          throw new Error("topic_tracer_promotion_invalid");
        const published = await publishSignedPromotionOnce(signed, sourceNote);
        return json(response, 200, { status: "published", event: published.event, authorityBinding: "none" });
      }
      if (path === "/api/staging-participant/topic-tracer/suggestion-source") {
        if (!exactRecord(body, ["discussionRootId", "sourceAuthorPubkey", "sourceNoteEventId", "sourceAppPostId"]) ||
          typeof body.discussionRootId !== "string" || typeof body.sourceAuthorPubkey !== "string" || typeof body.sourceNoteEventId !== "string" || typeof body.sourceAppPostId !== "string")
          throw new Error("topic_tracer_source_invalid");
        const sourceNote = await exactSourceNote({ sourceNoteEventId: body.sourceNoteEventId, sourceAuthorPubkey: body.sourceAuthorPubkey, sourceAppPostId: body.sourceAppPostId });
        if (!sourceNote || !HEX64.test(body.discussionRootId)) return json(response, 200, null);
        const roots = await citizenRelay.query([{ ids: [body.discussionRootId], authors: [body.sourceAuthorPubkey], kinds: [1], limit: 1 }]);
        const discussionRoot = roots.find((candidate) => candidate.id === body.discussionRootId && candidate.pubkey === body.sourceAuthorPubkey &&
          verifyCivicTopicPromotionEvent({ event: candidate, sourcePost: sourceNote, municipalityId: "roebel-mueritz", agentPubkey: config.meckyPubkey }) !== null);
        const exchange = await exactExchangeForSource(sourceNote, body.sourceAppPostId);
        const selected = discussionRoot && selectedConversationSourceFor(discussionRoot);
        if (!discussionRoot || !exchange || !selected || selected.mentionEventId !== sourceNote.id || selected.replyEventId !== exchange.reply.id) return json(response, 200, null);
        const answers = await agentRelay.query([{ kinds: [1], authors: [config.meckyPubkey], "#e": [discussionRoot.id], limit: 20 }]);
        const answer = answers.filter(verifyEvent).filter((candidate) => candidate.pubkey === config.meckyPubkey && isAgentEvent(candidate) &&
          tagValue(candidate, "source-app-post") === body.sourceAppPostId && tagValue(candidate, "mecky-receipt") !== null).sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id));
        if (answer.length !== 1) return json(response, 200, null);
        return json(response, 200, { status: "resolved", sourceNote, discussionRoot, meckyAnswer: answer[0]!, meckyReplyEvent: exchange.reply,
          ...(exchange.projection.receiptId === undefined ? {} : { meckyReceiptId: exchange.projection.receiptId }) });
      }
      if (path === "/api/staging-participant/topic-tracer/suggestions") {
        if (!exactRecord(body, ["event"])) throw new Error("topic_tracer_suggestion_invalid");
        const signed = signedEventForWrite(body.event);
        const rootId = signed.tags.find((tag) => tag[0] === "e" && tag[3] === "root")?.[1];
        if (!rootId || !HEX64.test(rootId)) throw new Error("topic_tracer_suggestion_invalid");
        const roots = await citizenRelay.query([{ ids: [rootId], authors: [signed.pubkey], kinds: [1], limit: 1 }]);
        const root = roots.find((candidate) => candidate.id === rootId && candidate.pubkey === signed.pubkey && verifyEvent(candidate));
        const sourceId = root && tagValue(root, "source-post");
        if (!root || !sourceId || !HEX64.test(sourceId)) throw new Error("topic_tracer_suggestion_invalid");
        const notes = await citizenRelay.query([{ ids: [sourceId], authors: [signed.pubkey], kinds: [1], limit: 1 }]);
        const sourceNote = notes.find((candidate) => candidate.id === sourceId && candidate.pubkey === signed.pubkey && verifyEvent(candidate));
        const promotion = sourceNote && verifyCivicTopicPromotionEvent({ event: root, sourcePost: sourceNote, municipalityId: "roebel-mueritz", agentPubkey: config.meckyPubkey });
        const selected = promotion?.conversationSource;
        if (!sourceNote || !promotion || !selected || selected.mentionEventId !== sourceNote.id) throw new Error("topic_tracer_suggestion_invalid");
        const exchange = await exactExchangeForSource(sourceNote, selected.sourceAppPostId);
        const answers = await agentRelay.query([{ kinds: [1], authors: [config.meckyPubkey], "#e": [root.id], limit: 20 }]);
        const sourceAnswer = answers.filter(verifyEvent).find((candidate) => tagValue(candidate, "mecky-receipt") === tagValue(signed, "mecky-receipt"));
        if (!exchange || exchange.reply.id !== selected.replyEventId || !sourceAnswer) throw new Error("topic_tracer_suggestion_invalid");
        verifyParticipantTopicSuggestion({ binding: { municipalityId: "roebel-mueritz", topicId: promotion.topicId }, sourcePost: sourceNote,
          sourceDiscussion: root, sourceAnswer, conversationWitnesses: { conversationTopic: APP_CONVERSATION_TOPIC, mentionEvent: sourceNote, replyEvent: exchange.reply },
          agentPubkey: config.meckyPubkey, event: signed });
        const published = await publishParticipantSuggestionOnce(signed, `${root.id}:${signed.pubkey}`);
        return json(response, 200, { status: "published", event: published.event, authorityBinding: "none" });
      }
      if (path === "/api/session/admit") {
        if (
          !exactRecord(body, [
            "schemaVersion",
            "credential",
            "statement",
            "walletSignature",
            "bindingEvent",
          ]) ||
          body.schemaVersion !== "roebel_citizen_admission_proof_v1" ||
          !exactRecord(body.credential, ["kind", "address", "chainId"]) ||
          (body.credential.kind !== "thirdweb_smart_account" &&
            body.credential.kind !== "passkey_safe") ||
          typeof body.credential.address !== "string" ||
          !ADDRESS.test(body.credential.address) ||
          body.credential.chainId !== 100 ||
          typeof body.statement !== "string" ||
          typeof body.walletSignature !== "string" ||
          !WALLET_SIGNATURE.test(body.walletSignature) ||
          (body.walletSignature.length - 2) % 2 !== 0
        )
          throw new Error("citizen_admission_invalid");
        const bindingEvent = event(body.bindingEvent);
        const binding = verifyBindingEvent(
          bindingEvent,
          body.credential.address
        );
        if (!binding.valid)
          throw new Error(`citizen_binding_${binding.reason}`);
        if (
          config.mode === "public-signed-only" &&
          isSyntheticCitizen(config, binding.pubkey)
        )
          throw new Error("citizen_admission_legacy_identity");
        const expectedStatement = bindingStatement({
          account: body.credential.address,
          npub: binding.npub,
        });
        if (
          body.statement !== expectedStatement ||
          bindingEvent.content !== expectedStatement
        ) {
          throw new Error("citizen_binding_statement_mismatch");
        }
        if (
          !(await verifyWalletSignature({
            address: body.credential.address,
            message: expectedStatement,
            signature: body.walletSignature,
          }))
        )
          throw new Error("citizen_wallet_signature_invalid");
        await admitPubkey(binding.pubkey);
        return json(response, 200, {
          status: "admitted",
          pubkey: binding.pubkey,
          assurance: "staging_credential_control",
          authorityBinding: "none",
        });
      }
      if (path === "/api/signed-event") {
        if (
          !exactRecord(body, ["intent", "event"]) ||
          (body.intent !== "post" &&
            body.intent !== "promotion" &&
            body.intent !== "argument" &&
            body.intent !== "conversation" &&
            body.intent !== "suggestion")
        )
          throw new Error("signed_event_invalid");
        const signed = signedEventForWrite(body.event);
        const maxSignedContent = body.intent === "suggestion" ? 4_000 : 2_000;
        if (
          signed.kind !== 1 ||
          signed.content !== signed.content.trim() ||
          signed.content.length < 1 ||
          signed.content.length > maxSignedContent
        ) {
          throw new Error("signed_event_invalid");
        }
        let signedSuggestion: CitizenSignedTopicSuggestionV1 | null = null;
        if (body.intent === "post") {
          const sourceAppPostTags = signed.tags.filter(
            (tag) => tag[0] === "source-app-post"
          );
          if (
            signed.tags.length > 9 ||
            sourceAppPostTags.length > 1 ||
            !signed.tags.every(
              (tag) =>
                (tag.length === 2 &&
                  tag[0] === "p" &&
                  typeof tag[1] === "string" &&
                  HEX64.test(tag[1])) ||
                (tag.length === 2 &&
                  tag[0] === "source-app-post" &&
                  typeof tag[1] === "string" &&
                  UUID.test(tag[1]))
            )
          )
            throw new Error("signed_post_tags_invalid");
        } else if (body.intent === "conversation") {
          if (!isAppConversationMention(config, signed))
            throw new Error("signed_conversation_invalid");
          const postId = sourceAppPostIdFor(signed)!;
          const commentId = sourceAppCommentIdFor(signed);
          const prior = (
            await citizenRelay.query([
              { kinds: [1], authors: [signed.pubkey], limit: 300 },
            ])
          )
            .filter(verifyEvent)
            .filter((candidate) => isAppConversationMention(config, candidate))
            .find(
              (candidate) =>
                sourceAppPostIdFor(candidate) === postId &&
                sourceAppCommentIdFor(candidate) === commentId
            );
          if (prior && prior.id !== signed.id)
            throw new Error("signed_conversation_source_already_requested");
          if (prior?.id === signed.id)
            return json(response, 200, {
              status: "published",
              event: prior,
              authorityBinding: "none",
            });
        } else if (body.intent === "promotion") {
          const sourcePostId = tagValue(signed, "source-post");
          if (!sourcePostId || !HEX64.test(sourcePostId))
            throw new Error("signed_promotion_invalid");
          const sourcePost = (
            await citizenRelay.query([
              {
                ids: [sourcePostId],
                authors: [signed.pubkey],
                kinds: [1],
                limit: 1,
              },
            ])
          )
            .filter(verifyEvent)
            .find(
              (candidate) =>
                candidate.id === sourcePostId &&
                candidate.pubkey === signed.pubkey
            );
          if (
            !sourcePost ||
            sourcePost.tags.some(
              (tag) => tag[0] === "source-post" || tag[0] === "argument-root"
            ) ||
            signed.created_at <= sourcePost.created_at
          )
            throw new Error("signed_promotion_source_invalid");
          if (
            verifyCivicTopicPromotionEvent({
              event: signed,
              sourcePost,
              municipalityId: "roebel-mueritz",
              agentPubkey: config.meckyPubkey,
            }) === null
          )
            throw new Error("signed_promotion_invalid");
          const selectedConversation = selectedConversationSourceFor(
            signed,
            true
          );
          if (selectedConversation) {
            const [mentions, replies] = await Promise.all([
              citizenRelay.query([
                {
                  ids: [selectedConversation.mentionEventId],
                  kinds: [1],
                  limit: 1,
                },
              ]),
              agentRelay.query([
                {
                  ids: [selectedConversation.replyEventId],
                  authors: [config.meckyPubkey],
                  kinds: [1],
                  limit: 1,
                },
              ]),
            ]);
            if (
              selectedConversationProjectionFor(
                config,
                signed,
                [
                  sourcePost,
                  ...mentions
                    .filter(verifyEvent)
                    .filter(
                      (mention) =>
                        config.mode !== "public-signed-only" ||
                        !isSyntheticCitizen(config, mention.pubkey)
                    ),
                ],
                replies.filter(verifyEvent)
              ) === null
            ) {
              throw new Error("signed_promotion_conversation_invalid");
            }
          }
          const publishedPromotion = await publishSignedPromotionOnce(
            signed,
            sourcePost
          );
          return json(response, 200, {
            status: publishedPromotion.alreadyPromoted
              ? "already_promoted"
              : "promoted",
            event: publishedPromotion.event,
            authorityBinding: "none",
          });
        } else if (body.intent === "suggestion") {
          const rootId = signed.tags.find(
            (tag) => tag[0] === "e" && tag[3] === "root"
          )?.[1];
          const receiptId = tagValue(signed, "mecky-receipt");
          const relatedCitizenEvents =
            rootId && HEX64.test(rootId)
              ? (
                  await citizenRelay.query([
                    { ids: [rootId, signed.id], kinds: [1], limit: 2 },
                  ])
                ).filter(verifyEvent)
              : [];
          const sourceDiscussion = relatedCitizenEvents.find(
            (candidate) => candidate.id === rootId
          );
          const discussionContext = sourceDiscussion
            ? await visibleDiscussionContextFor(
                sourceDiscussion,
                relatedCitizenEvents
              )
            : null;
          const visibleDiscussion = discussionContext?.rootEvent;
          const topic = visibleDiscussion ? topicFor(visibleDiscussion) : null;
          const sourceAnswers =
            rootId && receiptId
              ? (
                  await agentRelay.query([
                    {
                      kinds: [1],
                      authors: [config.meckyPubkey],
                      "#e": [rootId],
                      limit: 20,
                    },
                  ])
                ).filter(verifyEvent)
              : [];
          const sourceAnswer = sourceAnswers.find(
            (candidate) => tagValue(candidate, "mecky-receipt") === receiptId
          );
          if (
            !discussionContext ||
            !visibleDiscussion ||
            !sourceAnswer ||
            !topic ||
            caseBindingFor(visibleDiscussion) !== null
          ) {
            throw new Error("signed_suggestion_sources_invalid");
          }
          signedSuggestion = verifyCitizenSignedTopicSuggestion({
            binding: {
              municipalityId: "roebel-mueritz",
              topicId: topic.id,
            },
            sourceDiscussion: visibleDiscussion,
            sourceAnswer,
            agentPubkey: config.meckyPubkey,
            event: signed,
          });
          const prior = relatedCitizenEvents.find(
            (candidate) => candidate.id === signed.id
          );
          if (prior) {
            return json(response, 200, {
              status: "signed",
              event: prior,
              suggestion: signedSuggestion,
              authorityBinding: "none",
            });
          }
        } else {
          const rootId = tagValue(signed, "argument-root");
          const parentId =
            signed.tags.find(
              (tag) => tag[0] === "e" && tag[3] === "reply"
            )?.[1] ?? null;
          const relatedEvents =
            rootId && parentId
              ? (
                  await citizenRelay.query([
                    { ids: [rootId, parentId], kinds: [1], limit: 2 },
                  ])
                ).filter(verifyEvent)
              : [];
          const rootEvent = relatedEvents.find(
            (candidate) => candidate.id === rootId
          );
          const discussionContext = rootEvent
            ? await visibleDiscussionContextFor(rootEvent, relatedEvents)
            : null;
          const visibleRoot = discussionContext?.rootEvent;
          const visibleParent = discussionContext?.citizenEvents.find(
            (candidate) => candidate.id === parentId
          );
          const rootArgument = visibleRoot
            ? asArgument(config, visibleRoot)
            : null;
          const parentArgument = visibleParent
            ? asArgument(config, visibleParent)
            : null;
          const rootTopic = visibleRoot ? topicFor(visibleRoot) : null;
          const connectedArguments = connectedArgumentsFor(
            new Set(discussionContext !== null && rootId ? [rootId] : []),
            (discussionContext?.citizenEvents ?? [])
              .map((candidate) => asArgument(config, candidate))
              .filter(
                (candidate): candidate is PublicArgument =>
                  candidate !== null && candidate.rootId === rootId
              )
          );
          if (
            !rootId ||
            !parentId ||
            !visibleRoot ||
            !visibleParent ||
            !discussionContext ||
            rootArgument?.stance !== "root" ||
            parentArgument?.rootId !== rootId ||
            !connectedArguments.some(
              (candidate) => candidate.id === parentId
            ) ||
            !rootTopic ||
            signed.created_at <= visibleRoot.created_at ||
            signed.created_at <= visibleParent.created_at ||
            JSON.stringify(signed.tags) !==
              JSON.stringify([
                ["e", rootId, "", "root"],
                ["e", parentId, "", "reply"],
                ["argument-root", rootId],
                ["stance", tagValue(signed, "stance")],
                ["t", "stadtstack-argument"],
                ["municipality", "roebel-mueritz"],
                ["topic", rootTopic.id],
              ]) ||
            (tagValue(signed, "stance") !== "pro" &&
              tagValue(signed, "stance") !== "con")
          ) {
            throw new Error("signed_argument_invalid");
          }
        }
        const published = await citizenRelay.publish(signed);
        if (!published.ok)
          throw new Error(`citizen_relay_${published.message}`);
        return json(response, 200, {
          status: body.intent === "suggestion" ? "signed" : "published",
          event: signed,
          ...(signedSuggestion === null
            ? {}
            : { suggestion: signedSuggestion }),
          authorityBinding: "none",
        });
      }
      if (path === "/api/post") {
        if (
          !exactRecord(body, ["personaId", "content"]) ||
          typeof body.content !== "string" ||
          !body.content.trim() ||
          body.content.length > 1_000
        )
          throw new Error("post_invalid");
        const actor = persona(config, body.personaId);
        const signed = buildNoteEvent(secret(actor), body.content.trim());
        const published = await citizenRelay.publish(signed);
        if (!published.ok)
          throw new Error(`citizen_relay_${published.message}`);
        return json(response, 200, {
          status: "published",
          persona: {
            id: actor.id,
            name: actor.name,
            publicKey: actor.publicKey,
          },
          event: signed,
          authorityBinding: "none",
        });
      }
      if (path === "/api/promote") {
        if (
          !exactRecord(body, [
            "personaId",
            "sourcePostId",
            "topicId",
            "question",
          ]) ||
          typeof body.sourcePostId !== "string" ||
          !HEX64.test(body.sourcePostId) ||
          body.topicId !== MARIENFELDER_TOPIC_ID ||
          typeof body.question !== "string" ||
          !body.question.trim() ||
          body.question.length > 1_000
        )
          throw new Error("promotion_invalid");
        const actor = persona(config, body.personaId);
        const candidates = (
          await citizenRelay.query([
            { kinds: [1], authors: [actor.publicKey], limit: 100 },
          ])
        ).filter(verifyEvent);
        const sourcePost = candidates.find(
          (entry) => entry.id === body.sourcePostId
        );
        if (!sourcePost) throw new Error("promotion_source_missing");
        const existing = candidates.find(
          (entry) =>
            entry.pubkey === actor.publicKey &&
            tagValue(entry, "source-post") === sourcePost.id &&
            tagValue(entry, "topic") === MARIENFELDER_TOPIC_ID &&
            asArgument(config, entry)?.stance === "root"
        );
        if (existing) {
          return json(response, 200, {
            status: "already_promoted",
            sourcePostId: sourcePost.id,
            topicId: MARIENFELDER_TOPIC_ID,
            event: existing,
            authorityBinding: "none",
          });
        }
        const signed = buildCivicPromotionEvent(secret(actor), {
          sourcePost,
          municipalityId: "roebel-mueritz",
          sourceCaseId: "marienfelder-strasse",
          canonicalCaseId: CASE_ID,
          topicId: MARIENFELDER_TOPIC_ID,
          agentPubkey: config.meckyPubkey,
          content: `@Mecky, ${body.question.trim()}`,
          createdAt: Math.max(
            Math.floor(Date.now() / 1_000),
            sourcePost.created_at + 1
          ),
        });
        const published = await citizenRelay.publish(signed);
        if (!published.ok)
          throw new Error(`citizen_relay_${published.message}`);
        return json(response, 200, {
          status: "promoted",
          sourcePostId: sourcePost.id,
          topicId: MARIENFELDER_TOPIC_ID,
          event: signed,
          authorityBinding: "none",
        });
      }
      if (path === "/api/discussion") {
        if (
          !exactRecord(body, ["personaId", "question"]) ||
          typeof body.question !== "string" ||
          !body.question.trim() ||
          body.question.length > 1_000
        )
          throw new Error("discussion_invalid");
        const actor = persona(config, body.personaId);
        const signed = buildCivicDiscussionEvent(
          Uint8Array.from(Buffer.from(actor.secretKeyHex, "hex")),
          {
            municipalityId: "roebel-mueritz",
            sourceCaseId: "marienfelder-strasse",
            canonicalCaseId: CASE_ID,
            agentPubkey: config.meckyPubkey,
            content: `@Mecky, ${body.question.trim()}`,
          }
        );
        const published = await citizenRelay.publish(signed);
        if (!published.ok)
          throw new Error(`citizen_relay_${published.message}`);
        return json(response, 200, {
          status: "published",
          persona: {
            id: actor.id,
            name: actor.name,
            publicKey: actor.publicKey,
          },
          event: signed,
        });
      }
      if (path === "/api/claim") {
        if (
          !exactRecord(body, [
            "personaId",
            "rootEventId",
            "parentEventId",
            "stance",
            "content",
          ]) ||
          typeof body.rootEventId !== "string" ||
          !HEX64.test(body.rootEventId) ||
          typeof body.parentEventId !== "string" ||
          !HEX64.test(body.parentEventId) ||
          (body.stance !== "pro" && body.stance !== "con") ||
          typeof body.content !== "string" ||
          !body.content.trim() ||
          body.content.length > 1_000
        )
          throw new Error("claim_invalid");
        const relatedEvents = (
          await citizenRelay.query([
            {
              ids: [body.rootEventId, body.parentEventId],
              kinds: [1],
              limit: 2,
            },
          ])
        ).filter(verifyEvent);
        const rootEvent = relatedEvents.find(
          (candidate) => candidate.id === body.rootEventId
        );
        const parentEvent = relatedEvents.find(
          (candidate) => candidate.id === body.parentEventId
        );
        const rootArgument = rootEvent ? asArgument(config, rootEvent) : null;
        const parentArgument = parentEvent
          ? asArgument(config, parentEvent)
          : null;
        const rootTopic = rootEvent ? topicFor(rootEvent) : null;
        const rootCaseBinding = rootEvent ? caseBindingFor(rootEvent) : null;
        if (
          !rootEvent ||
          !parentEvent ||
          rootArgument?.stance !== "root" ||
          parentArgument?.rootId !== body.rootEventId ||
          !rootTopic
        ) {
          throw new Error("claim_thread_invalid");
        }
        const actor = persona(config, body.personaId);
        const signed = buildNoteEvent(secret(actor), body.content.trim(), {
          tags: [
            ["e", body.rootEventId, "", "root"],
            ["e", body.parentEventId, "", "reply"],
            ["argument-root", body.rootEventId],
            ["stance", body.stance],
            ["t", "stadtstack-argument"],
            ["municipality", "roebel-mueritz"],
            ["topic", rootTopic.id],
            ...(rootCaseBinding
              ? [
                  ["case", rootCaseBinding.sourceCaseId],
                  ["stadtstack-case", rootCaseBinding.canonicalCaseId],
                ]
              : []),
          ],
        });
        const published = await citizenRelay.publish(signed);
        if (!published.ok)
          throw new Error(`citizen_relay_${published.message}`);
        return json(response, 200, {
          status: "published",
          event: signed,
          authorityBinding: "none",
        });
      }
      if (path === "/api/suggestion") {
        if (
          !exactRecord(body, [
            "personaId",
            "discussion",
            "answer",
            "title",
            "summary",
          ]) ||
          typeof body.title !== "string" ||
          typeof body.summary !== "string"
        )
          throw new Error("suggestion_invalid");
        const actor = persona(config, body.personaId);
        const discussion = event(body.discussion);
        const answer = event(body.answer);
        if (
          discussion.pubkey !== actor.publicKey ||
          answer.pubkey !== config.meckyPubkey
        )
          throw new Error("suggestion_actor_mismatch");
        const suggestion = buildCitizenSignedSuggestion(
          Uint8Array.from(Buffer.from(actor.secretKeyHex, "hex")),
          {
            binding: {
              municipalityId: "roebel-mueritz",
              sourceCaseId: "marienfelder-strasse",
              canonicalCaseId: CASE_ID,
            },
            agentPubkey: config.meckyPubkey,
            sourceDiscussion: discussion,
            sourceAnswer: answer,
            title: body.title,
            summary: body.summary,
            createdAt: Math.floor(Date.now() / 1_000),
          }
        );
        const suggestionEvent: NostrEvent = {
          id: suggestion.event.id,
          pubkey: suggestion.event.pubkey,
          created_at: suggestion.event.createdAt,
          kind: suggestion.event.kind,
          tags: suggestion.event.tags,
          content: suggestion.event.content,
          sig: suggestion.event.signature,
        };
        const published = await citizenRelay.publish(suggestionEvent);
        if (!published.ok)
          throw new Error(`citizen_relay_${published.message}`);
        return json(response, 200, {
          status: "signed",
          suggestion,
          event: suggestionEvent,
        });
      }
      return json(response, 404, { error: "not_found" });
    })().catch((error: unknown) => {
      if (!response.writableEnded)
        json(response, error instanceof SyntaxError ? 400 : 422, {
          error: error instanceof Error ? error.message : "workbench_failed",
        });
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.bindHost, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("workbench_listener_invalid");
  return {
    port: address.port,
    close: async () => {
      citizenRelay.close();
      if (agentRelay !== citizenRelay) agentRelay.close();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    },
  };
}
