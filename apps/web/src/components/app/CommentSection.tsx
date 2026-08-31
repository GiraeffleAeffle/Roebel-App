"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Image from "next/image";
import { useActiveAccount } from "thirdweb/react";
import { useVerificationStatus } from "@/hooks/useVerificationStatus";
import { createComment } from "@/app/actions/posts";
import { getPublicFeedComments } from "@/lib/public-feed-client";
import { createClient } from "@/lib/supabase/client";
import { uploadResumable } from "@/lib/storage/resumable-upload";
import { PostMediaGrid } from "@/components/app/PostMediaGrid";
import { VideoPlayer } from "@/components/app/VideoPlayer";
import { ConnectCta } from "@/components/unternehmen/ConnectCta";
import { useAccount } from "@/lib/context/AccountContext";
import { isOrgAccount, ACCOUNT_TYPE_LABELS } from "@/types/account";
import type { PostComment } from "@/types/post";
import type { FeedType } from "@/types/post";
import { Bot, ExternalLink, Send, ImagePlus, Video, X } from "lucide-react";
import { toast } from "sonner";
import { useCitizenSession } from "@/lib/citizen-session/CitizenSessionContext";
import {
  containsExplicitMeckyMention,
  requestAppMeckyConversationAnswer,
} from "@/lib/stadtstack/app-mecky-conversation";
import { appMeckyConversationGateway } from "@/lib/stadtstack/app-mecky-gateway";
import type {
  StagingMeckyConversationReply,
  StagingMeckyConversationResponse,
} from "@/lib/stadtstack/staging-api";
import { loadPublicMeckyConversation } from "@/lib/stadtstack/civic-projection-client";
import { resolveStadtstackStagingLab } from "@/lib/stadtstack/staging-lab";
import { useStagingTestParticipant } from "@/hooks/useStagingTestParticipant";
import { StagingParticipantEnrollment } from "@/components/app/StagingParticipantEnrollment";

const MAX_COMMENT_IMAGES = 3;
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_VIDEO_SIZE = 5 * 1024 * 1024 * 1024; // 5 GB (matches bucket cap)

