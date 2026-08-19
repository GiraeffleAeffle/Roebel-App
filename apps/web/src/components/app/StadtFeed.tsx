"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useActiveAccount } from "thirdweb/react";
import { createClient } from "@/lib/supabase/client";
import { getPublicFeedPosts } from "@/lib/public-feed-client";
import { fetchProposalsForFeed } from "@/app/actions/proposals-feed";
import { fetchRecentProposalComments } from "@/app/actions/proposal-comments";
import { PostComposer } from "@/components/app/PostComposer";
import { PostCard } from "@/components/app/PostCard";
import { FeedExperienceCard } from "@/components/app/FeedExperienceCard";
import { AlertCard } from "@/components/app/AlertCard";
import { FeedProposalCard } from "@/components/app/FeedProposalCard";
import { FeedProposalCommentCard } from "@/components/app/FeedProposalCommentCard";
import type { ServiceAlert } from "@/app/actions/alerts";
import type {
  PostWithEngagement,
  ProposalFeedItem,
  ProposalCommentFeedItem,
} from "@/types/post";
import { useAppMode } from "@/lib/context/AppModeContext";
import { useUserProfile } from "@/hooks/useUserProfile";
import { Landmark, ShieldCheck } from "lucide-react";
import { hasSupabase, recordClient } from "@/lib/record";
import { listNotices, RecordUnavailableError, type NoticeRow } from "@netizen-labs/record-client";

type StadtFeedItem =
  | { kind: "post"; data: PostWithEngagement; created_at: string }
  | { kind: "proposal"; data: ProposalFeedItem; created_at: string }
  | { kind: "proposal_comment"; data: ProposalCommentFeedItem; created_at: string };

/**
 * noticeToSpec (packages/publisher/src/mappers.ts) never publishes an
 * alert_type/location, and there is no separate starts_at tag — only
 * title/message/severity/status. alert_type falls back to the same
 * "general" AlertCard itself falls back to for any unrecognised value, so
 * this is an explicit, honest choice rather than a guess. starts_at reuses
 * the notice event's own created_at (added to NoticeRow for this) — "since
 * when this notice has been visible on the record" is the closest honest
 * reading available.
 */
function noticeToAlert(n: NoticeRow): ServiceAlert {
  return {
    id: n.id,
    title: n.title,
    description: n.message || null,
    alert_type: "general",
    severity: (n.severity ?? "warning") as ServiceAlert["severity"],
    status: "active",
    location: null,
    starts_at: n.created_at,
    ends_at: null,
    created_at: n.created_at,
    updated_at: n.created_at,
    created_by: "",
  };
}

