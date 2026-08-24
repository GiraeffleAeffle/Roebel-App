"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { GitFork, Loader2 } from "lucide-react";
import type { NostrEvent } from "@netizen-labs/nostr";

import { useCitizenSession } from "@/lib/citizen-session/CitizenSessionContext";
import {
  promoteAppPostToCivicTopic,
  type AppPostPromotionGateway,
  type AppPostPromotionSource,
} from "@/lib/stadtstack/app-post-promotion";
import {
  stagingGet,
  stagingPost,
  type StagingConfigResponse,
  type StagingFeedResponse,
  type StagingMeckyConversationReply,
  type StagingMeckyConversationResponse,
} from "@/lib/stadtstack/staging-api";
import { resolveStadtstackStagingLab } from "@/lib/stadtstack/staging-lab";

const gateway: AppPostPromotionGateway = {
  getConfig: () => stagingGet<StagingConfigResponse>("/config"),
  getFeed: () => stagingGet<StagingFeedResponse>("/feed"),
  admit: (proof) =>
    stagingPost<{ status: "admitted"; pubkey: string }>(
      "/session/admit",
      proof,
    ),
  publish: (intent, event) =>
    stagingPost<
      | { status: "published" | "promoted"; event?: NostrEvent }
      | { status: "already_promoted"; event: NostrEvent }
    >("/signed-event", { intent, event }),
};

function suggestedTitle(content: string): string {
  const firstSentence = content.split(/[.!?\n]/, 1)[0]?.trim() ?? "";
  return firstSentence.slice(0, 120);
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
  const [selectedSource, setSelectedSource] = useState("original-post");
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
      const conversation = await stagingGet<StagingMeckyConversationResponse>(
        `/conversation?post=${encodeURIComponent(post.id)}`,
      );
      setConversationReplies(
        conversation.replies.filter((reply) => reply.evidenceRefs.length > 0),
      );
    } catch {
      setConversationReplies([]);
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
      const selectedReply = conversationReplies.find(
        (reply) => reply.id === selectedSource,
      );
      const selectedReplySeconds =
        selectedReply === undefined
          ? 0
          : Math.floor(Date.parse(selectedReply.createdAt) / 1_000);
      if (
        selectedReply !== undefined &&
        !Number.isSafeInteger(selectedReplySeconds)
      ) {
        throw new Error("app_post_promotion_conversation_timestamp_invalid");
      }
      const result = await promoteAppPostToCivicTopic({
        session,
        gateway,
        post: { ...post, walletAddress: post.walletAddress.toLowerCase() },
        topicTitle,
        question,
        nowSeconds: Math.max(
          Math.floor(Date.now() / 1_000),
          selectedReplySeconds + 1,
        ),
        ...(selectedReply === undefined
          ? {}
          : {
              conversationSource: {
                kind: "selected_conversation" as const,
                sourceAppPostId: post.id,
                ...(selectedReply.sourceAppCommentId === null
                  ? {}
                  : {
                      sourceAppCommentId: selectedReply.sourceAppCommentId,
                    }),
                mentionEventId: selectedReply.mentionId,
                replyEventId: selectedReply.id,
                ...(selectedReply.receiptId === null
                  ? {}
                  : { receiptId: selectedReply.receiptId }),
              },
            }),
      });
      router.push(`/app/diskussion/${result.discussionId}`);
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
            <label className="flex cursor-pointer gap-2 rounded-lg border border-border bg-background p-3 text-xs">
              <input
                type="radio"
                name={`stadtstack-source-${post.id}`}
                value="original-post"
                checked={selectedSource === "original-post"}
                onChange={(event) => setSelectedSource(event.target.value)}
                className="mt-0.5"
              />
              <span>
                <span className="block font-semibold text-foreground">
                  Ursprünglichen Beitrag verwenden
                </span>
                <span className="mt-0.5 block text-muted-foreground">
                  Die neue Diskussion verweist auf diesen unveränderten Beitrag.
                </span>
              </span>
            </label>
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
                setSelectedSource("original-post");
              }}
              disabled={busy}
              className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-foreground disabled:opacity-50"
            >
              Abbrechen
            </button>
            <button
              type="submit"
              disabled={busy || topicTitle.trim().length < 3 || question.trim().length < 3}
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
