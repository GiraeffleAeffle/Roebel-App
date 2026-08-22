import Link from "next/link";
import {
  Bot,
  CheckCircle2,
  ChevronRight,
  GitFork,
  MessageCircleMore,
} from "lucide-react";
import type { StagingTopicPost } from "@/lib/stadtstack/staging-api";

function shortTime(value: string): string {
  return new Date(value).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function CivicTopicActivityCard({ topic }: { topic: StagingTopicPost }) {
  const href = topic.synthetic
    ? `/app/diskussion/${topic.id}`
    : `/app/themen/${encodeURIComponent(topic.topicId)}`;
  return (
    <Link
      href={href}
      className="block rounded-xl border border-primary/25 bg-card p-4 shadow-sm transition hover:border-primary/50 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <GitFork className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
              Bürger-Thema
            </span>
            <h3 className="text-base font-semibold text-foreground">
              {topic.topicTitle}
            </h3>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs font-medium text-muted-foreground">
            <span>
              {topic.discussionCount}{" "}
              {topic.discussionCount === 1 ? "Diskussion" : "Diskussionen"}
            </span>
            <span>·</span>
            <span>
              {topic.sourcePostIds.length}{" "}
              {topic.sourcePostIds.length === 1
                ? "Quellbeitrag"
                : "Quellbeiträge"}
            </span>
            <span>·</span>
            <span>{topic.activityCount} signierte Aktivitäten</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">
              Leitfrage von {topic.author.name}
            </span>
            <span>
              {topic.synthetic
                ? "Synthetisches Profil"
                : "Verknüpftes Staging-Konto"}
            </span>
            <span>·</span>
            <span>zuletzt aktiv {shortTime(topic.lastActivityAt)}</span>
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground">
            {topic.content}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs font-medium text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <MessageCircleMore className="h-4 w-4" /> {topic.replyCount}{" "}
              Argumente
            </span>
            <span className="inline-flex items-center gap-1">
              <GitFork className="h-4 w-4" /> Pro/Contra-Baum
            </span>
            {topic.meckyAnswered ? (
              <span className="inline-flex items-center gap-1 text-emerald-700">
                <CheckCircle2 className="h-4 w-4" /> Mecky hat signiert
                geantwortet
              </span>
            ) : topic.meckyMentioned ? (
              <span className="inline-flex items-center gap-1 text-amber-700">
                <Bot className="h-4 w-4" /> @Mecky erwähnt · Antwort ausstehend
              </span>
            ) : null}
            <span className="ml-auto inline-flex items-center gap-1 text-primary">
              {topic.synthetic ? "Diskussion öffnen" : "Thema öffnen"}{" "}
              <ChevronRight className="h-4 w-4" />
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}
