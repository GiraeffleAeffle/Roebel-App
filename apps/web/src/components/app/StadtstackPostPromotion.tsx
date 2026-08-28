"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { GitFork, Loader2 } from "lucide-react";

import { useCitizenSession } from "@/lib/citizen-session/CitizenSessionContext";
import type { StagingMeckyConversationReply } from "@/lib/stadtstack/staging-api";
import {
  loadPublicCivicInstance,
  loadPublicMeckyConversation,
} from "@/lib/stadtstack/civic-projection-client";
import { resolveStadtstackStagingLab } from "@/lib/stadtstack/staging-lab";
import {
  promoteStagingParticipantSourcePost,
  resumeStagingParticipantSourcePostPromotion,
} from "@/lib/staging-participant/topic-tracer";

type AppPostPromotionSource = Readonly<{
  id: string;
  walletAddress: string;
  content: string;
  createdAt: string;
}>;

function suggestedTitle(content: string): string {
  const firstSentence = content.split(/[.!?\n]/, 1)[0]?.trim() ?? "";
  return firstSentence.slice(0, 120);
}

function toTopicId(title: string): string {
  const slug = title
    .trim()
    .toLocaleLowerCase("de-DE")
    .replaceAll("ä", "ae")
    .replaceAll("ö", "oe")
    .replaceAll("ü", "ue")
    .replaceAll("ß", "ss")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
    .replace(/-+$/g, "");
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(slug)) {
    throw new Error("staging_participant_topic_title_invalid");
  }
  return `urn:stadtstack:topic:municipality:roebel-mueritz:${slug}`;
}