export function StadtFeed() {
  const account = useActiveAccount();
  const { activeMode } = useAppMode();
  const { user } = useUserProfile();
  const [posts, setPosts] = useState<PostWithEngagement[]>([]);
  const [proposals, setProposals] = useState<ProposalFeedItem[]>([]);
  const [proposalComments, setProposalComments] = useState<ProposalCommentFeedItem[]>([]);
  const [alerts, setAlerts] = useState<ServiceAlert[]>([]);
  const [announcements, setAnnouncements] = useState<{ id: string; title: string; content: string; created_at: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  const isCitizen = user?.tier === "citizen" || user?.is_verified_citizen;
  const canPost = isCitizen || activeMode === "org";

  const handlePostCreated = useCallback(() => {
    setRefreshKey((prev) => prev + 1);
  }, []);

  const handlePostDeleted = useCallback(() => {
    setRefreshKey((prev) => prev + 1);
  }, []);

  useEffect(() => {
    async function fetchStadt() {
      setLoading(true);

      // The public GET reader already selects the configured read model, so
      // it is called the same way in both modes.
      const postsResult = await getPublicFeedPosts({
        limit: 30,
        feedType: "rathaus",
      });
      if (postsResult.success && postsResult.data) {
        setPosts(postsResult.data);
      }

      if (!hasSupabase) {
        // Proposal feed items and proposal comments both need vote tallies
        // and a proposer wallet address that no record dataset carries
        // (ProposalMetaRow has no for_votes/against_votes/proposer_address —
        // see civic.ts) — same "hide rather than fabricate" call the home
        // page already makes for its featured-proposal hero. Alerts and
        // announcements come from listNotices(), split by its `kind` field.
        setProposals([]);
        setProposalComments([]);
        try {
          const notices = await listNotices(recordClient);
          setAlerts(
            notices
              .filter((n) => n.kind === "service_alert" && n.status === "active")
              .slice(0, 3)
              .map(noticeToAlert)
          );
          setAnnouncements(
            notices
              .filter((n) => n.kind === "announcement" && n.status === "active")
              .slice(0, 5)
              .map((n) => ({ id: n.id, title: n.title, content: n.message, created_at: n.created_at }))
          );
        } catch (error) {
          if (!(error instanceof RecordUnavailableError)) throw error;
          setAlerts([]);
          setAnnouncements([]);
        }
        setLoading(false);
        return;
      }

      const supabase = createClient();

      const [alertsRes, proposalsList, commentsList, announcementsRes] = await Promise.all([
        supabase
          .from("service_alerts")
          .select("*")
          .eq("status", "active")
          .order("severity", { ascending: true })
          .limit(3),
        fetchProposalsForFeed(20),
        fetchRecentProposalComments(30),
        supabase
          .from("announcements")
          .select("id, title, content, created_at")
          .eq("is_active", true)
          .order("created_at", { ascending: false })
          .limit(5),
      ]);

      setAlerts((alertsRes.data || []) as ServiceAlert[]);
      setProposals(proposalsList);
      setProposalComments(commentsList);
      setAnnouncements(announcementsRes.data || []);
      setLoading(false);
    }
    fetchStadt();
  }, [refreshKey, account?.address]);

  const merged: StadtFeedItem[] = [
    ...posts.map((p) => ({ kind: "post" as const, data: p, created_at: p.created_at })),
    ...proposals.map((p) => ({ kind: "proposal" as const, data: p, created_at: p.created_at })),
    ...proposalComments.map((c) => ({
      kind: "proposal_comment" as const,
      data: c,
      created_at: c.created_at,
    })),
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  if (loading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="bg-card rounded-lg border border-border animate-pulse h-32" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Tourist/guest CTA */}
      {!isCitizen && (
        <div className="bg-primary/5 border border-primary/20 rounded-lg p-4 flex items-start gap-3">
          <ShieldCheck className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-foreground">
              Werde Bürger, um in der Stadt teilzunehmen
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Verifizierte Bürger und Organisationen können in der Stadt posten und abstimmen.
            </p>
            <Link
              href="/app/verifizierung"
              className="text-xs text-primary font-medium mt-2 inline-block hover:underline"
            >
              Jetzt verifizieren
            </Link>
          </div>
        </div>
      )}

      {/* Post composer — citizens and orgs only */}
      {canPost && (
        <PostComposer
          onPostCreated={handlePostCreated}
          defaultFeedType="rathaus"
        />
      )}

      {/* Active alerts — pinned */}
      {alerts.map((alert) => (
        <AlertCard key={`alert-${alert.id}`} {...alert} />
      ))}

      {/* Announcements — pinned summary */}
      {announcements.length > 0 && (
        <div className="bg-card rounded-lg border border-border p-4">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-3">
            <Landmark className="h-4 w-4 text-primary" />
            Bekanntmachungen
          </h3>
          <div className="space-y-3">
            {announcements.map((a) => (
              <div key={a.id} className="border-l-2 border-primary/30 pl-3">
                <p className="text-sm font-medium text-foreground">{a.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{a.content}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {new Date(a.created_at).toLocaleDateString("de-DE", { day: "numeric", month: "short" })}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Merged feed: posts + proposals + proposal_comments by created_at desc */}
      {merged.length === 0 ? (
        <div className="bg-card rounded-lg border border-border p-8 text-center">
          <Landmark className="h-10 w-10 text-muted-foreground mx-auto mb-2" />
          <p className="text-muted-foreground text-sm">
            Noch keine Beiträge in der Stadt. {canPost ? "Sei der Erste!" : ""}
          </p>
        </div>
      ) : (
        merged.map((item) => {
          if (item.kind === "post") {
            if (item.data.post_type === "event_experience") {
              return <FeedExperienceCard key={`exp-${item.data.id}`} post={item.data} />;
            }
            return (
              <PostCard
                key={`post-${item.data.id}`}
                {...item.data}
                onDeleted={handlePostDeleted}
              />
            );
          }
          if (item.kind === "proposal") {
            return <FeedProposalCard key={`proposal-${item.data.id}`} proposal={item.data} />;
          }
          return (
            <FeedProposalCommentCard
              key={`pcomment-${item.data.id}`}
              comment={item.data}
            />
          );
        })
      )}
    </div>
  );
}
