import { verifyEvent, type NostrEvent } from "@netizen-labs/nostr";

import type { MeckyMirrorAdapter, StagingParticipantTopicTracerAdapter } from "./types.ts";

const ADMIT_PATH = "/api/session/admit";
const POST_PATH = "/api/signed-event";
const TOPIC_PROMOTION_SOURCE_PATH = "/api/staging-participant/topic-tracer/promotion-source";
const TOPIC_PROMOTION_PUBLISH_PATH = "/api/staging-participant/topic-tracer/promotions";
const TOPIC_SUGGESTION_SOURCE_PATH = "/api/staging-participant/topic-tracer/suggestion-source";
const TOPIC_SUGGESTION_PUBLISH_PATH = "/api/staging-participant/topic-tracer/suggestions";
const TOPIC_PROMOTION_SAFE_FAILURES: Readonly<Record<string, string>> = Object.freeze({
  topic_tracer_promotion_invalid: "staging_participant_topic_publish_contract_invalid",
  signed_event_legacy_identity: "staging_participant_topic_publish_identity_forbidden",
  event_invalid: "staging_participant_topic_publish_event_invalid",
  "citizen_relay_blocked: author not allowed": "staging_participant_topic_publish_author_forbidden",
  "citizen_relay_blocked: store capacity": "staging_participant_topic_publish_capacity",
});
export const PRIVATE_WORKBENCH_URL =
  "http://e2e-workbench.stadtstack-roebel-staging-lab.svc.cluster.local:18083/";

export type PrivateWorkbenchMirrorConfig = Readonly<{
  /** Exact cluster-local workbench base URL; no browser origin is accepted. */
  url: string;
  /** Existing workbench admission boundary, e.g. x-stadtstack-e2e: 1. */
  admissionHeader: Readonly<{ name: string; value: string }>;
  fetch?: typeof fetch;
}>;

function validate(config: PrivateWorkbenchMirrorConfig): URL {
  let url: URL;
  try {
    url = new URL(config.url);
  } catch {
    throw new Error("staging_participant_workbench_url_invalid");
  }
  if (
    config.url !== PRIVATE_WORKBENCH_URL ||
    url.href !== PRIVATE_WORKBENCH_URL ||
    url.protocol !== "http:" ||
    url.username || url.password || url.pathname !== "/" || url.search || url.hash ||
    config.admissionHeader.name !== "x-stadtstack-e2e" ||
    config.admissionHeader.value !== "1"
  ) {
    throw new Error("staging_participant_workbench_config_invalid");
  }
  return url;
}

async function post(
  fetcher: typeof fetch,
  base: URL,
  path: string,
  header: PrivateWorkbenchMirrorConfig["admissionHeader"],
  body: unknown,
  safeFailures?: Readonly<Record<string, string>>,
): Promise<unknown> {
  const response = await fetcher(new URL(path, base), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [header.name]: header.value,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8_000),
  });
  let value: unknown = null;
  try { value = await response.json(); } catch { /* non-JSON is invalid */ }
  if (!response.ok) {
    const failure = closedRecord(value, ["error"]);
    const safeFailure = failure && typeof failure.error === "string" && safeFailures &&
      Object.hasOwn(safeFailures, failure.error)
      ? safeFailures[failure.error]
      : undefined;
    throw new Error(safeFailure ?? "staging_participant_workbench_unavailable");
  }
  return value;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype ? value as Record<string, unknown> : null;
}

function closedRecord(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  const candidate = record(value);
  if (!candidate) return null;
  const actual = Object.keys(candidate).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]) ? candidate : null;
}

function nostrEvent(value: unknown): NostrEvent | null {
  const candidate = closedRecord(value, ["id", "pubkey", "created_at", "kind", "tags", "content", "sig"]);
  if (!candidate || typeof candidate.id !== "string" || !/^[a-f0-9]{64}$/iu.test(candidate.id) ||
    typeof candidate.pubkey !== "string" || !/^[a-f0-9]{64}$/iu.test(candidate.pubkey) ||
    !Number.isSafeInteger(candidate.created_at) || !Number.isSafeInteger(candidate.kind) ||
    typeof candidate.content !== "string" || typeof candidate.sig !== "string" ||
    !/^[a-f0-9]{128}$/iu.test(candidate.sig) || !Array.isArray(candidate.tags) ||
    candidate.tags.some((tag) => !Array.isArray(tag) || tag.some((value) => typeof value !== "string"))) return null;
  const event: NostrEvent = {
    id: candidate.id.toLowerCase(), pubkey: candidate.pubkey.toLowerCase(),
    created_at: candidate.created_at as number, kind: candidate.kind as number,
    tags: (candidate.tags as string[][]).map((tag) => [...tag]), content: candidate.content,
    sig: candidate.sig.toLowerCase(),
  };
  return verifyEvent(event) ? event : null;
}

function published(value: unknown, expectedEventId: string): boolean {
  const result = closedRecord(value, ["status", "event", "authorityBinding"]);
  const event = result && record(result.event);
  return result?.status === "published" && result?.authorityBinding === "none" &&
    event?.id === expectedEventId;
}

