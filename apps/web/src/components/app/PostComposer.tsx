"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Image from "next/image";
import { useActiveAccount } from "thirdweb/react";
import { useVerificationStatus } from "@/hooks/useVerificationStatus";
import { useUserProfile } from "@/hooks/useUserProfile";
import { createPost } from "@/app/actions/posts";
import { useAccount } from "@/lib/context/AccountContext";
import { isOrgAccount, ACCOUNT_TYPE_LABELS } from "@/types/account";
import {
  ImagePlus,
  Video,
  X,
  Loader2,
  Link as LinkIcon,
  BarChart3,
  Home,
  Landmark,
  Sparkles,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { uploadResumable } from "@/lib/storage/resumable-upload";
import {
  probeStreamConfigured,
  uploadVideoToStream,
  getVideoFileDuration,
  MAX_VIDEO_DURATION_SECONDS,
} from "@/lib/stream-upload";
import { PollCreator } from "@/components/app/PollCreator";
import { CategorySelector } from "@/components/app/CategorySelector";
import {
  GuidelinesBanner,
  GuidelinesInfoButton,
} from "@/components/app/CommunityGuidelines";
import type {
  OGMetadata,
  CreatePollInput,
  PostCategory,
  FeedType,
} from "@/types/post";
import { hasSupabase } from "@/lib/record";
import { useRouter } from "next/navigation";
import { useCitizenSession } from "@/lib/citizen-session/CitizenSessionContext";
import {
  containsExplicitMeckyMention,
  requestAppMeckyConversationAnswer,
} from "@/lib/stadtstack/app-mecky-conversation";
import { appMeckyConversationGateway } from "@/lib/stadtstack/app-mecky-gateway";
import { resolveStadtstackStagingLab } from "@/lib/stadtstack/staging-lab";
import { useStagingTestParticipant } from "@/hooks/useStagingTestParticipant";
import { StagingParticipantEnrollment } from "@/components/app/StagingParticipantEnrollment";
import {
  loadPendingStagingParticipantMeckyMirror,
  mirrorStagingParticipantMeckyPost,
  type PendingStagingParticipantMeckyMirror,
} from "@/lib/staging-participant/client";

const MAX_CHARS = 500;
const MAX_IMAGES = 10;
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_VIDEO_SIZE = 5 * 1024 * 1024 * 1024; // 5 GB (matches bucket cap)
const URL_REGEX = /https?:\/\/[^\s]+/g;

const FEED_OPTIONS: { id: FeedType; label: string; icon: typeof Home }[] = [
  { id: "main", label: "Alles", icon: Home },
  { id: "rathaus", label: "Stadt", icon: Landmark },
  { id: "app", label: "App", icon: Sparkles },
];

interface PostComposerProps {
  onPostCreated?: () => void;
  defaultFeedType?: FeedType;
  requireVerified?: boolean;
}

export function PostComposer({
  onPostCreated,
  defaultFeedType = "main",
  requireVerified = true,
}: PostComposerProps) {
  const router = useRouter();
  const account = useActiveAccount();
  const citizenSession = useCitizenSession();
  const { isVerified, isLoading: verificationLoading } =
    useVerificationStatus();
  const { user } = useUserProfile();
  const { activeAccount } = useAccount();

  const isPostingAsOrg = activeAccount ? isOrgAccount(activeAccount) : false;
  const stagingParticipantGatewayExpected = Boolean(
    resolveStadtstackStagingLab(
      process.env.NEXT_PUBLIC_STADTSTACK_STAGING_LAB,
    ),
  );
  // The temporary capability belongs only to the ordinary neighbourhood feed.
  // App and Rathaus composers retain their existing citizen/org behavior and
  // never offer a hidden route into the normal feed.
  const stagingParticipationCanBeUsedHere = defaultFeedType === "main";
  const stagingParticipant = useStagingTestParticipant(account);
  const isStagingParticipant =
    stagingParticipationCanBeUsedHere &&
    stagingParticipantGatewayExpected &&
    stagingParticipant.isAvailable &&
    stagingParticipant.isActive &&
    !isPostingAsOrg;
  const maxChars = isStagingParticipant ? 250 : MAX_CHARS;
  const canCreatePost = stagingParticipantGatewayExpected && stagingParticipant.isLoading
    ? false
    : stagingParticipantGatewayExpected
      ? isStagingParticipant
      : isVerified || isPostingAsOrg;

  const [isExpanded, setIsExpanded] = useState(false);
  const [content, setContent] = useState("");
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoPreview, setVideoPreview] = useState<string | null>(null);
  const [linkPreviews, setLinkPreviews] = useState<OGMetadata[]>([]);
  const [fetchedUrls, setFetchedUrls] = useState<Set<string>>(new Set());
  const [pollInput, setPollInput] = useState<CreatePollInput | null>(null);
  const [category, setCategory] = useState<PostCategory | null>(null);
  const [feedType, setFeedType] = useState<FeedType>(defaultFeedType);
  const [feedMenuOpen, setFeedMenuOpen] = useState(false);
  const [videoUploadProgress, setVideoUploadProgress] = useState<number | null>(
    null
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingParticipantMeckyPost, setPendingParticipantMeckyPost] =
    useState<PendingStagingParticipantMeckyMirror | null>(null);

  const participantWalletAddress =
    citizenSession?.snapshot.credential.address.toLowerCase() ??
    account?.address.toLowerCase() ??
    null;

  // Keep local feed selection in sync when the active tab changes
  useEffect(() => {
    setFeedType(defaultFeedType);
  }, [defaultFeedType]);

  // A failed participant mirror survives a reload as a short-lived, public-only
  // record. It is scoped to the current wallet; the admission proof is never
  // restored and will be regenerated by the retry handler below.
  useEffect(() => {
    if (!isStagingParticipant || !participantWalletAddress) {
      setPendingParticipantMeckyPost(null);
      return;
    }
    setPendingParticipantMeckyPost(
      loadPendingStagingParticipantMeckyMirror(participantWalletAddress),
    );
  }, [isStagingParticipant, participantWalletAddress]);

  const canPostToRathaus = isVerified || isPostingAsOrg;

  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const submitLockRef = useRef(false);

  const retryParticipantMeckyPost = useCallback(async () => {
    const pending = pendingParticipantMeckyPost;
    if (!pending || submitLockRef.current) return;
    submitLockRef.current = true;
    setIsSubmitting(true);
    try {
      const retry = await mirrorStagingParticipantMeckyPost({
        sourcePost: pending.sourcePost,
        session: citizenSession,
        retry: pending,
      });
      if (retry.success) {
        setPendingParticipantMeckyPost(null);
        toast.success("Mecky wurde signiert gefragt.");
        router.push(`/app/posts/${pending.sourcePost.id}`);
      } else {
        // Invalid/expired retry data is returned without `pending`; do not
        // keep an unrecoverable in-memory copy after storage was cleared.
        setPendingParticipantMeckyPost(retry.pending ?? null);
        toast.warning(
          "Mecky ist noch nicht sicher erreichbar; die Anfrage bleibt zum erneuten Versuch erhalten.",
        );
      }
    } finally {
      submitLockRef.current = false;
      setIsSubmitting(false);
    }
  }, [citizenSession, pendingParticipantMeckyPost, router]);

  const shortAddress = account?.address
    ? `${account.address.slice(0, 4)}...${account.address.slice(-3)}`
    : "";
  const displayName = user?.username || shortAddress;

  // Auto-detect URLs in content and fetch OG previews
  const fetchOGForUrls = useCallback(
    async (text: string) => {
      const urls = text.match(URL_REGEX) || [];
      for (const url of urls) {
        if (fetchedUrls.has(url)) continue;
        setFetchedUrls((prev) => new Set(prev).add(url));
        try {
          const res = await fetch(
            `/api/og-metadata?url=${encodeURIComponent(url)}`
          );
          const json = await res.json();
          if (
            json.success &&
            json.data &&
            (json.data.title || json.data.image)
          ) {
            setLinkPreviews((prev) => {
              if (prev.some((p) => p.url === json.data.url)) return prev;
              return [...prev, json.data];
            });
          }
        } catch {
          // Ignore fetch errors
        }
      }
    },
    [fetchedUrls]
  );

  // Debounced URL detection
  useEffect(() => {
    if (!content || isStagingParticipant) return;
    const timeout = setTimeout(() => fetchOGForUrls(content), 800);
    return () => clearTimeout(timeout);
  }, [content, fetchOGForUrls, isStagingParticipant]);

  // Handle image selection
  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const remaining = MAX_IMAGES - imageFiles.length;
    const newFiles = files.slice(0, remaining);

    if (files.length > remaining) {
      toast.error(`Maximal ${MAX_IMAGES} Bilder erlaubt`);
    }

    setImageFiles((prev) => [...prev, ...newFiles]);

    // Generate previews
    for (const file of newFiles) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        setImagePreviews((prev) => [...prev, ev.target?.result as string]);
      };
      reader.readAsDataURL(file);
    }

    // Reset input
    e.target.value = "";
  };

  // Handle video selection
  const handleVideoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset input so the same file can be re-picked after a rejection
    e.target.value = "";
    if (!file) return;

    if (file.size > MAX_VIDEO_SIZE) {
      toast.error("Video darf maximal 5 GB groß sein");
      return;
    }

    // Cloudflare Stream validates duration only AFTER the full upload —
    // reject over-long videos here instead of after gigabytes of upload.
    if (await probeStreamConfigured()) {
      try {
        const duration = await getVideoFileDuration(file);
        if (duration > MAX_VIDEO_DURATION_SECONDS) {
          toast.error(
            `Video ist zu lang (maximal ${Math.floor(MAX_VIDEO_DURATION_SECONDS / 60)} Minuten)`
          );
          return;
        }
      } catch {
        // metadata unreadable — let the server-side cap decide
      }
    }

    setVideoFile(file);
    setVideoPreview(URL.createObjectURL(file));
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

  const removeLinkPreview = (url: string) => {
    setLinkPreviews((prev) => prev.filter((p) => p.url !== url));
  };

  // Upload a file directly to Supabase Storage (bypasses Vercel body size limit).
  // Images use the simple non-resumable path; videos use TUS resumable so multi-
  // hundred-MB uploads survive flaky networks and don't hit the per-request cap.
  const uploadToStorage = async (
    file: File,
    type: "image" | "video"
  ): Promise<string | null> => {
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
    const prefix = type === "video" ? "post-videos" : "post-images";
    const fileName = `${prefix}/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;

    if (type === "video") {
      try {
        setVideoUploadProgress(0);
        // Cloudflare Stream (adaptive HLS) when configured; Supabase Storage otherwise.
        if (await probeStreamConfigured()) {
          const url = await uploadVideoToStream(
            file,
            account?.address ?? "",
            (pct) => setVideoUploadProgress(pct)
          );
          if (!url)
            toast.error(
              "Video-Upload fehlgeschlagen. Bitte versuche es erneut."
            );
          return url;
        }
        const url = await uploadResumable({
          file,
          bucket: "images",
          path: fileName,
          contentType: file.type || "video/mp4",
          onProgress: (pct) => setVideoUploadProgress(pct),
        });
        return url;
      } catch (err) {
        console.error("Resumable upload error:", err);
        toast.error("Video-Upload fehlgeschlagen. Bitte versuche es erneut.");
        return null;
      } finally {
        setVideoUploadProgress(null);
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
  };

  // Submit post
  const handleSubmit = async () => {
    if (!account?.address || !content.trim() || submitLockRef.current) return;

    submitLockRef.current = true;
    setIsSubmitting(true);

    try {
      // Upload images directly to Supabase Storage
      const uploadedImageUrls: string[] = [];
      if (!isStagingParticipant) {
        for (const file of imageFiles) {
          const url = await uploadToStorage(file, "image");
          if (url) uploadedImageUrls.push(url);
        }
      }

      // Upload video directly to Supabase Storage. If a video was attached
      // and the upload fails, abort the whole submit so we don't end up with
      // a text-only ghost post the user didn't ask for. uploadToStorage has
      // already toasted the error.
      let uploadedVideoUrl: string | null = null;
      if (!isStagingParticipant && videoFile) {
        uploadedVideoUrl = await uploadToStorage(videoFile, "video");
        if (!uploadedVideoUrl) {
          return;
        }
      }

      // Extract URLs from content
      const linkUrls = isStagingParticipant ? [] : content.match(URL_REGEX) || [];

      // Validate poll options if poll is attached
      const validPoll =
        pollInput && pollInput.options.filter((o) => o.trim()).length >= 2
          ? { ...pollInput, options: pollInput.options.filter((o) => o.trim()) }
          : undefined;

      const targetFeedType: FeedType =
        feedType === "rathaus" && !canPostToRathaus ? "main" : feedType;
      const submittedContent = content.trim();

      const result = isStagingParticipant
        ? await stagingParticipant.createPost(submittedContent)
        : await createPost({
            wallet_address: account.address,
            account_id: activeAccount?.id,
            content: submittedContent,
            category: category || "generell",
            feed_type: targetFeedType,
            media_urls: uploadedImageUrls,
            video_url: uploadedVideoUrl,
            link_urls: linkUrls,
            poll: validPoll,
          });

      if (result.success && result.data) {
        let meckyRequested = false;
        let participantMeckyMirrored = false;
        let participantMeckyDeferred = false;
        if (
          !isStagingParticipant &&
          citizenSession &&
          resolveStadtstackStagingLab(
            process.env.NEXT_PUBLIC_STADTSTACK_STAGING_LAB
          ) &&
          containsExplicitMeckyMention(submittedContent)
        ) {
          try {
            await requestAppMeckyConversationAnswer({
              session: citizenSession,
              gateway: appMeckyConversationGateway,
              source: {
                postId: result.data.id,
                walletAddress: result.data.wallet_address.toLowerCase(),
                content: result.data.content,
                createdAt: result.data.created_at,
              },
            });
            meckyRequested = true;
          } catch (error) {
            console.error("Mecky conversation request failed", error);
            toast.warning(
              "Der Beitrag ist veröffentlicht, aber Mecky konnte noch nicht gefragt werden."
            );
          }
        }
        if (
          isStagingParticipant &&
          containsExplicitMeckyMention(submittedContent)
        ) {
          if (!citizenSession) {
            participantMeckyDeferred = true;
          } else {
            const mirrored = await mirrorStagingParticipantMeckyPost({
              sourcePost: result.data,
              session: citizenSession,
            });
            participantMeckyMirrored = mirrored.success;
            participantMeckyDeferred = !mirrored.success;
            if (!mirrored.success) setPendingParticipantMeckyPost(mirrored.pending ?? null);
            else setPendingParticipantMeckyPost(null);
          }
        }
        // Reset form
        setContent("");
        setImageFiles([]);
        setImagePreviews([]);
        removeVideo();
        setLinkPreviews([]);
        setFetchedUrls(new Set());
        setPollInput(null);
        setCategory(null);
        setFeedType(defaultFeedType);
        setIsExpanded(false);
        if (participantMeckyDeferred) {
          toast.warning(
            "Beitrag veröffentlicht. Mecky konnte noch nicht sicher erreicht werden; es wurde keine Ersatzantwort erzeugt."
          );
        } else {
          toast.success(
            participantMeckyMirrored
              ? "Beitrag veröffentlicht – Mecky wurde signiert gefragt."
              : meckyRequested
              ? "Beitrag veröffentlicht – Mecky antwortet im Gespräch."
              : "Beitrag veröffentlicht!"
          );
        }
        onPostCreated?.();
        if (meckyRequested || participantMeckyMirrored) router.push(`/app/posts/${result.data.id}`);
      } else {
        toast.error(result.error || "Fehler beim Veröffentlichen");
      }
    } catch {
      toast.error("Fehler beim Veröffentlichen");
    } finally {
      submitLockRef.current = false;
      setIsSubmitting(false);
    }
  };

  // Posting always needs the backend — never show a composer that can't submit.
  if (!hasSupabase) return null;

  if (account && stagingParticipantGatewayExpected && stagingParticipant.isLoading) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
        Staging-Schreibzugang wird geprüft …
      </div>
    );
  }

  if (account && stagingParticipantGatewayExpected && !stagingParticipant.isAvailable) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
        Der begrenzte Staging-Schreibdienst ist derzeit nicht erreichbar. Es
        wird kein unsicherer Legacy-Schreibweg verwendet.
      </div>
    );
  }

  // In the separately armed staging database all legacy direct feed writes are
  // closed. The reviewed gateway currently supports only a personal, text-only
  // main-feed tracer; never let another UI path fail silently against the DB.
  if (account && stagingParticipantGatewayExpected && !isStagingParticipant) {
    const message = isPostingAsOrg
      ? "Organisationsbeiträge sind in diesem Staging-Schritt pausiert. Bitte zum persönlichen Profil wechseln."
      : !stagingParticipationCanBeUsedHere
        ? "Beiträge in diesem Bereich sind im aktuellen Staging-Schritt pausiert."
        : "Für einen persönlichen Testbeitrag zuerst die begrenzte Staging-Testteilnahme aktivieren.";
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <p className="text-sm text-muted-foreground">{message}</p>
        {!isPostingAsOrg && stagingParticipationCanBeUsedHere && (
          <StagingParticipantEnrollment
            isEnrolling={stagingParticipant.isEnrolling}
            enroll={stagingParticipant.enroll}
            className="mt-2 text-xs font-semibold text-primary hover:underline disabled:opacity-50"
          />
        )}
      </div>
    );
  }

  // Non-citizen state — only blocks when the parent feed requires verification
  if (
    requireVerified &&
    !verificationLoading &&
    account &&
    !canCreatePost
  ) {
    return (
      <div className="bg-card rounded-lg border border-border p-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center text-sm font-medium text-muted-foreground flex-shrink-0">
            {displayName.slice(0, 2).toUpperCase()}
          </div>
          <div className="flex-1 space-y-2 rounded-xl bg-muted px-4 py-2.5 text-sm text-muted-foreground">
            <p>Nur verifizierte Bürger können Beiträge erstellen</p>
          </div>
        </div>
      </div>
    );
  }

  // Collapsed state
  if (!isExpanded) {
    return (
      <div className="bg-card rounded-lg border border-border p-4">
        {isStagingParticipant && pendingParticipantMeckyPost && (
          <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
            <p>Der Beitrag ist veröffentlicht; die signierte Mecky-Anfrage wartet noch auf einen sicheren Versand.</p>
            <button
              type="button"
              className="mt-1 font-semibold underline disabled:opacity-50"
              disabled={isSubmitting}
              onClick={() => void retryParticipantMeckyPost()}
            >
              Mecky-Anfrage erneut senden
            </button>
          </div>
        )}
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center text-sm font-medium text-muted-foreground flex-shrink-0 overflow-hidden">
            {isPostingAsOrg && activeAccount?.avatar_url ? (
              <Image
                src={activeAccount.avatar_url}
                alt=""
                width={40}
                height={40}
                className="object-cover w-full h-full"
              />
            ) : user?.profile_picture_url ? (
              <Image
                src={user.profile_picture_url}
                alt=""
                width={40}
                height={40}
                className="object-cover w-full h-full"
              />
            ) : (
              (isPostingAsOrg && activeAccount
                ? activeAccount.name
                : displayName
              )
                .slice(0, 2)
                .toUpperCase()
            )}
          </div>
          <button
            onClick={() => {
              setIsExpanded(true);
              setTimeout(() => textareaRef.current?.focus(), 100);
            }}
            className="flex-1 py-2.5 px-4 bg-muted rounded-full text-sm text-muted-foreground hover:bg-accent transition-colors text-left"
          >
            Was gibt es Neues, Nachbar?
          </button>
          {!isStagingParticipant && <button
            onClick={() => {
              setIsExpanded(true);
              setTimeout(() => imageInputRef.current?.click(), 100);
            }}
            className="p-2 text-muted-foreground hover:text-foreground rounded-full hover:bg-accent transition-colors"
            aria-label="Bild hinzufügen"
          >
            <ImagePlus className="h-5 w-5" />
          </button>}
        </div>
      </div>
    );
  }

  // Expanded composer
  return (
    <div className="bg-card rounded-lg border border-border overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 pb-2">
        <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center text-sm font-medium text-muted-foreground flex-shrink-0 overflow-hidden">
          {isPostingAsOrg && activeAccount?.avatar_url ? (
            <Image
              src={activeAccount.avatar_url}
              alt=""
              width={40}
              height={40}
              className="object-cover w-full h-full"
            />
          ) : user?.profile_picture_url ? (
            <Image
              src={user.profile_picture_url}
              alt=""
              width={40}
              height={40}
              className="object-cover w-full h-full"
            />
          ) : (
            displayName.slice(0, 2).toUpperCase()
          )}
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-medium text-foreground">
            {isPostingAsOrg ? activeAccount?.name : displayName}
          </span>
          {isPostingAsOrg && activeAccount && (
            <span className="text-[10px] text-muted-foreground">
              Posting als {ACCOUNT_TYPE_LABELS[activeAccount.account_type]}
            </span>
          )}
        </div>
        <button
          onClick={() => {
            if (
              !content &&
              imageFiles.length === 0 &&
              !videoFile &&
              !pollInput
            ) {
              setIsExpanded(false);
            }
          }}
          className="ml-auto p-1.5 text-muted-foreground hover:text-foreground rounded-md hover:bg-accent transition-colors"
          aria-label="Schließen"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Community Guidelines Banner (first-time only) */}
      <GuidelinesBanner />

      {isStagingParticipant && (
        <div className="mx-4 mb-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
          {stagingParticipant.label}. Erlaubt sind nur Textbeiträge im normalen Feed.
        </div>
      )}

      {isStagingParticipant && pendingParticipantMeckyPost && (
        <div className="mx-4 mb-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
          <p>Der Beitrag ist veröffentlicht; die signierte Mecky-Anfrage wartet noch auf einen sicheren Versand.</p>
          <button
            type="button"
            className="mt-1 font-semibold underline disabled:opacity-50"
            disabled={isSubmitting}
            onClick={() => void retryParticipantMeckyPost()}
          >
            Mecky-Anfrage erneut senden
          </button>
        </div>
      )}

      {/* Feed-target selector */}
      {!isStagingParticipant && <div className="px-4 pb-2">
        <div className="relative inline-block">
          <button
            type="button"
            onClick={() => setFeedMenuOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-medium text-foreground hover:bg-accent transition-colors"
          >
            <span className="text-muted-foreground">An:</span>
            {(() => {
              const opt = FEED_OPTIONS.find((o) => o.id === feedType)!;
              const Icon = opt.icon;
              return (
                <>
                  <Icon className="h-3.5 w-3.5" />
                  {opt.label}
                </>
              );
            })()}
            <span className="text-muted-foreground">▾</span>
          </button>
          {feedMenuOpen && (
            <div className="absolute z-10 mt-1 w-40 rounded-md border border-border bg-card shadow-md py-1">
              {FEED_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                const disabled = opt.id === "rathaus" && !canPostToRathaus;
                const selected = feedType === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      if (disabled) return;
                      setFeedType(opt.id);
                      setFeedMenuOpen(false);
                    }}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors ${
                      disabled
                        ? "text-muted-foreground cursor-not-allowed opacity-60"
                        : "text-foreground hover:bg-accent"
                    }`}
                    title={disabled ? "Nur für verifizierte Bürger" : undefined}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span className="flex-1">{opt.label}</span>
                    {selected && <Check className="h-3.5 w-3.5 text-primary" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>}

      {/* Textarea */}
      <div className="px-4 pb-2">
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => {
            if (Array.from(e.target.value).length <= maxChars) {
              setContent(e.target.value);
            }
          }}
          placeholder="Was gibt es Neues, Nachbar?"
          className="w-full resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none min-h-[80px]"
          rows={3}
          maxLength={maxChars}
          autoFocus
        />
        <div className="flex justify-end">
          <span
            className={`text-xs ${
              Array.from(content).length >= maxChars
                ? "text-destructive"
                : Array.from(content).length >= maxChars * 0.8
                  ? "text-yellow-500"
                  : "text-muted-foreground"
            }`}
          >
            {Array.from(content).length}/{maxChars}
          </span>
        </div>
      </div>

      {/* Category selector */}
      {!isStagingParticipant && <div className="px-4 pb-2">
        <CategorySelector value={category} onChange={setCategory} />
      </div>}

      {/* Image previews */}
      {imagePreviews.length > 0 && (
        <div className="px-4 pb-2">
          <div className="flex gap-2 flex-wrap">
            {imagePreviews.map((preview, i) => (
              <div
                key={i}
                className="relative w-20 h-20 rounded-lg overflow-hidden"
              >
                <Image
                  src={preview}
                  alt={`Vorschau ${i + 1}`}
                  fill
                  className="object-cover"
                  sizes="80px"
                />
                <button
                  onClick={() => removeImage(i)}
                  className="absolute top-1 right-1 p-0.5 bg-black/60 rounded-full text-white hover:bg-black/80"
                  aria-label="Bild entfernen"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Video preview */}
      {videoPreview && (
        <div className="px-4 pb-2">
          <div className="relative rounded-lg overflow-hidden bg-black max-h-40">
            <video
              src={videoPreview}
              className="w-full max-h-40 object-contain"
              controls
              muted
              playsInline
            />
            <button
              onClick={removeVideo}
              className="absolute top-2 right-2 p-1 bg-black/60 rounded-full text-white hover:bg-black/80"
              aria-label="Video entfernen"
            >
              <X className="h-4 w-4" />
            </button>
            {videoUploadProgress != null && (
              <>
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                  <span className="text-white text-sm font-medium">
                    {videoUploadProgress < 100
                      ? `Hochladen… ${videoUploadProgress}%`
                      : "Verarbeite…"}
                  </span>
                </div>
                <div className="absolute inset-x-0 bottom-0 h-1 bg-white/20">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{ width: `${videoUploadProgress}%` }}
                  />
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Link previews */}
      {linkPreviews.length > 0 && (
        <div className="px-4 pb-2 space-y-2">
          {linkPreviews.map((preview) => (
            <div
              key={preview.url}
              className="flex items-start gap-2 p-2 rounded-lg border border-border bg-muted"
            >
              {preview.image && (
                <div className="relative w-16 h-16 rounded overflow-hidden flex-shrink-0">
                  <Image
                    src={preview.image}
                    alt=""
                    fill
                    className="object-cover"
                    sizes="64px"
                  />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-foreground line-clamp-1">
                  {preview.title || preview.url}
                </p>
                {preview.description && (
                  <p className="text-xs text-muted-foreground line-clamp-1">
                    {preview.description}
                  </p>
                )}
                <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                  <LinkIcon className="h-3 w-3" />
                  {preview.siteName}
                </p>
              </div>
              <button
                onClick={() => removeLinkPreview(preview.url)}
                className="p-0.5 text-muted-foreground hover:text-foreground"
                aria-label="Vorschau entfernen"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Poll creator */}
      {pollInput !== null && (
        <PollCreator value={pollInput} onChange={setPollInput} />
      )}

      {/* Action bar */}
      <div className="flex items-center justify-between px-4 py-3 border-t border-border">
        <div className="flex items-center gap-1">
          {!isStagingParticipant && <button
            onClick={() => imageInputRef.current?.click()}
            disabled={imageFiles.length >= MAX_IMAGES}
            className="p-2 text-muted-foreground hover:text-foreground rounded-full hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Bilder hinzufügen"
          >
            <ImagePlus className="h-5 w-5" />
          </button>}
          {!isStagingParticipant && <button
            onClick={() => videoInputRef.current?.click()}
            disabled={!!videoFile}
            className="p-2 text-muted-foreground hover:text-foreground rounded-full hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Video hinzufügen"
          >
            <Video className="h-5 w-5" />
          </button>}
          {!isStagingParticipant && <button
            onClick={() =>
              setPollInput(
                pollInput
                  ? null
                  : { poll_type: "single", options: ["", ""], duration_days: 1 }
              )
            }
            className={`p-2 rounded-full hover:bg-accent transition-colors ${
              pollInput
                ? "text-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
            aria-label="Umfrage erstellen"
          >
            <BarChart3 className="h-5 w-5" />
          </button>}
          <GuidelinesInfoButton />
        </div>

        <button
          onClick={handleSubmit}
          disabled={
            !content.trim() ||
            isSubmitting ||
            videoUploadProgress != null
          }
          className="px-4 py-2 bg-primary text-primary-foreground rounded-full text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {isSubmitting && (
            <Loader2 className="h-4 w-4 animate-spin" />
          )}
          {videoUploadProgress != null
            ? videoUploadProgress < 100
              ? `Hochladen ${videoUploadProgress}%`
              : "Verarbeite…"
            : "Veröffentlichen"}
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
    </div>
  );
}
