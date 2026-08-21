import { isAgentEvent, type NostrEvent } from "@netizen-labs/nostr";

/**
 * What an agent is allowed to answer.
 *
 * These are not tuning knobs, they are the difference between a helpful companion
 * and a spam engine wearing the town's identity. They exist BEFORE the answering
 * does, because every one of them is far harder to add once people are used to
 * unlimited replies.
 */

export interface Bounds {
  /** Most replies to one author within the window. */
  perAuthorPerHour: number;
  /** Most replies in total per day, so a bad prompt cannot drain a budget. */
  perDay: number;
  /** Master switch — the manifest's agents.charter.killSwitch. */
  enabled: boolean;
}

export const DEFAULT_BOUNDS: Bounds = { perAuthorPerHour: 5, perDay: 100, enabled: true };

export interface ReplyHistory {
  /** Timestamps (unix seconds) of replies already sent, newest last. */
  repliedAt: number[];
  /** Per-author reply timestamps. */
  byAuthor: Map<string, number[]>;
  /** Parent event ids already answered — the idempotency key. */
  answered: Set<string>;
  /** Transient failures are retried, but never on every watcher pass. */
  retryAfter: Map<string, number>;
  /** In-memory exponential backoff state; relay replies remain the durable truth. */
  retryAttempts: Map<string, number>;
  /** Signed replies already copied into the app read model during this process. */
  projected: Set<string>;
}

export type Refusal =
  | "kill-switch"
  | "already-answered"
  | "retry-backoff"
  | "self"
  | "other-agent"
  | "author-rate-limit"
  | "daily-cap"
  | "empty";

export interface Decision {
  answer: boolean;
  reason?: Refusal;
}

const HOUR = 3600;
const DAY = 86_400;

/**
 * Decide whether to answer one mention.
 *
 * Pure, so every rule is testable without a relay, an LLM or a clock.
 */
export function shouldAnswer(args: {
  event: NostrEvent;
  agentPubkey: string;
  history: ReplyHistory;
  now: number;
  bounds?: Bounds;
}): Decision {
  const { event, agentPubkey, history, now } = args;
  const bounds = args.bounds ?? DEFAULT_BOUNDS;

  if (!bounds.enabled) return { answer: false, reason: "kill-switch" };
  if (history.answered.has(event.id)) return { answer: false, reason: "already-answered" };
  if ((history.retryAfter.get(event.id) ?? 0) > now) {
    return { answer: false, reason: "retry-backoff" };
  }

  // Never answer itself. Without this a reply that mentions the agent loops forever.
  if (event.pubkey.toLowerCase() === agentPubkey.toLowerCase()) {
    return { answer: false, reason: "self" };
  }

  // Never answer another agent. Two bots that reply to each other will do so
  // until someone notices the bill.
  if (isAgentEvent(event)) return { answer: false, reason: "other-agent" };

  if (!event.content?.trim()) return { answer: false, reason: "empty" };

  const author = event.pubkey.toLowerCase();
  const recent = (history.byAuthor.get(author) ?? []).filter((t) => now - t < HOUR);
  if (recent.length >= bounds.perAuthorPerHour) {
    return { answer: false, reason: "author-rate-limit" };
  }

  const today = history.repliedAt.filter((t) => now - t < DAY);
  if (today.length >= bounds.perDay) return { answer: false, reason: "daily-cap" };

  return { answer: true };
}

/** Record a reply so the bounds see it on the next pass. */
export function recordReply(history: ReplyHistory, event: NostrEvent, now: number): void {
  history.answered.add(event.id);
  history.retryAfter.delete(event.id);
  history.retryAttempts.delete(event.id);
  history.repliedAt.push(now);
  const author = event.pubkey.toLowerCase();
  history.byAuthor.set(author, [...(history.byAuthor.get(author) ?? []), now]);
}

/** Defer a transient failure with bounded exponential backoff (1, 2, 4…15 minutes). */
export function deferReply(history: ReplyHistory, event: NostrEvent, now: number): void {
  const attempts = (history.retryAttempts.get(event.id) ?? 0) + 1;
  const delay = Math.min(60 * (2 ** Math.min(attempts - 1, 4)), 900);
  history.retryAttempts.set(event.id, attempts);
  history.retryAfter.set(event.id, now + delay);
}

export function emptyHistory(): ReplyHistory {
  return {
    repliedAt: [],
    byAuthor: new Map(),
    answered: new Set(),
    retryAfter: new Map(),
    retryAttempts: new Map(),
    projected: new Set(),
  };
}
