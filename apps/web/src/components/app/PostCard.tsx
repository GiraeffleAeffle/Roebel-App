"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActiveAccount } from "thirdweb/react";
import { useVerificationStatus } from "@/hooks/useVerificationStatus";
import { MessageCircle, Share2, Trash2, MapPin, Crown } from "lucide-react";
import { PostMediaGrid } from "@/components/app/PostMediaGrid";
import { VideoPlayer } from "@/components/app/VideoPlayer";
import { MediaLightbox } from "@/components/app/MediaLightbox";
import { LinkPreview } from "@/components/app/LinkPreview";
import { LikeButton } from "@/components/app/LikeButton";
import { ReportButton } from "@/components/app/ReportButton";
import { CategoryBadge } from "@/components/app/CategoryBadge";
import { PollDisplay } from "@/components/app/PollDisplay";
import { CommentSection } from "@/components/app/CommentSection";
import { StadtstackPostPromotion } from "@/components/app/StadtstackPostPromotion";
import { deletePost } from "@/app/actions/posts";
import type { PostWithEngagement } from "@/types/post";
import { toast } from "sonner";

interface PostCardProps extends PostWithEngagement {
  onDeleted?: () => void;
  mode?: "feed" | "detail";
}

function formatRelativeTime(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHrs = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return "gerade eben";
  if (diffMin < 60) return `vor ${diffMin} Min.`;
  if (diffHrs < 24) return `vor ${diffHrs} Std.`;
  if (diffDays < 7) return `vor ${diffDays} T.`;
  return date.toLocaleDateString("de-DE", { day: "numeric", month: "short" });
}

// Linkify URLs in text
function linkifyText(text: string) {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const parts = text.split(urlRegex);

  return parts.map((part, i) => {
    if (part.match(urlRegex)) {
      return (
        <a
          key={i}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline break-all"
        >
          {part}
        </a>
      );
    }
    return part;
  });
}

