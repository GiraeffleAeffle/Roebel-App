"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  ChevronRight,
  FileText,
  GitFork,
  Loader2,
  MessageCircleMore,
  ShieldCheck,
} from "lucide-react";
import {
  projectPublicCivicTopicDetail,
  projectPublicCivicTopicJourney,
  type PublicCivicTopicDetail,
} from "@/lib/stadtstack/civic-topic-detail";
import {
  stagingGet,
  loadStadtstackAdministrationProgress,
  type StagingFeedResponse,
} from "@/lib/stadtstack/staging-api";
import type { StadtstackAdministrationProgress as AdministrationProgress } from "@/lib/stadtstack/administration-progress";
import { StadtstackAdministrationProgress } from "./StadtstackAdministrationProgress";
import { CivicJourneyRail } from "./CivicJourneyRail";

function date(value: string): string {
  return new Date(value).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function StadtstackCivicTopic({ topicId }: { topicId: string }) {
  const [detail, setDetail] = useState<PublicCivicTopicDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [administrationProgress, setAdministrationProgress] =
    useState<AdministrationProgress | null>(null);
  const [administrationLoading, setAdministrationLoading] = useState(false);
  const [administrationError, setAdministrationError] = useState<string | null>(
    null
  );
  const administrationRequestId = useRef(0);
  const canonicalCaseId = detail?.caseBinding?.canonicalCaseId ?? null;

  const refreshAdministration = useCallback(async () => {
    if (!canonicalCaseId) return;
    const requestId = ++administrationRequestId.current;
    setAdministrationLoading(true);
    setAdministrationError(null);
    try {
      const progress =
        await loadStadtstackAdministrationProgress(canonicalCaseId);
      if (administrationRequestId.current !== requestId) return;
      setAdministrationProgress(progress);
    } catch {
      if (administrationRequestId.current !== requestId) return;
      setAdministrationError(
        "Der öffentlich geprüfte Verwaltungsstand ist gerade nicht erreichbar."
      );
    } finally {
      if (administrationRequestId.current === requestId) {
        setAdministrationLoading(false);
      }
    }
  }, [canonicalCaseId]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void stagingGet<StagingFeedResponse>("/feed?profile=public")
      .then((feed) => {
        if (!active) return;
        const projected = projectPublicCivicTopicDetail(feed, topicId);
        if (!projected) throw new Error("civic_topic_not_found");
        setDetail(projected);
      })
      .catch(() => {
        if (active) setError("Das öffentliche Bürger-Thema ist nicht erreichbar.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [topicId]);

  useEffect(() => {
    setAdministrationProgress(null);
    setAdministrationError(null);
    if (!canonicalCaseId) {
      administrationRequestId.current += 1;
      setAdministrationLoading(false);
      return;
    }
    void refreshAdministration();
  }, [canonicalCaseId, refreshAdministration]);

  if (loading) {
    return (
      <div className="flex min-h-72 items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-primary" />
      </div>
    );
  }
  if (!detail || error) {
    return (
      <div className="space-y-4">
        <Link
          href="/app"
          className="inline-flex items-center gap-1 text-sm text-primary"
        >
          <ArrowLeft className="h-4 w-4" /> Zurück zum Feed
        </Link>
        <div className="rounded-xl border border-rose-300 bg-rose-50 p-5 text-rose-950">
          {error ?? "Bürger-Thema nicht gefunden."}
        </div>
      </div>
    );
  }

  const { topic, sourcePosts, unresolvedSourcePostIds } = detail;
  const administrationStatus = administrationProgress
    ? {
        caseId: administrationProgress.caseBinding.caseId,
        status:
          administrationProgress.status === "citizen_brief_current"
            ? ("brief_current" as const)
            : ("in_review" as const),
      }
    : null;
  const journey = projectPublicCivicTopicJourney(detail, administrationStatus);
  return (
    <div className="space-y-5">
      <Link
        href="/app"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Zurück zum Feed
      </Link>

      <header className="rounded-xl border border-emerald-700/25 bg-emerald-950 p-5 text-white">
        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-emerald-200">
          <GitFork className="h-4 w-4" /> Bürger-Thema · signierte öffentliche
          Projektion
        </div>
        <h1 className="mt-2 text-2xl font-bold leading-8">
          {topic.topicTitle}
        </h1>
        <p className="mt-2 text-sm leading-6 text-emerald-50">
          {topic.content}
        </p>
        <div className="mt-3 flex flex-wrap gap-3 text-xs text-emerald-100">
          <span>{topic.discussionCount} strukturierte Diskussionen</span>
          <span>{topic.sourcePostIds.length} Quellbeiträge</span>
          <span>{topic.activityCount} signierte Aktivitäten</span>
          <span>zuletzt aktiv {date(topic.lastActivityAt)}</span>
        </div>
      </header>

      {journey && <CivicJourneyRail journey={journey} />}

      {detail.caseBindingConflict && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          Mehrere Civic-Case-Bindungen wurden für dieses Thema gefunden. Der
          Verwaltungsstand bleibt ausgeblendet, bis die Zuordnung menschlich
          geklärt ist.
        </div>
      )}

      {detail.caseBinding && (
        <StadtstackAdministrationProgress
          progress={administrationProgress}
          loading={administrationLoading}
          error={administrationError}
          onRefresh={refreshAdministration}
          participationHref={`/app/proposals?case=${encodeURIComponent(
            detail.caseBinding.canonicalCaseId
          )}&topic=${encodeURIComponent(topicId)}`}
        />
      )}

      <section className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
          <div>
            <h2 className="font-bold">Eine öffentliche Linie, getrennte Records</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Beiträge bleiben Beiträge. Jede Diskussion bleibt ein eigenes
              signiertes Nostr-Ereignis. Dieses Thema gruppiert nur die
              öffentlichen Verweise und verleiht weder Abstimmungs- noch
              Verwaltungs- oder Treasury-Wirkung.
            </p>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-bold">Aus dem normalen Feed</h2>
        </div>
        {sourcePosts.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
            Die signierten Quellereignisse sind referenziert, aber derzeit
            nicht als öffentliche App-Beiträge projiziert.
          </div>
        ) : (
          sourcePosts.map((post) => {
            const content = (
              <article className="rounded-xl border border-border bg-card p-4">
                <div className="text-xs font-semibold text-muted-foreground">
                  {post.author.name} · {date(post.createdAt)}
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6">
                  {post.content}
                </p>
                {post.sourceAppPostId && (
                  <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary">
                    Ursprünglichen Beitrag öffnen
                    <ChevronRight className="h-4 w-4" />
                  </span>
                )}
              </article>
            );
            return post.sourceAppPostId ? (
              <Link
                key={post.id}
                href={`/app/posts/${post.sourceAppPostId}`}
                className="block"
              >
                {content}
              </Link>
            ) : (
              <div key={post.id}>{content}</div>
            );
          })
        )}
        {unresolvedSourcePostIds.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {unresolvedSourcePostIds.length} weitere signierte Quellereignisse
            bleiben im Nostr-Evidenzlog erhalten.
          </p>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <GitFork className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-bold">Strukturierte Diskussionen</h2>
        </div>
        {topic.discussions.map((discussion) => (
          <Link
            key={discussion.id}
            href={`/app/diskussion/${discussion.id}`}
            className="block rounded-xl border border-border bg-card p-4 transition hover:border-primary/50 hover:shadow-sm"
          >
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">
                {discussion.author.name}
              </span>
              <span>{date(discussion.createdAt)}</span>
            </div>
            <p className="mt-2 text-sm font-semibold leading-6">
              {discussion.content}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs font-medium text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <MessageCircleMore className="h-4 w-4" />
                {discussion.replyCount} Argumente
              </span>
              {discussion.meckyAnswered ? (
                <span className="inline-flex items-center gap-1 text-emerald-700">
                  <CheckCircle2 className="h-4 w-4" /> Mecky hat geantwortet
                </span>
              ) : discussion.meckyMentioned ? (
                <span className="inline-flex items-center gap-1 text-amber-700">
                  <Bot className="h-4 w-4" /> Mecky-Antwort ausstehend
                </span>
              ) : null}
              {discussion.suggestionSigned && (
                <span className="inline-flex items-center gap-1 text-violet-700">
                  <FileText className="h-4 w-4" /> Vorschlag signiert
                </span>
              )}
              {discussion.caseBinding && (
                <span className="inline-flex items-center gap-1 text-sky-700">
                  <ShieldCheck className="h-4 w-4" /> CivicCase aufgenommen
                </span>
              )}
              {discussion.sourceConversation && (
                <span className="inline-flex items-center gap-1 text-blue-700">
                  <Bot className="h-4 w-4" /> Aus ausgewähltem
                  Mecky-Austausch
                </span>
              )}
              <span className="ml-auto inline-flex items-center gap-1 text-primary">
                Diskussion öffnen <ChevronRight className="h-4 w-4" />
              </span>
            </div>
          </Link>
        ))}
      </section>
    </div>
  );
}