interface CommentSectionProps {
  postId: string;
  commentsCount: number;
  postFeedType: FeedType;
  defaultExpanded?: boolean;
  postSource: {
    id: string;
    walletAddress: string;
    content: string;
    createdAt: string;
  };
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

function CommentItem({ comment }: { comment: PostComment }) {
  if (comment.agent?.kind === "public_mecky") {
    return <PublicMeckyCommentItem comment={comment} />;
  }
  const shortAddress = `${comment.wallet_address.slice(0, 4)}...${comment.wallet_address.slice(-3)}`;

  return (
    <div className="flex gap-2.5 py-2">
      <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center flex-shrink-0 overflow-hidden">
        {comment.author_profile_picture_url ? (
          <Image
            src={comment.author_profile_picture_url}
            alt=""
            width={28}
            height={28}
            className="object-cover w-full h-full"
          />
        ) : (
          <span className="text-xs font-medium text-muted-foreground">
            {(comment.author_username || shortAddress)
              .slice(0, 2)
              .toUpperCase()}
          </span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="bg-muted rounded-lg px-3 py-2">
          <span className="text-xs font-medium text-foreground">
            {comment.author_username || shortAddress}
          </span>
          <p className="text-sm text-foreground mt-0.5">{comment.content}</p>
        </div>

        {/* Comment media */}
        {comment.media_urls && comment.media_urls.length > 0 && (
          <div className="mt-1.5 rounded-lg overflow-hidden max-w-sm">
            <PostMediaGrid
              mediaUrls={comment.media_urls}
              onImageClick={() => {}}
            />
          </div>
        )}
        {comment.video_url && (
          <div className="mt-1.5 rounded-lg overflow-hidden max-w-sm max-h-48">
            <VideoPlayer url={comment.video_url} />
          </div>
        )}

        <span className="text-xs text-muted-foreground ml-3">
          {formatRelativeTime(comment.created_at)}
        </span>
      </div>
    </div>
  );
}

function linkifyMeckyText(text: string) {
  return text.split(/(https?:\/\/[^\s]+)/g).map((part, index) =>
    /^https?:\/\//.test(part) ? (
      <a
        key={`${part}-${index}`}
        href={part}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary underline decoration-primary/40 underline-offset-2"
      >
        {part}
      </a>
    ) : (
      part
    )
  );
}

function MeckyAuthorityNotice() {
  return (
    <p
      data-mecky-authority-binding="none"
      className="mt-2 text-[10px] leading-4 text-amber-800 dark:text-amber-200"
    >
      Beratende KI-Antwort · keine Verwaltungs- oder Entscheidungsbefugnis
    </p>
  );
}

function PublicMeckyCommentItem({ comment }: { comment: PostComment }) {
  const agent = comment.agent!;
  const hasEvidence = agent.evidenceRefs.length > 0;
  return (
    <div className="flex gap-2.5 py-2" data-public-mecky-reply={comment.id}>
      <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
        <Bot className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-900/50 dark:bg-amber-950/30">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-semibold text-foreground">Mecky</span>
            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/50 dark:text-amber-200">
              {hasEvidence
                ? "KI · geprüfte Quellen"
                : "KI · öffentliche Antwort"}
            </span>
          </div>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm text-foreground">
            {linkifyMeckyText(comment.content)}
          </p>
          {hasEvidence && (
            <div className="mt-2 flex flex-wrap gap-2">
              {agent.evidenceRefs.map((evidence, index) => (
                <a
                  key={evidence.digest}
                  href={evidence.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  Nachweis {index + 1} <ExternalLink className="h-3 w-3" />
                </a>
              ))}
            </div>
          )}
          <MeckyAuthorityNotice />
        </div>
        <span className="ml-3 text-xs text-muted-foreground">
          {formatRelativeTime(comment.created_at)}
        </span>
      </div>
    </div>
  );
}

function MeckyCommentItem({ reply }: { reply: StagingMeckyConversationReply }) {
  return (
    <div className="flex gap-2.5 py-2" data-mecky-conversation-reply>
      <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
        <Bot className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-900/50 dark:bg-amber-950/30">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-foreground">Mecky</span>
            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/50 dark:text-amber-200">
              KI · geprüfte Quellen
            </span>
          </div>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm text-foreground">
            {linkifyMeckyText(reply.content)}
          </p>
          {reply.evidenceRefs.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {reply.evidenceRefs.map((evidence, index) => (
                <a
                  key={evidence.digest}
                  href={evidence.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  Geprüfter Nachweis {index + 1}{" "}
                  <ExternalLink className="h-3 w-3" />
                </a>
              ))}
            </div>
          )}
          <MeckyAuthorityNotice />
        </div>
        <span className="ml-3 text-xs text-muted-foreground">
          {formatRelativeTime(reply.createdAt)}
        </span>
      </div>
    </div>
  );
}

// Upload a file directly to Supabase Storage. Images use the simple
// non-resumable path; videos use TUS resumable to handle large files
// (multi-minute clips that exceed the per-request limit).
async function uploadToStorage(
  file: File,
  type: "image" | "video",
  onVideoProgress?: (pct: number) => void
): Promise<string | null> {
  const maxSize = type === "video" ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE;
  if (file.size > maxSize) {
    toast.error(
      type === "video"
        ? "Video darf maximal 5 GB groß sein"
        : "Bild darf maximal 5MB groß sein"
    );
    return null;
  }

  const fileExt =
    file.name.split(".").pop() || (type === "video" ? "mp4" : "jpg");
  const prefix = type === "video" ? "comment-videos" : "comment-images";
  const fileName = `${prefix}/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;

  if (type === "video") {
    try {
      onVideoProgress?.(0);
      const url = await uploadResumable({
        file,
        bucket: "images",
        path: fileName,
        contentType: file.type || "video/mp4",
        onProgress: (pct) => onVideoProgress?.(pct),
      });
      return url;
    } catch (err) {
      console.error("Resumable upload error:", err);
      toast.error("Video-Upload fehlgeschlagen. Bitte versuche es erneut.");
      return null;
    }
  }

  const supabase = createClient();
  const { error: uploadError } = await supabase.storage
    .from("images")
    .upload(fileName, file, { cacheControl: "3600", upsert: false });

  if (uploadError) {
    console.error("Upload error:", uploadError);
    toast.error("Upload fehlgeschlagen. Bitte versuche es erneut.");
    return null;
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from("images").getPublicUrl(fileName);
  return publicUrl;
}

export function CommentSection({
  postId,
  commentsCount,
  postFeedType,
  defaultExpanded = false,
  postSource,
}: CommentSectionProps) {
  const account = useActiveAccount();
  const citizenSession = useCitizenSession();
  const { isVerified } = useVerificationStatus();
  const { activeAccount } = useAccount();
  const isCommentingAsOrg = activeAccount ? isOrgAccount(activeAccount) : false;
  const stagingEnabled = Boolean(
    resolveStadtstackStagingLab(
      process.env.NEXT_PUBLIC_STADTSTACK_STAGING_LAB
    )
  );
  const stagingParticipant = useStagingTestParticipant(account);
  const isStagingParticipant =
    postFeedType === "main" &&
    stagingEnabled &&
    stagingParticipant.isAvailable &&
    stagingParticipant.isActive &&
    !isCommentingAsOrg;
  const canComment = Boolean(account) &&
    !(stagingEnabled && stagingParticipant.isLoading) &&
    (stagingEnabled
      ? isStagingParticipant
      : isVerified || isCommentingAsOrg);
  const [comments, setComments] = useState<PostComment[]>([]);
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [isLoading, setIsLoading] = useState(false);
  const [newComment, setNewComment] = useState("");
  const [totalCount, setTotalCount] = useState(commentsCount);
  const [meckyConversation, setMeckyConversation] =
    useState<StagingMeckyConversationResponse | null>(null);
  const [waitingForMentionId, setWaitingForMentionId] = useState<string | null>(
    null
  );
  const [conversationPollVersion, setConversationPollVersion] = useState(0);
  const [meckyPollingPaused, setMeckyPollingPaused] = useState(false);

  // Media state
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoPreview, setVideoPreview] = useState<string | null>(null);
  const [videoUploadProgress, setVideoUploadProgress] = useState<number | null>(
    null
  );
  const [isUploading, setIsUploading] = useState(false);

  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const submitLockRef = useRef(false);

  const hasMedia = !isStagingParticipant && (imageFiles.length > 0 || videoFile !== null);
  const projectedReplyIds = new Set(
    comments
      .filter((comment) => comment.agent?.kind === "public_mecky")
      .map((comment) => comment.id)
  );
  const transitionalReplies =
    meckyConversation?.replies.filter(
      (reply) => !projectedReplyIds.has(reply.id)
    ) ?? [];
  const visibleCommentCount = totalCount + transitionalReplies.length;
  const pendingMeckyRequests =
    meckyConversation?.requests?.filter(
      (request) => request.state === "pending"
    ) ?? [];

  const refreshMeckyConversation = useCallback(async () => {
    if (!stagingEnabled) return null;
    const response = await loadPublicMeckyConversation(postId);
    setMeckyConversation(response);
    return response;
  }, [postId, stagingEnabled]);

  const loadComments = async () => {
    if (isLoading) return;
    setIsLoading(true);
    const [result] = await Promise.all([
      getPublicFeedComments(postId, 50, 0),
      refreshMeckyConversation().catch(() => null),
    ]);
    if (result.success && result.data) {
      setComments(result.data);
    }
    setIsLoading(false);
    setIsExpanded(true);
  };

  // Auto-load on default expanded
  useEffect(() => {
    if (defaultExpanded && comments.length === 0) {
      loadComments();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultExpanded]);

  useEffect(() => {
    if (!stagingEnabled || !isExpanded) return;
    setMeckyPollingPaused(false);
    const expectsTopLevelMention = containsExplicitMeckyMention(
      postSource.content
    );
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    const poll = async () => {
      attempts += 1;
      let result: StagingMeckyConversationResponse | null = null;
      try {
        result = await refreshMeckyConversation();
      } catch {
        // A transient projection failure must not affect the ordinary thread.
      }
      if (cancelled) return;
      const trackedRequest = waitingForMentionId
        ? result?.requests?.find(
            (request) => request.mentionId === waitingForMentionId
          )
        : undefined;
      const expectedRequestVisible = waitingForMentionId
        ? trackedRequest !== undefined ||
          result?.mentionIds.includes(waitingForMentionId) === true
        : !expectsTopLevelMention || (result?.requestCount ?? 0) > 0;
      const settled = waitingForMentionId
        ? trackedRequest?.state === "answered"
        : expectedRequestVisible && (result?.pendingCount ?? 0) === 0;
      if (!settled && attempts < 40) {
        timer = setTimeout(poll, 3_000);
      } else if (!settled) {
        setMeckyPollingPaused(true);
      }
      if (settled && waitingForMentionId) setWaitingForMentionId(null);
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [
    conversationPollVersion,
    isExpanded,
    postSource.content,
    refreshMeckyConversation,
    stagingEnabled,
    waitingForMentionId,
  ]);

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const remaining = MAX_COMMENT_IMAGES - imageFiles.length;
    const newFiles = files.slice(0, remaining);

    if (files.length > remaining) {
      toast.error(`Maximal ${MAX_COMMENT_IMAGES} Bilder erlaubt`);
    }

    setImageFiles((prev) => [...prev, ...newFiles]);

    for (const file of newFiles) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        setImagePreviews((prev) => [...prev, ev.target?.result as string]);
      };
      reader.readAsDataURL(file);
    }

    e.target.value = "";
  };

  const handleVideoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 50 * 1024 * 1024) {
      toast.error("Video darf maximal 50MB groß sein");
      return;
    }

    setVideoFile(file);
    setVideoPreview(URL.createObjectURL(file));
    e.target.value = "";
  };

  const removeImage = (index: number) => {
    setImageFiles((prev) => prev.filter((_, i) => i !== index));
    setImagePreviews((prev) => prev.filter((_, i) => i !== index));
  };

  const removeVideo = () => {
    if (videoPreview) URL.revokeObjectURL(videoPreview);
    setVideoFile(null);
    setVideoPreview(null);
  };

  const resetMedia = () => {
    setImageFiles([]);
    setImagePreviews([]);
    removeVideo();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (
      !account?.address ||
      (!newComment.trim() && !hasMedia) ||
      submitLockRef.current ||
      isUploading
    )
      return;

    const content = newComment.trim() || " ";
    submitLockRef.current = true;
    setNewComment("");
    setIsUploading(true);

    try {
      // Upload media
      const uploadedImageUrls: string[] = [];
      if (!isStagingParticipant) {
        for (const file of imageFiles) {
          const url = await uploadToStorage(file, "image");
          if (url) uploadedImageUrls.push(url);
        }
      }

      let uploadedVideoUrl: string | null = null;
      if (!isStagingParticipant && videoFile) {
        try {
          uploadedVideoUrl = await uploadToStorage(videoFile, "video", (pct) =>
            setVideoUploadProgress(pct)
          );
        } finally {
          setVideoUploadProgress(null);
        }
        // Abort comment submit if video upload failed (toast already shown).
        if (!uploadedVideoUrl) {
          return;
        }
      }

      // Optimistic comment — reflect the active account's identity when
      // commenting as an org, so the optimistic render matches what the
      // server will persist.
      const optimisticComment: PostComment = {
        id: `temp-${Date.now()}`,
        post_id: postId,
        wallet_address: account.address,
        account_id: isStagingParticipant ? null : activeAccount?.id ?? null,
        content,
        media_urls: imagePreviews,
        video_url: videoPreview,
        status: "published",
        created_at: new Date().toISOString(),
        author_username: isCommentingAsOrg
          ? (activeAccount?.name ?? null)
          : null,
        author_profile_picture_url: isCommentingAsOrg
          ? (activeAccount?.avatar_url ?? null)
          : null,
      };

      setComments((prev) => [...prev, optimisticComment]);
      setTotalCount((prev) => prev + 1);
      if (!isExpanded) setIsExpanded(true);
      resetMedia();

      const result = isStagingParticipant
        ? await stagingParticipant.createComment(postId, content)
        : await createComment({
            post_id: postId,
            wallet_address: account.address,
            account_id: activeAccount?.id,
            content,
            media_urls:
              uploadedImageUrls.length > 0 ? uploadedImageUrls : undefined,
            video_url: uploadedVideoUrl,
          });

      if (result.success && result.data) {
        setComments((prev) =>
          prev.map((c) => (c.id === optimisticComment.id ? result.data! : c))
        );
        if (
          !isStagingParticipant &&
          stagingEnabled &&
          citizenSession &&
          containsExplicitMeckyMention(result.data.content)
        ) {
          try {
            const request = await requestAppMeckyConversationAnswer({
              session: citizenSession,
              gateway: appMeckyConversationGateway,
              source: {
                postId,
                commentId: result.data.id,
                walletAddress: result.data.wallet_address.toLowerCase(),
                content: result.data.content,
                createdAt: result.data.created_at,
              },
            });
            setWaitingForMentionId(request.mentionId);
            setConversationPollVersion((value) => value + 1);
            toast.success("Kommentar veröffentlicht – Mecky antwortet hier.");
          } catch (error) {
            console.error("Mecky conversation request failed", error);
            toast.warning(
              "Der Kommentar ist veröffentlicht, aber Mecky konnte noch nicht gefragt werden."
            );
          }
        } else if (
          isStagingParticipant &&
          containsExplicitMeckyMention(result.data.content)
        ) {
          toast.warning(
            "Kommentar veröffentlicht. Die signierte Mecky-Antwort wird mit dem nächsten, getrennt geprüften Diskussionsschritt aktiviert."
          );
        }
      } else {
        // Rollback
        setComments((prev) =>
          prev.filter((c) => c.id !== optimisticComment.id)
        );
        setTotalCount((prev) => prev - 1);
        toast.error(result.error || "Fehler beim Kommentieren");
      }
    } catch {
      toast.error("Fehler beim Kommentieren");
    } finally {
      submitLockRef.current = false;
      setIsUploading(false);
    }
  };

  return (
    <div className="border-t border-border">
      {/* Show all comments button */}
      {visibleCommentCount > 0 && !isExpanded && (
          <button
            onClick={loadComments}
            className="w-full px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors text-left"
          >
            {visibleCommentCount === 1
              ? "1 Kommentar anzeigen"
              : `Alle ${visibleCommentCount} Kommentare anzeigen`}
          </button>
        )}

      {/* Comments list */}
      {isExpanded && (
        <div className="px-4 pb-1">
          {isLoading ? (
            <div className="py-3 text-center">
              <div className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent text-muted-foreground" />
            </div>
          ) : (
            comments.map((comment) => (
              <CommentItem key={comment.id} comment={comment} />
            ))
          )}
          {!isLoading &&
            transitionalReplies.map((reply) => (
              <MeckyCommentItem key={reply.id} reply={reply} />
            ))}
          {!isLoading &&
            (pendingMeckyRequests.length > 0 ||
              (meckyConversation?.pendingCount ?? 0) > 0 ||
              waitingForMentionId !== null) && (
              <div
                className="my-2 flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100"
                aria-live="polite"
              >
                <span className="flex items-center gap-2">
                  <Bot className="h-4 w-4" />
                  {meckyPollingPaused
                    ? "Mecky wurde gefragt. Die Antwort ist noch ausstehend."
                    : "Mecky prüft die verfügbaren öffentlichen Nachweise …"}
                </span>
                {meckyPollingPaused && (
                  <button
                    type="button"
                    onClick={() => {
                      setMeckyPollingPaused(false);
                      setConversationPollVersion((value) => value + 1);
                    }}
                    className="shrink-0 font-semibold underline underline-offset-2"
                  >
                    Erneut nach Mecky sehen
                  </button>
                )}
              </div>
            )}
        </div>
      )}

      {/* Comment input */}
      {canComment ? (
        <form onSubmit={handleSubmit} className="border-t border-border">
          {isStagingParticipant && (
            <p className="mx-4 mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
              {stagingParticipant.label}. Erlaubt sind nur Textkommentare.
            </p>
          )}
          {/* Active-account context — only when commenting as an org */}
          {!isStagingParticipant && isCommentingAsOrg && activeAccount && (
            <div className="flex items-center gap-2 px-4 pt-2 pb-1">
              <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center flex-shrink-0 overflow-hidden">
                {activeAccount.avatar_url ? (
                  <Image
                    src={activeAccount.avatar_url}
                    alt=""
                    width={24}
                    height={24}
                    className="object-cover w-full h-full"
                  />
                ) : (
                  <span className="text-[10px] font-medium text-muted-foreground">
                    {activeAccount.name.slice(0, 2).toUpperCase()}
                  </span>
                )}
              </div>
              <div className="flex flex-col leading-tight">
                <span className="text-xs font-medium text-foreground">
                  {activeAccount.name}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  Kommentiert als{" "}
                  {ACCOUNT_TYPE_LABELS[activeAccount.account_type]}
                </span>
              </div>
            </div>
          )}

          {/* Media previews */}
          {hasMedia && (
            <div className="px-4 pt-2 flex gap-2 flex-wrap">
              {imagePreviews.map((preview, i) => (
                <div
                  key={i}
                  className="relative w-14 h-14 rounded-md overflow-hidden"
                >
                  <Image
                    src={preview}
                    alt={`Vorschau ${i + 1}`}
                    fill
                    className="object-cover"
                    sizes="56px"
                  />
                  <button
                    type="button"
                    onClick={() => removeImage(i)}
                    className="absolute top-0.5 right-0.5 p-0.5 bg-black/60 rounded-full text-white hover:bg-black/80"
                    aria-label="Bild entfernen"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </div>
              ))}
              {videoPreview && (
                <div className="relative w-20 h-14 rounded-md overflow-hidden bg-black">
                  <video
                    src={videoPreview}
                    className="w-full h-full object-contain"
                    controls
                    muted
                    playsInline
                  />
                  <button
                    type="button"
                    onClick={removeVideo}
                    className="absolute top-0.5 right-0.5 p-0.5 bg-black/60 rounded-full text-white hover:bg-black/80"
                    aria-label="Video entfernen"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                  {videoUploadProgress != null && (
                    <>
                      <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                        <span className="text-white text-[10px] font-medium">
                          {videoUploadProgress < 100
                            ? `${videoUploadProgress}%`
                            : "…"}
                        </span>
                      </div>
                      <div className="absolute inset-x-0 bottom-0 h-0.5 bg-white/20">
                        <div
                          className="h-full bg-primary transition-all"
                          style={{ width: `${videoUploadProgress}%` }}
                        />
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="flex items-center gap-2 px-4 py-2">
            {!isStagingParticipant && (
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => imageInputRef.current?.click()}
                  disabled={imageFiles.length >= MAX_COMMENT_IMAGES}
                  className="p-1.5 text-muted-foreground hover:text-foreground rounded-full hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  aria-label="Bild hinzufügen"
                >
                  <ImagePlus className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => videoInputRef.current?.click()}
                  disabled={!!videoFile}
                  className="p-1.5 text-muted-foreground hover:text-foreground rounded-full hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  aria-label="Video hinzufügen"
                >
                  <Video className="h-4 w-4" />
                </button>
              </div>
            )}
            <input
              type="text"
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              placeholder="Kommentar schreiben..."
              maxLength={500}
              className="flex-1 bg-muted rounded-full px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20 placeholder:text-muted-foreground"
            />
            <button
              type="submit"
              disabled={
                (!newComment.trim() && !hasMedia) || isUploading
              }
              className="p-2 text-primary hover:bg-primary/10 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Kommentar senden"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>

          {/* Hidden file inputs */}
          <input
            ref={imageInputRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            multiple
            className="hidden"
            onChange={handleImageSelect}
          />
          <input
            ref={videoInputRef}
            type="file"
            accept="video/mp4,video/webm,video/quicktime"
            className="hidden"
            onChange={handleVideoSelect}
          />
        </form>
      ) : account ? (
        <div className="px-4 py-2 border-t border-border">
          <div className="space-y-1 text-center text-xs text-muted-foreground">
            <p>
              {stagingEnabled && stagingParticipant.isLoading
                ? "Staging-Schreibzugang wird geprüft …"
                : stagingEnabled && !stagingParticipant.isAvailable
                  ? "Der begrenzte Staging-Schreibdienst ist derzeit nicht erreichbar."
                : stagingParticipant.isAvailable && isCommentingAsOrg
                  ? "Organisationskommentare sind in diesem Staging-Schritt pausiert."
                  : stagingParticipant.isAvailable && postFeedType !== "main"
                    ? "Kommentare in diesem Bereich sind im aktuellen Staging-Schritt pausiert."
                    : stagingParticipant.isAvailable
                      ? "Für einen persönlichen Testkommentar zuerst die Staging-Testteilnahme aktivieren."
                      : "Nur verifizierte Bürger können kommentieren"}
            </p>
            {stagingEnabled &&
              postFeedType === "main" &&
              stagingParticipant.isAvailable &&
              !isCommentingAsOrg && (
                <StagingParticipantEnrollment
                  isEnrolling={stagingParticipant.isEnrolling}
                  enroll={stagingParticipant.enroll}
                  className="font-semibold text-primary hover:underline disabled:opacity-50"
                />
              )}
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 border-t border-border px-4 py-3 text-center">
          <p className="text-xs text-muted-foreground">
            Kommentare und Mecky-Antworten bleiben öffentlich lesbar.
          </p>
          <ConnectCta
            label="Anmelden und mitreden"
            title="Bei Röbel anmelden und mitreden"
            className="min-h-9 rounded-full px-4 py-2"
          />
        </div>
      )}
    </div>
  );
}