export function PostCard({
  id,
  wallet_address,
  content,
  media_urls,
  video_url,
  category,
  likes_count,
  comments_count,
  created_at,
  author_username,
  author_profile_picture_url,
  author_neighborhood,
  author_account_name,
  author_account_avatar_url,
  author_account_type,
  links,
  is_liked_by_viewer,
  is_reported_by_viewer,
  poll,
  onDeleted,
  mode = "feed",
}: PostCardProps) {
  const router = useRouter();
  const account = useActiveAccount();
  const { isVerified } = useVerificationStatus();
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [lightboxMode, setLightboxMode] = useState<"image" | "video">("image");
  const [isDeleting, setIsDeleting] = useState(false);
  const [showComments, setShowComments] = useState(false);

  const isMecky = wallet_address === "mecky_bot";
  const isAuthor = account?.address?.toLowerCase() === wallet_address.toLowerCase();
  const shortAddress = `${wallet_address.slice(0, 4)}...${wallet_address.slice(-3)}`;
  const isOrgPost = author_account_type && author_account_type !== "personal" && author_account_name;
  const displayName = isOrgPost ? author_account_name! : (author_username || shortAddress);
  const displayAvatar = isOrgPost && author_account_avatar_url ? author_account_avatar_url : author_profile_picture_url;
  // Record mode has no wallet-keyed profile route (wallet_address is "" for a
  // personal author, or the "mecky_bot" bot-badge sentinel) — `/app/profile/`
  // would be a dead link, so the author name/avatar render as plain, static
  // elements instead of a Link whenever there is no real address to route to.
  const hasProfileLink = !!wallet_address && wallet_address !== "mecky_bot";

  const handleCardClick = (e: React.MouseEvent) => {
    if (mode === "detail") return;
    const target = e.target as HTMLElement;
    if (target.closest('button, a, input, video, [role="button"], [data-radix-collection-item]')) return;
    router.push(`/app/posts/${id}`);
  };

  const handleImageClick = (index: number) => {
    setLightboxIndex(index);
    setLightboxMode("image");
    setLightboxOpen(true);
  };

  const handleVideoFullscreen = () => {
    setLightboxMode("video");
    setLightboxOpen(true);
  };

  const handleShare = async () => {
    const url = `${window.location.origin}/app/posts/${id}`;
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Beitrag von ${displayName}`,
          text: content.slice(0, 100),
          url,
        });
      } catch {
        // User cancelled or share failed
      }
    } else {
      await navigator.clipboard.writeText(url);
      toast.success("Link kopiert!");
    }
  };

  const handleDelete = async () => {
    if (!isAuthor || isDeleting) return;
    setIsDeleting(true);
    const result = await deletePost(id, wallet_address);
    if (result.success) {
      toast.success("Beitrag gelöscht");
      onDeleted?.();
    } else {
      toast.error(result.error || "Fehler beim Löschen");
      setIsDeleting(false);
    }
  };

  return (
    <>
      <div
        className={`bg-card rounded-lg border border-border overflow-hidden ${
          mode === "feed" ? "cursor-pointer" : ""
        }`}
        onClick={handleCardClick}
      >
        {/* Header */}
        <div className="flex items-center gap-3 p-4 pb-2">
          {hasProfileLink ? (
            <Link
              href={`/app/profile/${wallet_address}`}
              className="h-10 w-10 rounded-full bg-muted flex items-center justify-center flex-shrink-0 overflow-hidden"
            >
              {displayAvatar ? (
                <Image
                  src={displayAvatar}
                  alt={displayName}
                  width={40}
                  height={40}
                  className="object-cover w-full h-full"
                />
              ) : (
                <span className="text-sm font-medium text-muted-foreground">
                  {displayName.slice(0, 2).toUpperCase()}
                </span>
              )}
            </Link>
          ) : (
            <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center flex-shrink-0 overflow-hidden">
              {displayAvatar ? (
                <Image
                  src={displayAvatar}
                  alt={displayName}
                  width={40}
                  height={40}
                  className="object-cover w-full h-full"
                />
              ) : (
                <span className="text-sm font-medium text-muted-foreground">
                  {displayName.slice(0, 2).toUpperCase()}
                </span>
              )}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              {hasProfileLink ? (
                <Link
                  href={`/app/profile/${wallet_address}`}
                  className="text-sm font-medium text-foreground hover:underline"
                >
                  {displayName}
                </Link>
              ) : (
                <span className="text-sm font-medium text-foreground">{displayName}</span>
              )}
              {isOrgPost && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 text-[10px] font-medium">
                  {author_account_type === "unternehmen" ? "Gewerbe" :
                   author_account_type === "verein" ? "Verein" :
                   author_account_type === "stadt" ? "Stadt" :
                   author_account_type === "fraktion" ? "Fraktion" : ""}
                </span>
              )}
              {isMecky && (
                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-[10px] font-medium">
                  <Crown className="h-2.5 w-2.5" />
                  Bot
                </span>
              )}
            </div>
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <span>{formatRelativeTime(created_at)}</span>
              {author_neighborhood && (
                <>
                  <span>&middot;</span>
                  <MapPin className="h-3 w-3" />
                  <span>{author_neighborhood}</span>
                </>
              )}
            </div>
          </div>
          {isAuthor && (
            <button
              onClick={handleDelete}
              disabled={isDeleting}
              className="p-1.5 text-muted-foreground hover:text-destructive rounded-md hover:bg-destructive/10 transition-colors"
              aria-label="Beitrag löschen"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Category badge */}
        {category && category !== "generell" && (
          <div className="px-4 pb-1">
            <CategoryBadge category={category} />
          </div>
        )}

        {/* Text content */}
        <div className="px-4 pb-3">
          <p className="text-sm text-foreground whitespace-pre-wrap break-words">
            {linkifyText(content)}
          </p>
        </div>

        {/* Media grid */}
        {media_urls.length > 0 && (
          <PostMediaGrid
            mediaUrls={media_urls}
            onImageClick={handleImageClick}
          />
        )}

        {/* Video */}
        {video_url && (
          <VideoPlayer url={video_url} onFullscreen={handleVideoFullscreen} />
        )}

        {/* Link previews */}
        {links.length > 0 && (
          <div className="mt-2">
            {links.map((link) => (
              <LinkPreview key={link.id} link={link} />
            ))}
          </div>
        )}

        {/* Poll */}
        {poll && (
          <PollDisplay
            poll={poll}
            walletAddress={account?.address}
            isVerified={isVerified}
          />
        )}

        {/* Action bar */}
        <div className="flex items-center gap-1 px-4 py-2 border-t border-border">
          <LikeButton
            postId={id}
            isLiked={is_liked_by_viewer}
            likesCount={likes_count}
            walletAddress={account?.address}
          />
          <button
            onClick={() => setShowComments(!showComments)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-muted-foreground hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950 rounded-md text-sm transition-colors"
          >
            <MessageCircle className="h-4 w-4" />
            {comments_count > 0 && <span>{comments_count}</span>}
          </button>
          <button
            onClick={handleShare}
            className="flex items-center gap-1.5 px-3 py-1.5 text-muted-foreground hover:text-green-500 hover:bg-green-50 dark:hover:bg-green-950 rounded-md text-sm transition-colors"
          >
            <Share2 className="h-4 w-4" />
          </button>
          {!isAuthor && (
            <ReportButton
              postId={id}
              isReported={is_reported_by_viewer}
              walletAddress={account?.address}
            />
          )}
        </div>

        {mode === "detail" && isAuthor && (
          <StadtstackPostPromotion
            post={{
              id,
              walletAddress: wallet_address,
              content,
              createdAt: created_at,
            }}
          />
        )}

        {/* Comments section */}
        {(showComments || comments_count > 0) && (
          <CommentSection
            postId={id}
            commentsCount={comments_count}
            defaultExpanded={mode === "detail"}
          />
        )}
      </div>

      {/* Lightbox */}
      <MediaLightbox
        open={lightboxOpen}
        onOpenChange={setLightboxOpen}
        mediaUrls={media_urls}
        videoUrl={video_url}
        initialIndex={lightboxIndex}
        mode={lightboxMode}
      />
    </>
  );
}
