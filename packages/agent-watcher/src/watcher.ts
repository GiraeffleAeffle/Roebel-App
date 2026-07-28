import {
  RelayClient,
  buildAgentNoteEvent,
  isAgentEvent,
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
  think: (question: string, event: NostrEvent) => Promise<string | null>;
  now?: () => number;
  log?: (message: string) => void;
  makeClient?: (url: string) => Pick<RelayClient, "query" | "publish" | "close">;
  relayUrl: string;
}

export interface PassResult {
  seen: number;
  answered: number;
  refused: Record<string, number>;
}

/** Look back a little so an event written during the previous pass is not missed. */
const LOOKBACK_SECONDS = 900;

export async function watchOnce(deps: WatcherDeps): Promise<PassResult> {
  const log = deps.log ?? (() => {});
  const now = (deps.now ?? (() => Math.floor(Date.now() / 1000)))();
  const client = deps.makeClient
    ? deps.makeClient(deps.relayUrl)
    : new RelayClient(deps.relayUrl, { timeoutMs: 15_000 });

  const refused: Record<string, number> = {};
  let answered = 0;
  let mentions: NostrEvent[] = [];

  try {
    mentions = await client.query([
      {
        kinds: [1],
        "#p": [deps.agent.publicKey],
        since: now - LOOKBACK_SECONDS,
        limit: 100,
      },
    ]);

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

      let answer: string | null = null;
      try {
        answer = await deps.think(event.content, event);
      } catch (error) {
        log(`thinking failed for ${event.id.slice(0, 12)}: ${(error as Error).message}`);
      }

      if (!answer?.trim()) {
        // Mark it answered anyway: a question the agent cannot answer must not be
        // retried forever on every pass.
        recordReply(deps.history, event, now);
        refused.declined = (refused.declined ?? 0) + 1;
        continue;
      }

      const reply = buildAgentNoteEvent(deps.agent, answer.trim(), {
        tags: [
          ["e", event.id, "", "reply"],
          ["p", event.pubkey],
        ],
      });
      const result = await client.publish(reply);
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
    client.close();
  }

  return { seen: mentions.length, answered, refused };
}

/** Exported for the CLI's logging, and so callers can reason about what was skipped. */
export { isAgentEvent };