export function StadtstackPostPromotion({
  post,
}: {
  post: AppPostPromotionSource;
}) {
  const router = useRouter();
  const session = useCitizenSession();
  const enabled = resolveStadtstackStagingLab(
    process.env.NEXT_PUBLIC_STADTSTACK_STAGING_LAB,
  );
  const [open, setOpen] = useState(false);
  const [topicTitle, setTopicTitle] = useState(() => suggestedTitle(post.content));
  const [question, setQuestion] = useState("");
  const [conversationReplies, setConversationReplies] = useState<
    StagingMeckyConversationReply[]
  >([]);
  const [selectedSource, setSelectedSource] = useState("");
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (
    !enabled ||
    !session ||
    session.snapshot.credential.address !== post.walletAddress.toLowerCase()
  ) {
    return null;
  }

  const openPromotion = async () => {
    setOpen(true);
    setError(null);
    setLoadingConversation(true);
    try {
      const resumed = await resumeStagingParticipantSourcePostPromotion(post.id);
      if (resumed) {
        router.push(`/app/diskussion/${resumed.discussionRootId}`);
        return;
      }
      const conversation = await loadPublicMeckyConversation(post.id);
      const replies = conversation.replies.filter(
        (reply) =>
          reply.evidenceRefs.length > 0 && reply.sourceAppCommentId === null,
      );
      setConversationReplies(replies);
      setSelectedSource((current) => current || replies[0]?.id || "");
    } catch (cause) {
      setConversationReplies([]);
      setError(
        cause instanceof Error
          ? cause.message
          : "Ein offener Diskussionsschritt konnte nicht fortgesetzt werden.",
      );
    } finally {
      setLoadingConversation(false);
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const selectedReply = conversationReplies.find((reply) => reply.id === selectedSource);
      if (!selectedReply) throw new Error("staging_participant_mecky_reply_required");
      const selectedReplySeconds = Math.floor(
        Date.parse(selectedReply.createdAt) / 1_000,
      );
      if (!Number.isSafeInteger(selectedReplySeconds) || selectedReplySeconds < 0) {
        throw new Error("staging_participant_mecky_reply_timestamp_invalid");
      }
      if (
        selectedReply.mentionEvent.id !== selectedReply.mentionId ||
        selectedReply.replyEvent.id !== selectedReply.id
      ) {
        throw new Error("staging_participant_source_exchange_invalid");
      }
      const config = await loadPublicCivicInstance();
      const topicId = toTopicId(topicTitle);
      const rootEvent = await session.promotePublicPostToTopic({
        sourcePost: selectedReply.mentionEvent,
        municipalityId: "roebel-mueritz",
        topicId,
        topicTitle: topicTitle.trim(),
        agentPubkey: config.meckyPubkey,
        content: /@mecky\b/iu.test(question.trim())
          ? question.trim()
          : `@Mecky, ${question.trim()}`,
        conversationSource: {
          kind: "selected_conversation",
          sourceAppPostId: post.id,
          mentionEventId: selectedReply.mentionEvent.id,
          replyEventId: selectedReply.id,
          ...(selectedReply.receiptId === null ? {} : { receiptId: selectedReply.receiptId }),
        },
        createdAt: Math.max(
          Math.floor(Date.now() / 1_000),
          selectedReply.mentionEvent.created_at + 1,
          selectedReplySeconds + 1,
        ),
      });
      const receipt = await promoteStagingParticipantSourcePost({
        sourcePostId: post.id,
        rootEvent,
      });
      router.push(`/app/diskussion/${receipt.discussionRootId}`);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Das Bürger-Thema konnte nicht angelegt werden.",
      );
      setBusy(false);
    }
  };

  return (
    <section className="border-t border-border bg-primary/[0.025] px-4 py-3">
      {!open ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-foreground">
              Zeigt dieser Beitrag ein gemeinsames Röbel-Thema?
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Nur du als Autor kannst daraus eine nachvollziehbare Diskussion
              starten.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void openPromotion()}
            className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/5"
          >
            <GitFork className="h-4 w-4" /> Als Bürger-Thema weiterführen
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label
              htmlFor={`stadtstack-topic-${post.id}`}
              className="text-xs font-semibold text-foreground"
            >
              Thema
            </label>
            <input
              id={`stadtstack-topic-${post.id}`}
              value={topicTitle}
              onChange={(event) => setTopicTitle(event.target.value)}
              minLength={3}
              maxLength={120}
              required
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            />
          </div>
          <fieldset className="space-y-2">
            <legend className="text-xs font-semibold text-foreground">
              Nachvollziehbarer Ausgangspunkt
            </legend>
            {loadingConversation ? (
              <p className="text-xs text-muted-foreground">
                Belegte Mecky-Antworten werden geladen …
              </p>
            ) : (
              conversationReplies.map((reply) => (
                <label
                  key={reply.id}
                  className="flex cursor-pointer gap-2 rounded-lg border border-border bg-background p-3 text-xs"
                >
                  <input
                    type="radio"
                    name={`stadtstack-source-${post.id}`}
                    value={reply.id}
                    checked={selectedSource === reply.id}
                    onChange={(event) => setSelectedSource(event.target.value)}
                    className="mt-0.5"
                  />
                  <span className="min-w-0">
                    <span className="block font-semibold text-foreground">
                      @Mecky-Austausch von {reply.mentionAuthor.name} mitnehmen
                    </span>
                    <span className="mt-0.5 line-clamp-2 block text-muted-foreground">
                      {reply.content}
                    </span>
                    <span className="mt-1 block text-primary">
                      {reply.evidenceRefs.length} belegte Quelle
                      {reply.evidenceRefs.length === 1 ? "" : "n"} · Antwort
                      {reply.sourceAppCommentId === null
                        ? " auf den Beitrag"
                        : " im Kommentarverlauf"}
                    </span>
                  </span>
                </label>
              ))
            )}
            {!loadingConversation && conversationReplies.length === 0 && (
              <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950">
                Für diesen Staging-Schritt braucht es zuerst die beantwortete,
                signierte @Mecky-Erwähnung dieses Beitrags.
              </p>
            )}
          </fieldset>
          <div>
            <label
              htmlFor={`stadtstack-question-${post.id}`}
              className="text-xs font-semibold text-foreground"
            >
              Was soll gemeinsam geklärt werden?
            </label>
            <textarea
              id={`stadtstack-question-${post.id}`}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              rows={3}
              minLength={3}
              maxLength={1_000}
              required
              placeholder="Zum Beispiel: @Mecky, welche geprüften Informationen und Optionen gibt es dazu?"
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            />
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            Der ursprüngliche Beitrag bleibt unverändert und wird als Quelle
            zitiert. Noch kein Vorschlag oder CivicCase: Diese entstehen erst
            durch spätere, ausdrücklich bestätigte menschliche Schritte.
          </p>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setError(null);
                setSelectedSource("");
              }}
              disabled={busy}
              className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-foreground disabled:opacity-50"
            >
              Abbrechen
            </button>
            <button
              type="submit"
              disabled={busy || topicTitle.trim().length < 3 || question.trim().length < 3 || !selectedSource}
              className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Diskussion starten
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
