import {
  RelayClient,
  buildAgentNoteEvent,
  isAgentEvent,
  verifyEvent,
  type AgentIdentity,
  type NostrEvent,
} from "@netizen-labs/nostr";
import { recordReply, shouldAnswer, type Bounds, type ReplyHistory } from "./bounds";

/**
 * Watch a relay for mentions of this node's agent and answer in place.
 *
 * A mention is a NIP-01 `p` tag carrying the agent's pubkey, so the question is
 * legible to any Nostr client rather than only to the app that wrote it. The reply
 * is a kind 1 with an `e` tag pointing at the parent — a standard threaded reply,
 * automatically labelled `netizen_agent` because it is built as an agent event.
 */

export interface WatcherDeps {
  agent: AgentIdentity;
  history: ReplyHistory;
  bounds?: Bounds;
  /** Produce the answer. Returning null declines to answer at all. */
  think: (
    question: string,
    event: NostrEvent,
  ) => Promise<string | WatcherReply | null>;
  now?: () => number;
  /** Maximum age of mentions considered for restart recovery. */
  lookbackSeconds?: number;
  log?: (message: string) => void;
  makeClient?: (url: string) => Pick<RelayClient, "query" | "publish" | "close">;
  /** Relay that stores the agent profile and replies. Defaults to relayUrl. */
  replyRelayUrl?: string;
  relayUrl: string;
}

export interface WatcherReply {
  content: string;
  tags: string[][];
}

export interface PassResult {
  seen: number;
  answered: number;
  refused: Record<string, number>;
}

/** Backfill one day by default; signed relay replies remain the idempotency source. */
export const DEFAULT_LOOKBACK_SECONDS = 86_400;
const DAY_SECONDS = 86_400;
const MAX_RELAY_REPLY_HISTORY = 500;
const REPLY_TAG_NAMES = new Set([
  "mecky-receipt",
  "municipality",
  "topic",
  "case",
  "stadtstack-case",
  "evidence",
]);

function normalizeReply(value: string | WatcherReply | null): WatcherReply | null {
  if (value === null) return null;
  if (typeof value === "string") return { content: value.trim(), tags: [] };
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== "content,tags" ||
    typeof value.content !== "string" ||
    !Array.isArray(value.tags)
  ) {
    throw new Error("watcher_reply_invalid");
  }
  const content = value.content.trim();
  if (!content || content.length > 2_000 || value.tags.length > 8) {
    throw new Error("watcher_reply_invalid");
  }
  const tags = value.tags.map((tag) => {
    if (
      !Array.isArray(tag) ||
      tag.length < 2 ||
      tag.length > 3 ||
      tag.some((part) => typeof part !== "string" || part.length === 0) ||
      !REPLY_TAG_NAMES.has(tag[0]!)
    ) {
      throw new Error("watcher_reply_invalid");
    }
    return [...tag];
  });
  return { content, tags };
}

function restorePublishedReply(history: ReplyHistory, event: NostrEvent): void {
  const parentId = event.tags.find(
    (tag) => tag[0] === "e" && tag[3] === "reply" && typeof tag[1] === "string",
  )?.[1];
  if (!parentId || history.answered.has(parentId)) return;

  history.answered.add(parentId);
  history.repliedAt.push(event.created_at);
  const author = event.tags.find(
    (tag) => tag[0] === "p" && typeof tag[1] === "string",
  )?.[1];
  if (author) {
    const normalized = author.toLowerCase();
    history.byAuthor.set(normalized, [
      ...(history.byAuthor.get(normalized) ?? []),
      event.created_at,
    ]);
  }
}

