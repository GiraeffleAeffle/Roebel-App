"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Bot, CheckCircle2, ChevronRight, GitFork, MessageCircleMore, ShieldCheck } from "lucide-react";
import {
  stagingGet,
  type StagingFeedPost,
  type StagingFeedResponse,
} from "@/lib/stadtstack/staging-api";

function shortTime(value: string): string {
  return new Date(value).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function StadtstackStagingFeed() {
  const [posts, setPosts] = useState<StagingFeedPost[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">("loading");

  useEffect(() => {
    let active = true;
    stagingGet<StagingFeedResponse>("/feed")
      .then((value) => {
        if (!active) return;
        setPosts(value.posts);
        setStatus("ready");
      })
      .catch(() => {
        if (active) setStatus("unavailable");
      });
    return () => { active = false; };
  }, []);

  if (status === "loading") {
    return <div aria-label="Synthetische Diskussionen werden geladen" className="h-40 animate-pulse rounded-xl border border-border bg-card" />;
  }
  if (status === "unavailable") {
    return (
      <section className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
        Die isolierte Testdiskussion ist gerade nicht erreichbar. Der normale Röbel-Feed bleibt unverändert.
      </section>
    );
  }

  return (
    <section aria-labelledby="stadtstack-staging-feed-title" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <h2 id="stadtstack-staging-feed-title" className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
          <GitFork className="h-4 w-4 text-primary" /> Themen &amp; Diskussionen
        </h2>
        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-900">
          <ShieldCheck className="h-3.5 w-3.5" /> Staging · signiertes Nostr · Testprofile
        </span>
      </div>

      {posts.map((post) => (
        <Link
          key={post.id}
          href={`/app/diskussion/${post.id}`}
          className="block rounded-xl border border-border bg-card p-4 shadow-sm transition hover:border-primary/40 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-sm font-bold text-emerald-900">
              {post.author.name.slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-base font-semibold text-foreground">{post.topicTitle ?? "Öffentliche Diskussion"}</h3>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs font-medium text-muted-foreground">
                <span>{post.discussionCount ?? 1} {(post.discussionCount ?? 1) === 1 ? "Diskussion" : "Diskussionen"} im Thema</span>
                <span>·</span>
                <span>{post.activityCount ?? post.replyCount + 1} signierte Aktivitäten</span>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">Leitfrage von {post.author.name}</span>
                <span>Synthetisches Profil</span>
                <span>·</span>
                <span>zuletzt aktiv {shortTime(post.lastActivityAt ?? post.createdAt)}</span>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground">{post.content}</p>
              <div className="mt-3 flex flex-wrap items-center gap-3 text-xs font-medium text-muted-foreground">
                <span className="inline-flex items-center gap-1"><MessageCircleMore className="h-4 w-4" /> {post.replyCount} Argumente</span>
                <span className="inline-flex items-center gap-1"><GitFork className="h-4 w-4" /> Pro/Contra-Baum</span>
                {post.meckyAnswered ? (
                  <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 className="h-4 w-4" /> Mecky hat signiert geantwortet</span>
                ) : post.meckyMentioned ? (
                  <span className="inline-flex items-center gap-1 text-amber-700"><Bot className="h-4 w-4" /> @Mecky erwähnt · Antwort ausstehend</span>
                ) : null}
                <span className="ml-auto inline-flex items-center gap-1 text-primary">Leitdiskussion öffnen <ChevronRight className="h-4 w-4" /></span>
              </div>
            </div>
          </div>
        </Link>
      ))}
    </section>
  );
}
