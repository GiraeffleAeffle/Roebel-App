"use client";

import Link from "next/link";
import {
  ArrowLeft,
  Bot,
  ExternalLink,
  FileCheck2,
  ShieldCheck,
} from "lucide-react";

import type {
  StagingMeckyConversationResponse,
  StagingOrdinaryPost,
} from "@/lib/stadtstack/staging-api";

function linkify(text: string) {
  return text.split(/(https?:\/\/[^\s]+)/g).map((part, index) =>
    /^https?:\/\//.test(part) ? (
      <a
        key={`${part}-${index}`}
        href={part}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-primary underline underline-offset-2"
      >
        {part}
      </a>
    ) : (
      part
    )
  );
}

function timestamp(value: string): string {
  return new Date(value).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function StadtstackStagingPostDetail({
  conversation,
  post,
}: {
  conversation: StagingMeckyConversationResponse;
  post: StagingOrdinaryPost;
}) {
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link
        href="/app"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Zurück zum Feed
      </Link>

      <section className="overflow-hidden rounded-xl border border-emerald-300 bg-card shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 bg-emerald-950 px-4 py-3 text-emerald-50">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide">
            <ShieldCheck className="h-4 w-4" /> Signierter Nostr-Spiegel ·
            Staging
          </span>
          <span className="text-xs">Keine Produktionsdaten</span>
        </div>
        <div className="p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-sm font-bold text-emerald-900">
              {post.author.name.slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">
                  {post.author.name}
                </span>
                <span>
                  {post.synthetic
                    ? "Synthetisches Testprofil"
                    : "Verknüpftes Staging-Konto"}
                </span>
                <span>·</span>
                <span>{timestamp(post.createdAt)}</span>
              </div>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-foreground">
                {post.content}
              </p>
              <div className="mt-3 flex flex-wrap gap-3 border-t border-border pt-3 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <FileCheck2 className="h-4 w-4" /> Signaturgebundener
                  Quellbeitrag
                </span>
                <span>Keine CivicCase-, Abstimmungs- oder Treasury-Wirkung</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-900/60 dark:bg-amber-950/30">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Bot className="h-4 w-4 text-amber-700" /> Mecky · geprüfte
          öffentliche Quellen
        </h2>
        {conversation.replies.length > 0 ? (
          <div className="mt-3 space-y-4">
            {conversation.replies.map((reply) => (
              <article key={reply.id} data-mecky-conversation-reply>
                <p className="whitespace-pre-wrap break-words text-sm leading-6 text-foreground">
                  {linkify(reply.content)}
                </p>
                {reply.evidenceRefs.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {reply.evidenceRefs.map((evidence) => (
                      <a
                        key={evidence.digest}
                        href={evidence.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                      >
                        Geprüfter Nachweis <ExternalLink className="h-3 w-3" />
                      </a>
                    ))}
                  </div>
                )}
                <p className="mt-2 text-xs text-muted-foreground">
                  Signierte Antwort · {timestamp(reply.createdAt)}
                </p>
              </article>
            ))}
          </div>
        ) : conversation.pendingCount > 0 ? (
          <p className="mt-3 text-sm text-amber-950 dark:text-amber-100">
            Mecky prüft die verfügbaren öffentlichen Nachweise …
          </p>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            Für diese Erwähnung liegt noch keine signierte Antwort vor.
          </p>
        )}
      </section>
    </div>
  );
}