export async function watchOnce(deps: WatcherDeps): Promise<PassResult> {
  const log = deps.log ?? (() => {});
  const now = (deps.now ?? (() => Math.floor(Date.now() / 1000)))();
  const lookbackSeconds = deps.lookbackSeconds ?? DEFAULT_LOOKBACK_SECONDS;
  if (!Number.isSafeInteger(lookbackSeconds) || lookbackSeconds < 60 || lookbackSeconds > DAY_SECONDS) {
    throw new Error("watcher_lookback_seconds_invalid");
  }
  const citizenClient = deps.makeClient
    ? deps.makeClient(deps.relayUrl)
    : new RelayClient(deps.relayUrl, { timeoutMs: 15_000 });
  const replyRelayUrl = deps.replyRelayUrl ?? deps.relayUrl;
  const replyClient = replyRelayUrl === deps.relayUrl
    ? citizenClient
    : deps.makeClient
      ? deps.makeClient(replyRelayUrl)
      : new RelayClient(replyRelayUrl, { timeoutMs: 15_000 });

  const refused: Record<string, number> = {};
  let answered = 0;
  let mentions: NostrEvent[] = [];

  try {
    const [mentionEvents, replyEvents] = await Promise.all([
      citizenClient.query([{
        kinds: [1],
        "#p": [deps.agent.publicKey],
        since: now - lookbackSeconds,
        limit: 100,
      }]),
      replyClient.query([{
        kinds: [1],
        authors: [deps.agent.publicKey],
        since: now - DAY_SECONDS,
        limit: MAX_RELAY_REPLY_HISTORY,
      }]),
    ]);

    // Relay filters are a transport convenience, not a trust boundary. Only a
    // signature-valid event may suppress a reply or consume a rate-limit slot.
    const verifiedMentions = mentionEvents.filter(verifyEvent);
    const verifiedReplies = replyEvents.filter(verifyEvent);

    for (const event of verifiedReplies) {
      if (
        event.pubkey.toLowerCase() === deps.agent.publicKey.toLowerCase() &&
        isAgentEvent(event)
      ) {
        restorePublishedReply(deps.history, event);
      }
    }
    // The relay applies the first filter, so every non-self result is a mention.
    // The second filter adds our own published replies solely as durable
    // idempotency/rate-limit evidence; never feed those back into shouldAnswer.
    mentions = verifiedMentions.filter(
      (event) => event.pubkey.toLowerCase() !== deps.agent.publicKey.toLowerCase(),
    );

    // Oldest first, so a burst is answered in the order it was asked.
    for (const event of [...mentions].sort((a, b) => a.created_at - b.created_at)) {
      const decision = shouldAnswer({
        event,
        agentPubkey: deps.agent.publicKey,
        history: deps.history,
        now,
        bounds: deps.bounds,
      });

      if (!decision.answer) {
        refused[decision.reason ?? "unknown"] = (refused[decision.reason ?? "unknown"] ?? 0) + 1;
        continue;
      }

      let answer: WatcherReply | null = null;
      try {
        answer = normalizeReply(await deps.think(event.content, event));
      } catch (error) {
        log(`thinking failed for ${event.id.slice(0, 12)}: ${(error as Error).message}`);
      }

      if (!answer) {
        // Mark it answered anyway: a question the agent cannot answer must not be
        // retried forever on every pass.
        recordReply(deps.history, event, now);
        refused.declined = (refused.declined ?? 0) + 1;
        continue;
      }

      const reply = buildAgentNoteEvent(deps.agent, answer.content, {
        tags: [
          ["e", event.id, "", "reply"],
          ["p", event.pubkey],
          ...answer.tags,
        ],
      });
      const result = await replyClient.publish(reply);
      if (result.ok) {
        recordReply(deps.history, event, now);
        answered += 1;
        log(`answered ${event.id.slice(0, 12)} by ${event.pubkey.slice(0, 12)}`);
      } else {
        // Do NOT record it: a relay rejection is worth retrying next pass.
        log(`relay refused the reply: ${result.message}`);
      }
    }
  } finally {
    citizenClient.close();
    if (replyClient !== citizenClient) replyClient.close();
  }

  return { seen: mentions.length, answered, refused };
}

/** Exported for the CLI's logging, and so callers can reason about what was skipped. */
export { isAgentEvent };
