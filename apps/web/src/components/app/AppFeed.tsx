"use client";

import { useState, useEffect, useCallback } from "react";
import { useActiveAccount } from "thirdweb/react";
import { getPublicFeedPosts } from "@/lib/public-feed-client";
import { PostComposer } from "@/components/app/PostComposer";
import { PostCard } from "@/components/app/PostCard";
import { FeedExperienceCard } from "@/components/app/FeedExperienceCard";
import type { PostWithEngagement } from "@/types/post";
import { Sparkles } from "lucide-react";

export function AppFeed() {
  const account = useActiveAccount();
  const [posts, setPosts] = useState<PostWithEngagement[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  const handlePostCreated = useCallback(() => {
    setRefreshKey((prev) => prev + 1);
  }, []);

  const handlePostDeleted = useCallback(() => {
    setRefreshKey((prev) => prev + 1);
  }, []);

  useEffect(() => {
    async function fetchAppFeed() {
      setLoading(true);
      const result = await getPublicFeedPosts({
        limit: 30,
        feedType: "app",
      });
      if (result.success && result.data) {
        setPosts(result.data);
      }
      setLoading(false);
    }
    fetchAppFeed();
  }, [refreshKey, account?.address]);

  return (
    <div className="space-y-4">
      <div className="bg-primary/5 border border-primary/20 rounded-lg p-4 flex items-start gap-3">
        <Sparkles className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-foreground">
            App-Diskussionen & Updates
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Diskutiere mit dem Team über die App, melde Bugs oder schlage Features vor.
          </p>
        </div>
      </div>

      <PostComposer
        onPostCreated={handlePostCreated}
        defaultFeedType="app"
      />

      {loading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-card rounded-lg border border-border animate-pulse h-32" />
          ))}
        </div>
      ) : posts.length === 0 ? (
        <div className="bg-card rounded-lg border border-border p-8 text-center">
          <Sparkles className="h-10 w-10 text-muted-foreground mx-auto mb-2" />
          <p className="text-muted-foreground text-sm">
            Noch keine App-Diskussionen. Sag uns, wie wir die App verbessern können!
          </p>
        </div>
      ) : (
        posts.map((p) =>
          p.post_type === "event_experience" ? (
            <FeedExperienceCard key={`exp-${p.id}`} post={p} />
          ) : (
            <PostCard key={`post-${p.id}`} {...p} onDeleted={handlePostDeleted} />
          )
        )
      )}
    </div>
  );
}
