import { buildAgentNoteEvent, verifyEvent, type AgentIdentity, type NostrEvent } from "@netizen-labs/nostr";
import { createPublicMeckyRelayReply, publicMeckyDiscussionBindingFor } from "./public-mecky-receipt";
import type { PublicMecky } from "./public-mecky";
import type { PublicDiscussionContext } from "./public-discussion-context";

/** Explicit operator command for one unadopted discussion, never an automatic
 * rewrite or a public write endpoint. The original signed reply is retained. */
export async function prepareDiscussionCorrection(input: {
  context: PublicDiscussionContext;
  previousAnswerId: string;
  agent: AgentIdentity;
  municipalityId: string;
  sourceCaseId: string;
  canonicalCaseId: string;
  publicMecky: PublicMecky;
  now: number;
}): Promise<NostrEvent> {
  const { context, agent } = input;
  const prior = context.currentAnswer, root = context.rootEvent;
  if (context.hasSuggestionOrCase || !prior || !verifyEvent(prior) || !verifyEvent(root) ||
    prior.id !== input.previousAnswerId || prior.pubkey !== agent.publicKey ||
    !Number.isSafeInteger(input.now) || input.now <= prior.created_at ||
    context.evidence.eventId !== root.id || context.evidence.evidenceId !== `sha256:${root.id}`) {
    throw Error("discussion_correction_precondition_failed");
  }
  const binding = publicMeckyDiscussionBindingFor(root, input);
  if (!("topicId" in binding)) throw Error("discussion_correction_requires_unadopted_topic");
  const result = await input.publicMecky.answerMention({
    municipalityId: input.municipalityId, question: root.content.trim(),
    now: new Date(input.now * 1000).toISOString(), discussionId: root.id,
    conversationEvidence: [context.evidence],
  });
  if (result.status !== "answered" || !result.evidenceRefs.some(ref => ref.evidenceId === context.evidence.evidenceId)) {
    throw Error("discussion_correction_requires_discussion_evidence");
  }
  const corrected = createPublicMeckyRelayReply({ discussion: root, binding, result: {
    ...result,
    content: `KI-Korrektur: Die vorherige Antwort hatte unpassende Quellen.\n\n${result.content}`,
  } });
  return buildAgentNoteEvent(agent, corrected.content, {
    createdAt: input.now,
    tags: [["e", root.id, "", "reply"], ["p", root.pubkey],
      ...root.tags.filter(tag => tag[0] === "source-app-post" || tag[0] === "source-app-comment"),
      ...corrected.tags],
  });
}

export async function publishDiscussionCorrection(input: Omit<Parameters<typeof prepareDiscussionCorrection>[0], "context"> & {
  discussionId: string;
  readContext: (id: string) => Promise<PublicDiscussionContext>;
  relay: {
    query: (filters: Array<Record<string, unknown>>) => Promise<NostrEvent[]>;
    publish: (event: NostrEvent) => Promise<{ ok: boolean }>;
  };
  recordPrepared: (event: NostrEvent) => Promise<void>;
}): Promise<NostrEvent> {
  const context = await input.readContext(input.discussionId);
  const requireUnchangedRelay = async () => {
    const replies = await input.relay.query([{ kinds: [1], authors: [input.agent.publicKey], "#e": [input.discussionId], limit: 100 }]);
    const current = replies.filter(event => verifyEvent(event) && event.pubkey === input.agent.publicKey &&
      event.tags.some(tag => tag[0] === "mecky-receipt") &&
      event.tags.some(tag => tag[0] === "e" && tag[1] === input.discussionId && tag[3] === "reply"))
      .sort((a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id))[0];
    if (current?.id !== input.previousAnswerId) throw Error("discussion_correction_relay_changed");
  };
  // A stale app projection cannot hide an already published correction on retry.
  await requireUnchangedRelay();
  const correction = await prepareDiscussionCorrection({ ...input, context });
  const latest = await input.readContext(input.discussionId);
  if (latest.currentAnswer?.id !== input.previousAnswerId || latest.hasSuggestionOrCase) throw Error("discussion_correction_changed");
  await requireUnchangedRelay();
  await input.recordPrepared(correction);
  const result = await input.relay.publish(correction);
  if (!result.ok) throw Error("discussion_correction_publish_refused");
  const stored = await input.relay.query([{ ids: [correction.id], authors: [input.agent.publicKey], kinds: [1], limit: 1 }]);
  if (!stored.some(event => event.id === correction.id && verifyEvent(event))) throw Error("discussion_correction_readback_pending");
  return correction;
}