/**
 * The adapter has exactly two immutable requests: admit the already-verified
 * credential binding, then submit its exact signed app-conversation mention. It
 * cannot publish an arbitrary event intent or call a public workbench origin.
 */
export function createPrivateWorkbenchMeckyMirrorAdapter(
  config: PrivateWorkbenchMirrorConfig,
): MeckyMirrorAdapter {
  const base = validate(config);
  const fetcher = config.fetch ?? globalThis.fetch;
  if (typeof fetcher !== "function") throw new Error("staging_participant_fetch_unavailable");
  return {
    async mirrorPost({ admissionProof, event }) {
      const admitted = await post(fetcher, base, ADMIT_PATH, config.admissionHeader, admissionProof);
      if (!admitted || typeof admitted !== "object" || (admitted as { status?: unknown }).status !== "admitted") {
        throw new Error("staging_participant_workbench_admission_invalid");
      }
      const published = await post(fetcher, base, POST_PATH, config.admissionHeader, {
        intent: "conversation",
        event,
      });
      if (
        !published || typeof published !== "object" ||
        (published as { status?: unknown }).status !== "published" ||
        (published as { event?: { id?: unknown } }).event?.id !== event.id
      ) {
        throw new Error("staging_participant_workbench_publish_invalid");
      }
      return { status: "published", eventId: event.id } as const;
    },
  };
}

/**
 * ADR-0022 uses four dedicated cluster-local endpoints. In particular it does
 * not call the workbench's diagnostic `/api/signed-event` path, so a new civic
 * route cannot accidentally inherit the ordinary conversation capability.
 */
export function createPrivateWorkbenchTopicTracerAdapter(
  config: PrivateWorkbenchMirrorConfig,
): StagingParticipantTopicTracerAdapter {
  const base = validate(config);
  const fetcher = config.fetch ?? globalThis.fetch;
  if (typeof fetcher !== "function") throw new Error("staging_participant_fetch_unavailable");
  return {
    async resolvePromotionSource(input) {
      const value = await post(fetcher, base, TOPIC_PROMOTION_SOURCE_PATH, config.admissionHeader, input);
      if (value === null) return null;
      const result = closedRecord(value, ["status", "sourceNote", "meckyReplyEvent", "meckyReceiptId"])
        ?? closedRecord(value, ["status", "sourceNote", "meckyReplyEvent"]);
      const sourceNote = result && nostrEvent(result.sourceNote);
      const meckyReplyEvent = result && nostrEvent(result.meckyReplyEvent);
      if (!result || result.status !== "resolved" || !sourceNote || !meckyReplyEvent ||
        (result.meckyReceiptId !== undefined && typeof result.meckyReceiptId !== "string")) {
        throw new Error("staging_participant_topic_source_invalid");
      }
      return {
        sourceNote, meckyReplyEvent,
        ...(result.meckyReceiptId === undefined ? {} : { meckyReceiptId: result.meckyReceiptId }),
      };
    },
    async publishPromotion({ event }) {
      const value = await post(
        fetcher,
        base,
        TOPIC_PROMOTION_PUBLISH_PATH,
        config.admissionHeader,
        { event },
        TOPIC_PROMOTION_SAFE_FAILURES,
      );
      if (!published(value, event.id)) throw new Error("staging_participant_topic_publish_invalid");
      return { status: "published", eventId: event.id } as const;
    },
    async resolveTopicSuggestionSources(input) {
      const value = await post(fetcher, base, TOPIC_SUGGESTION_SOURCE_PATH, config.admissionHeader, input);
      if (value === null) return null;
      const result = closedRecord(value, [
        "status", "sourceNote", "discussionRoot", "meckyAnswer", "meckyReplyEvent", "meckyReceiptId",
      ]) ?? closedRecord(value, [
        "status", "sourceNote", "discussionRoot", "meckyAnswer", "meckyReplyEvent",
      ]);
      const sourceNote = result && nostrEvent(result.sourceNote);
      const discussionRoot = result && nostrEvent(result.discussionRoot);
      const meckyAnswer = result && nostrEvent(result.meckyAnswer);
      const meckyReplyEvent = result && nostrEvent(result.meckyReplyEvent);
      if (!result || result.status !== "resolved" || !sourceNote || !discussionRoot || !meckyAnswer || !meckyReplyEvent ||
        (result.meckyReceiptId !== undefined && typeof result.meckyReceiptId !== "string")) {
        throw new Error("staging_participant_topic_source_invalid");
      }
      return {
        sourceNote, discussionRoot, meckyAnswer, meckyReplyEvent,
        ...(result.meckyReceiptId === undefined ? {} : { meckyReceiptId: result.meckyReceiptId }),
      };
    },
    async publishTopicSuggestion({ event }) {
      const value = await post(fetcher, base, TOPIC_SUGGESTION_PUBLISH_PATH, config.admissionHeader, { event });
      if (!published(value, event.id)) throw new Error("staging_participant_topic_publish_invalid");
      return { status: "published", eventId: event.id } as const;
    },
  };
}
