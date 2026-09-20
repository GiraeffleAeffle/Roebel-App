"use client";

import { use, useState, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, RotateCw } from "lucide-react";
import { PostCard } from "@/components/app/PostCard";
import { getPublicFeedPost } from "@/lib/public-feed-client";
import { loadPublicCivicDiscussion } from "@/lib/stadtstack/civic-projection-client";
import { readDiscussionFollowUp, type DiscussionFollowUp } from "@/lib/stadtstack/discussion-follow-up";
import type { PostWithEngagement } from "@/types/post";

export default function PostDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ discussion?: string | string[] }>;
}) {
  const { id } = use(params);
  const { discussion } = use(searchParams);
  const requestedDiscussion = typeof discussion === "string" ? discussion : discussion ? "invalid" : "";
  const [post, setPost] = useState<PostWithEngagement | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [followUp, setFollowUp] = useState<DiscussionFollowUp | null>(null);
  const [followUpError, setFollowUpError] = useState(false);
  const [followUpLoading, setFollowUpLoading] = useState(Boolean(requestedDiscussion));

  useEffect(() => {
    let active = true;
    setFollowUp(null);
    setFollowUpError(false);
    setFollowUpLoading(Boolean(requestedDiscussion));
    if (requestedDiscussion) {
      if (!/^[0-9a-f]{64}$/u.test(requestedDiscussion)) { setFollowUpError(true); setFollowUpLoading(false); }
      else void loadPublicCivicDiscussion(requestedDiscussion).then(thread => {
        const context = readDiscussionFollowUp(thread, requestedDiscussion, id);
        if (active) setFollowUp(context);
      }).catch(() => { if (active) setFollowUpError(true); })
        .finally(() => { if (active) setFollowUpLoading(false); });
    }
    return () => { active = false; };
  }, [id, requestedDiscussion, retry]);

  useEffect(() => {
    let active = true;
    async function load() {
      setIsLoading(true);
      setError(null);
      setPost(null);

      try {
        let primaryError = "Beitrag konnte nicht geladen werden";

        try {
          const result = await getPublicFeedPost(id);
          if (result.success && result.data) {
            if (active) setPost(result.data);
            return;
          }
          primaryError = result.error || "Beitrag nicht gefunden";
        } catch {
          primaryError = "Beitrag konnte nicht geladen werden";
        }

        if (active) setError(primaryError);
      } finally {
        if (active) setIsLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [id, retry]);

  if (isLoading || followUpLoading) {
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <div className="h-4 bg-muted rounded w-16 animate-pulse" />
        <div className="bg-card rounded-lg border border-border p-4 space-y-3 animate-pulse">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-muted" />
            <div className="space-y-1.5">
              <div className="h-3 bg-muted rounded w-24" />
              <div className="h-2.5 bg-muted rounded w-16" />
            </div>
          </div>
          <div className="space-y-2">
            <div className="h-3 bg-muted rounded w-full" />
            <div className="h-3 bg-muted rounded w-3/4" />
          </div>
          <div className="h-48 bg-muted rounded-lg" />
        </div>
      </div>
    );
  }

  if (error || !post) {
    return (
      <div className="max-w-2xl mx-auto text-center py-12">
        <p className="text-muted-foreground font-medium">
          {error || "Beitrag nicht gefunden"}
        </p>
        <Link
          href="/app"
          className="inline-flex items-center gap-1 mt-4 text-sm text-primary hover:text-primary/80"
        >
          <ArrowLeft className="h-4 w-4" />
          Zurück
        </Link>
        <button
          type="button"
          onClick={() => setRetry((value) => value + 1)}
          className="mx-auto mt-3 flex items-center gap-1 text-sm font-medium text-primary hover:text-primary/80"
        >
          <RotateCw className="h-4 w-4" /> Erneut laden
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <Link
        href="/app"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Zurück
      </Link>

      {followUpError && <p role="status" className="rounded-xl border border-border p-4 text-sm">Der Diskussionsbezug konnte nicht bestätigt werden. Öffne die Rückfrage erneut über die Diskussion oder lade diesen Beitrag noch einmal.</p>}
      <PostCard key={`${id}:${requestedDiscussion}`} {...post} mode="detail" discussionFollowUp={followUp?.discussionId === requestedDiscussion && followUp.sourcePostId === id ? followUp : undefined} />
    </div>
  );
}
